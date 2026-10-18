BEGIN;

-- Server-controlled opt-in. Legacy keeps source-specific geographic selection;
-- both modes use the same safety ledger, scorer, reach limit and hourly cap.
CREATE TABLE public.bounty_targeting_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  consolidated_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.bounty_targeting_config (singleton) VALUES (true);

CREATE TABLE public.bounty_targeting_dispatches (
  bounty_id uuid NOT NULL REFERENCES public.bounties(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('zip', 'radius', 'service_area', 'consolidated')),
  mode text NOT NULL CHECK (mode IN ('legacy', 'consolidated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bounty_id, source)
);

ALTER TABLE public.bounty_hunter_notifications
  ADD COLUMN outbox_id uuid REFERENCES public.notifications_outbox(id) ON DELETE SET NULL,
  ADD COLUMN provider_accepted_at timestamptz,
  ADD COLUMN in_app_created_at timestamptz;
COMMENT ON TABLE public.bounty_hunter_notifications IS
  'Durable bounty/hunter targeting reservation and scoring provenance. created_at means queued, NOT delivered. provider_accepted_at means a push ticket was accepted, NOT device delivery; pre-migration delivery outcomes are unknown.';

CREATE TABLE public.bounty_targeting_deliveries (
  outbox_id uuid NOT NULL REFERENCES public.notifications_outbox(id) ON DELETE CASCADE,
  hunter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('push', 'in_app', 'email')),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'processing', 'accepted', 'suppressed', 'failed', 'unknown')),
  claim_id uuid,
  attempted_at timestamptz,
  last_error text,
  PRIMARY KEY (outbox_id, hunter_id, channel)
);

ALTER TABLE public.bounty_targeting_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bounty_targeting_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bounty_targeting_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bounty_targeting_config, public.bounty_targeting_dispatches,
  public.bounty_targeting_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bounty_targeting_config, public.bounty_targeting_dispatches,
  public.bounty_targeting_deliveries TO service_role;

-- Import the old ZIP/service-area bypass into the dedup ledger. Never replay old
-- outbox rows or manufacture delivery acknowledgements.
-- Count the latest queued exposure toward the cap, even for existing ledger
-- pairs; retain the earliest observation and original scoring provenance.
INSERT INTO public.bounty_hunter_notifications AS ledger (bounty_id, hunter_id, stage, reasons, created_at)
SELECT b.id, p.id, 1, jsonb_build_object(
  'source', 'legacy_outbox', 'delivery', 'unknown',
  'first_queued_at', min(o.created_at), 'last_queued_at', max(o.created_at)), max(o.created_at)
FROM public.notifications_outbox o
JOIN public.bounties b ON b.id::text = COALESCE(o.data->>'bountyId', o.data->>'bounty_id', o.bounty_id)
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(o.recipients) = 'array' THEN o.recipients ELSE '[]'::jsonb END
) r(id)
JOIN public.profiles p ON p.id::text = r.id
WHERE o.data->>'type' = 'bounty_nearby'
GROUP BY b.id, p.id
ON CONFLICT (bounty_id, hunter_id) DO UPDATE
SET created_at = GREATEST(ledger.created_at, EXCLUDED.created_at),
    reasons = COALESCE(ledger.reasons, '{}'::jsonb)
      || jsonb_build_object('legacy_outbox_import', EXCLUDED.reasons);

