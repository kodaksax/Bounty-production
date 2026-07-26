-- Notification redesign, migration 6/6: wire the bundling helper
-- (enqueue_bundled_notification, added in migration 4) into the two triggers
-- that generate the highest-volume notification types — applied last, after
-- the client (Notification Center + action sheet) already knows how to
-- render a `count > 1` bundled notification, so bundled rows never exist
-- without a UI that understands them.
--
-- Also fixes a second, independently-discovered bug while touching these
-- functions: their outbox `data` payloads use snake_case keys (bounty_id,
-- sender_id, conversation_id, hunter_id), which never matched the client's
-- camelCase deep-link logic — notification taps for messages/applications/
-- acceptances have likely never navigated anywhere correctly. That's now
-- primarily fixed by a key-normalization step added to process-notification
-- (2026-07-25 deploy), but the application trigger below also gets a new
-- `request_id` field it never included at all, needed for the Accept/Decline
-- rich-action sheet (which requires knowing the bounty_requests.id, not just
-- the bounty_id/hunter_id it had before).

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_message_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  b_id uuid;
  recipient record;
BEGIN
  sender_name := public.get_username(NEW.sender_id);

  SELECT bounty_id INTO b_id FROM public.conversations WHERE id = NEW.conversation_id;

  -- Bundle rapid-fire messages in the same conversation from the same sender
  -- within a 60s window into one outbox row (count++) instead of one push per
  -- message. One enqueue call per recipient (bundle_key is per-recipient +
  -- conversation + sender so one chatty participant doesn't suppress another's
  -- separate notification).
  FOR recipient IN
    SELECT cp.user_id FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id != NEW.sender_id
  LOOP
    PERFORM public.enqueue_bundled_notification(
      jsonb_build_array(recipient.user_id),
      'message:' || NEW.conversation_id::text || ':' || NEW.sender_id::text || ':' || recipient.user_id::text,
      60,
      'Message from ' || sender_name,
      substring(NEW.text from 1 for 100),
      jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'sender_id', NEW.sender_id,
        'type', 'message'
      ),
      b_id::text
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_bounty_request_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b_title text;
BEGIN
  SELECT title INTO b_title FROM public.bounties WHERE id = NEW.bounty_id;

  -- Scenario A: New Application (Insert) — bundled per-bounty over a 10-minute
  -- window ("3 people applied to your bounty"). Bundled rows can't carry a
  -- single request_id for Accept/Decline (client hides those actions once
  -- count > 1 and shows "View Bounty" instead), so request_id here reflects
  -- only the most recent applicant in the bundle window — harmless since it's
  -- unused once bundled.
  IF (TG_OP = 'INSERT') THEN
    PERFORM public.enqueue_bundled_notification(
      jsonb_build_array(NEW.poster_id),
      'application:' || NEW.bounty_id::text,
      600,
      'New Bounty Application',
      'Someone applied to your bounty: ' || COALESCE(b_title, 'Bounty'),
      jsonb_build_object(
        'bounty_id', NEW.bounty_id,
        'hunter_id', NEW.hunter_id,
        'request_id', NEW.id,
        'type', 'application'
      ),
      NEW.bounty_id::text
    );
  END IF;

  -- Scenario B: Acceptance (Update status from pending to accepted) — not
  -- bundled, a hunter only gets one acceptance notification per bounty.
  IF (TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted') THEN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(NEW.hunter_id),
      'Bounty Accepted!',
      'Your application for "' || COALESCE(b_title, 'Bounty') || '" was accepted',
      jsonb_build_object('bounty_id', NEW.bounty_id, 'request_id', NEW.id, 'type', 'acceptance'),
      NEW.bounty_id::text
    );
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
