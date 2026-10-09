-- Rollback for 20261009000000_bounty_thread_event_cards.sql
--
-- Drops the card triggers and helpers and restores the original
-- handle_new_message_notification. Existing system messages and threads are
-- kept (they are ordinary conversations/messages); the event_type / ref_id
-- columns are kept too so no data is lost. Drop them by hand only after
-- deleting the system rows:
--   DELETE FROM public.messages WHERE event_type IS NOT NULL;
--   ALTER TABLE public.messages DROP CONSTRAINT messages_event_type_check,
--     DROP COLUMN event_type, DROP COLUMN ref_id;

BEGIN;

DROP TRIGGER IF EXISTS trg_messages_guard_event_cards ON public.messages;
DROP TRIGGER IF EXISTS trg_thread_events_from_requests ON public.bounty_requests;
DROP TRIGGER IF EXISTS trg_thread_events_from_completions ON public.completion_submissions;
DROP TRIGGER IF EXISTS trg_thread_events_from_bounty_payments ON public.bounty_payments;
DO $$ BEGIN
  IF to_regclass('public.bounty_v3_funding') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_thread_events_from_v3_funding ON public.bounty_v3_funding;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.fn_messages_guard_event_cards();
DROP FUNCTION IF EXISTS public.trg_thread_events_from_requests();
DROP FUNCTION IF EXISTS public.trg_thread_events_from_completions();
DROP FUNCTION IF EXISTS public.trg_thread_events_from_bounty_payments();
DROP FUNCTION IF EXISTS public.trg_thread_events_from_v3_funding();
DROP FUNCTION IF EXISTS public.fn_touch_thread_events(text, uuid);
DROP FUNCTION IF EXISTS public.fn_upsert_thread_event(uuid, uuid, text, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.fn_bounty_thread_id(uuid, uuid);

-- Original definition from 20260825120000_message_notification_media_body.sql
CREATE OR REPLACE FUNCTION public.handle_new_message_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  b_id uuid;
  recipient record;
  preview text;
BEGIN
  sender_name := public.get_username(NEW.sender_id);

  SELECT bounty_id INTO b_id FROM public.conversations WHERE id = NEW.conversation_id;

  -- Attachment-only messages have empty text; label them by media kind so the
  -- push body is never blank. Mirrors mediaPreviewLabel() in
  -- lib/utils/message-media.ts.
  preview := NULLIF(btrim(COALESCE(NEW.text, '')), '');
  IF preview IS NULL THEN
    IF NEW.media_url IS NOT NULL THEN
      preview := CASE
        WHEN NEW.media_url ~* '\.(jpe?g|png|gif|webp|heic|heif|bmp)(\?|#|$)' THEN 'Photo'
        WHEN NEW.media_url ~* '\.(mp4|mov|m4v|webm|avi|3gp)(\?|#|$)'         THEN 'Video'
        ELSE 'Attachment'
      END;
    ELSE
      preview := '';
    END IF;
  ELSE
    preview := substring(preview from 1 for 100);
  END IF;

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
      preview,
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

COMMIT;
