-- lifetime_spend (poster) and lifetime_earnings (hunter) person properties.
--
-- Why: lifetime_gmv credits the same gross to BOTH sides of a completed
-- bounty. capture_release_analytics_facts() writes one 'lifetime_gmv' fact
-- for the hunter and one for the poster, each carrying the escrowed gross, so
-- summing lifetime_gmv across persons counts every completed bounty twice.
-- It stays, unchanged, for history. Do not sum it across persons (see
-- docs/analytics/EVENT_TAXONOMY_CUTOVER.md, "Person properties").
--
-- New facts, one per completed bounty, same identity rules as lifetime_gmv:
--   lifetime_spend     poster = COALESCE(bounties.poster_id, bounties.user_id)
--                      amount = the escrowed gross (latest completed 'escrow'
--                      wallet_transactions row, else bounties.amount)
--   lifetime_earnings  hunter = bounties.accepted_by
--                      amount = abs(amount) of the completed 'release'
--                      wallet_transactions row itself: what the hunter was
--                      paid, after the platform fee (e.g. 503.50 of 530.00)
-- Summing lifetime_spend across posters is GMV; summing lifetime_earnings
-- across hunters is hunter payouts. Neither double-counts.
--
-- enqueue_analytics_person_snapshot() is the live prod definition
-- (md5 de2f7b30d2fb0268a4f27b9fe8d970bd on 2026-11-24) plus the two sums and
-- keys. capture_release_analytics_facts() is the live definition
-- (md5 897cdb05129f8f11776112c6035a77a1) plus the two inserts.
-- process-analytics-person sends the outbox properties as `$set` unchanged,
-- so no edge function deploy is needed.
--
-- Backfill: public.backfill_lifetime_split_facts(p_dry_run) reports what it
-- would write when p_dry_run = true (the default) and writes nothing. With
-- false it inserts the missing facts for every completed release, logs each
-- row to analytics_facts_backfill_log under p_batch, and re-enqueues those
-- persons so PostHog gets the values. Applying this migration writes no
-- facts by itself.
--
-- Rollback: supabase/rollbacks/production/20261124200000_lifetime_spend_earnings_person_properties.down.sql

-- ── Allowed metrics ─────────────────────────────────────────────────────────
ALTER TABLE public.analytics_user_facts
  DROP CONSTRAINT analytics_user_facts_metric_check;
ALTER TABLE public.analytics_user_facts
  ADD CONSTRAINT analytics_user_facts_metric_check CHECK (metric = ANY (ARRAY[
    'bounties_posted'::text,
    'paid_bounties_posted'::text,
    'bounties_claimed'::text,
    'bounties_completed'::text,
    'lifetime_gmv'::text,
    'lifetime_spend'::text,
    'lifetime_earnings'::text
  ]));

