-- Notify the poster when a hunter submits completed work for review.
--
-- Bug this fixes: posters received NOTHING when a hunter finished their work.
-- Both existing paths were dead ends:
--
--   1. lib/services/completion-service.ts inserted into notifications_outbox
--      directly from the client. notifications_outbox has RLS enabled with zero
--      policies by design (see 20260715i_sync_rls_policies_across_environments)
--      because it is a service-role-only table, so that INSERT was always
--      rejected. The error was swallowed as a best-effort logger.warning, which
--      is why the submission appeared to succeed while no notification existed.
--
--   2. handle_bounty_status_notification (20260322) enqueues 'Review Needed',
--      but only fires when bounties.status transitions to 'completed'. The
--      hunter's submit flow only INSERTs into completion_submissions and never
--      touches bounties.status, so that trigger never ran for this event.
--
-- The fix follows the pattern already established for messages/applications:
-- a SECURITY DEFINER trigger owns the enqueue, so it runs with the privileges
-- needed to bypass RLS and cannot be skipped by a client that forgets to call it.

BEGIN;

-------------------------------------------------------------------------------
-- Display name helper
--
-- get_username() (20260322) returns profiles.username only. Posters recognize
-- hunters by their display name where one is set, so prefer it and fall back
-- through username to a neutral label rather than ever rendering "null".
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_display_name(user_id uuid)
RETURNS text AS $$
DECLARE
  resolved text;
BEGIN
  SELECT COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(username), ''))
    INTO resolved
    FROM public.profiles
   WHERE id = user_id;
  RETURN COALESCE(resolved, 'A hunter');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-------------------------------------------------------------------------------
-- Trigger: work submitted for review -> notify poster
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_completion_submission_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_poster_id  uuid;
  v_title      text;
  v_hunter     text;
  v_is_revision boolean;
BEGIN
  -- Only a submission awaiting poster review is worth notifying about.
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  -- Production schema uses poster_id; legacy/staging rows may still use user_id.
  SELECT COALESCE(b.poster_id, b.user_id), b.title
    INTO v_poster_id, v_title
    FROM public.bounties b
   WHERE b.id = NEW.bounty_id;

  -- No resolvable recipient (deleted bounty, orphaned submission): nothing to do.
  IF v_poster_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Never notify someone about their own action, in the edge case where a
  -- poster submits against their own bounty.
  IF v_poster_id = NEW.hunter_id THEN
    RETURN NEW;
  END IF;

  v_hunter := public.get_display_name(NEW.hunter_id);
  v_title := COALESCE(NULLIF(TRIM(v_title), ''), 'your bounty');
  -- Resubmission after a revision request reads differently to the poster.
  v_is_revision := COALESCE(NEW.revision_count, 0) > 0;

  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  VALUES (
    jsonb_build_array(v_poster_id),
    v_hunter || CASE WHEN v_is_revision THEN ' resubmitted their work' ELSE ' finished the work' END,
    v_hunter
      || CASE WHEN v_is_revision THEN ' has resubmitted their work on "' ELSE ' has completed the work on "' END
      || left(v_title, 80)
      || '" and it is ready for your review.',
    jsonb_build_object(
      'type', 'review_needed',
      -- Both spellings on purpose: the DB triggers established snake_case, but
      -- the client deep-link resolver (lib/services/notification-deep-links.ts)
      -- reads data.bountyId. Emitting both makes the notification tappable
      -- without breaking any existing snake_case consumer.
      'bounty_id', NEW.bounty_id,
      'bountyId', NEW.bounty_id,
      'hunter_id', NEW.hunter_id,
      'hunterId', NEW.hunter_id,
      'hunter_name', v_hunter,
      'submission_id', NEW.id,
      'is_revision', v_is_revision
    ),
    NEW.bounty_id::text
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_completion_submission_notification ON public.completion_submissions;
CREATE TRIGGER trg_completion_submission_notification
  AFTER INSERT ON public.completion_submissions
  FOR EACH ROW EXECUTE FUNCTION public.handle_completion_submission_notification();

-------------------------------------------------------------------------------
-- Trigger: poster reviews the submission -> notify hunter
--
-- Same RLS dead-end as above, in the opposite direction. These three
-- notifications were all enqueued from the client and therefore never sent:
--
--   * "Work Approved!"   completion-service.ts approveSubmission()
--   * "Revision Requested" completion-service.ts requestRevision()
--   * "Please rate the poster"  poster-review-modal.tsx + postings review screen
--
-- Note this is the notification 20260623_fix_bounty_status_notification_trigger
-- assumed was being delivered when it removed the 'completed' branch from
-- handle_bounty_status_notification ("handled by completion-service.ts ... as
-- the dedicated Work Approved! notification"). It was not being delivered, so
-- hunters have been receiving nothing at all on approval since that migration.
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_completion_review_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_title    text;
  v_body     text;
BEGIN
  -- Only act on a real status transition into a reviewed state.
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.hunter_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(b.title), ''), 'your bounty')
    INTO v_title
    FROM public.bounties b
   WHERE b.id = NEW.bounty_id;

  v_title := left(COALESCE(v_title, 'your bounty'), 80);

  IF NEW.status = 'approved' THEN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(NEW.hunter_id),
      'Work Approved! 🎉',
      'Your work on "' || v_title || '" was approved. Payment is on its way.',
      jsonb_build_object(
        'type', 'completion',
        'subtype', 'approval',
        'bounty_id', NEW.bounty_id,
        'bountyId', NEW.bounty_id,
        'submission_id', NEW.id
      ),
      NEW.bounty_id::text
    );

    -- Rating prompt, previously enqueued by the poster's review screens via
    -- approveAndRelease(notifyFn). Timing shifts slightly: it now fires on
    -- approval rather than after the escrow release call returns.
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(NEW.hunter_id),
      'Please rate the poster',
      'Please rate your experience for "' || v_title || '".',
      jsonb_build_object(
        'type', 'completion',
        'subtype', 'rating_prompt',
        'bounty_id', NEW.bounty_id,
        'bountyId', NEW.bounty_id,
        'submission_id', NEW.id
      ),
      NEW.bounty_id::text
    );

  ELSIF NEW.status = 'revision_requested' THEN
    v_body := 'The poster requested changes to "' || v_title || '". Check the feedback and resubmit.';

    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(NEW.hunter_id),
      'Revision Requested',
      v_body,
      jsonb_build_object(
        'type', 'completion',
        'subtype', 'revision_requested',
        'isRevision', true,
        'feedback', NEW.poster_feedback,
        'bounty_id', NEW.bounty_id,
        'bountyId', NEW.bounty_id,
        'submission_id', NEW.id
      ),
      NEW.bounty_id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_completion_review_notification ON public.completion_submissions;
CREATE TRIGGER trg_completion_review_notification
  AFTER UPDATE OF status ON public.completion_submissions
  FOR EACH ROW EXECUTE FUNCTION public.handle_completion_review_notification();

COMMIT;

NOTIFY pgrst, 'reload schema';
