-- 2026-03-20 01: Add geography column and GiST index for geospatial queries
-- NOTE: For large tables, create the index CONCURRENTLY in production to avoid locks.

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS geom geography(Point,4326);

-- Example backfill (uncomment and adapt if you have lat/lon in `location`):
-- UPDATE public.bounties
-- SET geom = ST_SetSRID(ST_MakePoint((jsonb_extract_path_text(location_json,'lng'))::double precision, (jsonb_extract_path_text(location_json,'lat'))::double precision),4326)::geography
-- WHERE geom IS NULL AND location_json IS NOT NULL;

-- Create GIST index. For production run with CONCURRENTLY to avoid table locks:
CREATE INDEX IF NOT EXISTS idx_bounties_geom_gist ON public.bounties USING GIST (geom);
