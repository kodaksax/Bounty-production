-- Migration: Location redesign (4/6) — search_bounties_nearby() RPC
-- Created: 2026-07-25
--
-- Powers the hunter feed's radius filter (1/5/10/25 mi/Anywhere) and
-- distance sort. SECURITY DEFINER because it filters on `geom` (which
-- stores the EXACT point, synced from latitude/longitude by
-- bounties_compute_approx_location() -- see prior migration) via an
-- index-backed ST_DWithin (idx_bounties_geom_gist), but the calling
-- `authenticated` role must never be able to read `geom`/latitude/longitude
-- directly -- that's the whole point of doing the radius match server-side
-- instead of shipping every bounty's exact coordinates to the client for a
-- local Haversine filter (the dead-end approach the old client-side
-- calculateDistance() in components/bounty-feed.tsx was stuck with, since
-- it never had real coordinates to work with).
--
-- Returns ONLY the safe/coarse columns -- id, neighborhood,
-- approx_latitude/approx_longitude, and the non-location bounty fields --
-- plus a computed distance_miles. It never returns location, latitude,
-- longitude, unit, or geom. Callers that need the exact address (poster's
-- own bounty, or the accepted hunter) call get_bounty_exact_location()
-- separately.
--
-- p_radius_miles = NULL means "Anywhere": no distance constraint, distance
-- is still computed/returned for display when a location is supplied but
-- results aren't filtered or required to have coordinates.

CREATE OR REPLACE FUNCTION public.search_bounties_nearby(
  p_lat          double precision DEFAULT NULL,
  p_lng          double precision DEFAULT NULL,
  p_radius_miles double precision DEFAULT NULL,
  p_category     text DEFAULT NULL,
  p_limit        integer DEFAULT 50,
  p_offset       integer DEFAULT 0
)
RETURNS TABLE(
  id               uuid,
  title            text,
  description      text,
  amount           numeric,
  is_for_honor     boolean,
  category         text,
  status           bounty_status_enum,
  neighborhood     text,
  approx_latitude  double precision,
  approx_longitude double precision,
  poster_id        uuid,
  username         text,
  avatar           text,
  created_at       timestamptz,
  deadline         timestamptz,
  distance_miles   double precision
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
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
$$;

COMMENT ON FUNCTION public.search_bounties_nearby(double precision, double precision, double precision, text, integer, integer) IS
  'Hunter feed radius search/sort. Returns only coarse/safe bounty columns plus computed distance_miles -- never location, latitude, longitude, unit, or geom. p_radius_miles = NULL means no distance constraint ("Anywhere").';

REVOKE EXECUTE ON FUNCTION public.search_bounties_nearby(double precision, double precision, double precision, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_bounties_nearby(double precision, double precision, double precision, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_bounties_nearby(double precision, double precision, double precision, text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
