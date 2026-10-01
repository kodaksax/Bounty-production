-- Escrow commitment (trust-spine audit 2026-09-30, T4 / S2 / S4).
--
-- Two holes, reproduced on staging 2026-10-01 before this fix:
--   * S4: the bounties UPDATE policies are poster-only with no column or
--     transition restriction. After a hunter is accepted and escrow is held,
--     the poster could PATCH accepted_by to another account, set status to
--     cancelled / open / deleted / cancellation_requested, or DELETE the row
--     (which cascades bounty_requests + completion_submissions and NULLs
--     wallet_transactions.bounty_id, detaching the escrow).
--   * S2: POST /wallet/refund (and /bounty-payments/cancel) authorised the
--     owner with no state check, so a poster could take 100% of the escrow
--     back after the hunter was accepted, after work was submitted, or during
--     a dispute.
--
-- 1. trg_bounties_guard_lifecycle: a BEFORE UPDATE OR DELETE guard that only
--    applies to direct client writes (current_user = authenticated/anon) by a
--    non-admin. Every server path is untouched: the lifecycle RPCs
--    (fn_accept_bounty_request, request_bounty_cancellation, admin_*), the
--    dispute cascade and every other SECURITY DEFINER function run as the
--    function owner, and edge functions run as service_role.
--
--    Direct-write transitions still allowed (inventoried from the client on
--    main @ 3fd015d0; each is exercised by the staging suite):
--      open/cancelled/archived/deleted -> anything except in_progress,
--        cancellation_requested, completed   (edit, cancel, archive, delete,
--        repost of a never-committed bounty)
--      in_progress            -> completed   (approve: payout.tsx,
--                                             completion-service.approveSubmission)
--      cancellation_requested -> in_progress (poster rejects hunter's request)
--      cancellation_requested -> cancelled   (poster accepts hunter's request;
--                                             requires that request to exist)
--      completed              -> archived | deleted
--    Never by direct write: accepted_by / accepted_request_id (only
--    fn_accept_bounty_request assigns a hunter), entering in_progress
--    or cancellation_requested (only the RPCs), completed_at outside the
--    completing update, and DELETE of a bounty a hunter is committed to.
--
-- 2. fn_owner_refund_block_reason(bounty, caller): the single rule both
--    refund endpoints call before moving escrow back to the poster.
--      allowed  -> no hunter was ever accepted, or the accepted hunter filed a
--                  cancellation that is pending/accepted;
--      blocked  -> anything else, and always while a dispute is open.
--    Returns NULL when allowed, otherwise a machine-readable reason.
--
-- Rollback (generated from each environment's live pre-migration state):
--   supabase/rollbacks/production/20261001120100_bounty_lifecycle_guard_and_refund_gate.down.sql
--   supabase/rollbacks/staging/20261001120100_bounty_lifecycle_guard_and_refund_gate.down.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_bounties_guard_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER on purpose: current_user identifies a direct client write.
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_from text;
  v_to   text;
  v_committed boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_from := OLD.status::text;
  v_committed := OLD.accepted_by IS NOT NULL
                 OR v_from IN ('in_progress', 'cancellation_requested', 'completed');

  IF TG_OP = 'DELETE' THEN
    IF v_committed THEN
      RAISE EXCEPTION 'bounty_delete_not_allowed_after_acceptance'
        USING ERRCODE = '42501',
              HINT = 'A hunter is committed to this bounty. Use the cancellation or dispute flow.';
    END IF;
    RETURN OLD;
  END IF;

  v_to := NEW.status::text;

  -- Hunter assignment is owned by fn_accept_bounty_request. The one implicit
  -- change allowed is fn_bounties_clear_worker_when_reopened nulling
  -- accepted_by when a never-committed bounty goes back to 'open'.
  IF NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
     AND NOT (NEW.accepted_by IS NULL AND v_to = 'open'
              AND v_from NOT IN ('in_progress', 'cancellation_requested', 'completed'))
  THEN
    RAISE EXCEPTION 'bounty_assignment_is_server_managed'
      USING ERRCODE = '42501',
            HINT = 'Accept an application with fn_accept_bounty_request.';
  END IF;
  -- (Not hunter_id: that legacy column exists on staging but not on prod.)
  IF NEW.accepted_request_id IS DISTINCT FROM OLD.accepted_request_id THEN
    RAISE EXCEPTION 'bounty_assignment_is_server_managed' USING ERRCODE = '42501';
  END IF;

  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at
     AND NOT (v_to = 'completed' AND v_from IS DISTINCT FROM 'completed')
  THEN
    RAISE EXCEPTION 'bounty_completed_at_is_server_managed' USING ERRCODE = '42501';
  END IF;

  IF v_to IS NOT DISTINCT FROM v_from THEN
    RETURN NEW;
  END IF;

  IF (v_from = 'in_progress' AND v_to = 'completed')
     OR (v_from = 'cancellation_requested' AND v_to = 'in_progress')
     OR (v_from = 'completed' AND v_to IN ('archived', 'deleted'))
  THEN
    RETURN NEW;
  END IF;

  IF v_from = 'cancellation_requested' AND v_to = 'cancelled' THEN
    IF EXISTS (
      SELECT 1 FROM public.bounty_cancellations bc
       WHERE bc.bounty_id = OLD.id
         AND bc.requester_id = OLD.accepted_by
         AND bc.status IN ('pending', 'accepted')
    ) THEN
      RETURN NEW;
    END IF;
  ELSIF v_from IN ('cancelled', 'archived', 'deleted') AND OLD.accepted_by IS NOT NULL THEN
    -- Ended after a hunter was accepted: tidy-up only (archive / delete),
    -- never back into the marketplace with the old hunter's escrow history.
    IF v_to IN ('cancelled', 'archived', 'deleted') THEN
      RETURN NEW;
    END IF;
  ELSIF NOT v_committed
        AND v_to NOT IN ('in_progress', 'cancellation_requested', 'completed')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'bounty_status_transition_not_allowed: % -> %', v_from, v_to
    USING ERRCODE = '42501',
          HINT = 'Once a hunter is accepted the bounty can only be completed, or ended through '
                 'the hunter''s cancellation request or a dispute.';
END;
$$;

DROP TRIGGER IF EXISTS trg_bounties_guard_lifecycle ON public.bounties;
-- Name sorts after trg_bounties_clear_worker_when_reopened, so this guard sees
-- that trigger's implicit accepted_by reset (BEFORE triggers fire by name).
CREATE TRIGGER trg_bounties_guard_lifecycle
  BEFORE UPDATE OR DELETE ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.fn_bounties_guard_lifecycle();


CREATE OR REPLACE FUNCTION public.fn_owner_refund_block_reason(p_bounty_id uuid, p_caller uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  b public.bounties%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND THEN
    RETURN 'bounty_not_found';
  END IF;
  IF p_caller IS NULL OR p_caller NOT IN (COALESCE(b.user_id, b.poster_id), COALESCE(b.poster_id, b.user_id)) THEN
    RETURN 'not_bounty_owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bounty_disputes d
     WHERE d.bounty_id = p_bounty_id
       AND d.status IN ('open', 'under_review')
  ) THEN
    RETURN 'refund_blocked_by_open_dispute';
  END IF;

  -- Never committed to a hunter: the poster's money is the poster's.
  IF b.accepted_by IS NULL
     AND b.accepted_request_id IS NULL
     AND b.status::text NOT IN ('in_progress', 'cancellation_requested', 'completed')
     AND NOT EXISTS (
       SELECT 1 FROM public.bounty_requests br
        WHERE br.bounty_id = p_bounty_id AND br.status::text = 'accepted'
     )
  THEN
    RETURN NULL;
  END IF;

  -- Committed: only the accepted hunter's own cancellation releases the
  -- escrow back to the poster. acceptCancellation() refunds *before* it marks
  -- the request accepted, so 'pending' must count.
  IF b.status::text IN ('cancellation_requested', 'cancelled')
     AND EXISTS (
       SELECT 1 FROM public.bounty_cancellations bc
        WHERE bc.bounty_id = p_bounty_id
          AND bc.requester_id = b.accepted_by
          AND bc.status IN ('pending', 'accepted')
     )
  THEN
    RETURN NULL;
  END IF;

  RETURN 'refund_requires_cancellation_or_dispute';
END;
$$;

REVOKE ALL ON FUNCTION public.fn_owner_refund_block_reason(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_owner_refund_block_reason(uuid, uuid) TO service_role;

COMMIT;