CREATE OR REPLACE FUNCTION public.fn_score_and_dispatch_bounty_notification(
  p_bounty_id uuid, p_candidates uuid[], p_stage smallint,
  p_title text, p_body text, p_extra_data jsonb DEFAULT '{}'::jsonb
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_bounty record;
  v_cap integer;
  v_outbox uuid := gen_random_uuid();
  v_recipients uuid[];
  v_hunter uuid;
  v_pool jsonb;
BEGIN
  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND OR COALESCE(v_bounty.is_test, false) OR v_bounty.status <> 'open' THEN RETURN 0; END IF;
  IF NOT COALESCE((public.fn_bounty_distribution_gate(
    p_bounty_id, 'targeting', p_stage, p_stage > 1)->>'allowed')::boolean, false) THEN RETURN 0; END IF;
  IF p_candidates IS NULL OR cardinality(p_candidates) = 0 THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bounty-targeting-global', 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('bounty-targeting-score:' || p_bounty_id::text, 0));

  v_cap := CASE WHEN v_bounty.is_for_honor THEN 15
    WHEN v_bounty.amount >= 100 THEN 60 WHEN v_bounty.amount >= 40 THEN 40 ELSE 25 END;
  -- Legacy source triggers cannot multiply the initial reward-scaled reach.
  v_cap := GREATEST(0, v_cap - (SELECT count(*) FROM public.bounty_hunter_notifications
    WHERE bounty_id = p_bounty_id AND stage = p_stage));
  IF v_cap = 0 THEN RETURN 0; END IF;

  -- Filter and score the whole supplied pool BEFORE bounding it. Otherwise
  -- stale/applied hunters in the first 1000 IDs can hide every recruitable one.
  WITH candidates AS (
    SELECT p.id AS hunter_id,
      CASE WHEN v_bounty.category IS NULL OR cardinality(p.skill_categories) IS NULL
        OR cardinality(p.skill_categories) = 0 THEN 0.5
        WHEN v_bounty.category = ANY(p.skill_categories) THEN 1.0 ELSE 0.0 END AS category_score,
      CASE WHEN p.last_session_at IS NULL THEN 0.3
        WHEN p.last_session_at > now() - interval '3 days' THEN 1.0
        WHEN p.last_session_at > now() - interval '14 days' THEN 0.6 ELSE 0.3 END AS activity_score,
      GREATEST(0.0, 1.0 - COALESCE(p.cancellation_count, 0) * 0.15) AS reliability_score,
      CASE WHEN v_bounty.geom IS NULL OR p.geom IS NULL THEN 0.5
        ELSE GREATEST(0.0, 1.0 - (ST_Distance(v_bounty.geom, p.geom) / 1000.0) / 25.0) END AS distance_score
    FROM public.profiles p
    WHERE p.id = ANY(p_candidates)
      AND p.id IS DISTINCT FROM COALESCE(v_bounty.poster_id, v_bounty.user_id)
      AND p.deleted_at IS NULL AND p.account_status = 'active'
      AND NOT EXISTS (SELECT 1 FROM public.bounty_hunter_notifications n
        WHERE n.bounty_id = p_bounty_id AND n.hunter_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.bounty_requests r
        WHERE r.bounty_id = p_bounty_id AND r.hunter_id = p.id)
      AND (SELECT count(*) FROM public.bounty_hunter_notifications n
        WHERE n.hunter_id = p.id AND n.created_at > now() - interval '1 hour') < 5
  ), scored AS (
    SELECT *, category_score * 0.35 + activity_score * 0.2
      + reliability_score * 0.15 + distance_score * 0.3 AS score FROM candidates
  ), bounded AS (
    SELECT * FROM scored ORDER BY score DESC, hunter_id LIMIT 1000
  )
  SELECT jsonb_agg(to_jsonb(bounded) ORDER BY score DESC, hunter_id) INTO v_pool FROM bounded;
  IF v_pool IS NULL THEN RETURN 0; END IF;

  -- At most 1000 selected hunters are locked, in stable order. Recheck all
  -- eligibility and the rolling cap AFTER locking in a fresh statement.
  FOR v_hunter IN
    SELECT hunter_id FROM jsonb_to_recordset(v_pool) AS pool(hunter_id uuid) ORDER BY hunter_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('bounty-targeting:' || v_hunter::text, 0));
  END LOOP;

  WITH eligible AS (
    SELECT pool.*
    FROM jsonb_to_recordset(v_pool) AS pool(
      hunter_id uuid, category_score numeric, activity_score numeric,
      reliability_score numeric, distance_score numeric, score numeric)
    JOIN public.profiles p ON p.id = pool.hunter_id
    WHERE p.deleted_at IS NULL AND p.account_status = 'active'
      AND p.id IS DISTINCT FROM COALESCE(v_bounty.poster_id, v_bounty.user_id)
      AND NOT EXISTS (SELECT 1 FROM public.bounty_hunter_notifications n
        WHERE n.bounty_id = p_bounty_id AND n.hunter_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.bounty_requests r
        WHERE r.bounty_id = p_bounty_id AND r.hunter_id = p.id)
      AND (SELECT count(*) FROM public.bounty_hunter_notifications n
        WHERE n.hunter_id = p.id AND n.created_at > now() - interval '1 hour') < 5
  ), logged AS (
    INSERT INTO public.bounty_hunter_notifications (bounty_id, hunter_id, stage, score, reasons)
    SELECT p_bounty_id, hunter_id, p_stage, score,
      jsonb_build_object('category_score', category_score, 'activity_score', activity_score,
        'reliability_score', reliability_score, 'distance_score', distance_score,
        'match_sources', COALESCE(p_extra_data->'geo_matches'->hunter_id::text,
          jsonb_build_array(COALESCE(p_extra_data->>'match', 'liquidity'))),
        'targeting_mode', COALESCE(p_extra_data->>'targeting_mode', 'liquidity'))
    FROM eligible ORDER BY score DESC, hunter_id LIMIT v_cap
    ON CONFLICT (bounty_id, hunter_id) DO NOTHING RETURNING hunter_id
  )
  SELECT array_agg(hunter_id ORDER BY hunter_id) INTO v_recipients FROM logged;
  IF cardinality(v_recipients) IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.notifications_outbox (id, recipients, title, body, data, bounty_id)
  VALUES (v_outbox, to_jsonb(v_recipients), p_title, p_body,
    (COALESCE(p_extra_data, '{}'::jsonb) - 'geo_matches') ||
      jsonb_build_object('type', 'bounty_nearby', 'bountyId', p_bounty_id,
        'stage', p_stage, 'targeting_version', 1), p_bounty_id::text);
  UPDATE public.bounty_hunter_notifications SET outbox_id = v_outbox
    WHERE bounty_id = p_bounty_id AND hunter_id = ANY(v_recipients);
  INSERT INTO public.bounty_targeting_deliveries (outbox_id, hunter_id, channel)
    SELECT v_outbox, h, c FROM unnest(v_recipients) h
    CROSS JOIN unnest(ARRAY['push', 'in_app', 'email']) c;
  RETURN cardinality(v_recipients);
