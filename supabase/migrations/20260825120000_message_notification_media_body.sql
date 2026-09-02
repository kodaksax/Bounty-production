-- Message push notifications: describe attachment-only messages
--
-- `handle_new_message_notification` used `substring(NEW.text from 1 for 100)`
-- as the push body. Messages that carry only an attachment store an empty
-- string in `text`, so the recipient got a push with a title and a blank body.
-- Fall back to a short media label in that case.
--
-- Everything else (the 60s bundling, the bundle key, the data payload) is
-- unchanged from 20260725140000_notification_triggers_v2_bundling.sql.

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
