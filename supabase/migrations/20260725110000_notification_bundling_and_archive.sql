-- Notification redesign, migration 4/6: bundling columns/function + archive flag.
--
-- Bundling happens at outbox-insert time via enqueue_bundled_notification(): if a
-- pending outbox row with the same bundle_key already exists within the given
-- window, it's updated (count++, body regenerated) instead of a new row being
-- inserted. This is applied to actual triggers in a later migration (6/6), once
-- the client can render count > 1 notifications correctly.

BEGIN;

ALTER TABLE public.notifications_outbox ADD COLUMN IF NOT EXISTS bundle_key text;
ALTER TABLE public.notifications_outbox ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_notifications_outbox_bundle_key
  ON public.notifications_outbox (bundle_key, status, created_at DESC)
  WHERE bundle_key IS NOT NULL;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 1;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_notifications_user_archived
  ON public.notifications (user_id, archived, created_at DESC);

CREATE OR REPLACE FUNCTION public.enqueue_bundled_notification(
  p_recipients jsonb,
  p_bundle_key text,
  p_bundle_window_seconds int,
  p_title text,
  p_body text,
  p_data jsonb,
  p_bounty_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
BEGIN
  SELECT id INTO v_existing_id
  FROM public.notifications_outbox
  WHERE bundle_key = p_bundle_key
    AND status = 'pending'
    AND created_at > now() - make_interval(secs => p_bundle_window_seconds)
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.notifications_outbox
    SET count = count + 1,
        title = p_title,
        body = p_body,
        data = p_data,
        updated_at = now()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.notifications_outbox
      (recipients, bundle_key, count, title, body, data, bounty_id, status, scheduled_at)
    VALUES
      (p_recipients, p_bundle_key, 1, p_title, p_body, p_data, p_bounty_id, 'pending', now());
  END IF;
END;
$$;

-- This project has a default privilege that auto-grants EXECUTE on newly
-- created functions to `anon`/`authenticated` (confirmed via
-- information_schema.routine_privileges after the initial REVOKE ALL FROM
-- PUBLIC below did NOT remove those grants — REVOKE FROM PUBLIC only removes
-- the implicit "everyone" grant, not an explicit prior grant to a named role).
-- Without the explicit REVOKE below, any signed-in user could call this RPC
-- directly via PostgREST with arbitrary p_recipients/title/body and spam
-- push/email content to arbitrary users. Revoke from anon/authenticated
-- explicitly, not just PUBLIC.
REVOKE ALL ON FUNCTION public.enqueue_bundled_notification(jsonb, text, int, text, text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_bundled_notification(jsonb, text, int, text, text, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_bundled_notification(jsonb, text, int, text, text, jsonb, text) TO service_role;

COMMIT;