END;
$$;

CREATE FUNCTION public.fn_dispatch_bounty_targeting(p_bounty_id uuid, p_source text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  b record;
  v_mode text;
  v_source text;
  v_claim uuid;
  v_candidates uuid[];
  v_matches jsonb;
BEGIN
  IF p_source NOT IN ('zip', 'radius', 'service_area') THEN RETURN 0; END IF;
  SELECT * INTO b FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND OR COALESCE(b.is_test, false) OR b.status <> 'open' THEN RETURN 0; END IF;
  IF b.geom IS NULL AND COALESCE(btrim(b.zip_code), '') = '' THEN RETURN 0; END IF;
  IF p_source = 'zip' AND COALESCE(btrim(b.zip_code), '') = '' THEN RETURN 0; END IF;
  IF p_source IN ('radius', 'service_area') AND b.geom IS NULL THEN RETURN 0; END IF;
  IF NOT COALESCE((public.fn_bounty_distribution_gate(
    b.id, p_source, 1::smallint, false)->>'allowed')::boolean, false) THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bounty-targeting-global', 0));
  -- Freeze the rollout mode for this bounty: toggling cannot create a second blast.
  PERFORM pg_advisory_xact_lock(hashtextextended('bounty-targeting-mode:' || b.id::text, 0));
  SELECT mode INTO v_mode FROM public.bounty_targeting_dispatches WHERE bounty_id = b.id LIMIT 1;
  IF v_mode IS NULL THEN
    SELECT CASE WHEN consolidated_enabled THEN 'consolidated' ELSE 'legacy' END
      INTO v_mode FROM public.bounty_targeting_config WHERE singleton;
    v_mode := COALESCE(v_mode, 'legacy');
  END IF;
  v_source := CASE WHEN v_mode = 'consolidated' THEN 'consolidated' ELSE p_source END;
  INSERT INTO public.bounty_targeting_dispatches (bounty_id, source, mode)
    VALUES (b.id, v_source, v_mode) ON CONFLICT DO NOTHING RETURNING bounty_id INTO v_claim;
  IF v_claim IS NULL THEN RETURN 0; END IF;

  -- geom is the public approximate point since the location-privacy migration.
  -- Never read bounty_private_locations or emit hunter centers in payloads.
  WITH zip AS (
    SELECT p.id, 'zip'::text AS source FROM public.profiles p
    WHERE b.zip_code IS NOT NULL AND btrim(b.zip_code) <> '' AND p.zip_code = b.zip_code
      AND p.deleted_at IS NULL AND p.account_status = 'active'
      AND p.id IS DISTINCT FROM COALESCE(b.poster_id, b.user_id)
      AND (v_mode = 'consolidated' OR p_source = 'zip')
  ), radius AS (
    SELECT p.id, 'radius'::text AS source FROM public.profiles p
    WHERE b.geom IS NOT NULL AND p.geom IS NOT NULL AND ST_DWithin(p.geom, b.geom, 20 * 1609.344)
      AND p.deleted_at IS NULL AND p.account_status = 'active'
      AND p.id IS DISTINCT FROM COALESCE(b.poster_id, b.user_id)
      AND (v_mode = 'consolidated' OR (p_source = 'radius'
        AND NOT COALESCE(btrim(b.zip_code) <> '' AND p.zip_code = b.zip_code, false)))
  ), service_area AS (
    SELECT DISTINCT p.id, 'service_area'::text AS source
    FROM public.hunter_service_areas a JOIN public.profiles p ON p.id = a.hunter_id
    WHERE b.geom IS NOT NULL AND a.radius_miles IS NOT NULL
      AND ST_DWithin(b.geom, ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
        a.radius_miles * 1609.344)
      AND p.deleted_at IS NULL AND p.account_status = 'active'
      AND p.id IS DISTINCT FROM COALESCE(b.poster_id, b.user_id)
      AND (v_mode = 'consolidated' OR (p_source = 'service_area'
        AND NOT COALESCE(btrim(b.zip_code) <> '' AND p.zip_code = b.zip_code, false)))
  ), merged AS (
    SELECT id, jsonb_agg(source ORDER BY source) AS sources FROM (
      SELECT * FROM zip UNION ALL SELECT * FROM radius UNION ALL SELECT * FROM service_area
    ) geo GROUP BY id
  ), eligible AS (
    SELECT m.id, m.sources,
      CASE WHEN b.category IS NULL OR cardinality(p.skill_categories) IS NULL
        OR cardinality(p.skill_categories) = 0 THEN 0.5
        WHEN b.category = ANY(p.skill_categories) THEN 1.0 ELSE 0.0 END AS category_score,
      CASE WHEN p.last_session_at IS NULL THEN 0.3
        WHEN p.last_session_at > now() - interval '3 days' THEN 1.0
        WHEN p.last_session_at > now() - interval '14 days' THEN 0.6 ELSE 0.3 END AS activity_score,
      GREATEST(0.0, 1.0 - COALESCE(p.cancellation_count, 0) * 0.15) AS reliability_score,
      CASE WHEN b.geom IS NULL OR p.geom IS NULL THEN 0.5
        ELSE GREATEST(0.0, 1.0 - (ST_Distance(b.geom, p.geom) / 1000.0) / 25.0) END AS distance_score
    FROM merged m JOIN public.profiles p ON p.id = m.id
    WHERE p.deleted_at IS NULL AND p.account_status = 'active'
      AND p.id IS DISTINCT FROM COALESCE(b.poster_id, b.user_id)
      AND NOT EXISTS (SELECT 1 FROM public.bounty_hunter_notifications n
        WHERE n.bounty_id = b.id AND n.hunter_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.bounty_requests r
        WHERE r.bounty_id = b.id AND r.hunter_id = p.id)
      AND (SELECT count(*) FROM public.bounty_hunter_notifications n
        WHERE n.hunter_id = p.id AND n.created_at > now() - interval '1 hour') < 5
  ), scored AS (
    SELECT *, category_score * 0.35 + activity_score * 0.2
      + reliability_score * 0.15 + distance_score * 0.3 AS score FROM eligible
  ), bounded AS (
    SELECT id, sources FROM scored ORDER BY score DESC, id LIMIT 1000
  )
  SELECT array_agg(id ORDER BY id), jsonb_object_agg(id::text, sources)
    INTO v_candidates, v_matches FROM bounded;
  RETURN public.fn_score_and_dispatch_bounty_notification(b.id, v_candidates, 1::smallint,
    'New Bounty Near You', '"' || b.title || '" was just posted near you.',
    jsonb_build_object('match', v_source, 'targeting_mode', v_mode, 'geo_matches', v_matches));
END;
$$;

-- Keep every INSERT / location-added trigger and its existing WHEN clause.
CREATE OR REPLACE FUNCTION public.fn_notify_zip_matched_bounty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fn_dispatch_bounty_targeting(NEW.id, 'zip');
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_notify_radius_matched_bounty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fn_dispatch_bounty_targeting(NEW.id, 'radius');
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_notify_service_area_matched_bounty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fn_dispatch_bounty_targeting(NEW.id, 'service_area');
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_claim_bounty_targeting_delivery(
  p_outbox_id uuid, p_hunter_id uuid, p_channel text, p_claim_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.notifications_outbox
    WHERE id = p_outbox_id AND data->>'type' = 'bounty_nearby'
      AND data->>'targeting_version' = '1' FOR UPDATE;
  IF NOT FOUND OR v_status = 'sent' THEN RETURN false; END IF;
  UPDATE public.bounty_targeting_deliveries
    SET state = 'processing', claim_id = p_claim_id, attempted_at = clock_timestamp(), last_error = NULL
    WHERE outbox_id = p_outbox_id AND hunter_id = p_hunter_id AND channel = p_channel
      AND state IN ('pending', 'failed');
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.fn_ack_bounty_targeting_delivery(
  p_outbox_id uuid, p_hunter_id uuid, p_channel text, p_claim_id uuid,
  p_state text, p_error text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_state NOT IN ('accepted', 'suppressed', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'Invalid targeting delivery state';
  END IF;
  UPDATE public.bounty_targeting_deliveries SET state = p_state, last_error = left(p_error, 500)
    WHERE outbox_id = p_outbox_id AND hunter_id = p_hunter_id AND channel = p_channel
      AND state = 'processing' AND claim_id = p_claim_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_state = 'accepted' AND p_channel IN ('push', 'in_app') THEN
    UPDATE public.bounty_hunter_notifications
    SET provider_accepted_at = CASE WHEN p_channel = 'push' THEN now() ELSE provider_accepted_at END,
        in_app_created_at = CASE WHEN p_channel = 'in_app' THEN now() ELSE in_app_created_at END
    WHERE outbox_id = p_outbox_id AND hunter_id = p_hunter_id;
  END IF;
  RETURN true;
END;
$$;

-- No lease stealing: a crashed provider request has an UNKNOWN outcome. Retrying
-- it could duplicate a push. Known rejections/pre-send failures may be retried.
CREATE FUNCTION public.fn_finish_bounty_targeting_outbox(p_outbox_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_retry boolean;
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.notifications_outbox
    WHERE id = p_outbox_id AND data->>'type' = 'bounty_nearby'
      AND data->>'targeting_version' = '1' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_status = 'sent' THEN RETURN true; END IF;
  UPDATE public.bounty_targeting_deliveries SET state = 'unknown',
    last_error = 'Worker interrupted; outcome unknown, not automatically resent'
    WHERE outbox_id = p_outbox_id AND state = 'processing'
      AND attempted_at < clock_timestamp() - interval '5 minutes';
  IF EXISTS (SELECT 1 FROM public.bounty_targeting_deliveries
    WHERE outbox_id = p_outbox_id AND state = 'processing') THEN RETURN false; END IF;
  SELECT EXISTS (SELECT 1 FROM public.bounty_targeting_deliveries
    WHERE outbox_id = p_outbox_id AND state IN ('pending', 'failed')) INTO v_retry;
  UPDATE public.notifications_outbox
    SET status = CASE WHEN v_retry THEN 'failed' ELSE 'sent' END, attempts = attempts + 1,
      last_error = CASE WHEN v_retry THEN 'Targeting delivery has retryable failures' ELSE NULL END,
      delivery_errors = (SELECT jsonb_agg(jsonb_build_object(
        'user_id', hunter_id, 'channel', channel, 'state', state, 'reason', last_error))
        FROM public.bounty_targeting_deliveries
        WHERE outbox_id = p_outbox_id AND state IN ('failed', 'unknown'))
    WHERE id = p_outbox_id;
  RETURN NOT v_retry;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], smallint, text, text, jsonb),
  public.fn_dispatch_bounty_targeting(uuid, text),
  public.fn_notify_zip_matched_bounty(), public.fn_notify_radius_matched_bounty(),
  public.fn_notify_service_area_matched_bounty(),
  public.fn_claim_bounty_targeting_delivery(uuid, uuid, text, uuid),
  public.fn_ack_bounty_targeting_delivery(uuid, uuid, text, uuid, text, text),
  public.fn_finish_bounty_targeting_outbox(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], smallint, text, text, jsonb),
  public.fn_dispatch_bounty_targeting(uuid, text),
  public.fn_claim_bounty_targeting_delivery(uuid, uuid, text, uuid),
  public.fn_ack_bounty_targeting_delivery(uuid, uuid, text, uuid, text, text),
  public.fn_finish_bounty_targeting_outbox(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