-- ── Release trigger ─────────────────────────────────────────────────────────
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
      -- What the hunter was actually paid: this release row, net of fee.
      INSERT INTO public.analytics_user_facts(user_id, metric, source_id, amount)
      VALUES (v_hunter_id, 'lifetime_earnings', NEW.bounty_id::text, COALESCE(abs(NEW.amount), 0))
      ON CONFLICT DO NOTHING;
      PERFORM public.enqueue_analytics_person_snapshot(v_hunter_id);
    END IF;

    IF v_poster_id IS NOT NULL THEN
      INSERT INTO public.analytics_user_facts(user_id, metric, source_id, amount)
      VALUES (v_poster_id, 'lifetime_gmv', NEW.bounty_id::text, v_gross)
      ON CONFLICT DO NOTHING;
      -- What the poster paid: the escrowed gross.
      INSERT INTO public.analytics_user_facts(user_id, metric, source_id, amount)
      VALUES (v_poster_id, 'lifetime_spend', NEW.bounty_id::text, v_gross)
      ON CONFLICT DO NOTHING;
      PERFORM public.enqueue_analytics_person_snapshot(v_poster_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Person snapshot ─────────────────────────────────────────────────────────
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
  v_spend numeric(14, 2);
  v_earnings numeric(14, 2);
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
    COALESCE(sum(amount) FILTER (WHERE metric = 'lifetime_gmv'), 0),
    COALESCE(sum(amount) FILTER (WHERE metric = 'lifetime_spend'), 0),
    COALESCE(sum(amount) FILTER (WHERE metric = 'lifetime_earnings'), 0)
  INTO v_posted, v_paid_posted, v_claimed, v_completed, v_gmv, v_spend, v_earnings
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
    -- Credited to BOTH poster and hunter: never sum across persons.
    'lifetime_gmv', v_gmv,
    'lifetime_spend', v_spend,
    'lifetime_earnings', v_earnings,
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

-- ── Backfill (reversible, dry-run first) ────────────────────────────────────
-- analytics_facts_backfill_log exists since 20261105180000.

-- Facts the new trigger would have written for every completed release as
-- the data stands now.
CREATE OR REPLACE FUNCTION public.missing_lifetime_split_facts()
RETURNS TABLE (user_id uuid, metric text, source_id text, amount numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH releases AS (
    SELECT DISTINCT ON (r.bounty_id)
      r.bounty_id,
      COALESCE(b.poster_id, b.user_id) AS poster_id,
      b.accepted_by AS hunter_id,
      COALESCE(abs(r.amount), 0) AS paid,
      COALESCE((
        SELECT abs(wt.amount)
        FROM public.wallet_transactions wt
        WHERE wt.bounty_id = b.id
          AND wt.type = 'escrow'
          AND wt.status = 'completed'
        ORDER BY wt.created_at DESC
        LIMIT 1
      ), abs(b.amount), 0) AS gross
    FROM public.wallet_transactions r
    JOIN public.bounties b ON b.id = r.bounty_id
    WHERE r.type = 'release' AND r.status = 'completed'
    -- The trigger keeps the first release per bounty (ON CONFLICT DO
    -- NOTHING); none has more than one as of 2026-11-24.
    ORDER BY r.bounty_id, r.created_at
  ),
  wanted AS (
    SELECT poster_id AS user_id, 'lifetime_spend'::text AS metric, bounty_id::text AS source_id, gross AS amount
    FROM releases WHERE poster_id IS NOT NULL
    UNION ALL
    SELECT hunter_id, 'lifetime_earnings', bounty_id::text, paid
    FROM releases WHERE hunter_id IS NOT NULL
  )
  SELECT w.user_id, w.metric, w.source_id, w.amount
  FROM wanted w
  -- FK: a fact needs a profile row.
  JOIN public.profiles p ON p.id = w.user_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.analytics_user_facts f
    WHERE f.user_id = w.user_id
      AND f.metric = w.metric
      AND f.source_id = w.source_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.backfill_lifetime_split_facts(
  p_dry_run boolean DEFAULT true,
  p_batch text DEFAULT 'lifetime_split_2026_11_24'
)
RETURNS TABLE (metric text, fact_rows bigint, persons bigint, total_amount numeric, written boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
BEGIN
  IF p_dry_run THEN
    RETURN QUERY
      SELECT m.metric, count(*), count(DISTINCT m.user_id), sum(m.amount), false
      FROM public.missing_lifetime_split_facts() m
      GROUP BY m.metric
      ORDER BY m.metric;
    RETURN;
  END IF;

  WITH ins AS (
    INSERT INTO public.analytics_user_facts (user_id, metric, source_id, amount)
    SELECT m.user_id, m.metric, m.source_id, m.amount FROM public.missing_lifetime_split_facts() m
    ON CONFLICT DO NOTHING
    RETURNING analytics_user_facts.user_id, analytics_user_facts.metric, analytics_user_facts.source_id
  )
  INSERT INTO public.analytics_facts_backfill_log (batch, user_id, metric, source_id, created_at)
  SELECT p_batch, ins.user_id, ins.metric, ins.source_id, now() FROM ins
  ON CONFLICT DO NOTHING;

  -- now() is the transaction start, so these are exactly this run's rows.
  FOR v_user IN
    SELECT DISTINCT l.user_id FROM public.analytics_facts_backfill_log l
    WHERE l.batch = p_batch AND l.created_at = now()
  LOOP
    PERFORM public.enqueue_analytics_person_snapshot(v_user);
  END LOOP;

  RETURN QUERY
    SELECT f.metric, count(*), count(DISTINCT f.user_id), sum(f.amount), true
    FROM public.analytics_facts_backfill_log l
    JOIN public.analytics_user_facts f
      ON f.user_id = l.user_id AND f.metric = l.metric AND f.source_id = l.source_id
    WHERE l.batch = p_batch AND l.created_at = now()
    GROUP BY f.metric
    ORDER BY f.metric;
END;
$function$;

REVOKE ALL ON FUNCTION public.missing_lifetime_split_facts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_lifetime_split_facts(boolean, text) FROM PUBLIC, anon, authenticated;
