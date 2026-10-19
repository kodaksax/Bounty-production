-- Migration: search_bounties_nearby can keep online jobs in a radius search (SBA-02, client side)
-- Created: 2026-10-19
--
-- PROBLEM (docs/audits/shoal-behavioral-audit.md, SBA-02):
--   The hunter feed is moving to "within 25 miles" by default for hunters
--   with a location, so in-person work is local. A radius search today keeps
--   only rows with a map point (b.geom), and online jobs never have one, so
--   the same default would hide every online job. They can be done from
--   anywhere and must stay in the feed.
--
--   The RPC also returns no work_type, so the feed cannot tell an online row
--   from an in-person row it has no distance for.
--
-- WHAT THIS DOES
--   1. Adds p_include_online (default false). When true, a radius search also
--      returns open online bounties. They have no distance, so they sort
--      after every in-person row, newest first (the existing ORDER BY).
--      p_include_online = false keeps today's result set exactly, so
--      installed builds (which never send it) see no change.
--   2. Returns work_type as an extra trailing column. Installed builds map
--      the columns they know and ignore the new one.
--   3. Grants: unchanged for anon/authenticated; EXECUTE revoked from PUBLIC
--      (it was inherited from the default grant) — SECURITY DEFINER rule.
--
--   The return type changes, so the function is dropped and recreated in one
--   transaction. PostgREST resolves RPC calls by argument name; the old
--   7-argument calls still match the new function because p_include_online
--   has a default.
--
-- Body otherwise identical to 20260913010000 (prod and staging md5
-- 89be049623de227f2723ec5a676535a8 on 2026-10-19).
--
-- Rollback: supabase/rollbacks/production/20261019210000_search_bounties_nearby_include_online.down.sql

BEGIN;

DROP FUNCTION IF EXISTS public.search_bounties_nearby(
  double precision, double precision, double precision, text, integer, integer, boolean
);

CREATE FUNCTION public.search_bounties_nearby(
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_radius_miles double precision DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_include_test boolean DEFAULT false,
  p_include_online boolean DEFAULT false
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
  distance_miles double precision,
  work_type text
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
    END AS distance_miles,
    b.work_type::text
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
      -- SBA-02: a radius limits in-person work only.
      OR (p_include_online AND b.work_type = 'online')
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

REVOKE ALL ON FUNCTION public.search_bounties_nearby(
  double precision, double precision, double precision, text, integer, integer, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_bounties_nearby(
  double precision, double precision, double precision, text, integer, integer, boolean, boolean
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_bounties_nearby(
  double precision, double precision, double precision, text, integer, integer, boolean, boolean
) IS
  'Open bounties near a point, nearest first. p_radius_miles NULL = no radius. p_include_online keeps online jobs (which have no point) in a radius search, after the in-person rows (SBA-02).';

NOTIFY pgrst, 'reload schema';

COMMIT;
