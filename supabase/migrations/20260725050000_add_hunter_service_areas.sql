-- Migration: Location redesign (5/6) — hunter_service_areas table
-- Created: 2026-07-25
--
-- Backs "set work radius" + "multiple service areas" for hunters. Each row
-- is a named point + radius (e.g. "Home" 10mi, "Downtown gigs" 5mi). Exactly
-- one row per hunter may have is_primary = true (enforced by the partial
-- unique index below) -- that's the default center/radius used for the
-- feed's distance filter when the hunter hasn't picked a specific area.
--
-- Self-only data (never exposed to other users), so this is a plain
-- auth.uid()-scoped RLS table -- same shape as bounty_requests
-- (20251119_add_bounty_requests_table.sql) -- no column-privilege
-- complexity needed like the bounties exact-location columns.
--
-- NOT reusing the existing (untracked, unused-by-app-code) profiles.latitude
-- /longitude columns for the primary area -- their original intended
-- consumer couldn't be established, so this feature owns its data instead
-- of building on an unexplained column.

CREATE TABLE IF NOT EXISTS public.hunter_service_areas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hunter_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label        text NOT NULL DEFAULT 'Primary',
  latitude     double precision NOT NULL,
  longitude    double precision NOT NULL,
  radius_miles double precision, -- NULL = "Anywhere"
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hunter_service_areas_hunter_id
  ON public.hunter_service_areas(hunter_id);

-- At most one primary area per hunter.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hunter_service_areas_one_primary
  ON public.hunter_service_areas(hunter_id) WHERE is_primary;

DROP TRIGGER IF EXISTS trg_hunter_service_areas_updated_at ON public.hunter_service_areas;
CREATE TRIGGER trg_hunter_service_areas_updated_at
  BEFORE UPDATE ON public.hunter_service_areas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.hunter_service_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY hunter_service_areas_select_own
  ON public.hunter_service_areas FOR SELECT
  USING (auth.uid() = hunter_id);

CREATE POLICY hunter_service_areas_insert_own
  ON public.hunter_service_areas FOR INSERT
  WITH CHECK (auth.uid() = hunter_id);

CREATE POLICY hunter_service_areas_update_own
  ON public.hunter_service_areas FOR UPDATE
  USING (auth.uid() = hunter_id)
  WITH CHECK (auth.uid() = hunter_id);

CREATE POLICY hunter_service_areas_delete_own
  ON public.hunter_service_areas FOR DELETE
  USING (auth.uid() = hunter_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hunter_service_areas TO authenticated;

COMMENT ON TABLE public.hunter_service_areas IS
  'A hunter''s work-radius preferences: named point + radius_miles (NULL = Anywhere). Self-only via RLS. Exactly one row per hunter may have is_primary = true.';

NOTIFY pgrst, 'reload schema';
