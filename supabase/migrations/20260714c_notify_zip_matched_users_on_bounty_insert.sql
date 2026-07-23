-- Migration: notify_zip_matched_users_on_bounty_insert
-- Created: 2026-07-14
--
-- When a new bounty is posted with a zip_code set, notify every user whose
-- profiles.zip_code matches — via the existing notifications_outbox +
-- process-notification Edge Function pipeline (same delivery path used by
-- handle_bounty_status_notification / handle_bounty_request_notification in
-- 20260322_serverless_notification_triggers.sql).
--
-- Fires once, at bounty creation ("submitted to the feed"), not on later
-- updates. No-ops when the bounty has no zip_code, or when no other user's
-- profile has a matching zip_code.

CREATE OR REPLACE FUNCTION public.fn_notify_zip_matched_bounty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poster_id   uuid;
  v_recipients  jsonb;
BEGIN
  -- Nothing to match without a zip code on the bounty.
  IF NEW.zip_code IS NULL OR btrim(NEW.zip_code) = '' THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT jsonb_agg(id)
  INTO v_recipients
  FROM public.profiles
  WHERE zip_code = NEW.zip_code
    AND id IS DISTINCT FROM v_poster_id;

  -- No matching users (or only the poster themselves) — nothing to send.
  IF v_recipients IS NULL OR jsonb_array_length(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  VALUES (
    v_recipients,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted near you.',
    jsonb_build_object('bounty_id', NEW.id, 'type', 'bounty_nearby', 'zip_code', NEW.zip_code),
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_notify_zip_matched_bounty IS
  'AFTER INSERT trigger on public.bounties. Notifies every user whose profiles.zip_code matches the new bounty''s zip_code (excluding the poster) via notifications_outbox.';

DROP TRIGGER IF EXISTS trg_bounties_notify_zip_matched ON public.bounties;
CREATE TRIGGER trg_bounties_notify_zip_matched
  AFTER INSERT ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_zip_matched_bounty();

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
