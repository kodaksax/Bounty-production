-- =====================================================================
-- profiles.is_internal + bounties.is_test
--
-- Problem (measured 2026-09-12): 54.5% of external-hunter requests over 30
-- days (58/104 in the last 7) landed on bounties owned by the 14 internal/
-- test profiles -- the team QA-ing the task-template library directly in the
-- production feed. Every one of those costs a real hunter a real
-- application, which then joins the 85.6% no-response bucket.
--
-- profiles.is_internal is the single source of truth this migration
-- introduces -- no email LIKE pattern should ever be written again after
-- this. bounties.is_test is derived from it at insert time and is what
-- actually gates feed/search/notification visibility.
-- =====================================================================

BEGIN;

-- ─── profiles.is_internal ──────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_internal IS
  'True for the team''s own accounts used to QA/seed the app (matches the canonical internal-account list). Single source of truth for "is this a real user" -- bounties.is_test is derived from this at insert time via fn_bounties_default_is_test. Never derive this ad hoc from an email pattern elsewhere; update this column instead.';

-- Backfill: the 14 canonical internal accounts, matched by profiles.email.
-- Deliberately narrow -- exact addresses plus two literal-domain patterns
-- (@bountyfinder*, @example.com) that cannot false-positive on a real user's
-- personal domain. A prior draft of this backfill also matched `%test%`
-- anywhere in the address; that's broad enough to mark real signups like
-- "contest@…", "latest@…", or "attester@…" as internal, so it's excluded
-- here on purpose. testuser_diag99@test.com is still covered because it's in
-- the exact-address list below, not via a pattern.
UPDATE public.profiles
SET is_internal = true
WHERE is_internal = false
  AND (
    lower(email) IN (
      'leewright093@gmail.com', 'jordanmag11@yahoo.com', 'posterbnty158@gmail.com',
      'maglalangjordan4@gmail.com', 'maglalangjordn4@gmail.com', 'maglalangjordan@gmail.com',
      'jordanm4@umbc.edu', 'nickel681@gmail.com', 'wrightangelique07@gmail.com',
      'work.angeliquew@gmail.com', 'jordancooper555@gmail.com', 'ralphjordan73@gmail.com',
      'test@example.com', 'testuser_diag99@test.com'
    )
    OR email ILIKE '%@bountyfinder%'
    OR email ILIKE '%@example.com'
  );

-- ─── bounties.is_test ───────────────────────────────────────────────────────
ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bounties.is_test IS
  'True for bounties owned by an internal/QA account. Defaulted at insert time by fn_bounties_default_is_test based on the poster''s profiles.is_internal -- not hand-set by app code. Filtered out of the hunter feed, search, and nearby-bounty notifications unless the viewer is internal and has opted in to seeing test content.';

