-- "New Bounty Near You" reaches nearby ZIPs, not just the exact one, and a
-- bounty's ZIP has to describe the bounty's own address.
--
-- 1. ZIP-only hunters only ever matched an exact ZIP. The 20 mi radius match
--    in fn_dispatch_bounty_targeting needs profiles.geom, and 73 of 1013
--    active profiles on prod (2026-10-23) have a zip_code but no coordinates:
--    a bounty one ZIP over never reached them. Same for a bounty that has a
--    ZIP and no geom yet (web posts before geocode-bounties picks them up):
--    radius and service-area matching returned 0.
--    Fix: public.zip_centroids (Census 2023 ZCTA internal points, loaded by
--    scripts/load-zip-centroids.js). A missing hunter or bounty point falls
--    back to its ZIP's centroid. Real coordinates always win; the centroid is
--    only a stand-in for "somewhere in that ZIP", well inside the 20 mi
--    radius tolerance.
--
-- 2. deriveBountyZipCode (app/services/bountyService.ts) fell back to the
--    POSTER's profile ZIP when the address text had none. A job in Austin
--    posted by someone whose profile says Dallas got zip_code 75062, so the
--    exact-ZIP push went to Dallas. The client no longer does that; installed
--    builds still will. trg_bounties_check_zip_matches_point clears a bounty
--    ZIP whose centroid is far from the bounty's own coordinates (more than
--    25 mi, or 3x the ZCTA's radius for large rural ZCTAs). It only ever
--    clears, never guesses a replacement, and leaves the ZIP alone when it
--    can't judge (no coordinates, ZIP not in the table, table not loaded).
--
-- Rollout is unchanged: bounty_targeting_config.consolidated_enabled is not
-- touched, and both modes keep the same gate, scorer, cap and dedup ledger.
-- Until zip_centroids is loaded every lookup misses and behaviour is exactly
-- as before.
--
-- Rollback: supabase/rollbacks/production/20261023120000_nearby_zip_targeting.down.sql

BEGIN;

SET LOCAL search_path = public, extensions;

