-- Rollback for supabase/migrations/20261001160000_bounty_location_privacy.sql
-- (same script for staging and production: it restores the definitions the
-- forward migration captured from THAT database in location_privacy_rollback_defs).
--
-- WARNING: this re-exposes exact addresses and coordinates on public.bounties
-- (the pre-fix state). Use only if the forward migration breaks the app and a
-- forward fix is not possible.
--
-- Non-destructive: bounty_private_locations, bounty_location_backfill_snapshot,
-- bounty_location_access_log and location_privacy_rollback_defs are KEPT.
-- Drop them by hand only after deciding the fix is abandoned.
--
-- Restores, for every bounty with a private row:
--   location  <- private.address (current value, so post-migration edits survive)
--   latitude/longitude/unit <- private values
--   geom      <- exact point (what the old trigger wrote)
--   neighborhood <- pre-migration value when the sanitizer had nulled it

BEGIN;

DO $$
DECLARE
  v_trig      record;
  v_disabled  jsonb := '[]'::jsonb;
  v_replident "char";
  v_def       text;
  v_rows      integer;
BEGIN
  IF to_regclass('public.location_privacy_rollback_defs') IS NULL
     OR to_regclass('public.bounty_private_locations') IS NULL THEN
    RAISE EXCEPTION 'rollback: forward migration 20261001160000 was never applied here';
  END IF;

  -- 1. Stop privatizing new writes.
  DROP TRIGGER IF EXISTS zz_bounties_privatize_location ON public.bounties;
  DROP TRIGGER IF EXISTS zz_bounties_store_private_location ON public.bounties;

  -- 2. Put exact values back, with user triggers paused (no notifications,
  --    no updated_at churn, no broadcast of the restored rows).
  FOR v_trig IN
    SELECT t.tgname, t.tgenabled FROM pg_trigger t
    WHERE t.tgrelid = 'public.bounties'::regclass AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  LOOP
    EXECUTE format('ALTER TABLE public.bounties DISABLE TRIGGER %I', v_trig.tgname);
    v_disabled := v_disabled || jsonb_build_object('name', v_trig.tgname, 'mode', v_trig.tgenabled::text);
  END LOOP;

  SELECT c.relreplident INTO v_replident FROM pg_class c WHERE c.oid = 'public.bounties'::regclass;
  IF v_replident = 'f' THEN
    ALTER TABLE public.bounties REPLICA IDENTITY DEFAULT;
  END IF;

  UPDATE public.bounties b
  SET location     = COALESCE(p.address, b.location),
      latitude     = p.latitude,
      longitude    = p.longitude,
      unit         = p.unit,
      geom         = CASE WHEN p.latitude IS NOT NULL
                          THEN ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography
                          ELSE b.geom END,
      neighborhood = COALESCE(b.neighborhood, s.neighborhood)
  FROM public.bounty_private_locations p
  LEFT JOIN public.bounty_location_backfill_snapshot s ON s.bounty_id = p.bounty_id
  WHERE p.bounty_id = b.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'rollback: restored exact location on % bounties', v_rows;

  IF v_replident = 'f' THEN
    ALTER TABLE public.bounties REPLICA IDENTITY FULL;
  END IF;

  FOR v_trig IN
    SELECT d ->> 'name' AS tgname, d ->> 'mode' AS mode FROM jsonb_array_elements(v_disabled) d
  LOOP
    EXECUTE format('ALTER TABLE public.bounties ENABLE %s TRIGGER %I',
                   CASE v_trig.mode WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END,
                   v_trig.tgname);
  END LOOP;

  -- 3. Restore the live definitions captured before the forward migration.
  SELECT definition INTO v_def FROM public.location_privacy_rollback_defs
  WHERE object_name = 'get_bounty_exact_location(uuid)';
  IF v_def IS NOT NULL THEN
    EXECUTE v_def;
    REVOKE ALL ON FUNCTION public.get_bounty_exact_location(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_bounty_exact_location(uuid) TO authenticated, service_role;
  END IF;

  SELECT definition INTO v_def FROM public.location_privacy_rollback_defs
  WHERE object_name = 'fn_compute_bounty_quality_score(uuid)';
  IF v_def IS NOT NULL THEN
    EXECUTE v_def;
  END IF;

  SELECT definition INTO v_def FROM public.location_privacy_rollback_defs
  WHERE object_name = 'bounties_compute_approx_location()';
  IF v_def IS NOT NULL THEN
    EXECUTE v_def;
  END IF;

  SELECT definition INTO v_def FROM public.location_privacy_rollback_defs
  WHERE object_name = 'trg_bounties_compute_approx_location';
  IF v_def IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_bounties_compute_approx_location ON public.bounties;
    EXECUTE v_def;
  END IF;

  -- 4. Functions the forward migration added.
  DROP FUNCTION IF EXISTS public.fn_bounties_privatize_location();
  DROP FUNCTION IF EXISTS public.fn_bounties_store_private_location();
  DROP FUNCTION IF EXISTS public.fn_backfill_bounty_location_privacy(boolean);
  DROP FUNCTION IF EXISTS public.fn_public_neighborhood(text);
  DROP FUNCTION IF EXISTS public.fn_public_location_label(text);
  DROP FUNCTION IF EXISTS public.fn_location_component_is_public(text);
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
