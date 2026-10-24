-- Rollback for 20261023120000_nearby_zip_targeting.sql
--
-- Restores fn_dispatch_bounty_targeting exactly as 20261014230000 defined it
-- (verified identical to prod on 2026-10-23), drops the ZIP check trigger and
-- the centroid table. Bounty ZIPs the trigger cleared stay cleared: each one
-- was more than 25 mi from the bounty's own coordinates, and its RAISE LOG
-- line in the Postgres logs names the bounty and the old ZIP.

BEGIN;

DROP TRIGGER IF EXISTS trg_bounties_check_zip_matches_point ON public.bounties;
DROP FUNCTION IF EXISTS public.fn_bounties_check_zip_matches_point();

CREATE OR REPLACE FUNCTION public.fn_dispatch_bounty_targeting(p_bounty_id uuid, p_source text)
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

REVOKE ALL ON FUNCTION public.fn_dispatch_bounty_targeting(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dispatch_bounty_targeting(uuid, text) TO service_role;

DROP TABLE IF EXISTS public.zip_centroids;

NOTIFY pgrst, 'reload schema';

COMMIT;
