-- BNTY-11: close zombie applications on dead bounties.
--
-- PROBLEM (measured 2026-09-19 on production): 127 bounty_requests sit at
-- status='pending' against a bounty whose own status is no longer 'open'.
-- All 127 are on bounties with status='deleted' -- bountyService.delete()
-- hard-deletes a bounty (which would cascade-delete its bounty_requests
-- rows via the FK) unless a payment record FK-references it, in which case
-- it falls back to a soft status='deleted'. Nothing cleans up the
-- now-orphaned pending applications on that path. 76 of the 127 are more
-- than 14 days old.
--
-- 2 of the 127 have hunter_id IS NULL -- the pre-existing "application with
-- no applicant" defect documented and deliberately left un-cleaned-up by
-- 20260911000000_marketplace_state_integrity.sql (bounty_requests_hunter_id_
-- present, added NOT VALID so it binds every future write without failing
-- on old rows). NOT VALID does not exempt UPDATE: any write to one of those
-- 2 rows -- including just flipping its status here -- still re-checks the
-- constraint and fails, since hunter_id is still NULL. This migration does
-- not decide that unrelated question; it excludes hunter_id IS NULL rows
-- from both the backfill and the ongoing trigger below, leaving those 2 for
-- the cleanup that migration already called for.
--
-- The same gap exists for cancellation and any other future way a bounty
-- can leave 'open' without going through fn_accept_bounty_request, which is
-- the only path that already rejects sibling pending requests (as part of
-- accepting one -- see 20260323_add_fn_accept_bounty_request.sql).
--
-- Until this migration, the hunter's own UI made it worse: a pending
-- request's display status is only overridden to 'applied' when the parent
-- bounty is still 'open' (getBountyDisplayStatus,
-- lib/utils/bounty-display-status.ts); 'deleted' fell through its switch's
-- default case and rendered as plain 'open', so a hunter looking at their
-- zombie application saw "Open for applications" / "Application sent"
-- instead of anything resembling reality. That bug is fixed in the same
-- change that adds this migration (lib/utils/bounty-display-status.ts and
-- lib/utils/bounty-lifecycle.ts now handle 'deleted' explicitly and render
-- "No longer available", matching the acceptance criterion).
--
-- FIX (two parts, same pattern as request expiry in
-- 20260913000000_bounty_request_expiry_and_poster_nudges.sql):
--   1. One-time backfill: every bounty_requests row still 'pending' against
--      a non-open bounty is marked 'rejected' with
--      rejection_source='system_bounty_closed'. Hunters are only notified
--      for requests newer than 14 days -- notifying someone about an
--      application they made over two weeks ago and have long since moved
--      on from is spam, not information.
--   2. Ongoing: an AFTER UPDATE trigger on bounties rejects (and notifies)
--      every pending bounty_requests row the moment its bounty's status
--      leaves 'open', regardless of which code path caused the transition
--      -- so this class of bug cannot recur no matter how the next removal
--      path (admin tooling, a new cancellation flow, etc.) is built.

BEGIN;

-- ─── rejection_source: new value for a bounty-driven system closure ───────
ALTER TABLE public.bounty_requests
  DROP CONSTRAINT IF EXISTS bounty_requests_rejection_source_check;
ALTER TABLE public.bounty_requests
  ADD CONSTRAINT bounty_requests_rejection_source_check
  CHECK (rejection_source IS NULL OR rejection_source IN ('poster', 'system_expiry', 'system_bounty_closed'));

COMMENT ON COLUMN public.bounty_requests.rejection_source IS
  'Who/what moved this row to rejected. ''poster'' = a human decision (default, stamped by trg_bounty_requests_stamp_decision for any writer that does not set it explicitly). ''system_expiry'' = fn_expire_bounty_requests auto-closed it after request_expiry_hours of silence on a still-open bounty. ''system_bounty_closed'' = fn_reject_pending_requests_on_bounty_close (or the BNTY-11 backfill) closed it because the bounty itself left status=''open'' -- deleted, cancelled, filled by another hunter, or any other departure -- while this request was still pending. NULL on rows rejected before rejection_source existed.';

-- ─── notifications: new type for "your application closed because the
--     bounty itself is gone", distinct from application_expired's
--     silence-timeout (which only ever fires on a bounty still status='open')
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'application', 'acceptance', 'completion', 'payment', 'message', 'follow',
      'cancellation_request', 'cancellation_accepted', 'cancellation_rejected',
      'dispute_created', 'dispute_resolved', 'workflow_dispute_created',
      'stale_bounty', 'stale_bounty_cancelled', 'stale_bounty_reposted',
      'update', 'review_needed', 'balance_update', 'bounty_nearby',
      'bounty_expiry', 'dispute_escalated', 'account_warning',
      'account_restricted', 'payout_paid', 'payout_failed', 'payout_canceled',
      'withdrawal_reversed', 'bank_disconnected', 'payout_method_changed',
      'verification_submitted', 'verification_verified', 'verification_rejected',
      'verification_canceled', 'marketing_promo',
      'reconciliation_alert', 'reconciliation_digest',
      'bounty_quality_nudge',
      'application_pending_reminder', 'application_expired',
      'rating_reminder',
      -- Zombie-application cleanup (this migration).
      'application_bounty_closed'
    ]::text[])
  );