-- Feed's dominant predicate is `status = 'open' AND is_test = false`, sorted
-- by created_at -- a partial index scoped to exactly that predicate (mirroring
-- idx_bounties_open_feed from 20260320_open_feed_covering_index.sql, which
-- predates is_test and so can't filter on it) rather than a general
-- (status, is_test) composite: only open+non-test rows are indexed at all, so
-- the index stays smaller and the feed query needs no separate filter recheck
-- against rows the index would otherwise have matched by status alone.
CREATE INDEX IF NOT EXISTS idx_bounties_open_not_test ON public.bounties (created_at DESC)
  INCLUDE (title, amount, category, poster_id)
  WHERE status = 'open' AND is_test = false;

-- Backfill: every existing bounty owned by an internal profile. Counted
-- before writing (98 of 152 total) -- see conversation. Per-row, not a single
-- bulk UPDATE: live data has at least one bounty that already violates
-- bounties_open_implies_unassigned (a NOT VALID constraint from
-- 20260911000000_marketplace_state_integrity.sql that never revalidated
-- pre-existing rows -- same landmine documented in
-- 20260912143515_bounty_quality_score_and_poster_nudges.sql's own backfill).
-- A single UPDATE touching multiple rows fails atomically on that one bad
-- row, which would silently block every other bounty from being backfilled.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT b.id
    FROM public.bounties b
    WHERE b.is_test = false
      AND COALESCE(b.poster_id, b.user_id) IN (
        SELECT id FROM public.profiles WHERE is_internal = true
      )
  LOOP
    BEGIN
      UPDATE public.bounties SET is_test = true WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'is_test backfill: skipping bounty % after error: %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ─── Default is_test = true on insert when the poster is internal ─────────
-- A BEFORE INSERT trigger (not a column default referencing another table,
-- which Postgres doesn't support) so every writer -- client, admin client,
-- edge function, future ones -- gets this without individually opting in.
--
-- Intentional, not incidental: an internal poster can never create a
-- non-test bounty through this path, full stop. `NEW.is_test IS NOT TRUE`
-- overrides both an unset column and an explicit `is_test = false` from the
-- caller, because Postgres materializes column defaults before a BEFORE
-- INSERT trigger ever runs -- by the time this fires there is no way to tell
-- "caller explicitly passed false" apart from "caller passed nothing, so it
-- defaulted to false". Since that distinction isn't observable from a plain
-- column default, the only sound choice is to key entirely off the poster's
-- identity: every bounty from an internal poster is test content, and only a
-- caller-supplied `is_test = true` is ever left alone (because it's already
-- what this trigger would have set). If a real (is_test = false) bounty from
-- an internal account is ever needed, it requires a different mechanism (e.g.
-- an explicit override flag on a dedicated insert path), not a change to
-- this guard's condition.
CREATE OR REPLACE FUNCTION public.fn_bounties_default_is_test()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_internal boolean;
BEGIN
  IF NEW.is_test IS NOT TRUE THEN
    SELECT is_internal INTO v_internal
    FROM public.profiles
    WHERE id = COALESCE(NEW.poster_id, NEW.user_id);
    NEW.is_test := COALESCE(v_internal, false);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bounties_default_is_test() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bounties_default_is_test() FROM anon;

DROP TRIGGER IF EXISTS trg_bounties_default_is_test ON public.bounties;
CREATE TRIGGER trg_bounties_default_is_test
  BEFORE INSERT ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounties_default_is_test();

-- ─── search_bounties_nearby: filter test bounties, gated toggle for internal
-- accounts only. p_include_test is honored only when the calling user
-- (auth.uid()) is themselves internal -- an external caller passing
-- p_include_test=true cannot see internal QA content just by asking.
--
-- Explicit DROP first: adding a trailing parameter via CREATE OR REPLACE
-- does not replace the old 6-arg function in place -- Postgres identifies a
-- function by (name, argument types), so a 7th parameter makes a distinct
-- overload and the old, unfiltered 6-arg version would keep existing
-- alongside it.
DROP FUNCTION IF EXISTS public.search_bounties_nearby(double precision, double precision, double precision, text, integer, integer);

CREATE OR REPLACE FUNCTION public.search_bounties_nearby(
  p_lat double precision DEFAULT NULL::double precision,
  p_lng double precision DEFAULT NULL::double precision,
  p_radius_miles double precision DEFAULT NULL::double precision,
  p_category text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_include_test boolean DEFAULT false
)
RETURNS TABLE(id uuid, title text, description text, amount numeric, is_for_honor boolean, category text, status bounty_status_enum, neighborhood text, approx_latitude double precision, approx_longitude double precision, poster_id uuid, username text, avatar text, created_at timestamp with time zone, deadline timestamp with time zone, distance_miles double precision)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    b.id, b.title, b.description, b.amount, b.is_for_honor, b.category, b.status,
    b.neighborhood, b.approx_latitude, b.approx_longitude, b.poster_id, b.username, b.avatar,
    b.created_at, b.deadline,
    CASE
      WHEN b.geom IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
      THEN ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) / 1609.344
      ELSE NULL
    END AS distance_miles
  FROM public.bounties b
  WHERE b.status = 'open'
    AND (p_category IS NULL OR b.category = p_category)
    AND (
      b.is_test = false
      OR (
        p_include_test
        AND EXISTS (SELECT 1 FROM public.profiles ip WHERE ip.id = auth.uid() AND ip.is_internal)
      )
    )
    AND (
      p_radius_miles IS NULL
      OR (
        b.geom IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
        AND ST_DWithin(
          b.geom,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
          p_radius_miles * 1609.344
        )
      )
    )
  ORDER BY
    (CASE
      WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND b.geom IS NOT NULL
      THEN ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography)
    END) ASC NULLS LAST,
    b.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100)
  OFFSET GREATEST(p_offset, 0);
$function$;

