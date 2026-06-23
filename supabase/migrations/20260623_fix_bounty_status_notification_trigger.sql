-- Migration: fix_bounty_status_notification_trigger
-- Created: 2026-06-23
--
-- Problem:
--   handle_bounty_status_notification Scenario A fires a "Review Needed"
--   notification to the poster whenever bounties.status transitions to
--   'completed'. However 'completed' is now the approval status (the poster
--   marks work done), not the submission status. The "Review Needed"
--   notification for the poster is already enqueued in completion-service.ts
--   at submission time via notifications_outbox. Keeping Scenario A causes the
--   poster to receive a spurious "submitted for review" notification the moment
--   they approve the work.
--
-- Fix:
--   Remove Scenario A from the trigger function entirely. The client-side
--   completion-service.ts path (submission time) is the correct place for the
--   "Review Needed" notification.
--   Scenario B (general status update to the hunter) is preserved unchanged.

CREATE OR REPLACE FUNCTION public.handle_bounty_status_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Scenario B: General Status Update (Notify Hunter via accepted_by)
  -- Fires on every status change except to 'completed' (handled by
  -- completion-service.ts at submission time).
  IF (OLD.status != NEW.status AND NEW.accepted_by IS NOT NULL) THEN
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
