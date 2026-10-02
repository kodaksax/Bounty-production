-- Rollback for 20261002120000_assignment_and_submission_integrity.sql
--
-- Both objects are new (prod had no trigger on bounty_requests UPDATE/DELETE
-- other than stamp_decision/updated_at, and no guard on completion_submissions
-- on 2026-10-02), so rolling back is dropping them. This restores the
-- previous, vulnerable behaviour: posters can rewrite the accepted request and
-- any user can insert or backdate a completion submission.
--
-- Roll back 20261002120100 first if it is applied: its review clock relies on
-- submitted_at being server-stamped.

BEGIN;

DROP TRIGGER IF EXISTS trg_completion_submissions_guard ON public.completion_submissions;
DROP FUNCTION IF EXISTS public.fn_completion_submissions_guard();

DROP TRIGGER IF EXISTS trg_bounty_requests_guard_assignment ON public.bounty_requests;
DROP FUNCTION IF EXISTS public.fn_bounty_requests_guard_assignment();

COMMIT;