-- ─── Nearby-bounty push notifications: skip test bounties entirely ─────────
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
  -- Test bounties never page a real hunter, regardless of match quality.
  IF COALESCE(NEW.is_test, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.zip_code IS NULL OR btrim(NEW.zip_code) = '' THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT jsonb_agg(id)
  INTO v_recipients
  FROM public.profiles
  WHERE zip_code = NEW.zip_code
    AND id IS DISTINCT FROM v_poster_id;

  IF v_recipients IS NULL OR jsonb_array_length(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  VALUES (
    v_recipients,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted in your ZIP code (' || NEW.zip_code || ').',
    jsonb_build_object('bounty_id', NEW.id, 'type', 'bounty_nearby', 'zip_code', NEW.zip_code),
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

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
  -- Test bounties never page a real hunter, regardless of match quality.
  IF COALESCE(NEW.is_test, false) THEN
    RETURN NEW;
  END IF;

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

-- ─── Liquidity escalation sweep: never re-broadcast a test bounty ──────────
-- Same candidate set as 20260912152257, with one added guard
-- (NOT COALESCE(b.is_test, false)) so a QA bounty that never gets an
-- application doesn't get pushed to real hunters every 2h/12h forever.
CREATE OR REPLACE FUNCTION public.fn_escalate_stale_bounty_liquidity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_bounty     record;
  v_candidates uuid[];
  v_poster_id  uuid;
BEGIN
  FOR v_bounty IN
    SELECT b.id, b.title, b.category, b.amount, b.is_for_honor, b.geom, b.zip_code,
           b.work_type, b.liquidity_stage, b.created_at, b.liquidity_last_escalated_at,
           b.poster_id, b.user_id, b.quality_score, b.quality_nudge_stage
    FROM public.bounties b
    WHERE b.status = 'open'
      AND b.liquidity_stage BETWEEN 1 AND 2
      AND NOT COALESCE(b.is_test, false)
      AND NOT EXISTS (SELECT 1 FROM public.bounty_requests br WHERE br.bounty_id = b.id)
      AND (
        (b.liquidity_stage = 1
           AND b.created_at < now() - interval '2 hours'
           AND (b.liquidity_last_escalated_at IS NULL OR b.liquidity_last_escalated_at < now() - interval '2 hours'))
        OR
        (b.liquidity_stage = 2
           AND b.liquidity_last_escalated_at IS NOT NULL
           AND b.liquidity_last_escalated_at < now() - interval '12 hours')
      )
  LOOP
    BEGIN
    v_poster_id := COALESCE(v_bounty.poster_id, v_bounty.user_id);
    v_candidates := NULL;

    IF v_bounty.work_type = 'online' THEN
      SELECT array_agg(p.id) INTO v_candidates
      FROM public.profiles p
      WHERE p.deleted_at IS NULL
        AND p.id IS DISTINCT FROM v_poster_id;

    ELSIF v_bounty.geom IS NOT NULL THEN
      IF v_bounty.liquidity_stage = 1 THEN
        SELECT array_agg(DISTINCT p.id) INTO v_candidates
        FROM public.profiles p
        JOIN public.hunter_service_areas hsa ON hsa.hunter_id = p.id
        WHERE p.deleted_at IS NULL
          AND hsa.hunter_id IS DISTINCT FROM v_poster_id
          AND hsa.latitude IS NOT NULL AND hsa.longitude IS NOT NULL
          AND (
            (hsa.radius_miles IS NOT NULL
               AND ST_DWithin(v_bounty.geom,
                               ST_SetSRID(ST_MakePoint(hsa.longitude, hsa.latitude), 4326)::geography,
                               hsa.radius_miles * 1609.344 * 2))
            OR (hsa.radius_miles IS NULL
                AND (v_bounty.amount >= 15 OR NOT v_bounty.is_for_honor)
                AND ST_DWithin(v_bounty.geom,
                                ST_SetSRID(ST_MakePoint(hsa.longitude, hsa.latitude), 4326)::geography,
                                40 * 1609.344))
          );
      ELSE
        SELECT array_agg(p.id) INTO v_candidates
        FROM public.profiles p
        WHERE p.deleted_at IS NULL
          AND p.id IS DISTINCT FROM v_poster_id
          AND p.geom IS NOT NULL
          AND ST_DWithin(v_bounty.geom, p.geom, 50 * 1609.344);
      END IF;
    END IF;

    PERFORM public.fn_score_and_dispatch_bounty_notification(
      v_bounty.id,
      v_candidates,
      (v_bounty.liquidity_stage + 1)::smallint,
      CASE WHEN v_bounty.liquidity_stage = 1 THEN 'Still looking for someone' ELSE 'This job still needs a hunter' END,
      '"' || v_bounty.title || '" hasn''t found a hunter yet — want to take a look?',
      jsonb_build_object('match', 'liquidity_escalation')
    );

    IF v_bounty.liquidity_stage = 1
       AND COALESCE(v_bounty.quality_score, 100) < 70
       AND COALESCE(v_bounty.quality_nudge_stage, 0) < 2
       AND v_poster_id IS NOT NULL
    THEN
      INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
      VALUES (
        jsonb_build_array(v_poster_id),
        'Your bounty hasn''t gotten much attention yet',
        'Adding a few more details may help the right hunter understand the job and decide it''s a fit.',
        jsonb_build_object('type', 'bounty_quality_nudge', 'bountyId', v_bounty.id, 'stage', 2, 'qualityScore', v_bounty.quality_score),
        v_bounty.id::text
      );
      UPDATE public.bounties SET quality_nudge_stage = 2 WHERE id = v_bounty.id;
    END IF;

    UPDATE public.bounties
    SET liquidity_stage = v_bounty.liquidity_stage + 1,
        liquidity_last_escalated_at = now()
    WHERE id = v_bounty.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_escalate_stale_bounty_liquidity: skipping bounty % after error: %', v_bounty.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

COMMIT;
