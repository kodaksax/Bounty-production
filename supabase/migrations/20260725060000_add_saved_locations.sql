-- Migration: Location redesign (6/6) — saved_locations table
-- Created: 2026-07-25
--
-- Replaces the AsyncStorage-only "address library"
-- (lib/services/address-library-service.ts, key
-- @bountyexpo:address_library) with a synced, durable equivalent so
-- favorite locations survive reinstalls and sync across devices. Self-only
-- via RLS, same shape as hunter_service_areas.

CREATE TABLE IF NOT EXISTS public.saved_locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label      text NOT NULL,
  address    text NOT NULL,
  unit       text,
  latitude   double precision,
  longitude  double precision,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_locations_user_id
  ON public.saved_locations(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_locations_one_default
  ON public.saved_locations(user_id) WHERE is_default;

DROP TRIGGER IF EXISTS trg_saved_locations_updated_at ON public.saved_locations;
CREATE TRIGGER trg_saved_locations_updated_at
  BEFORE UPDATE ON public.saved_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.saved_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_locations_select_own
  ON public.saved_locations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY saved_locations_insert_own
  ON public.saved_locations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY saved_locations_update_own
  ON public.saved_locations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY saved_locations_delete_own
  ON public.saved_locations FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_locations TO authenticated;

COMMENT ON TABLE public.saved_locations IS
  'A user''s favorite/saved locations (e.g. "Home", "Office"), synced server-side. Self-only via RLS. Replaces the old AsyncStorage-only address library.';

NOTIFY pgrst, 'reload schema';
