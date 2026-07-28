-- Migration: notify hunters when a new bounty lands inside their service area
-- Created: 2026-07-27
--
-- Adds the "push a notification when a bounty is posted near me" feature on top
-- of the location redesign's `hunter_service_areas` table (a hunter-defined
-- center point + radius_miles). This is the push-on-post counterpart to
-- `search_bounties_nearby` (which is pull/search only).
--
-- On bounty INSERT, notifies every hunter whose service area *covers* the new
-- bounty's exact location:
--   ST_DWithin(bounty.geom, hunter_point, radius_miles)
-- via the existing notifications_outbox + process-notification pipeline
-- (data.type 'bounty_nearby', already a registered marketplace type).
--
-- Product decisions baked in:
--   * "Anywhere" areas (radius_miles IS NULL) are DELIBERATELY skipped -- that
--     setting means "show me everything when I browse/search", not "push me
--     every bounty posted anywhere" (which would be spam). Anywhere hunters
--     still find bounties via search_bounties_nearby.
--   * Dedup with fn_notify_zip_matched_bounty (exact-ZIP push): a hunter whose
--     profile zip_code equals the bounty's is excluded here, so they receive at
--     most one notification per bounty. Both models coexist:
--       - same ZIP as bounty            -> ZIP-match trigger
--       - service area covers bounty     -> this trigger (if different ZIP)
--
-- Requires the bounty to have coordinates (geom, synced from latitude/longitude
-- by bounties_compute_approx_location); a bounty with no location no-ops. Reads
-- exact locations server-side only (SECURITY DEFINER) and emits just user ids +
-- a generic "near you" copy -- it never exposes an exact address to anyone.
--
-- `extensions` is on the search_path because PostGIS (ST_DWithin, the geography
-- type) lives in the extensions schema on Supabase, not public.

CREATE OR REPLACE FUNCTION public.fn_notify_service_area_matched_bounty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_poster_id  uuid;
  v_recipients jsonb;
BEGIN
  -- No coordinates on the bounty -> nothing to match on.
  IF NEW.geom IS NULL THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT jsonb_agg(DISTINCT hsa.hunter_id)
  INTO v_recipients
  FROM public.hunter_service_areas hsa
  JOIN public.profiles p ON p.id = hsa.hunter_id
  WHERE hsa.radius_miles IS NOT NULL             -- skip "Anywhere" (see header)
    AND hsa.latitude IS NOT NULL
    AND hsa.longitude IS NOT NULL
    AND ST_DWithin(
          NEW.geom,
          ST_SetSRID(ST_MakePoint(hsa.longitude, hsa.latitude), 4326)::geography,
          hsa.radius_miles * 1609.344            -- miles -> meters
        )
    AND hsa.hunter_id IS DISTINCT FROM v_poster_id
    AND p.deleted_at IS NULL
    -- Dedup: skip anyone the exact-ZIP trigger already notifies.
    AND NOT (
      NEW.zip_code IS NOT NULL
      AND btrim(NEW.zip_code) <> ''
      AND p.zip_code = NEW.zip_code
    );

  IF v_recipients IS NULL OR jsonb_array_length(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  VALUES (
    v_recipients,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted near you.',
    jsonb_build_object('bounty_id', NEW.id, 'type', 'bounty_nearby', 'match', 'service_area'),
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_notify_service_area_matched_bounty IS
  'AFTER INSERT trigger on public.bounties. Notifies every hunter whose hunter_service_areas entry (center + radius_miles, excluding NULL/"Anywhere") covers the new bounty geom, excluding the poster and any hunter already notified by the exact-ZIP trigger. Uses notifications_outbox (type bounty_nearby, match service_area).';

DROP TRIGGER IF EXISTS trg_bounties_notify_service_area ON public.bounties;
CREATE TRIGGER trg_bounties_notify_service_area
  AFTER INSERT ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_service_area_matched_bounty();

NOTIFY pgrst, 'reload schema';
