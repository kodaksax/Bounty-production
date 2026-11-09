-- Migration: fn_poster_local_proof, the counts behind the Post tab's local proof
--
-- Returns two numbers for a point: hunters active in the last 7 days and
-- bounties completed in the last 30 days, within the feed radius. It returns
-- counts only, never a row, so the caller learns a density and nothing about
-- any person.
--
-- Privacy, enforced here rather than in the app:
--   * A count below 3 comes back NULL, so a client can't read a small number.
--   * The radius is clamped to 25-100 miles. 25 is the feed's default radius;
--     a smaller one would let a caller narrow an area down to a few people.
--   * Signed-in callers only.
--
-- Internal accounts and accounts that aren't active are never counted, and the
-- caller is never counted among the hunters.
--
-- Rollback: supabase/rollbacks/production/20261108120000_poster_local_proof.down.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_poster_local_proof(
  p_lat double precision,
  p_lng double precision,
  p_radius_miles double precision DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  -- Keep equal to LOCAL_PROOF_MIN in lib/services/bounty-location-service.ts.
  v_min_count CONSTANT integer := 3;
  v_point     geography;
  v_meters    double precision;
  v_hunters   integer;
  v_completed integer;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('hunters_active_7d', NULL, 'bounties_completed_30d', NULL);
  END IF;

  v_point  := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_meters := GREATEST(25.0, LEAST(100.0, COALESCE(p_radius_miles, 25.0))) * 1609.344;

  SELECT count(*)::integer INTO v_hunters
  FROM public.profiles p
  WHERE p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND p.last_session_at > now() - interval '7 days'
    AND p.primary_role IN ('hunter', 'both')
    AND p.account_status = 'active'
    AND p.is_internal IS NOT TRUE
    AND p.id IS DISTINCT FROM auth.uid()
    AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
          v_point,
          v_meters
        );

  SELECT count(*)::integer INTO v_completed
  FROM public.bounties b
  WHERE b.status = 'completed'
    AND b.is_test IS NOT TRUE
    AND b.geom IS NOT NULL
    AND COALESCE(b.completed_at, b.updated_at::timestamptz) > now() - interval '30 days'
    AND ST_DWithin(b.geom, v_point, v_meters)
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles ip
      WHERE ip.id IN (b.poster_id, b.user_id, b.accepted_by)
        AND ip.is_internal IS TRUE
    );

  RETURN jsonb_build_object(
    'hunters_active_7d',      CASE WHEN v_hunters   >= v_min_count THEN v_hunters   END,
    'bounties_completed_30d', CASE WHEN v_completed >= v_min_count THEN v_completed END
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_poster_local_proof(double precision, double precision, double precision) IS
  'Counts of active hunters (7d) and completed bounties (30d) near a point. Counts below 3 return NULL; radius clamped to 25-100 miles; excludes internal and non-active accounts.';

-- Supabase default privileges also grant EXECUTE to anon, so it needs its own REVOKE.
REVOKE ALL ON FUNCTION public.fn_poster_local_proof(double precision, double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_poster_local_proof(double precision, double precision, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_poster_local_proof(double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_poster_local_proof(double precision, double precision, double precision) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
