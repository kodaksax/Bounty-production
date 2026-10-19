-- SBA-08 (docs/audits/shoal-behavioral-audit.md): rate-limit the live
-- username check.
--
-- is_username_available (20261019195723) is callable signed out, because
-- sign-up runs as anon. Unthrottled, it lets anyone test names as fast as
-- they can send requests. It reveals nothing a profile page or register's 409
-- doesn't, but at volume that is still enumeration. This keeps the answer and
-- caps how often each caller can ask.
--
-- Who counts as one caller:
--   signed in  -> their user id;
--   signed out -> the client IP (cf-connecting-ip, which Cloudflare sets and
--                 overwrites, else the first X-Forwarded-For hop).
-- Buckets are stored as md5('uid:...' / 'ip:...'), so the table holds no raw
-- IP addresses, and rows older than two hours are swept.
--
-- Limits: 30 checks per minute and 300 per hour per caller. The sign-up form
-- checks once per 400 ms typing pause, so a person picking a name makes about
-- 5-15 calls. Over the limit the call fails with HTTP 429 (code
-- 'rate_limited'), and the form shows "Couldn't check right now" rather than
-- "available". A rejected call rolls back its own increment, so only answered
-- checks count.
--
-- Only Data API callers acting as anon or authenticated are limited. Direct
-- database sessions (no request.headers) and the service role are trusted.
--
-- The function becomes VOLATILE because it now writes. PostgREST runs GET
-- requests read-only, so calling it with GET fails instead of skipping the
-- counter. supabase-js .rpc() uses POST.
--
-- Rollback: supabase/rollbacks/production/20261019235800_is_username_available_rate_limit.down.sql

CREATE TABLE IF NOT EXISTS public.username_check_rate_limits (
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);

COMMENT ON TABLE public.username_check_rate_limits IS
  'Per-minute call counts for is_username_available, keyed by md5 of the caller '
  '(user id or IP). Written only by that function; no client access.';

CREATE INDEX IF NOT EXISTS username_check_rate_limits_window_idx
  ON public.username_check_rate_limits (window_start);

ALTER TABLE public.username_check_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.username_check_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid         uuid;
  v_headers     jsonb;
  v_role        text;
  v_ip          text;
  v_bucket      text;
  v_minute      timestamptz;
  v_minute_hits integer;
  v_hour_hits   integer;
BEGIN
  v_uid     := auth.uid();
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  v_role    := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';

  IF v_headers IS NOT NULL AND coalesce(v_role, 'anon') IN ('anon', 'authenticated') THEN
    IF v_uid IS NOT NULL THEN
      v_bucket := 'uid:' || v_uid::text;
    ELSE
      v_ip := nullif(btrim(coalesce(
                v_headers ->> 'cf-connecting-ip',
                split_part(v_headers ->> 'x-forwarded-for', ',', 1)
              )), '');
      v_bucket := 'ip:' || coalesce(v_ip, 'unknown');
    END IF;
    v_bucket := md5(v_bucket);
    v_minute := date_trunc('minute', now());

    INSERT INTO public.username_check_rate_limits AS r (bucket, window_start, hits)
    VALUES (v_bucket, v_minute, 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET hits = r.hits + 1
    RETURNING r.hits INTO v_minute_hits;

    SELECT coalesce(sum(r.hits), 0)::integer INTO v_hour_hits
      FROM public.username_check_rate_limits r
     WHERE r.bucket = v_bucket
       AND r.window_start > v_minute - interval '1 hour';

    IF v_minute_hits > 30 OR v_hour_hits > 300 THEN
      RAISE SQLSTATE 'PGRST' USING
        message = json_build_object(
          'code', 'rate_limited',
          'message', 'Too many username checks. Try again shortly.')::text,
        detail = json_build_object(
          'status', 429,
          'headers', json_build_object('Retry-After', '60'))::text;
    END IF;

    -- Housekeeping: about 1 call in 50 sweeps windows no limit still reads.
    IF random() < 0.02 THEN
      DELETE FROM public.username_check_rate_limits
       WHERE window_start < now() - interval '2 hours';
    END IF;
  END IF;

  IF p_username IS NULL OR btrim(p_username) !~ '^[A-Za-z0-9_]{3,24}$' THEN
    RETURN NULL;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE lower(p.username) = lower(btrim(p_username))
       AND p.id IS DISTINCT FROM v_uid
  );
END;
$function$;

COMMENT ON FUNCTION public.is_username_available(text) IS
  'Sign-up/onboarding username availability. NULL = malformed input; '
  'case-insensitive; the caller''s own row is ignored. Reveals existence only. '
  'Rate-limited per caller (30/min, 300/h) via username_check_rate_limits.';

REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated, service_role;
