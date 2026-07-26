-- Migration: Location redesign (2/6) — approx-location trigger + geom sync
-- Created: 2026-07-25
--
-- Computes bounties.approx_latitude/approx_longitude as a random 120-350m
-- offset from the exact point, ONE TIME when latitude/longitude are first
-- set (or genuinely changed), never on every read. Recomputing the jitter
-- on every SELECT would let anyone browsing the feed average repeated
-- samples back toward the real coordinates -- storing it once and reusing
-- it is what makes the "approximate pin" privacy-safe.
--
-- Also backfills the existing (currently unused) geography(Point,4326)
-- `geom` column + its GiST index (idx_bounties_geom_gist, added by
-- 20260320_add_geom_and_index.sql but never wired to any write path) so
-- search_bounties_nearby() (next migration) can do an index-backed
-- ST_DWithin radius search instead of a full-table Haversine scan.

CREATE OR REPLACE FUNCTION public.bounties_compute_approx_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_angle    double precision;
  v_radius_m double precision;
  v_dlat     double precision;
  v_dlng     double precision;
BEGIN
  IF NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
    NEW.approx_latitude  := NULL;
    NEW.approx_longitude := NULL;
    NEW.geom             := NULL;
    RETURN NEW;
  END IF;

  -- Exact point unchanged (trigger fired because latitude/longitude were in
  -- the UPDATE's column list, e.g. an unrelated bulk update, but the values
  -- are the same) -- keep the existing stable jitter, just resync geom.
  IF TG_OP = 'UPDATE'
     AND NEW.latitude = OLD.latitude
     AND NEW.longitude = OLD.longitude
     AND NEW.approx_latitude IS NOT NULL
     AND NEW.approx_longitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    RETURN NEW;
  END IF;

  v_angle    := random() * 2 * pi();
  v_radius_m := 120 + random() * 230; -- uniform 120-350m

  v_dlat := (v_radius_m * cos(v_angle)) / 111320.0;
  v_dlng := (v_radius_m * sin(v_angle)) / (111320.0 * cos(radians(NEW.latitude)));

  NEW.approx_latitude  := NEW.latitude + v_dlat;
  NEW.approx_longitude := NEW.longitude + v_dlng;
  NEW.geom             := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounties_compute_approx_location ON public.bounties;
CREATE TRIGGER trg_bounties_compute_approx_location
  BEFORE INSERT OR UPDATE OF latitude, longitude ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.bounties_compute_approx_location();

COMMENT ON FUNCTION public.bounties_compute_approx_location() IS
  'Computes a stable, one-time-randomized approx_latitude/approx_longitude jitter (120-350m) and syncs geom from latitude/longitude. Runs BEFORE INSERT OR UPDATE OF latitude, longitude on public.bounties.';
