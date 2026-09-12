-- Two impossible marketplace states, made impossible.
--
-- WHY
-- ---
-- Both were found live in production on 2026-09-10 by the launch-readiness
-- audit, and both are invisible to the app because nothing forbids them.
--
-- 1. A bounty that is simultaneously `open` and assigned.
--    `2a39dbf2` ("Move a couch", $1) went to status='open' on 09-08 while
--    keeping accepted_by, and stayed in the browse feed: BROWSABLE_BOUNTY_
--    STATUSES includes 'open' and the feed query never excludes rows carrying
--    an accepted_by (lib/services/bounty-service.ts). Seven more hunters
--    applied to a job that was already taken, and the poster's $1 stayed in
--    escrow throughout.
--
-- 2. Two hunters both "accepted" on one bounty.
--    `81f90076` carries two accepted requests naming two different hunters,
--    only one of whom is the bounty's accepted_by. Three bounties are in this
--    state. Nothing in the schema says a bounty has at most one accepted
--    applicant.
--
-- Related: `bounty_requests.hunter_id` is nullable while poster_id is NOT NULL
-- — backwards for an applications table. 50 rows have no applicant at all and
-- 28 of those are 'accepted'. The service layer now refuses to create them
-- (lib/services/bounty-request-service.ts); this stops the database accepting
-- them from any other writer.
--
-- WHY `NOT VALID`
-- ---------------
-- Existing rows violate all three rules. A plain CHECK would abort this
-- migration on production. `NOT VALID` enforces the rule on every INSERT and
-- UPDATE from now on while tolerating the historical rows, which is exactly
-- the property wanted: stop the bleeding now, clean up deliberately, then run
-- the VALIDATE statements at the bottom of this file.
--
-- The one exception is the unique index in section 3, which cannot be added
-- NOT VALID. It needs the three duplicate rows resolved first — see the
-- warning on that section before applying.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A bounty in the feed as `open` must not already be assigned
-- ---------------------------------------------------------------------------

ALTER TABLE public.bounties
  DROP CONSTRAINT IF EXISTS bounties_open_implies_unassigned;

ALTER TABLE public.bounties
  ADD CONSTRAINT bounties_open_implies_unassigned
  CHECK (status <> 'open'::bounty_status_enum OR accepted_by IS NULL)
  NOT VALID;

COMMENT ON CONSTRAINT bounties_open_implies_unassigned ON public.bounties IS
  'An open bounty is claimable, so it cannot already have a worker. Added NOT VALID on 2026-09-11: one production row (2a39dbf2) predates it.';

-- Any route back to `open` releases the worker with it. Without this the
-- constraint above would simply reject the transition, turning a state bug
-- into a write failure for whichever path performs it — and the audit could
-- not identify that path, because `bounty_events` does not exist in
-- production and no admin_action_log row references the bounty.
CREATE OR REPLACE FUNCTION public.fn_bounties_clear_worker_when_reopened()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'open'::bounty_status_enum
     AND NEW.accepted_by IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    NEW.accepted_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bounties_clear_worker_when_reopened() FROM PUBLIC;
-- Supabase auto-grants EXECUTE on new functions to both `anon` and
-- `authenticated`, and REVOKE FROM PUBLIC removes neither — see the existing
-- pattern throughout this migration set (e.g. 20260816221500,
-- 20260823120000). This function is a trigger body and gains nothing from
-- being directly callable, so both are revoked explicitly rather than relying
-- on "a trigger function isn't meaningfully callable anyway".
REVOKE ALL ON FUNCTION public.fn_bounties_clear_worker_when_reopened() FROM anon;
REVOKE ALL ON FUNCTION public.fn_bounties_clear_worker_when_reopened() FROM authenticated;

DROP TRIGGER IF EXISTS trg_bounties_clear_worker_when_reopened ON public.bounties;
CREATE TRIGGER trg_bounties_clear_worker_when_reopened
  BEFORE INSERT OR UPDATE OF status, accepted_by ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounties_clear_worker_when_reopened();

COMMENT ON FUNCTION public.fn_bounties_clear_worker_when_reopened() IS
  'Reopening a bounty releases its worker, so bounties_open_implies_unassigned can never be tripped by a legitimate transition.';

