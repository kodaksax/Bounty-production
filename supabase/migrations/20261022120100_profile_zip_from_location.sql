-- profiles.zip_code comes from the location the device reverse-geocoded.
--
-- 0 of the 69 profiles created 2026-10-12..10-22 have zip_code (27% did in
-- late August). Cause: the 2026-09-23 onboarding rewrite (aa0d91d3) deleted
-- app/onboarding/details.tsx, the only onboarding screen that wrote zip_code
-- (`updateAuthProfile({ zip_code: zip })` after a typed ZIP). Its replacement,
-- app/onboarding/location.tsx, asks for GPS instead of a ZIP and stores only
-- the reverse-geocoded label, "street, city, region, postalCode", in
-- profiles.location. The redesign was deliberate; losing zip_code was a side
-- effect: location.tsx's header still points at the deleted ZIP fallback.
-- The capture rolled out with the build, so zip_code fell to 0 by 10-12.
--
-- What reads profiles.zip_code: fn_notify_zip_matched_bounty (the "posted in
-- your ZIP" push), the service-area de-duplication beside it, and
-- deriveBountyZipCode (app/services/bountyService.ts), which falls back to the
-- poster's profile ZIP for in-person bounties.
--
-- The label already carries the ZIP: 41 of the 45 new profiles with
-- coordinates end in one (e.g. "Native Oak Dr, Chico, CA, 95928"). This
-- migration takes it from there, the way 20260913200958 did for bounties:
--   * BEFORE INSERT / UPDATE OF location: fill zip_code from the label's
--     trailing ZIP. Covers every installed build, no client release.
--     "Only use approximate" stores "city, region" with no ZIP, so nothing is
--     derived for those users.
--   * A changed label moves zip_code with it only while zip_code is empty or
--     was the old label's ZIP. A ZIP typed in the ZIP modal
--     (saveMyZipLocation) is left alone, and an explicit zip_code in the same
--     UPDATE wins.
--   * fn_backfill_profile_zip_from_location(p_dry_run DEFAULT true) for
--     existing rows: reports the count, writes only with false, and logs
--     every row it fills to profile_zip_backfill_log so it can be undone.
--     Expected candidates on prod (2026-10-22): 191 (42 created since 10-12).
--
-- Not covered: profiles with coordinates and no ZIP in the label (288 on prod,
-- 4 of them since 10-12; mostly the feed's GPS write). Those need a server
-- reverse geocoder (geocode-bounties already uses Photon).
--
-- Undo the backfill:
--   UPDATE public.profiles p SET zip_code = NULL
--   FROM public.profile_zip_backfill_log l
--   WHERE l.user_id = p.id AND p.zip_code = l.zip_code;
-- Rollback: supabase/rollbacks/production/20261022120100_profile_zip_from_location.down.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_profiles_zip_from_location()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  -- A US ZIP (optionally ZIP+4) ending the label after a comma or a space.
  v_new text := substring(NEW.location from '(?:^|[\s,])(\d{5})(?:-\d{4})?\s*$');
  v_old text;
BEGIN
  IF v_new IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NULLIF(btrim(NEW.zip_code), '') IS NULL THEN
      NEW.zip_code := v_new;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.zip_code IS DISTINCT FROM OLD.zip_code THEN
    RETURN NEW;
  END IF;

  v_old := substring(OLD.location from '(?:^|[\s,])(\d{5})(?:-\d{4})?\s*$');
  IF NULLIF(btrim(OLD.zip_code), '') IS NULL OR OLD.zip_code = v_old THEN
    NEW.zip_code := v_new;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_profiles_zip_from_location() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_zip_from_location ON public.profiles;
CREATE TRIGGER trg_profiles_zip_from_location
  BEFORE INSERT OR UPDATE OF location ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_zip_from_location();

-- ─── Backfill (run separately: dry run, then false) ────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_zip_backfill_log (
  user_id   uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  zip_code  text NOT NULL,
  filled_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_zip_backfill_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_zip_backfill_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.profile_zip_backfill_log TO service_role;

CREATE OR REPLACE FUNCTION public.fn_backfill_profile_zip_from_location(p_dry_run boolean DEFAULT true)
RETURNS TABLE(candidates integer, filled integer, dry_run boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_candidates integer;
  v_filled     integer := 0;
BEGIN
  SELECT count(*) INTO v_candidates
  FROM public.profiles p
  WHERE NULLIF(btrim(p.zip_code), '') IS NULL
    AND substring(p.location from '(?:^|[\s,])(\d{5})(?:-\d{4})?\s*$') IS NOT NULL;

  IF NOT p_dry_run THEN
    WITH filled AS (
      UPDATE public.profiles p
      SET zip_code = substring(p.location from '(?:^|[\s,])(\d{5})(?:-\d{4})?\s*$')
      WHERE NULLIF(btrim(p.zip_code), '') IS NULL
        AND substring(p.location from '(?:^|[\s,])(\d{5})(?:-\d{4})?\s*$') IS NOT NULL
      RETURNING p.id, p.zip_code
    )
    INSERT INTO public.profile_zip_backfill_log (user_id, zip_code)
    SELECT f.id, f.zip_code FROM filled f
    ON CONFLICT (user_id) DO NOTHING;
    GET DIAGNOSTICS v_filled = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_candidates, v_filled, p_dry_run;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_backfill_profile_zip_from_location(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_backfill_profile_zip_from_location(boolean) TO service_role;

COMMIT;
