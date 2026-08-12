-- Stop notifying the hunter "Bounty ... status is now: in_progress".
--
-- When a poster accepts an application, fn_accept_bounty_request sets
-- bounties.status = 'in_progress'. That fires Scenario B of
-- handle_bounty_status_notification, so the hunter received a generic
-- "Bounty Update / status is now: in_progress" on top of the dedicated
-- "Bounty Accepted!" that handle_bounty_request_notification already sends for
-- the very same action. Two notifications, one event, and the generic one is
-- the less informative of the pair.
--
-- Only the 'in_progress' case is suppressed. Every other status transition
-- still notifies the accepted hunter, and Scenario A is untouched.
--
-- The notification is purely informational: an outbox row that becomes a push
-- plus a bell entry. No client logic reads its body or its data.type, so
-- suppressing it changes nothing but what the hunter sees.
--
-- !! REPO/PRODUCTION DRIFT WARNING !!
-- This function is rewritten from the definition that is ACTUALLY LIVE in
-- production, which still contains Scenario A. The repo also holds
-- 20260623_fix_bounty_status_notification_trigger.sql, which deletes Scenario A
-- and was NEVER APPLIED (it is absent from the applied-migration list). Basing
-- this rewrite on the repo file would have silently dropped Scenario A from
-- production as a side effect. If 20260623 is ever applied after this
-- migration it will undo the change made here AND remove Scenario A; resolve
-- that drift deliberately rather than by migration ordering.

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_bounty_status_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Scenario A: Work Submitted for Review (status -> 'completed')
  -- Preserved exactly as it exists in production.
  IF (OLD.status != 'completed' AND NEW.status = 'completed') THEN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(NEW.poster_id),
      'Review Needed',
      'Bounty "' || NEW.title || '" has been submitted for review',
      jsonb_build_object('bounty_id', NEW.id, 'type', 'review_needed'),
      NEW.id::text
    );
  END IF;

  -- Scenario B: General Status Update (Notify Hunter via accepted_by)
  --   'completed'   -> excluded: the hunter gets the dedicated "Work Approved!"
  --                    from trg_completion_review_notification instead.
  --   'in_progress' -> excluded: the hunter gets the dedicated "Bounty
  --                    Accepted!" from handle_bounty_request_notification for
  --                    this same acceptance.
  IF (
    OLD.status != NEW.status
    AND NEW.status NOT IN ('completed', 'in_progress')
    AND NEW.accepted_by IS NOT NULL
  ) THEN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(NEW.accepted_by),
      'Bounty Update',
      'Bounty "' || NEW.title || '" status is now: ' || NEW.status,
      jsonb_build_object('bounty_id', NEW.id, 'type', 'update'),
      NEW.id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;

NOTIFY pgrst, 'reload schema';
