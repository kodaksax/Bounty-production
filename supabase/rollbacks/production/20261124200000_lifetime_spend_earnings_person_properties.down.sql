-- Reverts 20261124200000_lifetime_spend_earnings_person_properties.sql.
--
-- 1. Restores capture_release_analytics_facts() and
--    enqueue_analytics_person_snapshot() exactly as they were live on
--    2026-11-24 (md5 897cdb05… and de2f7b30…), so nothing writes the new
--    metrics any more.
-- 2. Deletes every lifetime_spend / lifetime_earnings fact. Only this
--    migration (its trigger and its backfill) ever wrote them. Removes this
--    backfill's log rows.
-- 3. Restores the metric CHECK constraint and drops the backfill helpers.
-- 4. Re-enqueues the affected persons.
--
-- PostHog keeps person properties it was sent: the re-enqueued snapshot no
-- longer carries lifetime_spend / lifetime_earnings, but `$set` does not
-- remove them. To clear them in PostHog as well, send `$unset` for those two
-- keys to the persons listed by step 2 (the SELECT below prints them).
--
-- lifetime_gmv facts are untouched throughout.

BEGIN;

CREATE OR REPLACE FUNCTION public.capture_release_analytics_facts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      b.accepted_by,  -- fixed: removed b.hunter_id
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
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_analytics_person_snapshot(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- `false OR NULL` is NULL, and a NULL here would ship as JSON `null`
    -- rather than a boolean, breaking any PostHog filter/insight that expects
    -- true/false. v_profile.is_internal is NOT NULL DEFAULT false and
    -- is_internal_analytics_email() already COALESCEs its own argument (both
    -- verified against the live prod definitions on 2026-09-28), so this can
    -- never actually be NULL today -- the outer COALESCE is defense-in-depth
    -- against either of those assumptions changing later, not a live bug fix.
    'is_internal', COALESCE(
      COALESCE(v_profile.is_internal, false)
      OR public.is_internal_analytics_email(v_profile.email),
      false
    )
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
$function$;

CREATE TEMP TABLE _reverted_split_persons ON COMMIT DROP AS
  SELECT DISTINCT user_id FROM public.analytics_user_facts
  WHERE metric IN ('lifetime_spend', 'lifetime_earnings');

-- Persons whose PostHog record still holds the two keys (for `$unset`).
SELECT user_id FROM _reverted_split_persons ORDER BY user_id;

DELETE FROM public.analytics_user_facts
WHERE metric IN ('lifetime_spend', 'lifetime_earnings');

DELETE FROM public.analytics_facts_backfill_log
WHERE metric IN ('lifetime_spend', 'lifetime_earnings');

ALTER TABLE public.analytics_user_facts
  DROP CONSTRAINT analytics_user_facts_metric_check;
ALTER TABLE public.analytics_user_facts
  ADD CONSTRAINT analytics_user_facts_metric_check CHECK (metric = ANY (ARRAY[
    'bounties_posted'::text,
    'paid_bounties_posted'::text,
    'bounties_claimed'::text,
    'bounties_completed'::text,
    'lifetime_gmv'::text
  ]));

DROP FUNCTION IF EXISTS public.backfill_lifetime_split_facts(boolean, text);
DROP FUNCTION IF EXISTS public.missing_lifetime_split_facts();

SELECT public.enqueue_analytics_person_snapshot(user_id) FROM _reverted_split_persons;

COMMIT;
