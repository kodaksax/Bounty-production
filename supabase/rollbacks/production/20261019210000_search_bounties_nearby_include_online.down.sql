-- Rollback for 20261019210000_search_bounties_nearby_include_online.sql (SBA-02).
-- Restores the 7-argument search_bounties_nearby from 20260913010000 (live
-- md5 89be049623de227f2723ec5a676535a8 on 2026-10-19). Builds that send
-- p_include_online will then fail to resolve the RPC; the client retries
-- without it (lib/services/bounty-location-service.ts), so the feed keeps
-- working, minus online jobs inside a radius.

BEGIN;

DROP FUNCTION IF EXISTS public.search_bounties_nearby(
  double precision, double precision, double precision, text, integer, integer, boolean, boolean
);

CREATE FUNCTION public.search_bounties_nearby(
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_radius_miles double precision DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_include_test boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  amount numeric,
  is_for_honor boolean,
  category text,
  status bounty_status_enum,
  neighborhood text,
  approx_latitude double precision,
  approx_longitude double precision,
  poster_id uuid,
  username text,
  avatar text,
  created_at timestamp with time zone,
  deadline timestamp with time zone,
  distance_miles double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    b.id, b.title, b.description, b.amount, b.is_for_honor, b.category, b.status,
    b.neighborhood, b.approx_latitude, b.approx_longitude, b.poster_id, b.username, b.avatar,
    b.created_at, b.deadline,
    CASE
      WHEN b.geom IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
      THEN ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) / 1609.344
      ELSE NULL
    END AS distance_miles
  FROM public.bounties b
  WHERE b.status = 'open'
    AND (p_category IS NULL OR b.category = p_category)
    AND (
      b.is_test = false
      OR (
        p_include_test
        AND EXISTS (SELECT 1 FROM public.profiles ip WHERE ip.id = auth.uid() AND ip.is_internal)
      )
    )
    AND (
      p_radius_miles IS NULL
      OR (
        b.geom IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
        AND ST_DWithin(
          b.geom,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
          p_radius_miles * 1609.344
        )
      )
    )
  ORDER BY
    (CASE
      WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND b.geom IS NOT NULL
      THEN ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography)
    END) ASC NULLS LAST,
    b.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100)
  OFFSET GREATEST(p_offset, 0);
$function$;

GRANT EXECUTE ON FUNCTION public.search_bounties_nearby(
  double precision, double precision, double precision, text, integer, integer, boolean
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
