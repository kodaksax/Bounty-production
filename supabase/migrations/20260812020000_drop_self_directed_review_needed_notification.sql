-- Drop Scenario A of handle_bounty_status_notification: the "Review Needed"
-- sent to the poster when bounties.status becomes 'completed'.
--
-- Why it is wrong in every case: nothing in the app sets status = 'completed'
-- to mean "awaiting review". Every writer is the poster finalizing work that is
-- already done --
--
--   app/postings/[bountyId]/payout.tsx  (release funds & complete / mark complete)
--   lib/services/completion-service.ts  (approveSubmission)
--   app/(admin)/bounty/[id].tsx         (admin override)
--
-- so the poster was notified about their own action, with copy telling them
-- work "has been submitted for review" at the exact moment they finished
-- reviewing it.
--
-- The genuine "hunter submitted work, please review" notification is owned by
-- trg_completion_submission_notification (20260812000000), which fires on the
-- completion_submissions INSERT that actually represents that event and names
-- the hunter. Scenario A is redundant with it and contradicts it on timing.
--
-- Scenario B is preserved unchanged, including the 'in_progress' suppression
-- added in 20260812010000.
--
-- Behaviour note: the admin override path now produces no notification to the
-- poster at all. That was previously the one arguably-useful firing of
-- Scenario A, though it delivered misleading copy. If admins completing a
-- bounty on someone's behalf should notify the poster, that wants its own
-- notification with accurate wording rather than a revival of this one.
--
-- See 20260812010000 for the repo/production drift warning about
-- 20260623_fix_bounty_status_notification_trigger.sql, which is still unapplied
-- and would clobber this if it were ever run.

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_bounty_status_notification()
RETURNS TRIGGER AS $$
BEGIN
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
