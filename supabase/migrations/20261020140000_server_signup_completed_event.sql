-- SBA-13 (a): `signup_completed` once per new account, for every sign-in method
--
-- The client sent `signup_completed` only from the email form
-- (app/auth/sign-up-form.tsx). Apple and Google sign-ins never sent it, and
-- on prod over the 45 days to 2026-10-19 they were 431 of 526 new profiles
-- (apple 226, google 205, email 94, phone 1), so PostHog saw about one signup
-- in five.
--
-- Every account gets exactly one profile row, created by handle_new_user()
-- inside the auth.users INSERT. This migration records one pending signup
-- event per profile INSERT, with the sign-in method read from
-- auth.users.raw_app_meta_data->>'provider'. The existing person-sync pipeline
-- already wakes up for every new profile (trg_queue_profile_analytics_snapshot
-- -> analytics_person_outbox -> drain_analytics_person_outbox() cron, every
-- minute -> process-analytics-person), so process-analytics-person sends
-- `signup_completed` in the same PostHog batch as the person `$set` and stamps
-- sent_at. No new cron, no new Edge Function.
--
-- Single source of truth: the server event carries
-- `source = 'server_profile_insert'`. New client builds no longer send
-- `signup_completed`; old builds keep sending the email-only client event
-- (no `source`) until they age out, so insights filter on the source.
--
-- Deploy order: process-analytics-person FIRST, then this migration. The new
-- function tolerates this table not existing; the old function would mark the
-- outbox row sent and leave the signup row unsent forever.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_queue_signup_completed_event ON public.profiles;
--   DROP FUNCTION IF EXISTS public.queue_signup_completed_event();
--   DROP TABLE IF EXISTS public.analytics_signup_events;
-- (The function deploy is backward compatible and can stay.)

CREATE TABLE IF NOT EXISTS public.analytics_signup_events (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- auth.users.raw_app_meta_data->>'provider': email | apple | google | phone.
  method text NOT NULL,
  -- Fixed per account, so a retried send is deduplicated by PostHog
  -- (same uuid + timestamp + distinct_id + event).
  event_uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  -- auth.users.created_at: the event's timestamp in PostHog.
  signed_up_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_analytics_signup_events_unsent
  ON public.analytics_signup_events (created_at)
  WHERE sent_at IS NULL;

ALTER TABLE public.analytics_signup_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_signup_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.analytics_signup_events TO service_role;

CREATE OR REPLACE FUNCTION public.queue_signup_completed_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_method text;
  v_signed_up_at timestamptz;
BEGIN
  -- This runs inside the auth.users INSERT (handle_new_user -> profiles
  -- INSERT). Nothing here may fail a signup, so every error is swallowed.
  BEGIN
    SELECT
      COALESCE(NULLIF(lower(btrim(u.raw_app_meta_data->>'provider')), ''), 'unknown'),
      u.created_at
    INTO v_method, v_signed_up_at
    FROM auth.users u
    WHERE u.id = NEW.id;

    -- Only a profile created alongside its auth user is a signup. A profile
    -- backfilled for an old account (20260221_backfill_missing_profiles did
    -- this; 2 such rows on prod) must not show up as a new signup today.
    IF FOUND AND v_signed_up_at > now() - interval '1 day' THEN
      INSERT INTO public.analytics_signup_events (user_id, method, signed_up_at)
      VALUES (NEW.id, v_method, v_signed_up_at)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'queue_signup_completed_event(%): % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_signup_completed_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_queue_signup_completed_event ON public.profiles;
CREATE TRIGGER trg_queue_signup_completed_event
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.queue_signup_completed_event();
