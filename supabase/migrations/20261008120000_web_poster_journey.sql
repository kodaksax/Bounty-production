-- Web-only poster journey (incident 2026-10-06, bounty 5e96aaed).
--
-- A customer posted and paid for a bounty on the website, never installed the
-- app, and could not finish: her "Accept" email reply went to an unread
-- inbox, the email button was an app-only link, nobody on the team was told,
-- and the bounty never got coordinates so nearby hunters were never matched.
--
-- This migration adds only bookkeeping. It does not touch money, bounty or
-- application state, or any existing row:
--
--   support_cases            trackable cases a person must look at, opened by
--                            poster-web, email-inbound and geocode-bounties
--   email_reply_contexts     maps reply+<token>@ addresses to the bounty an
--                            email was about (see _shared/reply-context.ts)
--   bounty_geocode_attempts  retry ledger for server-side geocoding
--   fn_claim_geocode_batch / fn_apply_bounty_geocode / fn_record_geocode_failure
--
-- All three tables are service-role only (RLS on, no policies): customers
-- reach them only through Edge Functions that check ownership themselves.
--
-- NOT added here, deliberately: a unique index on one accepted request per
-- bounty. As of 2026-10-08, 3 bounties already have more than one accepted
-- request, so the index would fail; repairing those rows is a data decision
-- for a person, not a migration. fn_accept_bounty_request's row locks are
-- what prevent new duplicates on the web path.

BEGIN;

-- ── support_cases ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_cases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'in_progress', 'resolved')),
  kind        text NOT NULL
              CHECK (kind IN (
                'email_reply',                    -- a matched reply to a notification email
                'email_reply_unmatched',          -- a reply we could not tie to a bounty
                'web_contact',                    -- "talk to a person" on the website
                'problem_report',                 -- poster reported a problem with the work
                'completion_without_submission',  -- poster says done, hunter never submitted
                'release_blocked',                -- poster confirmed, payout could not start
                'geocode_failed'                  -- in-person bounty has no usable location
              )),
  channel     text NOT NULL CHECK (channel IN ('web', 'email', 'system')),
  poster_id   uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  bounty_id   uuid REFERENCES public.bounties (id) ON DELETE SET NULL,
  request_id  uuid,
  -- Short, human-written or system summary. Customer free text is capped and
  -- never copied into analytics.
  summary     text CHECK (summary IS NULL OR length(summary) <= 4000),
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- One open case per situation where that matters (e.g. geocode:<bounty>).
  dedupe_key  text UNIQUE,
  resolved_at timestamptz,
  resolved_by uuid
);

CREATE INDEX IF NOT EXISTS idx_support_cases_open
  ON public.support_cases (created_at DESC) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_support_cases_bounty ON public.support_cases (bounty_id);

ALTER TABLE public.support_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_cases FROM anon, authenticated;

