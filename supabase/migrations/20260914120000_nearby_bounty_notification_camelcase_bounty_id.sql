-- Migration: emit the camelCase `bountyId` key in nearby-bounty notification
-- data payloads.
-- Created: 2026-09-14
--
-- The app deep-link resolver (lib/services/notification-deep-links.ts) reads
-- the bounty id from `data.bountyId`. The relevance engine
-- (20260912142307_hunter_relevance_and_liquidity_engine.sql) already writes
-- that camelCase key, but the two older nearby-bounty triggers still write
-- snake_case `bounty_id`, so a tap on "New Bounty Near You" from either of
-- them resolved to nothing and opened no screen.
--
-- This redefines both trigger functions to write `bountyId` in the data
-- payload. The `bounty_id` column of notifications_outbox is unchanged — only
-- the JSON `data` key that the client reads changes. The resolver also accepts
-- the legacy `bounty_id` key, so pushes already queued keep working.

-- 1. ZIP-match trigger (20260714c_notify_zip_matched_users_on_bounty_insert.sql)
CREATE OR REPLACE FUNCTION public.fn_notify_zip_matched_bounty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poster_id   uuid;
  v_recipients  jsonb;
BEGIN
  -- Nothing to match without a zip code on the bounty.
  IF NEW.zip_code IS NULL OR btrim(NEW.zip_code) = '' THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT jsonb_agg(id)
  INTO v_recipients
  FROM public.profiles
  WHERE zip_code = NEW.zip_code
    AND id IS DISTINCT FROM v_poster_id;

  -- No matching users (or only the poster themselves) — nothing to send.
  IF v_recipients IS NULL OR jsonb_array_length(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  VALUES (
    v_recipients,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted in your ZIP code (' || NEW.zip_code || ').',
    jsonb_build_object('bountyId', NEW.id, 'type', 'bounty_nearby', 'zip_code', NEW.zip_code),
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

-- 2. Service-area trigger
-- (20260728120000_notify_service_area_include_city_in_message.sql)
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
    jsonb_build_object('bountyId', NEW.id, 'type', 'bounty_nearby', 'match', 'service_area', 'place', v_place),
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
