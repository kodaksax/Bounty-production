-- Migration: add bounty latitude/longitude + derive geom server-side
-- Created: 2026-07-23
--
-- Step 1 of the "notify users within a radius of a new bounty" feature.
--
-- Until now the CreateBounty flow fetched a selected address's coordinates from
-- Google Places (getPlaceDetails returns latitude/longitude) but discarded them
-- -- only the formatted-address `text` was persisted. The `bounties.geom`
-- (geography(Point,4326)) column already existed but was never populated
-- (0 of 87 rows), so no proximity query was possible.
--
-- This migration:
--   1. Adds plain numeric `latitude`/`longitude` columns so the client can send
--      two ordinary numbers through the existing insert path (no PostGIS
--      literals on the client).
--   2. Adds a BEFORE INSERT/UPDATE trigger that derives `geom` from those
--      columns server-side. Keeping this in one place means every write path
--      (direct insert, offline-queue replay, admin edits) gets a correct geom
--      without duplicating the ST_MakePoint call, and the geom can never drift
--      out of sync with lat/lng.
--   3. Adds a GiST index on `geom` for the radius query that Step 3 will add.
--
-- No backfill: existing rows have no coordinates to derive geom from.

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

COMMENT ON COLUMN public.bounties.latitude IS
  'Poster-selected address latitude (from Google Places). Source of truth for geom; keep in [-90, 90].';
COMMENT ON COLUMN public.bounties.longitude IS
  'Poster-selected address longitude (from Google Places). Source of truth for geom; keep in [-180, 180].';

CREATE OR REPLACE FUNCTION public.fn_bounties_sync_geom()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Derive geom from lat/lng when both are present and in valid range;
  -- otherwise leave geom NULL (a bounty with no/invalid coordinates simply
  -- won't participate in proximity matching).
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

COMMENT ON FUNCTION public.fn_bounties_sync_geom IS
  'BEFORE INSERT/UPDATE trigger on public.bounties. Keeps geom (geography Point 4326) derived from the latitude/longitude columns so proximity queries have a single source of truth.';

DROP TRIGGER IF EXISTS trg_bounties_sync_geom ON public.bounties;
CREATE TRIGGER trg_bounties_sync_geom
  BEFORE INSERT OR UPDATE OF latitude, longitude
  ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounties_sync_geom();

CREATE INDEX IF NOT EXISTS idx_bounties_geom
  ON public.bounties
  USING gist (geom);

-- Reload PostgREST schema cache so the new columns are exposed immediately.
NOTIFY pgrst, 'reload schema';
