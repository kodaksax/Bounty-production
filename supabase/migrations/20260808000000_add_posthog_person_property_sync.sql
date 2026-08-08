BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.analytics_user_facts (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  metric text NOT NULL CHECK (metric IN (
    'bounties_posted',
    'paid_bounties_posted',
    'bounties_claimed',
    'bounties_completed',
    'lifetime_gmv'
  )),
  source_id text NOT NULL,
  amount numeric(14, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, metric, source_id)
);

CREATE TABLE IF NOT EXISTS public.analytics_person_outbox (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  properties jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_person_outbox_pending
  ON public.analytics_person_outbox(status, scheduled_at, updated_at)
  WHERE status IN ('pending', 'sending', 'failed');

ALTER TABLE public.analytics_user_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_person_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_user_facts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.analytics_person_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.analytics_person_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.is_internal_analytics_email(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(trim(COALESCE(p_email, ''))) IN (
    'jordanmag11@yahoo.com',
    'leewright093@gmail.com',
    'support@bountyfinder.app',
    'posterbnty158@gmail.com',
    'hunterbnty158@gmail.com'
  ) OR lower(COALESCE(p_email, '')) LIKE '%bountyfinder%';
$$;

CREATE OR REPLACE FUNCTION public.coarse_analytics_region(p_location text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_parts text[];
  v_count integer;
BEGIN
  IF NULLIF(trim(p_location), '') IS NULL THEN
    RETURN NULL;
  END IF;

  v_parts := regexp_split_to_array(trim(p_location), '\s*,\s*');
  v_count := array_length(v_parts, 1);
  IF v_count >= 3 THEN
    RETURN v_parts[v_count - 1] || ', ' || v_parts[v_count];
  END IF;
  IF v_count = 2
     AND p_location !~ '[0-9]'
     AND v_parts[1] !~* '\m(street|road|avenue|boulevard|lane|drive|court|highway)\M' THEN
    RETURN v_parts[1] || ', ' || v_parts[2];
  END IF;
  IF v_count = 1 AND p_location !~ '[0-9]' THEN
    RETURN trim(p_location);
  END IF;
  -- Free-form values that may contain a street address are not analytics-safe.
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_analytics_person_snapshot(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_posted bigint;
  v_paid_posted bigint;
  v_claimed bigint;
  v_completed bigint;
  v_gmv numeric(14, 2);
  v_behavior_role text;
  v_properties jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    count(*) FILTER (WHERE metric = 'bounties_posted'),
    count(*) FILTER (WHERE metric = 'paid_bounties_posted'),
    count(*) FILTER (WHERE metric = 'bounties_claimed'),
    count(*) FILTER (WHERE metric = 'bounties_completed'),
    COALESCE(sum(amount) FILTER (WHERE metric = 'lifetime_gmv'), 0)
  INTO v_posted, v_paid_posted, v_claimed, v_completed, v_gmv
  FROM public.analytics_user_facts
  WHERE user_id = p_user_id;

  v_behavior_role := CASE
    WHEN v_posted > 0 AND v_claimed > 0 THEN 'both'
    WHEN v_posted > 0 THEN 'poster'
    WHEN v_claimed > 0 THEN 'hunter'
    ELSE v_profile.primary_role
  END;

  v_properties := jsonb_build_object(
    'role', v_behavior_role,
    'signup_date', v_profile.created_at,
    'onboarding_completed_at', v_profile.onboarding_completed_at,
    'bounties_posted', v_posted,
    'paid_bounties_posted', v_paid_posted,
    'bounties_claimed', v_claimed,
    'bounties_completed', v_completed,
    'lifetime_gmv', v_gmv,
    'is_identity_verified', (
      COALESCE(v_profile.stripe_identity_status = 'verified', false)
      OR COALESCE(v_profile.id_verification_status = 'verified', false)
    ),
    'has_payment_method', EXISTS (
      SELECT 1 FROM public.payment_methods WHERE user_id = p_user_id
    ),
    'has_stripe_connect', (
      COALESCE(v_profile.stripe_connect_charges_enabled, false)
      AND COALESCE(v_profile.stripe_connect_payouts_enabled, false)
    ),
    'home_region', public.coarse_analytics_region(v_profile.location),
    'is_internal', public.is_internal_analytics_email(v_profile.email)
  );

  INSERT INTO public.analytics_person_outbox (
    user_id, properties, status, attempts, scheduled_at, last_error, updated_at
  ) VALUES (
    p_user_id, v_properties, 'pending', 0, NULL, NULL, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    properties = EXCLUDED.properties,
    status = 'pending',
    attempts = 0,
    scheduled_at = NULL,
    last_error = NULL,
    updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_bounty_analytics_facts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_poster_id uuid;
  v_hunter_id uuid;
BEGIN
  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
    VALUES (v_poster_id, 'bounties_posted', NEW.id::text)
    ON CONFLICT DO NOTHING;

    IF COALESCE(NEW.is_for_honor, false) = false AND COALESCE(NEW.amount, 0) > 0 THEN
      INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
      VALUES (v_poster_id, 'paid_bounties_posted', NEW.id::text)
      ON CONFLICT DO NOTHING;
    END IF;
    PERFORM public.enqueue_analytics_person_snapshot(v_poster_id);
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'completed' THEN
    v_hunter_id := COALESCE(NEW.accepted_by, NEW.hunter_id);
    IF v_hunter_id IS NOT NULL THEN
      INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
      VALUES (v_hunter_id, 'bounties_completed', NEW.id::text)
      ON CONFLICT DO NOTHING;
      PERFORM public.enqueue_analytics_person_snapshot(v_hunter_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_claim_analytics_fact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status::text = 'accepted'
     AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM NEW.status::text) THEN
    INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
    VALUES (NEW.hunter_id, 'bounties_claimed', NEW.id::text)
    ON CONFLICT DO NOTHING;
    PERFORM public.enqueue_analytics_person_snapshot(NEW.hunter_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_release_analytics_facts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_poster_id uuid;
  v_hunter_id uuid;
  v_gross numeric(14, 2);
BEGIN
  IF NEW.type = 'release'
     AND NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT
      COALESCE(b.poster_id, b.user_id),
      COALESCE(b.accepted_by, b.hunter_id),
      COALESCE((
        SELECT abs(wt.amount)
        FROM public.wallet_transactions wt
        WHERE wt.bounty_id = b.id
          AND wt.type = 'escrow'
          AND wt.status = 'completed'
        ORDER BY wt.created_at DESC
        LIMIT 1
      ), abs(b.amount), 0)
    INTO v_poster_id, v_hunter_id, v_gross
    FROM public.bounties b
    WHERE b.id = NEW.bounty_id;

    IF v_hunter_id IS NOT NULL THEN
      INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
      VALUES (v_hunter_id, 'bounties_completed', NEW.bounty_id::text)
      ON CONFLICT DO NOTHING;
      INSERT INTO public.analytics_user_facts(user_id, metric, source_id, amount)
      VALUES (v_hunter_id, 'lifetime_gmv', NEW.bounty_id::text, v_gross)
      ON CONFLICT DO NOTHING;
      PERFORM public.enqueue_analytics_person_snapshot(v_hunter_id);
    END IF;

    IF v_poster_id IS NOT NULL THEN
      INSERT INTO public.analytics_user_facts(user_id, metric, source_id, amount)
      VALUES (v_poster_id, 'lifetime_gmv', NEW.bounty_id::text, v_gross)
      ON CONFLICT DO NOTHING;
      PERFORM public.enqueue_analytics_person_snapshot(v_poster_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_profile_analytics_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.enqueue_analytics_person_snapshot(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_payment_method_analytics_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.enqueue_analytics_person_snapshot(OLD.user_id);
    RETURN OLD;
  END IF;
  PERFORM public.enqueue_analytics_person_snapshot(NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_onboarding_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(OLD.onboarding_completed, false) = false
     AND NEW.onboarding_completed = true
     AND NEW.onboarding_completed_at IS NULL THEN
    NEW.onboarding_completed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_onboarding_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND current_setting('app.bypass_profile_guard', true) IS DISTINCT FROM 'on'
     AND NEW.onboarding_completed_at IS DISTINCT FROM OLD.onboarding_completed_at THEN
    RAISE EXCEPTION 'onboarding_completed_at is server-managed';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_analytics_person_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_bounty_analytics_facts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_claim_analytics_fact() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_release_analytics_facts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_profile_analytics_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_payment_method_analytics_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_onboarding_completed_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_onboarding_completed_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_00_protect_onboarding_completed_at ON public.profiles;
CREATE TRIGGER trg_00_protect_onboarding_completed_at
  BEFORE UPDATE OF onboarding_completed_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_onboarding_completed_at();

DROP TRIGGER IF EXISTS trg_stamp_onboarding_completed_at ON public.profiles;
CREATE TRIGGER trg_stamp_onboarding_completed_at
  BEFORE UPDATE OF onboarding_completed ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_onboarding_completed_at();

DROP TRIGGER IF EXISTS trg_capture_bounty_analytics_facts ON public.bounties;
CREATE TRIGGER trg_capture_bounty_analytics_facts
  AFTER INSERT OR UPDATE OF status ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.capture_bounty_analytics_facts();

DROP TRIGGER IF EXISTS trg_capture_claim_analytics_fact ON public.bounty_requests;
CREATE TRIGGER trg_capture_claim_analytics_fact
  AFTER INSERT OR UPDATE OF status ON public.bounty_requests
  FOR EACH ROW EXECUTE FUNCTION public.capture_claim_analytics_fact();

DROP TRIGGER IF EXISTS trg_capture_release_analytics_facts ON public.wallet_transactions;
CREATE TRIGGER trg_capture_release_analytics_facts
  AFTER INSERT OR UPDATE OF status ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.capture_release_analytics_facts();

DROP TRIGGER IF EXISTS trg_queue_profile_analytics_snapshot ON public.profiles;
CREATE TRIGGER trg_queue_profile_analytics_snapshot
  AFTER INSERT OR UPDATE OF email, primary_role, onboarding_completed, onboarding_completed_at,
    stripe_identity_status, id_verification_status,
    stripe_connect_charges_enabled, stripe_connect_payouts_enabled, location
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.queue_profile_analytics_snapshot();

DROP TRIGGER IF EXISTS trg_queue_payment_method_analytics_snapshot ON public.payment_methods;
CREATE TRIGGER trg_queue_payment_method_analytics_snapshot
  AFTER INSERT OR DELETE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.queue_payment_method_analytics_snapshot();

INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
SELECT COALESCE(b.poster_id, b.user_id), 'bounties_posted', b.id::text
FROM public.bounties b
ON CONFLICT DO NOTHING;

INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
SELECT COALESCE(b.poster_id, b.user_id), 'paid_bounties_posted', b.id::text
FROM public.bounties b
WHERE COALESCE(b.is_for_honor, false) = false AND COALESCE(b.amount, 0) > 0
ON CONFLICT DO NOTHING;

INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
SELECT br.hunter_id, 'bounties_claimed', br.id::text
FROM public.bounty_requests br
WHERE br.status::text = 'accepted'
ON CONFLICT DO NOTHING;

INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
SELECT COALESCE(b.accepted_by, b.hunter_id), 'bounties_completed', b.id::text
FROM public.bounties b
WHERE b.status = 'completed' AND COALESCE(b.accepted_by, b.hunter_id) IS NOT NULL
ON CONFLICT DO NOTHING;

WITH completed_releases AS (
  SELECT DISTINCT ON (wt.bounty_id)
    wt.bounty_id,
    COALESCE(b.poster_id, b.user_id) AS poster_id,
    COALESCE(b.accepted_by, b.hunter_id, wt.user_id) AS hunter_id,
    COALESCE((
      SELECT abs(escrow.amount)
      FROM public.wallet_transactions escrow
      WHERE escrow.bounty_id = wt.bounty_id
        AND escrow.type = 'escrow'
        AND escrow.status = 'completed'
      ORDER BY escrow.created_at DESC
      LIMIT 1
    ), abs(b.amount), 0) AS gross_amount
  FROM public.wallet_transactions wt
  JOIN public.bounties b ON b.id = wt.bounty_id
  WHERE wt.type = 'release' AND wt.status = 'completed'
  ORDER BY wt.bounty_id, wt.created_at DESC
), gmv_facts AS (
  SELECT poster_id AS user_id, bounty_id, gross_amount FROM completed_releases
  UNION ALL
  SELECT hunter_id AS user_id, bounty_id, gross_amount FROM completed_releases
)
INSERT INTO public.analytics_user_facts(user_id, metric, source_id, amount)
SELECT user_id, 'lifetime_gmv', bounty_id::text, gross_amount
FROM gmv_facts
WHERE user_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
SELECT cr.hunter_id, 'bounties_completed', cr.bounty_id::text
FROM (
  SELECT DISTINCT ON (wt.bounty_id)
    wt.bounty_id,
    COALESCE(b.accepted_by, b.hunter_id, wt.user_id) AS hunter_id
  FROM public.wallet_transactions wt
  JOIN public.bounties b ON b.id = wt.bounty_id
  WHERE wt.type = 'release' AND wt.status = 'completed'
  ORDER BY wt.bounty_id, wt.created_at DESC
) cr
WHERE cr.hunter_id IS NOT NULL
ON CONFLICT DO NOTHING;

SELECT public.enqueue_analytics_person_snapshot(id) FROM public.profiles;

CREATE OR REPLACE FUNCTION public.drain_analytics_person_outbox()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_url text;
  v_key text;
  v_row record;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'drain_analytics_person_outbox: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in vault';
    RETURN;
  END IF;

  FOR v_row IN
    SELECT user_id
    FROM public.analytics_person_outbox
    WHERE status IN ('pending', 'sending', 'failed')
      AND attempts < 5
      AND (scheduled_at IS NULL OR scheduled_at <= now())
    ORDER BY updated_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM net.http_post(
      url := v_url || '/functions/v1/process-analytics-person',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('user_id', v_row.user_id)
    );

    UPDATE public.analytics_person_outbox
    SET status = 'sending',
      attempts = attempts + 1,
      scheduled_at = now() + interval '2 minutes'
    WHERE user_id = v_row.user_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.drain_analytics_person_outbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_analytics_person_outbox() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-analytics-person-outbox') THEN
      PERFORM cron.unschedule('drain-analytics-person-outbox');
    END IF;
    PERFORM cron.schedule(
      'drain-analytics-person-outbox',
      '* * * * *',
      'select public.drain_analytics_person_outbox()'
    );
  ELSE
    RAISE WARNING 'pg_cron and/or pg_net unavailable; analytics person outbox was not scheduled';
  END IF;
END;
$$;

COMMIT;