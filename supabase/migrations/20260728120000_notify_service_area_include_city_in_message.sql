-- Migration: include locality (city/neighborhood) in the service-area bounty
-- notification body, for a more specific "near you" message.
-- Created: 2026-07-28
--
-- Updates fn_notify_service_area_matched_bounty (added in
-- 20260727120000_notify_service_area_matched_bounty.sql) so the push reads
-- e.g. '"Walk my dog" was just posted near you in Owings Mills.' when the
-- bounty has a locality, and falls back to '… near you.' when it doesn't.
--
-- The locality comes from NEW.neighborhood — the coarse, public-safe label the
-- location redesign captures via reverse geocoding at post time
-- (district || city). Deliberately NOT NEW.location, which can be the exact
-- street address and must never be broadcast to nearby hunters.
--
-- Also adds `place` to the notification data payload for client use. Only the
-- message body / data changed; the recipient-matching logic (radius, Anywhere
-- skip, ZIP dedup, poster/deleted exclusion) is unchanged.

CREATE OR REPLACE FUNCTION public.fn_notify_service_area_matched_bounty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_poster_id  uuid;
  v_recipients jsonb;
  v_place      text;
  v_body       text;
BEGIN
  IF NEW.geom IS NULL THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT jsonb_agg(DISTINCT hsa.hunter_id)
  INTO v_recipients
  FROM public.hunter_service_areas hsa
  JOIN public.profiles p ON p.id = hsa.hunter_id
  WHERE hsa.radius_miles IS NOT NULL
    AND hsa.latitude IS NOT NULL
    AND hsa.longitude IS NOT NULL
    AND ST_DWithin(
          NEW.geom,
          ST_SetSRID(ST_MakePoint(hsa.longitude, hsa.latitude), 4326)::geography,
          hsa.radius_miles * 1609.344
        )
    AND hsa.hunter_id IS DISTINCT FROM v_poster_id
    AND p.deleted_at IS NULL
    AND NOT (
      NEW.zip_code IS NOT NULL
      AND btrim(NEW.zip_code) <> ''
      AND p.zip_code = NEW.zip_code
    );

  IF v_recipients IS NULL OR jsonb_array_length(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  -- Coarse, public-safe locality (district or city, captured by reverse
  -- geocoding at post time). Deliberately NOT NEW.location, which may be the
  -- exact street address and must not be broadcast.
  v_place := NULLIF(btrim(COALESCE(NEW.neighborhood, '')), '');

  v_body := CASE
    WHEN v_place IS NOT NULL
      THEN '"' || NEW.title || '" was just posted near you in ' || v_place || '.'
    ELSE '"' || NEW.title || '" was just posted near you.'
  END;

  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  VALUES (
    v_recipients,
    'New Bounty Near You',
    v_body,
    jsonb_build_object('bounty_id', NEW.id, 'type', 'bounty_nearby', 'match', 'service_area', 'place', v_place),
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