-- ---------------------------------------------------------------------------
-- 2. An application must name its applicant
-- ---------------------------------------------------------------------------

ALTER TABLE public.bounty_requests
  DROP CONSTRAINT IF EXISTS bounty_requests_hunter_id_present;

ALTER TABLE public.bounty_requests
  ADD CONSTRAINT bounty_requests_hunter_id_present
  CHECK (hunter_id IS NOT NULL)
  NOT VALID;

COMMENT ON CONSTRAINT bounty_requests_hunter_id_present ON public.bounty_requests IS
  'An application with no applicant is unusable and can still be accepted by a poster. Added NOT VALID on 2026-09-11: 50 production rows predate it, 28 of them already accepted.';

COMMIT;

-- ---------------------------------------------------------------------------
-- 3. At most one accepted applicant per bounty      ** READ BEFORE APPLYING **
-- ---------------------------------------------------------------------------
--
-- This section CHANGES EXISTING ROWS. A unique index cannot be created
-- NOT VALID, so the three bounties that currently carry two or more accepted
-- applications have to be resolved first. The rule below is deterministic:
-- keep the application whose hunter matches the bounty's own accepted_by, and
-- if none matches keep the earliest; demote the rest to 'rejected'.
--
-- That is a real, user-visible demotion for up to four people who were told
-- they had the job. Decide that deliberately. To apply the constraints in
-- section 1 and 2 only, stop here — they stand on their own.

BEGIN;

WITH ranked AS (
  SELECT r.id,
         r.poster_id,
         row_number() OVER (
           PARTITION BY r.bounty_id
           ORDER BY
             -- Tier 1: a real applicant always outranks an orphaned row.
             -- `bounty_requests.hunter_id` is nullable — the same defect
             -- fixed elsewhere in this migration and in
             -- bountyRequestService.create() — so some 'accepted' rows have
             -- no hunter at all. The original `accepted_by IS NOT DISTINCT
             -- FROM hunter_id` comparison treated NULL = NULL as a match: on
             -- a bounty with accepted_by IS NULL, that ranked an orphaned row
             -- #1 and demoted an applicant who actually has a name to
             -- 'rejected'. This tier keeps that from ever happening,
             -- independent of what accepted_by is.
             (r.hunter_id IS NOT NULL) DESC,
             -- Tier 2: among real applicants, prefer the one the bounty
             -- itself already points to. Guarded by `hunter_id IS NOT NULL`
             -- so this can only ever be a genuine match (true) or a genuine
             -- non-match (false) — never a NULL = NULL coincidence, since
             -- hunter_id is known non-null on this side by construction.
             (r.hunter_id IS NOT NULL AND r.hunter_id IS NOT DISTINCT FROM b.accepted_by) DESC,
             r.created_at ASC,
             r.id ASC
         ) AS rn
  FROM public.bounty_requests r
  JOIN public.bounties b ON b.id = r.bounty_id
  WHERE r.status = 'accepted'::request_status_enum
)
UPDATE public.bounty_requests br
   SET status = 'rejected'::request_status_enum,
       updated_at = now()
  FROM ranked
 WHERE br.id = ranked.id
   AND br.poster_id = ranked.poster_id   -- bounty_requests' PK is (id, poster_id)
   AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS bounty_requests_one_accepted_per_bounty
  ON public.bounty_requests (bounty_id)
  WHERE status = 'accepted'::request_status_enum;

COMMENT ON INDEX public.bounty_requests_one_accepted_per_bounty IS
  'One bounty, one winner. Three production bounties carried two or more accepted applications before 2026-09-11.';

COMMIT;

-- ---------------------------------------------------------------------------
-- 4. After cleanup — run these once the historical rows are resolved
-- ---------------------------------------------------------------------------
-- Each takes a brief ACCESS EXCLUSIVE lock and fails loudly if any row still
-- violates, which is the point: they are the proof the cleanup was complete.
--
--   ALTER TABLE public.bounties       VALIDATE CONSTRAINT bounties_open_implies_unassigned;
--   ALTER TABLE public.bounty_requests VALIDATE CONSTRAINT bounty_requests_hunter_id_present;
--
-- The 50 applicant-less rows have no recoverable applicant, so validating the
-- second one requires deciding whether to delete them. They are unusable
-- either way; the read path already skips them.
