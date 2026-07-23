-- Migration: add profile latitude/longitude + derive geom server-side
-- Created: 2026-07-23
--
-- Step 2 of the "notify users within a radius of a new bounty" feature
-- (Step 1 added the same lat/lng + geom pattern to public.bounties).
--
-- Gives each profile a coordinate to measure bounty distance against. Per the
-- product decision, this coordinate is the CENTROID of the user's ZIP code
-- (locationService.geocodeAddress(zip) returns a representative point for the
-- ZIP), NOT their precise device/home location. That keeps a genuinely private
-- datum out of the database while still supporting a ~20-mile radius match.
--
-- PRIVACY / RLS NOTE: these columns must never be exposed cross-user. The base
-- `profiles` table already has self-only SELECT RLS (auth.uid() = id), and the
-- curated `public_profiles` view does NOT include them -- do not add them. The
-- Step 3 radius match runs in a SECURITY DEFINER trigger, so it reads these
-- server-side without ever exposing one user's coordinates to another.
--
-- This migration:
--   1. Adds numeric latitude/longitude columns (the ZIP centroid).
--   2. Adds a BEFORE INSERT/UPDATE trigger deriving geom from them, so geom is
--      a single source of truth and can't drift from lat/lng.
--   3. Adds a GiST index on geom for the Step 3 radius query.
--
-- No backfill: existing profiles have no stored coordinate. They gain one the
-- next time their ZIP is set/confirmed (onboarding or profile edit).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);

COMMENT ON COLUMN public.profiles.latitude IS
  'Latitude of the centroid of the user''s zip_code (NOT precise device/home location). Source of truth for geom. PRIVATE: self-only RLS; never expose via public_profiles.';
COMMENT ON COLUMN public.profiles.longitude IS
  'Longitude of the centroid of the user''s zip_code (NOT precise device/home location). Source of truth for geom. PRIVATE: self-only RLS; never expose via public_profiles.';
COMMENT ON COLUMN public.profiles.geom IS
  'geography(Point,4326) derived from latitude/longitude (ZIP centroid) by fn_profiles_sync_geom. Used only by server-side proximity matching; never exposed cross-user.';

CREATE OR REPLACE FUNCTION public.fn_profiles_sync_geom()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.latitude IS NOT NULL
     AND NEW.longitude IS NOT NULL
     AND NEW.latitude BETWEEN -90 AND 90
     AND NEW.longitude BETWEEN -180 AND 180
  THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  ELSE
    NEW.geom := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_profiles_sync_geom IS
  'BEFORE INSERT/UPDATE trigger on public.profiles. Keeps geom (geography Point 4326) derived from the latitude/longitude (ZIP centroid) columns so proximity queries have a single source of truth.';

DROP TRIGGER IF EXISTS trg_profiles_sync_geom ON public.profiles;
CREATE TRIGGER trg_profiles_sync_geom
  BEFORE INSERT OR UPDATE OF latitude, longitude
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_profiles_sync_geom();

CREATE INDEX IF NOT EXISTS idx_profiles_geom
  ON public.profiles
  USING gist (geom);

-- Reload PostgREST schema cache so the new columns are exposed immediately.
NOTIFY pgrst, 'reload schema';
