-- Migration: fix_bounty_status_notification_columns
-- Created: 2026-04-27
-- Issue: "record 'new' has no field 'hunter_id'" on bounty accept (production only)
--
-- Root Cause:
--   The production `bounties` table was created with a different baseline than
--   staging. It uses:
--     - `accepted_by`  (uuid) instead of `hunter_id`
--     - `poster_id`    (uuid) instead of `creator_id`
--
--   However handle_bounty_status_notification() (added by
--   20260322_serverless_notification_triggers.sql) references:
--     - NEW.hunter_id   — column does not exist → runtime error
--     - NEW.creator_id  — column does not exist → would also fail on 'completed' transition
--
--   When fn_accept_bounty_request executes `UPDATE bounties SET status = 'in_progress'`
--   the trg_bounty_status_notification trigger fires, the function immediately
--   errors on `NEW.hunter_id`, and the entire transaction is rolled back.
--
-- Fix:
--   Recreate handle_bounty_status_notification using the actual column names
--   present in production: `accepted_by` and `poster_id`.
--   Logic is otherwise identical to the original.

CREATE OR REPLACE FUNCTION public.handle_bounty_status_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Scenario A: Work Submitted for Review (status -> 'completed')
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
  IF (OLD.status != NEW.status AND NEW.status != 'completed' AND NEW.accepted_by IS NOT NULL) THEN
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

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
