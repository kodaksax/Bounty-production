-- Migration: Applicant distance on in-person applications (SBA-02, server side)
-- Created: 2026-10-19
--
-- PROBLEM (docs/audits/shoal-behavioral-audit.md, SBA-02):
--   Of 18 applications to genuine in-person bounties where both locations are
--   known, none came from within 50 miles (median 1,504 mi). The BEFORE
--   triggers on bounty_requests check only that the bounty is open and the ID
--   requirement, so nothing records, let alone limits, how far an applicant is
--   from the job. A poster opening "10 applicants" cannot tell who can come.
--
-- DECISION (product, 2026-10-19): FLAG, don't block. In-person applications
-- from beyond 50 miles are stored with is_far = true and still accepted.
-- Online jobs never get a distance.
--
-- WHAT THIS DOES
--   1. bounty_requests gains:
--        distance_mi          integer  whole miles, 0 = "under 1 mile",
--                                      NULL = online job or a side has no location
--        is_far               boolean  distance_mi > 50
--        distance_computed_at timestamptz  when the two values were computed
--                                      (NULL = never; pre-existing rows with no
--                                      measurable distance)
--   2. zz_bounty_requests_applicant_distance (BEFORE INSERT OR UPDATE, runs
--      last) computes them at application time. Values a client sends are
--      ignored, and on UPDATE they are kept from OLD unless the row is moved
--      to another bounty or hunter -- posters hold an UPDATE policy on their
--      bounties' requests, so this is what stops them rewriting the flag.
--   3. Existing rows with a measurable distance are backfilled (see 5).
--   4. bounty_requests_broadcast_changes() masks the three columns in the
--      realtime payload (see PRIVACY).
--
-- PRIVACY
--   * Job side: bounties.geom is already the approximate point (120-350 m
--     jitter, never re-rolled) written by zz_bounties_privatize_location
--     (20261001160000); the exact point lives in bounty_private_locations and
--     is never read here. A hunter learns nothing beyond the public
--     approx_latitude/approx_longitude they can already read.
--   * Hunter side: profiles.latitude/longitude are device-precise (every live
--     row has > 4 decimal places) and are readable only by their owner. A
--     poster could post several bounties and trilaterate an applicant from
--     repeated whole-mile distances, so the hunter's point is snapped to a
--     0.01 degree grid (~1 km) before measuring. Repeated measurements then
--     converge on the grid cell, never on the hunter. Combined with whole-mile
--     rounding, the poster learns no more than "which ~1 km square".
--   * Who can read the columns: exactly who can already read the row --
--     the poster of the bounty, the applicant, and admins (bounty_requests
--     SELECT policies; the Node API filters to hunter-or-poster too). Clients
--     fetch applicants with select('*'), so installed builds receive the
--     values without an app update. profiles RLS is not touched.
--   * Realtime: on production, realtime.messages lets EVERY applicant to a
--     bounty receive its 'bounty:<id>' broadcasts, and the broadcast carries
--     the full row. Without masking, applicants would see each other's
--     distance. No client consumes these broadcast payloads (they refetch).
--     postgres_changes applies table RLS per subscriber and needs no change.
--   * fn_bounty_request_distance() answers "how far is any hunter from any
--     job", so it is executable by nobody but the table owner/service_role.
--
-- Rollback: supabase/rollbacks/production/20261019200000_applicant_distance.down.sql

BEGIN;

-- ─── 0. Preconditions ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t || '.' || c, ', ') INTO v_missing
  FROM (VALUES ('bounties', 'geom'), ('bounties', 'work_type'), ('profiles', 'geom'),
               ('bounty_requests', 'bounty_id'), ('bounty_requests', 'hunter_id')) AS req(t, c)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = req.t AND column_name = req.c
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'applicant distance: missing column(s): %', v_missing;
  END IF;

  -- bounties.geom must already be the approximate point.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.bounties'::regclass
      AND tgname = 'zz_bounties_privatize_location' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'applicant distance: zz_bounties_privatize_location is missing; apply 20261001160000 first';
  END IF;

  -- The backfill below suspends this trigger by name.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.bounty_requests'::regclass
      AND tgname = 'trg_bounty_requests_updated_at' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'applicant distance: trg_bounty_requests_updated_at is missing';
  END IF;
END $$;

