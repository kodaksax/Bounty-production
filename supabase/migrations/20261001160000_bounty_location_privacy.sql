-- Migration: Bounty location privacy (Trust Spine audit T3 / S3, P0)
-- Created: 2026-10-01
--
-- PROMISE: "Hunters see a neighborhood and a rating — never an address."
--
-- PROBLEM (docs/trust-spine-audit-2026-09-30.md, T3):
--   * StepWhere stores the reverse-geocoded street address in bounties.location.
--   * bounties.location / latitude / longitude / unit / geom are readable by
--     every signed-in user (column SELECT grants + RLS that exposes open rows).
--   * The same raw values also leave the database through paths that a column
--     REVOKE would NOT close:
--       - share-bounty / share-og-image edge functions (service role, public web)
--       - realtime postgres_changes + bounties_broadcast_trigger (full row)
--       - search_bounties_nearby(): filters/sorts on the EXACT geom and returns
--         an unrounded distance for caller-chosen points -> trilateration oracle
--       - admin RPCs, the Node API, any service-role reader
--
-- DESIGN: move the exact data out of public.bounties instead of hiding columns.
--   1. public.bounty_private_locations holds address / unit / latitude /
--      longitude. No client grants, no client policies. Readable only through
--      get_bounty_exact_location() (poster always; accepted hunter only while
--      the job is active) and by service_role.
--   2. BEFORE INSERT/UPDATE trigger zz_bounties_privatize_location runs LAST
--      among BEFORE triggers for every writer (old app builds, new builds,
--      RPCs, edge functions, service role). It copies exact values into the
--      private table and leaves only public-safe values on the row:
--        location      -> "City, ST" label (fn_public_location_label)
--        neighborhood  -> sanitized (NULL if it looks like an address)
--        latitude/longitude/unit -> NULL
--        approx_*      -> stable one-time 120-350 m jitter (never re-rolled for
--                         the same exact point, so samples can't be averaged)
--        geom          -> the APPROX point. Radius search, notifications and
--                         liquidity matching keep working at <=350 m error and
--                         search_bounties_nearby stops being an oracle.
--   3. Reversible backfill of existing rows, with a dry-run mode
--      (fn_backfill_bounty_location_privacy(true)) and a pre-image snapshot.
--   4. get_bounty_exact_location() reads the private table, applies the access
--      rule, and logs every call (granted or denied) to
--      bounty_location_access_log -- the observable for this change.
--
-- WHY NOT A COLUMN REVOKE NOW: shipped app builds (OTA is blocked) read
-- bounties with select('*') and insert(...).select(). PostgREST turns a
-- missing column privilege into "permission denied for table bounties", which
-- would break feed, detail and posting for every installed build. With the
-- data moved, the revoke becomes defence in depth; it is staged in
-- supabase/staged/20261001160100_bounty_location_column_revoke.sql and must
-- only be applied once a native build with explicit column lists is adopted.
--
-- Rollback: supabase/rollbacks/production/20261001160000_bounty_location_privacy.down.sql
-- restores the exact values onto bounties from the private table and the
-- function/trigger definitions this migration captured from the LIVE database
-- before replacing them (location_privacy_rollback_defs). Nothing is deleted.

-- ─── 0. Preconditions ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['id','location','latitude','longitude','unit','geom','approx_latitude',
                    'approx_longitude','neighborhood','poster_id','user_id','accepted_by','status']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = c
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'location privacy: public.bounties is missing column(s): %', v_missing;
  END IF;
END $$;

-- ─── 1. Capture live definitions for rollback ─────────────────────────────
-- Captured from the database this runs on, not from git, because this project
-- has repeatedly had live definitions that git doesn't know about.
CREATE TABLE IF NOT EXISTS public.location_privacy_rollback_defs (
  object_name text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('function', 'trigger', 'acl')),
  definition  text,            -- NULL = object did not exist
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.location_privacy_rollback_defs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.location_privacy_rollback_defs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.location_privacy_rollback_defs TO service_role;

INSERT INTO public.location_privacy_rollback_defs (object_name, kind, definition)
SELECT o.name, o.kind, o.def
FROM (
  SELECT 'get_bounty_exact_location(uuid)' AS name, 'function' AS kind,
         CASE WHEN to_regprocedure('public.get_bounty_exact_location(uuid)') IS NOT NULL
              THEN pg_get_functiondef(to_regprocedure('public.get_bounty_exact_location(uuid)')) END AS def
  UNION ALL
  SELECT 'get_bounty_exact_location(uuid)#acl', 'acl',
         (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_bounty_exact_location(uuid)'))
  UNION ALL
  SELECT 'fn_compute_bounty_quality_score(uuid)', 'function',
         CASE WHEN to_regprocedure('public.fn_compute_bounty_quality_score(uuid)') IS NOT NULL
              THEN pg_get_functiondef(to_regprocedure('public.fn_compute_bounty_quality_score(uuid)')) END
  UNION ALL
  SELECT 'bounties_compute_approx_location()', 'function',
         CASE WHEN to_regprocedure('public.bounties_compute_approx_location()') IS NOT NULL
              THEN pg_get_functiondef(to_regprocedure('public.bounties_compute_approx_location()')) END
  UNION ALL
  SELECT 'trg_bounties_compute_approx_location', 'trigger',
         (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
          WHERE t.tgrelid = 'public.bounties'::regclass AND t.tgname = 'trg_bounties_compute_approx_location')
) o
ON CONFLICT (object_name) DO NOTHING;   -- a re-run must never overwrite the originals

-- ─── 2. Private storage ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bounty_private_locations (
  bounty_id  uuid PRIMARY KEY
             REFERENCES public.bounties(id) ON DELETE CASCADE,
  address    text,
  unit       text,
  latitude   double precision,
  longitude  double precision,
  source     text NOT NULL DEFAULT 'write' CHECK (source IN ('write', 'backfill')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bounty_private_locations_coords_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT bounty_private_locations_lat_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT bounty_private_locations_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

COMMENT ON TABLE public.bounty_private_locations IS
  'Exact job location (street address, unit, coordinates). No anon/authenticated grants or policies: read only via get_bounty_exact_location() (poster; accepted hunter while active) or service_role. Written by the zz_bounties_privatize_location trigger.';

ALTER TABLE public.bounty_private_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bounty_private_locations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bounty_private_locations TO service_role;

-- Pre-image of every row the backfill touched. Exact data: same lock-down.
-- Drop after the soak period (see runbook), not before.
CREATE TABLE IF NOT EXISTS public.bounty_location_backfill_snapshot (
  bounty_id        uuid PRIMARY KEY,
  location         text,
  latitude         double precision,
  longitude        double precision,
  unit             text,
  geom             geography(Point, 4326),
  approx_latitude  double precision,
  approx_longitude double precision,
  neighborhood     text,
  captured_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bounty_location_backfill_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bounty_location_backfill_snapshot FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bounty_location_backfill_snapshot TO service_role;

-- Every exact-location request, granted or denied. Target for non-participant
-- grants: 0.
CREATE TABLE IF NOT EXISTS public.bounty_location_access_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bounty_id  uuid NOT NULL,
  caller_id  uuid,
  granted    boolean NOT NULL,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bounty_location_access_log_bounty
  ON public.bounty_location_access_log (bounty_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bounty_location_access_log_granted
  ON public.bounty_location_access_log (granted, created_at DESC);
ALTER TABLE public.bounty_location_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bounty_location_access_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bounty_location_access_log TO authenticated;
GRANT ALL ON public.bounty_location_access_log TO service_role;
DROP POLICY IF EXISTS bounty_location_access_log_admin_read ON public.bounty_location_access_log;
CREATE POLICY bounty_location_access_log_admin_read ON public.bounty_location_access_log
  FOR SELECT TO authenticated
  USING (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ─── 3. Public label functions ────────────────────────────────────────────
-- A comma-separated component is public when it carries no digits / '#',
-- isn't a country, a unit designator or a street name. Mirrored in
-- lib/utils/public-location.ts; both are checked against
-- __tests__/fixtures/public-location-label-cases.json.
CREATE OR REPLACE FUNCTION public.fn_location_component_is_public(p_c text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
SELECT
-- @pred-begin
(
  COALESCE(p_c, '') <> ''
  AND p_c !~ '[0-9#]'
  AND p_c !~* '^(usa|us|u\.s\.a?\.?|united states( of america)?)$'
  AND p_c !~* '\y(apt|apartment|suite|ste|unit|floor|bldg|building|room|po box|p\.o\. box|lot|trlr|trailer)\y'
  AND p_c !~* '\S\s+(st|street|rd|road|ave|av|avenue|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|ter|terrace|cir|circle|trl|trail|aly|alley|expy|expressway|tpke|turnpike|pike)\.?$'
)
-- @pred-end
$fn$;

-- "1234 Painters Mill Road, Owings Mills, MD 21117, USA" -> "Owings Mills, MD".
-- Keeps the last two public components; NULL when nothing public remains.
CREATE OR REPLACE FUNCTION public.fn_public_location_label(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
SELECT
-- @label-begin
(
  SELECT NULLIF(string_agg(f.c, ', ' ORDER BY f.ord), '')
  FROM (
    SELECT s.c, s.ord, row_number() OVER (ORDER BY s.ord DESC) AS rn
    FROM (
      SELECT btrim(regexp_replace(regexp_replace(btrim(t.part), '\s*[0-9]{5}(-[0-9]{4})?$', ''), '\s+', ' ', 'g')) AS c,
             t.ord
      FROM unnest(string_to_array(COALESCE(p_raw, ''), ',')) WITH ORDINALITY AS t(part, ord)
    ) s
    WHERE public.fn_location_component_is_public(s.c)
  ) f
  WHERE f.rn <= 2
)
-- @label-end
$fn$;

-- A neighborhood must be a single public component.
CREATE OR REPLACE FUNCTION public.fn_public_neighborhood(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
SELECT CASE
  WHEN position(',' IN COALESCE(p_raw, '')) > 0 THEN NULL
  WHEN public.fn_location_component_is_public(btrim(regexp_replace(COALESCE(p_raw, ''), '\s+', ' ', 'g')))
    THEN btrim(regexp_replace(p_raw, '\s+', ' ', 'g'))
  ELSE NULL
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_location_component_is_public(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_public_location_label(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_public_neighborhood(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_location_component_is_public(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_public_location_label(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_public_neighborhood(text) TO authenticated, service_role;

-- ─── 4. Write-path trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bounties_privatize_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_priv          public.bounty_private_locations%ROWTYPE;
  v_has_priv      boolean := false;
  v_loc_changed   boolean;
  v_loc_removed   boolean := false;
  v_coords_sent   boolean;
  v_unit_changed  boolean;
  v_dirty         boolean := false;
  v_raw           text;
  v_angle         double precision;
  v_radius_m      double precision;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_loc_changed  := NULLIF(btrim(COALESCE(NEW.location, '')), '') IS NOT NULL;
    v_coords_sent  := NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL;
    v_unit_changed := NEW.unit IS NOT NULL;
  ELSE
    v_loc_changed  := NEW.location IS DISTINCT FROM OLD.location;
    -- Public latitude/longitude are always NULL after this trigger, so a
    -- client that round-trips the row sends NULLs back = "no change".
    v_coords_sent  := NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
                      AND (NEW.latitude IS DISTINCT FROM OLD.latitude
                           OR NEW.longitude IS DISTINCT FROM OLD.longitude);
    v_unit_changed := NEW.unit IS DISTINCT FROM OLD.unit;
    SELECT * INTO v_priv FROM public.bounty_private_locations WHERE bounty_id = NEW.id FOR UPDATE;
    v_has_priv := FOUND;
  END IF;

  -- Address text.
  IF v_loc_changed THEN
    v_raw := NULLIF(btrim(COALESCE(NEW.location, '')), '');
    IF v_raw IS NULL THEN
      -- Location removed (e.g. switched to online): forget every exact field.
      v_loc_removed := true;
      v_priv.address := NULL;
      v_priv.unit := NULL;
      v_priv.latitude := NULL;
      v_priv.longitude := NULL;
    ELSE
      v_priv.address := v_raw;
      IF NOT v_coords_sent THEN
        v_priv.unit := NULL;
        v_priv.latitude := NULL;
        v_priv.longitude := NULL;
      END IF;
      NEW.location := COALESCE(public.fn_public_location_label(v_raw),
                               public.fn_public_neighborhood(NEW.neighborhood),
                               '');
    END IF;
    v_dirty := true;
  END IF;

  -- Coordinates.
  IF v_coords_sent THEN
    IF v_has_priv
       AND v_priv.latitude = NEW.latitude AND v_priv.longitude = NEW.longitude
       AND OLD.approx_latitude IS NOT NULL AND OLD.approx_longitude IS NOT NULL THEN
      -- Same exact point re-sent (the posting flow re-saves it): keep the
      -- existing jitter. Re-rolling it per save would leak the point by
      -- averaging.
      NEW.approx_latitude  := OLD.approx_latitude;
      NEW.approx_longitude := OLD.approx_longitude;
    ELSE
      v_angle    := random() * 2 * pi();
      v_radius_m := 120 + random() * 230;   -- uniform 120-350 m
      NEW.approx_latitude  := NEW.latitude + (v_radius_m * cos(v_angle)) / 111320.0;
      NEW.approx_longitude := NEW.longitude
                              + (v_radius_m * sin(v_angle)) / (111320.0 * cos(radians(NEW.latitude)));
      v_priv.latitude  := NEW.latitude;
      v_priv.longitude := NEW.longitude;
      v_dirty := true;
    END IF;
  ELSIF v_loc_removed OR (v_loc_changed AND NOT v_coords_sent) THEN
    NEW.approx_latitude  := NULL;
    NEW.approx_longitude := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    -- The approximate point is derived, never client-writable.
    NEW.approx_latitude  := OLD.approx_latitude;
    NEW.approx_longitude := OLD.approx_longitude;
  ELSE
    NEW.approx_latitude  := NULL;
    NEW.approx_longitude := NULL;
  END IF;

  -- Unit.
  IF v_unit_changed AND NOT v_loc_removed THEN
    v_priv.unit := NULLIF(btrim(COALESCE(NEW.unit, '')), '');
    v_dirty := true;
  END IF;

  -- Public row: only coarse values survive, whoever the writer is.
  NEW.latitude     := NULL;
  NEW.longitude    := NULL;
  NEW.unit         := NULL;
  NEW.neighborhood := public.fn_public_neighborhood(NEW.neighborhood);
  NEW.geom := CASE
    WHEN NEW.approx_latitude IS NOT NULL AND NEW.approx_longitude IS NOT NULL
    THEN ST_SetSRID(ST_MakePoint(NEW.approx_longitude, NEW.approx_latitude), 4326)::geography
  END;

  IF NOT v_dirty OR NOT (v_has_priv OR v_priv.address IS NOT NULL OR v_priv.unit IS NOT NULL
                         OR v_priv.latitude IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- The bounty row doesn't exist yet. Hand the exact values to the AFTER
    -- INSERT trigger through a transaction-local setting, so the private row
    -- is only written for rows that really were inserted.
    PERFORM set_config(
      'bounty_location.p_' || replace(NEW.id::text, '-', ''),
      jsonb_build_object('address', v_priv.address, 'unit', v_priv.unit,
                         'latitude', v_priv.latitude, 'longitude', v_priv.longitude)::text,
      true);
  ELSE
    INSERT INTO public.bounty_private_locations AS p
      (bounty_id, address, unit, latitude, longitude, source, updated_at)
    VALUES (NEW.id, v_priv.address, v_priv.unit, v_priv.latitude, v_priv.longitude, 'write', now())
    ON CONFLICT (bounty_id) DO UPDATE
      SET address    = EXCLUDED.address,
          unit       = EXCLUDED.unit,
          latitude   = EXCLUDED.latitude,
          longitude  = EXCLUDED.longitude,
          updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bounties_privatize_location() FROM PUBLIC, anon, authenticated;

-- Second half of the INSERT path: the row now exists, so store what the
-- BEFORE trigger stashed and clear the stash.
CREATE OR REPLACE FUNCTION public.fn_bounties_store_private_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key   text := 'bounty_location.p_' || replace(NEW.id::text, '-', '');
  v_stash jsonb := NULLIF(current_setting(v_key, true), '')::jsonb;
BEGIN
  IF v_stash IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM set_config(v_key, '', true);

  INSERT INTO public.bounty_private_locations AS p
    (bounty_id, address, unit, latitude, longitude, source, updated_at)
  VALUES (NEW.id,
          v_stash ->> 'address',
          v_stash ->> 'unit',
          (v_stash ->> 'latitude')::double precision,
          (v_stash ->> 'longitude')::double precision,
          'write', now())
  ON CONFLICT (bounty_id) DO UPDATE
    SET address    = EXCLUDED.address,
        unit       = EXCLUDED.unit,
        latitude   = EXCLUDED.latitude,
        longitude  = EXCLUDED.longitude,
        updated_at = now();
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bounties_store_private_location() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_bounties_store_private_location ON public.bounties;
CREATE TRIGGER zz_bounties_store_private_location
  AFTER INSERT ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounties_store_private_location();

-- Old trigger's logic is folded into the new one (the old one wrote the exact
-- point into geom). Its definition is in location_privacy_rollback_defs.
DROP TRIGGER IF EXISTS trg_bounties_compute_approx_location ON public.bounties;

-- "zz_" so it fires after every other BEFORE trigger (Postgres orders them by
-- name): readers like the nearby-notification claim and zip extraction still
-- see what the client sent, and nothing after it can put exact values back.
DROP TRIGGER IF EXISTS zz_bounties_privatize_location ON public.bounties;
CREATE TRIGGER zz_bounties_privatize_location
  BEFORE INSERT OR UPDATE ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounties_privatize_location();

-- ─── 5. Exact-location read path ──────────────────────────────────────────
-- Same signature and return shape as before, so installed app builds keep
-- working. Poster: always. Accepted hunter: only while the job is live.
-- Admins are deliberately not granted here; admin tooling reads with the
-- service role.
CREATE OR REPLACE FUNCTION public.get_bounty_exact_location(p_bounty_id uuid)
RETURNS TABLE(location text, latitude double precision, longitude double precision, unit text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_uid     uuid := auth.uid();
  v_poster  uuid;
  v_hunter  uuid;
  v_status  text;
  v_granted boolean := false;
  v_reason  text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(b.poster_id, b.user_id), b.accepted_by, b.status::text
    INTO v_poster, v_hunter, v_status
  FROM public.bounties b
  WHERE b.id = p_bounty_id;

  IF NOT FOUND THEN
    v_reason := 'not_found';
  ELSIF v_uid = v_poster THEN
    v_granted := true;
    v_reason  := 'poster';
  ELSIF v_uid = v_hunter AND v_status IN ('in_progress', 'cancellation_requested', 'disputed') THEN
    v_granted := true;
    v_reason  := 'accepted_hunter';
  ELSIF v_uid = v_hunter THEN
    v_reason := 'hunter_job_not_active';
  ELSE
    v_reason := 'not_participant';
  END IF;

  INSERT INTO public.bounty_location_access_log (bounty_id, caller_id, granted, reason)
  VALUES (p_bounty_id, v_uid, v_granted, v_reason);

  IF v_granted THEN
    RETURN QUERY
      SELECT p.address, p.latitude, p.longitude, p.unit
      FROM public.bounty_private_locations p
      WHERE p.bounty_id = p_bounty_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_bounty_exact_location(uuid) IS
  'Exact address/coordinates/unit from bounty_private_locations. Poster (COALESCE(poster_id,user_id)) always; accepted hunter while status is in_progress/cancellation_requested/disputed. Zero rows for everyone else. Every call is logged to bounty_location_access_log.';

REVOKE ALL ON FUNCTION public.get_bounty_exact_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bounty_exact_location(uuid) TO authenticated, service_role;

-- ─── 6. Quality score: "has a location" no longer reads exact columns ──────
-- fn_compute_bounty_quality_score SELECTs latitude/longitude into a record and
-- scores b.latitude/b.longitude. Those are now always NULL, which would cost
-- every located bounty 20 points and trigger the "add details" nudge. Alias
-- the approximate point in the SELECT list instead, leaving the rule itself
-- untouched. Patched in place from the LIVE definition so drift elsewhere in
-- the function survives; fails loudly if the expected text isn't there (its
-- AFTER-trigger caller swallows errors, so a silent mismatch would hide).
DO $$
DECLARE
  v_proc regprocedure := to_regprocedure('public.fn_compute_bounty_quality_score(uuid)');
  v_def  text;
  v_new  text;
BEGIN
  IF v_proc IS NULL THEN
    RAISE NOTICE 'location privacy: fn_compute_bounty_quality_score(uuid) not present, skipping';
    RETURN;
  END IF;
  v_def := pg_get_functiondef(v_proc);
  IF position('approx_latitude AS latitude' IN v_def) > 0 THEN
    RETURN;   -- already patched
  END IF;
  v_new := replace(v_def,
                   'zip_code, latitude, longitude,',
                   'zip_code, approx_latitude AS latitude, approx_longitude AS longitude,');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'location privacy: fn_compute_bounty_quality_score has no "zip_code, latitude, longitude," select list; live definition drifted, review before applying';
  END IF;
  EXECUTE v_new;
END $$;

-- ─── 7. Backfill (reversible, dry-run first) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_backfill_bounty_location_privacy(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_counts    jsonb;
  v_trig      record;
  v_disabled  jsonb := '[]'::jsonb;
  v_replident "char";
  v_snap      integer;
  v_priv      integer;
  v_rows      integer;
BEGIN
  SELECT jsonb_build_object(
    'rows_total',                     count(*),
    'rows_with_any_location_data',    count(*) FILTER (WHERE NULLIF(btrim(b.location), '') IS NOT NULL
                                                         OR b.latitude IS NOT NULL OR b.longitude IS NOT NULL
                                                         OR NULLIF(btrim(b.unit), '') IS NOT NULL OR b.geom IS NOT NULL),
    'rows_with_exact_coords',         count(*) FILTER (WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL),
    'rows_with_4plus_decimal_coords', count(*) FILTER (WHERE b.latitude IS NOT NULL
                                                         AND abs(b.latitude * 10000 - round(b.latitude * 10000)) > 0),
    'rows_with_geom',                 count(*) FILTER (WHERE b.geom IS NOT NULL),
    'rows_with_unit',                 count(*) FILTER (WHERE NULLIF(btrim(b.unit), '') IS NOT NULL),
    'rows_location_with_digits',      count(*) FILTER (WHERE b.location ~ '[0-9#]'),
    'rows_location_street_number',    count(*) FILTER (WHERE b.location ~ '(^|,)\s*#?[0-9]+[A-Za-z]?\s+\S'),
    'rows_location_label_changes',    count(*) FILTER (WHERE NULLIF(btrim(b.location), '') IS NOT NULL
                                                         AND COALESCE(public.fn_public_location_label(b.location), '')
                                                             IS DISTINCT FROM btrim(b.location)),
    'rows_neighborhood_sanitized',    count(*) FILTER (WHERE b.neighborhood IS NOT NULL
                                                         AND public.fn_public_neighborhood(b.neighborhood)
                                                             IS DISTINCT FROM b.neighborhood),
    'live_rows_exposed',              count(*) FILTER (WHERE b.status::text IN ('open', 'in_progress', 'cancellation_requested', 'disputed')
                                                         AND ((b.latitude IS NOT NULL)
                                                              OR b.location ~ '[0-9#]'
                                                              OR NULLIF(btrim(b.unit), '') IS NOT NULL)),
    'rows_already_private',           (SELECT count(*) FROM public.bounty_private_locations)
  )
  INTO v_counts
  FROM public.bounties b;

  IF p_dry_run THEN
    RETURN v_counts || jsonb_build_object('dry_run', true);
  END IF;

  -- 7a. Pre-image (first run wins; a re-run never overwrites it).
  INSERT INTO public.bounty_location_backfill_snapshot
    (bounty_id, location, latitude, longitude, unit, geom, approx_latitude, approx_longitude, neighborhood)
  SELECT b.id, b.location, b.latitude, b.longitude, b.unit, b.geom, b.approx_latitude, b.approx_longitude, b.neighborhood
  FROM public.bounties b
  WHERE NULLIF(btrim(b.location), '') IS NOT NULL
     OR b.latitude IS NOT NULL OR b.longitude IS NOT NULL
     OR NULLIF(btrim(b.unit), '') IS NOT NULL OR b.geom IS NOT NULL
     OR b.neighborhood IS NOT NULL
  ON CONFLICT (bounty_id) DO NOTHING;
  GET DIAGNOSTICS v_snap = ROW_COUNT;

  -- 7b. Exact values into private storage. geom-only rows (no lat/lng) are
  -- treated as exact too.
  INSERT INTO public.bounty_private_locations (bounty_id, address, unit, latitude, longitude, source)
  SELECT b.id,
         NULLIF(btrim(b.location), ''),
         NULLIF(btrim(b.unit), ''),
         CASE WHEN b.latitude IS NOT NULL AND b.longitude IS NOT NULL THEN b.latitude
              WHEN b.geom IS NOT NULL THEN ST_Y(b.geom::geometry) END,
         CASE WHEN b.latitude IS NOT NULL AND b.longitude IS NOT NULL THEN b.longitude
              WHEN b.geom IS NOT NULL THEN ST_X(b.geom::geometry) END,
         'backfill'
  FROM public.bounties b
  WHERE NULLIF(btrim(b.location), '') IS NOT NULL
     OR (b.latitude IS NOT NULL AND b.longitude IS NOT NULL)
     OR NULLIF(btrim(b.unit), '') IS NOT NULL
     OR b.geom IS NOT NULL
  ON CONFLICT (bounty_id) DO NOTHING;
  GET DIAGNOSTICS v_priv = ROW_COUNT;

  -- 7c. Scrub the public row with user triggers off, so the backfill sends no
  -- notifications, bumps no updated_at and -- most importantly -- broadcasts
  -- no OLD row (with the exact address) through bounties_broadcast_trigger.
  FOR v_trig IN
    SELECT t.tgname, t.tgenabled
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.bounties'::regclass
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  LOOP
    EXECUTE format('ALTER TABLE public.bounties DISABLE TRIGGER %I', v_trig.tgname);
    v_disabled := v_disabled || jsonb_build_object('name', v_trig.tgname, 'mode', v_trig.tgenabled::text);
  END LOOP;

  -- Same reason for logical replication: with REPLICA IDENTITY FULL, realtime
  -- UPDATE events carry the old row. DEFAULT sends only the key.
  SELECT c.relreplident INTO v_replident FROM pg_class c WHERE c.oid = 'public.bounties'::regclass;
  IF v_replident = 'f' THEN
    ALTER TABLE public.bounties REPLICA IDENTITY DEFAULT;
  END IF;

  UPDATE public.bounties b
  SET location = CASE
        WHEN NULLIF(btrim(b.location), '') IS NULL THEN b.location
        ELSE COALESCE(public.fn_public_location_label(b.location),
                      public.fn_public_neighborhood(b.neighborhood),
                      '')
      END,
      neighborhood     = public.fn_public_neighborhood(b.neighborhood),
      latitude         = NULL,
      longitude        = NULL,
      unit             = NULL,
      approx_latitude  = x.approx_lat,
      approx_longitude = x.approx_lng,
      geom = CASE WHEN x.approx_lat IS NOT NULL
                  THEN ST_SetSRID(ST_MakePoint(x.approx_lng, x.approx_lat), 4326)::geography END
  FROM (
    SELECT b2.id,
           CASE
             WHEN p.latitude IS NULL THEN NULL
             -- Keep an existing jitter only if it really is >= 100 m away.
             WHEN b2.approx_latitude IS NOT NULL AND b2.approx_longitude IS NOT NULL
                  AND ST_Distance(ST_SetSRID(ST_MakePoint(b2.approx_longitude, b2.approx_latitude), 4326)::geography,
                                  ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography) >= 100
               THEN b2.approx_latitude
             ELSE p.latitude + (j.r * cos(j.a)) / 111320.0
           END AS approx_lat,
           CASE
             WHEN p.latitude IS NULL THEN NULL
             WHEN b2.approx_latitude IS NOT NULL AND b2.approx_longitude IS NOT NULL
                  AND ST_Distance(ST_SetSRID(ST_MakePoint(b2.approx_longitude, b2.approx_latitude), 4326)::geography,
                                  ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography) >= 100
               THEN b2.approx_longitude
             ELSE p.longitude + (j.r * sin(j.a)) / (111320.0 * cos(radians(p.latitude)))
           END AS approx_lng
    FROM public.bounties b2
    LEFT JOIN public.bounty_private_locations p ON p.bounty_id = b2.id
    CROSS JOIN LATERAL (SELECT random() * 2 * pi() AS a, 120 + random() * 230 AS r, b2.id AS _dep) j
  ) x
  WHERE x.id = b.id
    AND (NULLIF(btrim(b.location), '') IS NOT NULL
         OR b.latitude IS NOT NULL OR b.longitude IS NOT NULL
         OR b.unit IS NOT NULL OR b.geom IS NOT NULL
         OR b.neighborhood IS NOT NULL
         OR b.approx_latitude IS NOT NULL);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

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

  RETURN v_counts || jsonb_build_object(
    'dry_run', false,
    'snapshot_rows_written', v_snap,
    'private_rows_written', v_priv,
    'bounty_rows_scrubbed', v_rows,
    'triggers_paused', jsonb_array_length(v_disabled),
    'replica_identity_was', v_replident::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_backfill_bounty_location_privacy(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_backfill_bounty_location_privacy(boolean) TO service_role;

DO $$
DECLARE
  v_dry  jsonb;
  v_done jsonb;
BEGIN
  v_dry := public.fn_backfill_bounty_location_privacy(true);
  RAISE NOTICE 'location privacy backfill (dry run): %', v_dry;
  v_done := public.fn_backfill_bounty_location_privacy(false);
  RAISE NOTICE 'location privacy backfill (applied): %', v_done;
END $$;

-- ─── 8. Post-conditions (abort the whole migration if any fail) ───────────
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.bounties
  WHERE latitude IS NOT NULL OR longitude IS NOT NULL OR unit IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'location privacy: % bounties still carry exact latitude/longitude/unit', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.bounties WHERE location ~ '[0-9#]';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'location privacy: % bounties still have digits in public location', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.bounties b
  JOIN public.bounty_private_locations p ON p.bounty_id = b.id
  WHERE p.latitude IS NOT NULL AND b.geom IS NOT NULL
    AND ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography) < 100;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'location privacy: % bounties have geom within 100 m of the exact point', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.bounty_location_backfill_snapshot s
  LEFT JOIN public.bounty_private_locations p ON p.bounty_id = s.bounty_id
  WHERE NULLIF(btrim(s.location), '') IS NOT NULL
    AND p.address IS DISTINCT FROM NULLIF(btrim(s.location), '')
    AND p.source = 'backfill';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'location privacy: % backfilled addresses do not match the snapshot', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM pg_trigger
  WHERE tgrelid = 'public.bounties'::regclass AND tgenabled = 'O'
    AND tgname IN ('zz_bounties_privatize_location', 'zz_bounties_store_private_location');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'location privacy: privatize/store triggers are not both enabled';
  END IF;

  IF has_table_privilege('authenticated', 'public.bounty_private_locations', 'SELECT')
     OR has_table_privilege('anon', 'public.bounty_private_locations', 'SELECT')
     OR has_function_privilege('anon', 'public.get_bounty_exact_location(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'location privacy: private storage is reachable by anon/authenticated';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
