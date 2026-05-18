-- Migration: Cascade dispute resolution across related bounty-lifecycle tables
-- Created: 2026-05-18
--
-- Problem:
--   When a dispute is resolved (winner = hunter or poster), only the
--   `bounty_disputes` row is updated (status / resolution / resolved_at /
--   winner).  The bounty itself, the per-applicant `bounty_requests` rows,
--   and any pending `completion_submissions` are left untouched, so the
--   bounty continues to appear active across feeds, dashboards, and
--   downstream queries even though the dispute is fully resolved.
--
-- Fix:
--   Add a SECURITY DEFINER AFTER UPDATE trigger on `bounty_disputes` that
--   atomically cascades the resolution to the related tables whenever the
--   dispute status transitions to a terminal hunter-wins / poster-wins
--   state.  All cascading writes are guarded by status filters so the
--   trigger is idempotent and safe to fire repeatedly (e.g. when the
--   service performs both an RPC update via fn_close_dispute_hold and a
--   subsequent metadata UPDATE on the dispute row).
--
-- Outcome mapping:
--   hunter wins  → bounties.status              = 'completed'
--                  completion_submissions.status = 'approved'   (pending / revision_requested)
--                  bounty_requests.status        = 'rejected'   (only still-pending; accepted stays)
--   poster wins  → bounties.status              = 'cancelled'
--                  completion_submissions.status = 'rejected'   (pending / revision_requested)
--                  bounty_requests.status        = 'rejected'   (pending and accepted)
--
-- Neutral closes ('resolved' without a winner, 'closed', 'cancelled') do
-- NOT cascade — they are administrative closes that should not force a
-- bounty-lifecycle transition.

CREATE OR REPLACE FUNCTION public.trg_fn_cascade_dispute_resolution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outcome TEXT;  -- 'hunter_wins' | 'poster_wins' | NULL
BEGIN
  -- Only act when the dispute status actually changes.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Determine the lifecycle outcome.  The `winner` column is the source of
  -- truth when present; otherwise infer from the resolved_* statuses.
  IF NEW.status = 'resolved_hunter_wins'
     OR (NEW.status = 'resolved' AND NEW.winner = 'hunter') THEN
    v_outcome := 'hunter_wins';
  ELSIF NEW.status = 'resolved_poster_wins'
     OR (NEW.status = 'resolved' AND NEW.winner = 'poster') THEN
    v_outcome := 'poster_wins';
  ELSE
    -- Neutral close — leave related rows alone.
    RETURN NEW;
  END IF;

  IF NEW.bounty_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_outcome = 'hunter_wins' THEN
    -- Mark the bounty as completed.  Guard with a status filter so this is
    -- idempotent and avoids reviving already-archived/deleted bounties.
    UPDATE public.bounties
       SET status = 'completed'
     WHERE id = NEW.bounty_id
       AND status IN ('open', 'in_progress', 'cancellation_requested');

    -- Approve any pending / revision-requested completion submissions.
    UPDATE public.completion_submissions
       SET status      = 'approved',
           reviewed_at = COALESCE(reviewed_at, NOW())
     WHERE bounty_id = NEW.bounty_id
       AND status IN ('pending', 'revision_requested');

    -- Reject any still-pending applicant requests; leave already-accepted
    -- requests in place (the accepted hunter is the dispute winner).
    UPDATE public.bounty_requests
       SET status = 'rejected'
     WHERE bounty_id = NEW.bounty_id
       AND status = 'pending';

  ELSE  -- poster_wins
    -- Cancel the bounty.
    UPDATE public.bounties
       SET status = 'cancelled'
     WHERE id = NEW.bounty_id
       AND status IN ('open', 'in_progress', 'cancellation_requested');

    -- Reject any pending / revision-requested completion submissions.
    UPDATE public.completion_submissions
       SET status      = 'rejected',
           reviewed_at = COALESCE(reviewed_at, NOW())
     WHERE bounty_id = NEW.bounty_id
       AND status IN ('pending', 'revision_requested');

    -- Reject all outstanding applicant requests (pending and accepted) —
    -- the bounty itself is being cancelled so no applicant can proceed.
    UPDATE public.bounty_requests
       SET status = 'rejected'
     WHERE bounty_id = NEW.bounty_id
       AND status IN ('pending', 'accepted');
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_fn_cascade_dispute_resolution() IS
  'Trigger function: when a bounty_disputes row transitions to a terminal '
  'hunter-wins or poster-wins state, atomically cascade the resolution to '
  'bounties.status, bounty_requests.status, and completion_submissions.status. '
  'Idempotent — safe to fire multiple times for the same dispute.';

-- Drop the trigger first so the migration is fully idempotent.
DROP TRIGGER IF EXISTS trg_bounty_disputes_cascade_resolution
  ON public.bounty_disputes;

CREATE TRIGGER trg_bounty_disputes_cascade_resolution
  AFTER UPDATE OF status ON public.bounty_disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_cascade_dispute_resolution();

-- ─── Backfill: reconcile already-resolved disputes ───────────────────────────
-- Any dispute that was resolved before this migration may have left its
-- bounty / requests / submissions in an inconsistent state.  Re-run the
-- cascade logic for each historical winner-bearing resolution so the
-- system is consistent from the moment this migration is applied.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, bounty_id, status, winner
      FROM public.bounty_disputes
     WHERE bounty_id IS NOT NULL
       AND (
            status IN ('resolved_hunter_wins', 'resolved_poster_wins')
         OR (status = 'resolved' AND winner IN ('hunter', 'poster'))
       )
  LOOP
    IF r.status = 'resolved_hunter_wins'
       OR (r.status = 'resolved' AND r.winner = 'hunter') THEN
      UPDATE public.bounties
         SET status = 'completed'
       WHERE id = r.bounty_id
         AND status IN ('open', 'in_progress', 'cancellation_requested');

      UPDATE public.completion_submissions
         SET status      = 'approved',
             reviewed_at = COALESCE(reviewed_at, NOW())
       WHERE bounty_id = r.bounty_id
         AND status IN ('pending', 'revision_requested');

      UPDATE public.bounty_requests
         SET status = 'rejected'
       WHERE bounty_id = r.bounty_id
         AND status = 'pending';

    ELSE  -- poster wins
      UPDATE public.bounties
         SET status = 'cancelled'
       WHERE id = r.bounty_id
         AND status IN ('open', 'in_progress', 'cancellation_requested');

      UPDATE public.completion_submissions
         SET status      = 'rejected',
             reviewed_at = COALESCE(reviewed_at, NOW())
       WHERE bounty_id = r.bounty_id
         AND status IN ('pending', 'revision_requested');

      UPDATE public.bounty_requests
         SET status = 'rejected'
       WHERE bounty_id = r.bounty_id
         AND status IN ('pending', 'accepted');
    END IF;
  END LOOP;
END $$;
