-- Migration: notify_radius_matched_users_on_bounty_insert
-- Created: 2026-07-23
--
-- Step 3 (final) of the "notify users within a radius of a new bounty" feature.
-- Steps 1 & 2 added lat/lng + a derived geography `geom` column to bounties and
-- profiles respectively. This adds the AFTER INSERT trigger that, when a new
-- bounty has coordinates, notifies every user whose profile geom (their ZIP
-- centroid) is within 20 miles -- via the same notifications_outbox +
-- process-notification pipeline the ZIP-match trigger already uses.
--
-- RELATIONSHIP TO THE EXISTING ZIP-MATCH TRIGGER
-- (fn_notify_zip_matched_bounty, 20260714c):
--   The ZIP trigger already notifies users whose profiles.zip_code EXACTLY
--   equals the bounty's zip_code -- and it works even for users who only gave a
--   ZIP and therefore have no geom. Those exact-ZIP users are almost always also
--   within 20 miles, so to avoid double-notifying, this radius trigger
--   DELIBERATELY EXCLUDES profiles whose zip_code matches the bounty's. Net
--   effect, no duplicates:
--     * same ZIP as bounty            -> handled by the ZIP trigger
--     * within 20 mi, different ZIP   -> handled by this radius trigger
--   The ZIP trigger is left untouched (non-destructive).
--
-- Requires geom on BOTH sides: a bounty with no coordinates (online bounty, or
-- an in-person address typed without picking a Places suggestion) no-ops here,
-- and a profile with no geom (no ZIP set yet) is never matched.

CREATE OR REPLACE FUNCTION public.fn_notify_radius_matched_bounty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- `extensions` is on the path because PostGIS (ST_DWithin, the geography type)
-- is installed in the extensions schema on Supabase, not public.
SET search_path = public, extensions
AS $$
DECLARE
  v_poster_id  uuid;
  v_recipients jsonb;
  -- 20 miles expressed in meters (geography ST_DWithin uses meters).
  v_radius_m   constant double precision := 20 * 1609.344;  -- 32186.88
BEGIN
  -- No coordinates on the bounty -> nothing to match on.
  IF NEW.geom IS NULL THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT jsonb_agg(p.id)
  INTO v_recipients
  FROM public.profiles p
  WHERE p.geom IS NOT NULL
    AND ST_DWithin(p.geom, NEW.geom, v_radius_m)
    AND p.id IS DISTINCT FROM v_poster_id
    AND p.deleted_at IS NULL
    -- Skip users the ZIP-match trigger already notifies (same ZIP as bounty),
    -- so a same-ZIP user does not receive two notifications for one bounty.
    AND NOT (
      NEW.zip_code IS NOT NULL
      AND btrim(NEW.zip_code) <> ''
      AND p.zip_code = NEW.zip_code
    );

  -- No one in range (after exclusions) -> nothing to send.
  IF v_recipients IS NULL OR jsonb_array_length(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  VALUES (
    v_recipients,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted near you.',
    jsonb_build_object(
      'bounty_id', NEW.id,
      'type', 'bounty_nearby',
      'match', 'radius',
      'radius_miles', 20
    ),
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_notify_radius_matched_bounty IS
  'AFTER INSERT trigger on public.bounties. Notifies every user whose profile geom (ZIP centroid) is within 20 miles of the new bounty''s geom, EXCLUDING the poster and any user in the bounty''s exact ZIP (already handled by fn_notify_zip_matched_bounty), via notifications_outbox.';

DROP TRIGGER IF EXISTS trg_bounties_notify_radius_matched ON public.bounties;
CREATE TRIGGER trg_bounties_notify_radius_matched
  AFTER INSERT ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_radius_matched_bounty();

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