-- ─── 1. ZIP centroids ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zip_centroids (
  zip        text PRIMARY KEY CHECK (zip ~ '^\d{5}$'),
  latitude   double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude  double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- Radius of a circle with the ZCTA's total area: a scale for "how far from
  -- the centroid can a real address in this ZIP be".
  radius_mi  double precision NOT NULL CHECK (radius_mi >= 0),
  geom       geography(Point, 4326) GENERATED ALWAYS AS
    (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED
);

COMMENT ON TABLE public.zip_centroids IS
  'US Census 2023 ZCTA internal points. Stand-in location for a hunter or bounty that has a ZIP but no coordinates in "near you" targeting. Loaded by scripts/load-zip-centroids.js.';

CREATE INDEX IF NOT EXISTS zip_centroids_geom_idx ON public.zip_centroids USING gist (geom);

ALTER TABLE public.zip_centroids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zip_centroids FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zip_centroids TO service_role;

-- ─── 2. Dispatcher: fall back to the ZIP centroid ──────────────────────────
-- Same as 20261014230000 except:
--   * v_point = b.geom, else the centroid of b.zip_code
--   * hunters: profiles.geom, else the centroid of profiles.zip_code
--   * in legacy mode the 'zip' source also runs the radius match when the
--     bounty has no geom. Otherwise a ZIP added to a bounty without
--     coordinates (the location-added UPDATE path, where only the zip trigger
--     fires) would still reach the exact ZIP only. The ledger dedups against
--     anything the 'radius' source already sent.
CREATE OR REPLACE FUNCTION public.fn_dispatch_bounty_targeting(p_bounty_id uuid, p_source text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  b record;
  v_point geography;
  v_mode text;
  v_source text;
  v_claim uuid;
  v_candidates uuid[];
  v_matches jsonb;
BEGIN
  IF p_source NOT IN ('zip', 'radius', 'service_area') THEN RETURN 0; END IF;
  SELECT * INTO b FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND OR COALESCE(b.is_test, false) OR b.status <> 'open' THEN RETURN 0; END IF;
  v_point := COALESCE(b.geom,
    (SELECT z.geom FROM public.zip_centroids z WHERE z.zip = btrim(b.zip_code)));
  IF v_point IS NULL AND COALESCE(btrim(b.zip_code), '') = '' THEN RETURN 0; END IF;
  IF p_source = 'zip' AND COALESCE(btrim(b.zip_code), '') = '' THEN RETURN 0; END IF;
  IF p_source IN ('radius', 'service_area') AND v_point IS NULL THEN RETURN 0; END IF;
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
  WITH hunters AS (
    SELECT p.id, p.zip_code, p.skill_categories, p.last_session_at, p.cancellation_count,
      COALESCE(p.geom, z.geom) AS point
    FROM public.profiles p
    LEFT JOIN public.zip_centroids z ON p.geom IS NULL AND z.zip = btrim(p.zip_code)
    WHERE p.deleted_at IS NULL AND p.account_status = 'active'
      AND p.id IS DISTINCT FROM COALESCE(b.poster_id, b.user_id)
  ), zip AS (
    SELECT h.id, 'zip'::text AS source FROM hunters h
    WHERE b.zip_code IS NOT NULL AND btrim(b.zip_code) <> '' AND h.zip_code = b.zip_code
      AND (v_mode = 'consolidated' OR p_source = 'zip')
  ), radius AS (
    SELECT h.id, 'radius'::text AS source FROM hunters h
    WHERE v_point IS NOT NULL AND h.point IS NOT NULL AND ST_DWithin(h.point, v_point, 20 * 1609.344)
      AND (v_mode = 'consolidated'
        OR (p_source = 'radius'
          AND NOT COALESCE(btrim(b.zip_code) <> '' AND h.zip_code = b.zip_code, false))
        OR (p_source = 'zip' AND b.geom IS NULL
          AND NOT COALESCE(btrim(b.zip_code) <> '' AND h.zip_code = b.zip_code, false)))
  ), service_area AS (
    SELECT DISTINCT h.id, 'service_area'::text AS source
    FROM public.hunter_service_areas a JOIN hunters h ON h.id = a.hunter_id
    WHERE v_point IS NOT NULL AND a.radius_miles IS NOT NULL
      AND ST_DWithin(v_point, ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
        a.radius_miles * 1609.344)
      AND (v_mode = 'consolidated' OR (p_source = 'service_area'
        AND NOT COALESCE(btrim(b.zip_code) <> '' AND h.zip_code = b.zip_code, false)))
  ), merged AS (
    SELECT id, jsonb_agg(source ORDER BY source) AS sources FROM (
      SELECT * FROM zip UNION ALL SELECT * FROM radius UNION ALL SELECT * FROM service_area
    ) geo GROUP BY id
  ), eligible AS (
    SELECT m.id, m.sources,
      CASE WHEN b.category IS NULL OR cardinality(h.skill_categories) IS NULL
        OR cardinality(h.skill_categories) = 0 THEN 0.5
        WHEN b.category = ANY(h.skill_categories) THEN 1.0 ELSE 0.0 END AS category_score,
      CASE WHEN h.last_session_at IS NULL THEN 0.3
        WHEN h.last_session_at > now() - interval '3 days' THEN 1.0
        WHEN h.last_session_at > now() - interval '14 days' THEN 0.6 ELSE 0.3 END AS activity_score,
      GREATEST(0.0, 1.0 - COALESCE(h.cancellation_count, 0) * 0.15) AS reliability_score,
      CASE WHEN v_point IS NULL OR h.point IS NULL THEN 0.5
        ELSE GREATEST(0.0, 1.0 - (ST_Distance(v_point, h.point) / 1000.0) / 25.0) END AS distance_score
    FROM merged m JOIN hunters h ON h.id = m.id
    WHERE NOT EXISTS (SELECT 1 FROM public.bounty_hunter_notifications n
        WHERE n.bounty_id = b.id AND n.hunter_id = h.id)
      AND NOT EXISTS (SELECT 1 FROM public.bounty_requests r
        WHERE r.bounty_id = b.id AND r.hunter_id = h.id)
      AND (SELECT count(*) FROM public.bounty_hunter_notifications n
        WHERE n.hunter_id = h.id AND n.created_at > now() - interval '1 hour') < 5
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

-- ─── 3. A bounty's ZIP must match its own address ──────────────────────────
-- BEFORE triggers run in name order: "check" sorts before
-- trg_bounties_claim_nearby_notification, so the claim and every AFTER
-- dispatcher see the cleaned ZIP; and before trg_bounties_sync_geom and
-- zz_bounties_privatize_location, so NEW.latitude/longitude are still what
-- the client sent. NEW.geom covers an UPDATE that only touches zip_code
-- (latitude/longitude are already privatized to NULL on the stored row).
CREATE OR REPLACE FUNCTION public.fn_bounties_check_zip_matches_point()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_zip text := NULLIF(btrim(NEW.zip_code), '');
  v_point geography;
  v_centroid geography;
  v_radius_mi double precision;
BEGIN
  IF v_zip IS NULL THEN RETURN NEW; END IF;

  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    v_point := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  ELSE
    v_point := NEW.geom;
  END IF;
  IF v_point IS NULL THEN RETURN NEW; END IF;

  SELECT geom, radius_mi INTO v_centroid, v_radius_mi
    FROM public.zip_centroids WHERE zip = v_zip;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF ST_Distance(v_point, v_centroid) > GREATEST(25, 3 * v_radius_mi) * 1609.344 THEN
    RAISE LOG 'bounty %: zip_code % is % mi from its coordinates; cleared',
      NEW.id, v_zip, round((ST_Distance(v_point, v_centroid) / 1609.344)::numeric, 1);
    NEW.zip_code := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bounties_check_zip_matches_point() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bounties_check_zip_matches_point ON public.bounties;
CREATE TRIGGER trg_bounties_check_zip_matches_point
  BEFORE INSERT OR UPDATE OF zip_code, latitude, longitude ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.fn_bounties_check_zip_matches_point();

NOTIFY pgrst, 'reload schema';

COMMIT;