-- ── email_reply_contexts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_reply_contexts (
  token             text PRIMARY KEY CHECK (token ~ '^[a-z2-7]{26}$'),
  poster_id         uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  bounty_id         uuid NOT NULL REFERENCES public.bounties (id) ON DELETE CASCADE,
  request_id        uuid,
  notification_type text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  reply_count       integer NOT NULL DEFAULT 0,
  last_reply_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_email_reply_contexts_expires ON public.email_reply_contexts (expires_at);

ALTER TABLE public.email_reply_contexts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_reply_contexts FROM anon, authenticated;

-- ── geocoding retry ledger ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bounty_geocode_attempts (
  bounty_id       uuid PRIMARY KEY REFERENCES public.bounties (id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'resolved', 'failed', 'gave_up', 'no_address')),
  attempts        integer NOT NULL DEFAULT 0,
  -- A provider status or reason code only. Never the address.
  last_error      text CHECK (last_error IS NULL OR length(last_error) <= 200),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bounty_geocode_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bounty_geocode_attempts FROM anon, authenticated;

-- Claims up to p_limit open in-person bounties that still have no point.
--
-- Duplicate processing: candidates are row-locked with SKIP LOCKED, and the
-- claim pushes next_attempt_at into the future in the same statement, so two
-- overlapping runs can never geocode the same bounty.
--
-- Returns the PRIVATE address (bounty_private_locations), because after the
-- privacy trigger bounties.location holds only a coarse public label; a city
-- centroid would place the bounty somewhere it isn't. No private address =
-- address NULL, which the caller records as no_address for a person to fix.
CREATE OR REPLACE FUNCTION public.fn_claim_geocode_batch(p_limit integer DEFAULT 10)
RETURNS TABLE (bounty_id uuid, address text, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT b.id
      FROM public.bounties b
      LEFT JOIN public.bounty_geocode_attempts a ON a.bounty_id = b.id
     WHERE b.status = 'open'
       AND b.work_type = 'in_person'
       AND b.geom IS NULL
       AND COALESCE(b.is_test, false) = false
       AND b.created_at > now() - interval '30 days'
       AND (a.bounty_id IS NULL
            OR (a.status IN ('pending', 'failed') AND a.next_attempt_at <= now()))
     ORDER BY b.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
     FOR UPDATE OF b SKIP LOCKED
  ),
  claimed AS (
    INSERT INTO public.bounty_geocode_attempts AS g (bounty_id, status, attempts, last_attempt_at, next_attempt_at)
    SELECT c.id, 'pending', 1, now(), now() + interval '10 minutes'
      FROM candidates c
    ON CONFLICT (bounty_id) DO UPDATE
       SET attempts        = g.attempts + 1,
           status          = 'pending',
           last_attempt_at = now(),
           -- 10 min, 20, 40, 80 ... capped at 6 h.
           next_attempt_at = now() + LEAST(interval '6 hours', interval '10 minutes' * power(2, g.attempts))
    RETURNING g.bounty_id, g.attempts
  )
  SELECT cl.bounty_id, NULLIF(btrim(p.address), ''), cl.attempts
    FROM claimed cl
    LEFT JOIN public.bounty_private_locations p ON p.bounty_id = cl.bounty_id;
END;
$$;

-- Writes a geocoded point through the normal bounties path, so the existing
-- triggers do the rest exactly as for an app post: zz_bounties_privatize_location
-- moves the exact point into bounty_private_locations and leaves only a
-- jittered geom on the public row, and fn_bounties_claim_nearby_notification
-- notifies nearby hunters if the bounty is under 24 h old (older bounties
-- become findable by nearby search without a "just posted" push).
--
-- Only ever fills a gap: no-op if the bounty already has a point or is no
-- longer open, so it cannot overwrite a location the poster set.
CREATE OR REPLACE FUNCTION public.fn_apply_bounty_geocode(
  p_bounty_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_zip_code text DEFAULT NULL,
  p_neighborhood text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rows integer;
  v_status text;
BEGIN
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'fn_apply_bounty_geocode: invalid coordinates';
  END IF;

  UPDATE public.bounties
     SET latitude     = p_latitude,
         longitude    = p_longitude,
         zip_code     = COALESCE(NULLIF(btrim(COALESCE(zip_code, '')), ''),
                                 CASE WHEN p_zip_code ~ '^\d{5}$' THEN p_zip_code END),
         neighborhood = COALESCE(neighborhood, NULLIF(btrim(COALESCE(p_neighborhood, '')), '')),
         updated_at   = now()
   WHERE id = p_bounty_id
     AND geom IS NULL
     AND status = 'open';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 1 THEN
    v_status := 'applied';
  ELSIF EXISTS (SELECT 1 FROM public.bounties WHERE id = p_bounty_id AND geom IS NOT NULL) THEN
    v_status := 'already_located';
  ELSE
    v_status := 'not_open';
  END IF;

  UPDATE public.bounty_geocode_attempts
     SET status = 'resolved', resolved_at = now(), last_error = NULL
   WHERE bounty_id = p_bounty_id;

  RETURN v_status;
END;
$$;

-- Records a failed attempt. Gives up after p_max_attempts (or immediately for
-- p_terminal, e.g. no address on file) and opens ONE support case per bounty —
-- a missing point is a job for a person, never proof that no hunter is nearby.
CREATE OR REPLACE FUNCTION public.fn_record_geocode_failure(
  p_bounty_id uuid,
  p_reason text,
  p_terminal boolean DEFAULT false,
  p_max_attempts integer DEFAULT 5
)
RETURNS TABLE (status text, case_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  v_status   text;
  v_poster   uuid;
  v_case_id  uuid;
BEGIN
  UPDATE public.bounty_geocode_attempts g
     SET status = CASE
                    WHEN p_terminal AND p_reason = 'no_address' THEN 'no_address'
                    WHEN p_terminal OR g.attempts >= p_max_attempts THEN 'gave_up'
                    ELSE 'failed'
                  END,
         last_error = left(COALESCE(p_reason, 'unknown'), 200)
   WHERE g.bounty_id = p_bounty_id
  RETURNING g.status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'fn_record_geocode_failure: bounty % was not claimed', p_bounty_id;
  END IF;

  IF v_status IN ('gave_up', 'no_address') THEN
    SELECT COALESCE(poster_id, user_id) INTO v_poster FROM public.bounties WHERE id = p_bounty_id;
    INSERT INTO public.support_cases (kind, channel, poster_id, bounty_id, summary, metadata, dedupe_key)
    VALUES (
      'geocode_failed', 'system', v_poster, p_bounty_id,
      CASE WHEN v_status = 'no_address'
           THEN 'In-person bounty has no address on file, so it cannot be placed on the map. Ask the poster where the job is.'
           ELSE 'In-person bounty address could not be located automatically. Check the address and set the location by hand.'
      END,
      jsonb_build_object('reason', left(COALESCE(p_reason, 'unknown'), 200)),
      'geocode:' || p_bounty_id::text
    )
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_case_id;
  END IF;

  RETURN QUERY SELECT v_status, v_case_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_claim_geocode_batch(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_apply_bounty_geocode(uuid, double precision, double precision, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_record_geocode_failure(uuid, text, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_geocode_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_apply_bounty_geocode(uuid, double precision, double precision, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_geocode_failure(uuid, text, boolean, integer) TO service_role;

-- ── "You're live" email: link to the website, not the app ─────────────────
-- fn_email_bounty_posted was applied to production on 2026-10-02
-- (schema_migrations 20261002230727 bounty_posted_email_trigger) but never
-- committed. Its button pointed at bountyexpo-workspace://postings/<id>, the
-- same app-only link that stranded the 2026-10-06 poster. Redefined here with
-- the identical body except ctaUrl, which now opens the bounty on the
-- website (see supabase/functions/_shared/web-links.ts). The trigger that
-- calls it is unchanged and not redefined.
CREATE OR REPLACE FUNCTION public.fn_email_bounty_posted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_url    text;
  v_key    text;
  v_poster uuid;
  v_reward text;
begin
  v_poster := coalesce(new.poster_id, new.user_id);
  if v_poster is null then
    return null;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'SUPABASE_URL';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY';
  if v_url is null or v_key is null then
    raise warning 'fn_email_bounty_posted: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in vault (bounty %)', new.id;
    return null;
  end if;

  v_reward := case
    when new.is_for_honor then 'For honor'
    when new.amount = trunc(new.amount) then '$' || trunc(new.amount)::text
    else '$' || to_char(new.amount, 'FM999999990.00')
  end;

  perform net.http_post(
    url     := v_url || '/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'userIds',  jsonb_build_array(v_poster),
      'category', 'marketplace',
      'type',     'bounty_posted',
      'title',    'You''re live',
      'body',     coalesce(new.title, ''),
      'data',     jsonb_build_object(
        'bountyId',      new.id,
        'bountyTitle',   coalesce(new.title, ''),
        'rewardDisplay', v_reward,
        'isInPerson',    (new.work_type::text = 'in_person'),
        'payAtHire',     (new.funding_mode = 'at_accept'),
        'ctaUrl',        'https://www.bountyfinder.net/manage/?bounty=' || new.id::text
                         || '&utm_source=bounty_email&utm_medium=email&utm_campaign=bounty_posted'
      )
    )
  );

  return null;
exception when others then
  raise warning 'fn_email_bounty_posted failed for bounty %: %', new.id, sqlerrm;
  return null;
end;
$function$;

COMMIT;