-- ─── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE public.bounty_requests
  ADD COLUMN IF NOT EXISTS distance_mi integer,
  ADD COLUMN IF NOT EXISTS is_far boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS distance_computed_at timestamptz;

ALTER TABLE public.bounty_requests
  DROP CONSTRAINT IF EXISTS bounty_requests_distance_mi_check;
ALTER TABLE public.bounty_requests
  ADD CONSTRAINT bounty_requests_distance_mi_check
  CHECK (distance_mi IS NULL OR distance_mi >= 0);

COMMENT ON COLUMN public.bounty_requests.distance_mi IS
  'SBA-02. Whole miles from the applicant (profiles.geom snapped to a 0.01 degree grid) to the job''s approximate point (bounties.geom), computed at application time. 0 = under 1 mile. NULL = online job, or either side had no location.';
COMMENT ON COLUMN public.bounty_requests.is_far IS
  'SBA-02. distance_mi > 50. Flag only: far in-person applications are allowed (product decision 2026-10-19).';
COMMENT ON COLUMN public.bounty_requests.distance_computed_at IS
  'SBA-02. When distance_mi/is_far were computed. Later than created_at for rows backfilled by 20261019200000 from the locations at that time.';

-- ─── 2. Distance (single source of truth) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bounty_request_distance(
  p_bounty_id uuid,
  p_hunter_id uuid,
  OUT distance_mi integer,
  OUT is_far boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_job    geography;
  v_hunter geography;
  v_mi     double precision;
BEGIN
  distance_mi := NULL;
  is_far := false;

  -- bounties.geom is the approximate point (zz_bounties_privatize_location).
  SELECT b.geom INTO v_job
  FROM public.bounties b
  WHERE b.id = p_bounty_id
    AND b.work_type = 'in_person';
  IF v_job IS NULL THEN
    RETURN;
  END IF;

  -- Device-precise point coarsened to a ~1 km cell before it is measured.
  SELECT ST_SnapToGrid(p.geom::geometry, 0.01)::geography INTO v_hunter
  FROM public.profiles p
  WHERE p.id = p_hunter_id;
  IF v_hunter IS NULL THEN
    RETURN;
  END IF;

  v_mi := ST_Distance(v_job, v_hunter) / 1609.344;
  distance_mi := CASE WHEN v_mi < 1 THEN 0 ELSE round(v_mi)::integer END;
  is_far := distance_mi > 50;
END;
$$;

COMMENT ON FUNCTION public.fn_bounty_request_distance(uuid, uuid) IS
  'SBA-02. Rounded applicant-to-job distance for an in-person bounty. A location oracle for any (bounty, hunter) pair: never grant to clients.';

REVOKE ALL ON FUNCTION public.fn_bounty_request_distance(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bounty_request_distance(uuid, uuid) TO service_role;

-- ─── 3. Stamp on application ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bounty_requests_stamp_distance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Stored once, at application time. Nobody rewrites it in place: the
  -- poster's UPDATE policy covers every column of their bounties' requests.
  -- A hunter_id cleared by account deletion (ON DELETE SET NULL) keeps the
  -- values, so the weekly share does not lose deleted applicants.
  IF TG_OP = 'UPDATE'
     AND NEW.bounty_id IS NOT DISTINCT FROM OLD.bounty_id
     AND (NEW.hunter_id IS NOT DISTINCT FROM OLD.hunter_id OR NEW.hunter_id IS NULL) THEN
    NEW.distance_mi := OLD.distance_mi;
    NEW.is_far := OLD.is_far;
    NEW.distance_computed_at := OLD.distance_computed_at;
    RETURN NEW;
  END IF;

  -- INSERT (or a move to another bounty/hunter): whatever the client sent is
  -- discarded and recomputed.
  SELECT d.distance_mi, d.is_far
    INTO NEW.distance_mi, NEW.is_far
  FROM public.fn_bounty_request_distance(NEW.bounty_id, NEW.hunter_id) d;
  NEW.is_far := COALESCE(NEW.is_far, false);
  NEW.distance_computed_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bounty_requests_stamp_distance() FROM PUBLIC, anon, authenticated;

-- ─── 4. Mask the realtime broadcast ────────────────────────────────────────
-- Captured from the live database (identical on production and staging,
-- md5 ee307e3c21a06a4389eaa072f43bde81; it had no source in git). Only change:
-- the three distance columns are nulled in the payload.
CREATE OR REPLACE FUNCTION public.bounty_requests_broadcast_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
declare
  v_bounty_id uuid;
  v_new public.bounty_requests;
  v_old public.bounty_requests;
begin
  v_bounty_id := coalesce(new.bounty_id, old.bounty_id);

  -- Every applicant to the bounty can receive this topic (realtime.messages
  -- policy bounty_participants_can_receive_broadcasts), so the applicant's
  -- distance must not ride along. SBA-02.
  v_new := new;
  v_new.distance_mi := null;
  v_new.is_far := null;
  v_new.distance_computed_at := null;

  if tg_op = 'INSERT' then
    perform realtime.broadcast_changes(
      'bounty:' || v_bounty_id::text,
      'applied',
      tg_op,
      tg_table_name,
      tg_table_schema,
      v_new,
      v_old  -- NULL on INSERT, as OLD was
    );
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      v_old := old;
      v_old.distance_mi := null;
      v_old.is_far := null;
      v_old.distance_computed_at := null;
      perform realtime.broadcast_changes(
        'bounty:' || v_bounty_id::text,
        'application_status_changed',
        tg_op,
        tg_table_name,
        tg_table_schema,
        v_new,
        v_old
      );
    end if;
  end if;

  return null;
end;
$function$;

REVOKE ALL ON FUNCTION public.bounty_requests_broadcast_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bounty_requests_broadcast_changes() TO service_role;

-- ─── 5. Backfill ───────────────────────────────────────────────────────────
-- Every existing row with a measurable distance, not only pending ones: it is
-- ~800 rows, and it gives the weekly query a pre-deploy baseline. These rows
-- use the locations as they are now (as the audit's own query did), which
-- distance_computed_at > created_at makes visible.
--
-- Runs BEFORE the stamp trigger exists (that trigger would keep OLD values),
-- and with trg_bounty_requests_updated_at suspended so updated_at is not
-- bumped on every row. No other trigger acts on an UPDATE that leaves status
-- and bounty_id unchanged. Rows without a hunter are skipped, which also
-- keeps the NOT VALID bounty_requests_hunter_id_present check out of play.
ALTER TABLE public.bounty_requests DISABLE TRIGGER trg_bounty_requests_updated_at;

UPDATE public.bounty_requests r
SET distance_mi = x.distance_mi,
    is_far = x.is_far,
    distance_computed_at = now()
FROM (
  SELECT r2.id, d.distance_mi, d.is_far
  FROM public.bounty_requests r2
  JOIN public.bounties b ON b.id = r2.bounty_id
  JOIN public.profiles p ON p.id = r2.hunter_id
  CROSS JOIN LATERAL public.fn_bounty_request_distance(r2.bounty_id, r2.hunter_id) d
  WHERE b.work_type = 'in_person'
    AND b.geom IS NOT NULL
    AND p.geom IS NOT NULL
    AND r2.distance_computed_at IS NULL
) x
WHERE r.id = x.id;

ALTER TABLE public.bounty_requests ENABLE TRIGGER trg_bounty_requests_updated_at;

-- ─── 6. Trigger ────────────────────────────────────────────────────────────
-- "zz_" so it runs after every other BEFORE trigger and nothing overwrites it.
DROP TRIGGER IF EXISTS zz_bounty_requests_applicant_distance ON public.bounty_requests;
CREATE TRIGGER zz_bounty_requests_applicant_distance
  BEFORE INSERT OR UPDATE ON public.bounty_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_bounty_requests_stamp_distance();

-- ─── 7. Postconditions ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_role text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.bounty_requests'::regclass
      AND tgname = 'zz_bounty_requests_applicant_distance' AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'applicant distance: stamp trigger missing or disabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.bounty_requests'::regclass
      AND tgname = 'trg_bounty_requests_updated_at' AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'applicant distance: trg_bounty_requests_updated_at was not re-enabled';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.fn_bounty_request_distance(uuid,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'applicant distance: % can execute fn_bounty_request_distance', v_role;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.bounty_requests
    WHERE distance_mi IS NOT NULL AND is_far IS DISTINCT FROM (distance_mi > 50)
  ) THEN
    RAISE EXCEPTION 'applicant distance: is_far disagrees with distance_mi after backfill';
  END IF;
END $$;

COMMIT;