-- ─── Ongoing: reject pending requests the moment a bounty leaves 'open' ────
-- AFTER UPDATE, not BEFORE: this writes to a different table (bounty_requests
-- and notifications_outbox), not to NEW itself, so there is nothing to
-- contribute back to the bounties row being written.
--
-- Wrapped in its own exception handler, same pattern as
-- fn_stamp_poster_interaction_on_message: a poster cancelling or deleting
-- their bounty must never fail because a secondary cleanup write hit an
-- unrelated problem.
CREATE OR REPLACE FUNCTION public.fn_reject_pending_requests_on_bounty_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text <> 'open' THEN
    WITH closed AS (
      UPDATE public.bounty_requests br
      SET status = 'rejected',
          rejection_source = 'system_bounty_closed',
          rejected_at = now()
      WHERE br.bounty_id = NEW.id
        AND br.status = 'pending'
        AND br.hunter_id IS NOT NULL
      RETURNING br.id, br.hunter_id
    )
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    SELECT
      jsonb_build_array(c.hunter_id),
      'Application no longer available',
      'This bounty is no longer available, so your application was closed automatically -- this wasn''t a rejection.',
      jsonb_build_object('type', 'application_bounty_closed', 'bountyId', NEW.id, 'applicationId', c.id),
      NEW.id::text
    FROM closed c;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_reject_pending_requests_on_bounty_close failed for bounty %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reject_pending_requests_on_bounty_close() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reject_pending_requests_on_bounty_close() FROM anon;
REVOKE ALL ON FUNCTION public.fn_reject_pending_requests_on_bounty_close() FROM authenticated;

DROP TRIGGER IF EXISTS trg_bounties_reject_pending_requests_on_close ON public.bounties;
CREATE TRIGGER trg_bounties_reject_pending_requests_on_close
  AFTER UPDATE OF status ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_reject_pending_requests_on_bounty_close();

COMMENT ON FUNCTION public.fn_reject_pending_requests_on_bounty_close() IS
  'BNTY-11: a bounty leaving status=open closes out any bounty_requests row still pending against it (rejection_source=system_bounty_closed), regardless of which path moved the bounty -- delete, cancel, accept, admin action. fn_accept_bounty_request already rejects sibling requests explicitly as part of accepting one, so by the time this fires for an accept there is normally nothing left for it to do; it exists as a backstop that holds even when a new removal path forgets to do that cleanup itself.';

-- ─── One-time backfill of existing zombie rows ─────────────────────────────
-- Same 14-day notify cutoff as the file header: close every one of them, but
-- only tell the hunter about the recent ones.
WITH closed AS (
  UPDATE public.bounty_requests br
  SET status = 'rejected',
      rejection_source = 'system_bounty_closed',
      rejected_at = now()
  FROM public.bounties b
  WHERE br.bounty_id = b.id
    AND br.status = 'pending'
    AND b.status::text <> 'open'
    AND br.hunter_id IS NOT NULL
  RETURNING br.id, br.bounty_id, br.hunter_id, br.created_at
),
notified AS (
  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  SELECT
    jsonb_build_array(c.hunter_id),
    'Application no longer available',
    'This bounty is no longer available, so your application was closed automatically -- this wasn''t a rejection.',
    jsonb_build_object('type', 'application_bounty_closed', 'bountyId', c.bounty_id, 'applicationId', c.id),
    c.bounty_id::text
  FROM closed c
  WHERE c.created_at >= now() - interval '14 days'
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM closed)   AS requests_closed,
  (SELECT count(*) FROM notified) AS hunters_notified;

COMMIT;

-- ─── Regression checks ──────────────────────────────────────────────────────
--
-- 1. SQL assertion -- the acceptance criterion ("0 pending requests on
--    non-open bounties") holds after the backfill above, for every row with
--    an actual applicant (see the hunter_id IS NULL note in the file header
--    for the small, separately-tracked exception):
--
--   SELECT count(*) FROM public.bounty_requests br
--   JOIN public.bounties b ON b.id = br.bounty_id
--   WHERE br.status = 'pending' AND b.status::text <> 'open' AND br.hunter_id IS NOT NULL;
--   -- expected: 0
--
-- 2. Trigger test -- a bounty status change closes out its pending requests:
--
--   BEGIN;
--   INSERT INTO public.bounties (id, poster_id, title, status, amount)
--   VALUES ('11111111-1111-1111-1111-111111111111', '<poster-uuid>', 'trigger test', 'open', 10);
--   INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id, status)
--   VALUES ('11111111-1111-1111-1111-111111111111', '<hunter-uuid>', '<poster-uuid>', 'pending');
--
--   UPDATE public.bounties SET status = 'cancelled'
--   WHERE id = '11111111-1111-1111-1111-111111111111';
--
--   SELECT status, rejection_source, rejected_at IS NOT NULL AS has_rejected_at
--   FROM public.bounty_requests
--   WHERE bounty_id = '11111111-1111-1111-1111-111111111111';
--   -- expected: status='rejected', rejection_source='system_bounty_closed', has_rejected_at=true
--
--   SELECT data->>'type' FROM public.notifications_outbox
--   WHERE bounty_id = '11111111-1111-1111-1111-111111111111';
--   -- expected: 'application_bounty_closed'
--   ROLLBACK;
