-- Reputation only from real transactions (trust-spine audit 2026-09-30, T7 / T19 / T24).
-- Proposal + data treatment: docs/security/rating-integrity-2026-10-02.md
--
-- 20261001120300 put the right INSERT policy on public.ratings, but:
--   * every aggregate (get_profile_activity_stats(_batch), the share edge
--     functions, the client's own averaging) still counted every row, including
--     legacy ratings with no bounty at all;
--   * staging's public.user_ratings is an auto-updatable VIEW over ratings, owned
--     by postgres and not security_invoker, with INSERT/UPDATE/DELETE granted to
--     anon: it bypasses every ratings policy. Prod's user_ratings is a separate
--     table (0 rows) with self-only write policies and anon write grants;
--   * insert evidence was bounty.status only. A poster can move in_progress ->
--     completed without any delivered work, and on staging (no 20261001130000) a
--     client can insert an already-'completed' bounty with any accepted_by;
--   * created_at was client-supplied;
--   * the poster can UPDATE bounties.average_rating / rating_count.
--
-- After this migration:
--   * trg_ratings_guard verifies every INSERT, from any role, against the
--     transaction (fn_rating_transaction_role) and stamps rater_role /
--     verified_at / created_at itself. Content is immutable for everyone;
--     clients can neither UPDATE nor DELETE.
--   * fn_rating_counts_toward_reputation is the single predicate for "this
--     rating is reputation". The SELECT policy, both stats RPCs and
--     get_user_reviews use it, so a count and the list behind it always agree.
--   * Legacy rows are NOT modified. They stay unverified (and therefore never
--     count) until admin_verify_legacy_ratings(false) is run deliberately after
--     its dry run. admin_revert_legacy_rating_verification() undoes that.
--
-- Rollback (generated from each environment's live pre-migration state):
--   supabase/rollbacks/production/20261002160000_rating_reputation_integrity.down.sql
--   supabase/rollbacks/staging/20261002160000_rating_reputation_integrity.down.sql

BEGIN;

-- ============================================================================
-- 1. Verification + moderation columns (all NULL for existing rows)
-- ============================================================================

ALTER TABLE public.ratings
  ADD COLUMN IF NOT EXISTS rater_role text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_source text,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_reason text;

COMMENT ON COLUMN public.ratings.rater_role IS
  'poster | hunter: which side of the bounty wrote this rating. Set by trg_ratings_guard (or the legacy backfill), never by the client.';
COMMENT ON COLUMN public.ratings.verified_at IS
  'When this rating was verified against its transaction (bounty -> participants -> approved completion). NULL = never verified; such a row never counts as reputation.';
COMMENT ON COLUMN public.ratings.verification_source IS
  'transaction_guard (verified at insert) | legacy_backfill (pre-2026-10-02 row verified by admin_verify_legacy_ratings; reversible).';
COMMENT ON COLUMN public.ratings.hidden_at IS
  'Set by an admin (service role) to withdraw a review from reputation without deleting it.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ratings'::regclass AND conname = 'ratings_rater_role_check') THEN
    ALTER TABLE public.ratings ADD CONSTRAINT ratings_rater_role_check
      CHECK (rater_role IS NULL OR rater_role IN ('poster', 'hunter'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ratings'::regclass AND conname = 'ratings_verification_source_check') THEN
    ALTER TABLE public.ratings ADD CONSTRAINT ratings_verification_source_check
      CHECK (verification_source IS NULL OR verification_source IN ('transaction_guard', 'legacy_backfill'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ratings'::regclass AND conname = 'ratings_verification_consistent') THEN
    ALTER TABLE public.ratings ADD CONSTRAINT ratings_verification_consistent
      CHECK ((verified_at IS NULL) = (verification_source IS NULL)
             AND (verified_at IS NULL) = (rater_role IS NULL));
  END IF;
  -- Whole stars. A no-op on prod (integer); staging's column is numeric(3,1).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ratings'::regclass AND conname = 'ratings_rating_whole_star') THEN
    ALTER TABLE public.ratings ADD CONSTRAINT ratings_rating_whole_star
      CHECK (rating = trunc(rating)) NOT VALID;
    ALTER TABLE public.ratings VALIDATE CONSTRAINT ratings_rating_whole_star;
  END IF;
END $$;

-- ============================================================================
-- 2. Transaction evidence: who (if anyone) may rate whom on a bounty
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_rating_transaction_role(p_bounty_id uuid, p_from uuid, p_to uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN p_from = COALESCE(b.poster_id, b.user_id) AND p_to = b.accepted_by THEN 'poster'
           WHEN p_from = b.accepted_by AND p_to = COALESCE(b.poster_id, b.user_id) THEN 'hunter'
         END
    FROM public.bounties b
   WHERE b.id = p_bounty_id
     AND p_from IS NOT NULL
     AND p_to IS NOT NULL
     AND p_from <> p_to
     AND b.accepted_by IS NOT NULL
     AND b.status::text IN ('completed', 'archived')
     -- The hunter delivered and the poster approved: a poster flipping the
     -- status alone is not a completed transaction.
     AND EXISTS (
       SELECT 1 FROM public.completion_submissions cs
        WHERE cs.bounty_id = b.id
          AND cs.hunter_id = b.accepted_by
          AND cs.status = 'approved'
     )
     -- The hunter applied and was accepted (accepted_by came through
     -- fn_accept_bounty_request, not a direct write).
     AND EXISTS (
       SELECT 1 FROM public.bounty_requests br
        WHERE br.bounty_id = b.id
          AND br.hunter_id = b.accepted_by
          AND br.status::text = 'accepted'
     )
$$;

COMMENT ON FUNCTION public.fn_rating_transaction_role(uuid, uuid, uuid) IS
  'poster | hunter when p_from may rate p_to for p_bounty_id (completed bounty, accepted application, approved submission by the accepted hunter, the two parties of it); NULL otherwise. Used by the ratings INSERT policy and trg_ratings_guard.';

REVOKE ALL ON FUNCTION public.fn_rating_transaction_role(uuid, uuid, uuid) FROM PUBLIC, anon;
-- The INSERT policy and the SECURITY INVOKER guard run as the caller.
GRANT EXECUTE ON FUNCTION public.fn_rating_transaction_role(uuid, uuid, uuid) TO authenticated, service_role;

-- ============================================================================
-- 3. Reputation predicate (single source of truth)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_rating_counts_toward_reputation(
  p_verified_at timestamptz,
  p_hidden_at   timestamptz,
  p_bounty_id   uuid,
  p_from        uuid,
  p_to          uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_verified_at IS NOT NULL
     AND p_hidden_at IS NULL
     AND p_bounty_id IS NOT NULL
     AND p_from IS NOT NULL
     AND p_to IS NOT NULL
     -- Internal test accounts rating each other is not marketplace reputation.
     AND NOT EXISTS (
       SELECT 1
         FROM public.profiles f
         JOIN public.profiles t ON t.id = p_to
        WHERE f.id = p_from
          AND COALESCE(f.is_internal, false)
          AND COALESCE(t.is_internal, false)
     )
$$;

COMMENT ON FUNCTION public.fn_rating_counts_toward_reputation(timestamptz, timestamptz, uuid, uuid, uuid) IS
  'True when a ratings row is reputation: verified against its transaction, not hidden by an admin, still attached to its bounty, and not an internal<->internal pair. Every aggregate and review list must use this.';

REVOKE ALL ON FUNCTION public.fn_rating_counts_toward_reputation(timestamptz, timestamptz, uuid, uuid, uuid) FROM PUBLIC;
-- Evaluated inside the ratings SELECT policy, which anon also passes through.
GRANT EXECUTE ON FUNCTION public.fn_rating_counts_toward_reputation(timestamptz, timestamptz, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

-- ============================================================================
-- 4. Guard trigger: verify every insert, freeze every row
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_ratings_guard()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER on purpose: current_user identifies a direct client write
-- (including writes routed through staging's user_ratings view).
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client boolean := current_user IN ('authenticated', 'anon');
  v_role   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Every role, including service_role: there is no legitimate unverified rating.
    v_role := public.fn_rating_transaction_role(NEW.bounty_id, NEW.from_user_id, NEW.to_user_id);
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'rating_requires_completed_transaction'
        USING ERRCODE = '42501',
              HINT = 'Only the poster and the accepted hunter of a completed bounty can rate each other.';
    END IF;
    NEW.rater_role          := v_role;
    NEW.verified_at         := now();
    NEW.verification_source := 'transaction_guard';
    NEW.created_at          := now();
    NEW.hidden_at           := NULL;
    NEW.hidden_reason       := NULL;
    NEW.comment             := NULLIF(btrim(NEW.comment), '');
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_client THEN
      RAISE EXCEPTION 'ratings_cannot_be_deleted'
        USING ERRCODE = '42501',
              HINT = 'Ratings are a record of a transaction. Report a review instead.';
    END IF;
    RETURN OLD;  -- account deletion cascade / admin
  END IF;

  -- UPDATE
  IF v_client THEN
    RAISE EXCEPTION 'ratings_are_immutable' USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.rating IS DISTINCT FROM OLD.rating
     OR NEW.comment IS DISTINCT FROM OLD.comment
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     -- The only reference change allowed is an FK ON DELETE SET NULL.
     OR (NEW.bounty_id IS DISTINCT FROM OLD.bounty_id AND NEW.bounty_id IS NOT NULL)
     OR (NEW.from_user_id IS DISTINCT FROM OLD.from_user_id AND NEW.from_user_id IS NOT NULL)
     OR (NEW.to_user_id IS DISTINCT FROM OLD.to_user_id AND NEW.to_user_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'ratings_are_immutable' USING ERRCODE = '42501',
      HINT = 'Rating content never changes. Hide it (hidden_at) instead.';
  END IF;

  -- Verification is stamped once; only a legacy_backfill stamp can be undone.
  IF (NEW.verified_at, NEW.verification_source, NEW.rater_role)
       IS DISTINCT FROM (OLD.verified_at, OLD.verification_source, OLD.rater_role)
     AND NOT (OLD.verified_at IS NULL)
     AND NOT (OLD.verification_source = 'legacy_backfill' AND NEW.verified_at IS NULL)
  THEN
    RAISE EXCEPTION 'rating_verification_is_immutable' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ratings_guard ON public.ratings;
CREATE TRIGGER trg_ratings_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.fn_ratings_guard();

-- ============================================================================
-- 5. Policies + grants
-- ============================================================================

DROP POLICY IF EXISTS ratings_insert_transaction_party ON public.ratings;
CREATE POLICY ratings_insert_transaction_party
  ON public.ratings FOR INSERT TO authenticated
  WITH CHECK (
    from_user_id = (SELECT auth.uid())
    AND public.is_account_active((SELECT auth.uid()))
    AND bounty_id IS NOT NULL
    AND rating >= 1 AND rating <= 5
    AND public.fn_rating_transaction_role(bounty_id, from_user_id, to_user_id) IS NOT NULL
  );

-- Other users see only reputation rows; a rater always sees their own (the
-- client's insert ... returning and hasRated need that); admins see all.
DROP POLICY IF EXISTS ratings_select_all ON public.ratings;
DROP POLICY IF EXISTS ratings_select_reputation ON public.ratings;
CREATE POLICY ratings_select_reputation
  ON public.ratings FOR SELECT TO public
  USING (
    public.fn_rating_counts_toward_reputation(verified_at, hidden_at, bounty_id, from_user_id, to_user_id)
    OR from_user_id = (SELECT auth.uid())
    OR COALESCE((SELECT auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  );

REVOKE ALL ON public.ratings FROM anon;
REVOKE ALL ON public.ratings FROM authenticated;
GRANT SELECT ON public.ratings TO anon;
GRANT SELECT, INSERT ON public.ratings TO authenticated;

-- user_ratings: a VIEW over ratings on staging, a dead 0-row table on prod.
-- Neither is read by any server code; the client only falls back to it on
-- error. Remove every client privilege (the object and its rows are kept).
DO $$
DECLARE p record;
BEGIN
  IF to_regclass('public.user_ratings') IS NOT NULL THEN
    FOR p IN SELECT policyname FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'user_ratings'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.user_ratings', p.policyname);
    END LOOP;
    REVOKE ALL ON public.user_ratings FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- ============================================================================
-- 6. Reputation is never stored on a bounty row
--    (poster held UPDATE on these; all rows are NULL / 0 on prod and staging)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.bounties'::regclass AND conname = 'bounties_no_stored_rating') THEN
    ALTER TABLE public.bounties ADD CONSTRAINT bounties_no_stored_rating
      CHECK (average_rating IS NULL AND COALESCE(rating_count, 0) = 0) NOT VALID;
    ALTER TABLE public.bounties VALIDATE CONSTRAINT bounties_no_stored_rating;
  END IF;
END $$;

-- ============================================================================
-- 7. Aggregates: same columns, reputation rows only
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_profile_activity_stats(target_user_id uuid)
RETURNS TABLE(
  bounties_posted int,
  bounties_completed int,
  hunter_completed int,
  first_bounty_posted_at timestamptz,
  rating_avg numeric,
  rating_count int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  WITH rep AS (
    SELECT r.rating
      FROM public.ratings r
     WHERE r.to_user_id = target_user_id
       AND public.fn_rating_counts_toward_reputation(r.verified_at, r.hidden_at, r.bounty_id, r.from_user_id, r.to_user_id)
  )
  SELECT
    (
      SELECT COUNT(*)::int FROM public.bounties b
      WHERE COALESCE(b.poster_id, b.user_id) = target_user_id
        AND b.status IN ('open', 'in_progress', 'completed')
    ) AS bounties_posted,
    (
      SELECT COUNT(*)::int FROM public.bounties b
      WHERE COALESCE(b.poster_id, b.user_id) = target_user_id
        AND b.status = 'completed'
    ) AS bounties_completed,
    (
      SELECT COUNT(*)::int FROM public.bounties b
      WHERE b.accepted_by = target_user_id
        AND b.status = 'completed'
    ) AS hunter_completed,
    (
      SELECT MIN(b.created_at) FROM public.bounties b
      WHERE COALESCE(b.poster_id, b.user_id) = target_user_id
        AND b.status IN ('open', 'in_progress', 'completed')
    ) AS first_bounty_posted_at,
    -- NULL (not 0) with no ratings, so MIN_RATING_SAMPLE can't misread it.
    (SELECT round(AVG(rep.rating), 2) FROM rep) AS rating_avg,
    (SELECT COUNT(*)::int FROM rep) AS rating_count;
$$;

COMMENT ON FUNCTION public.get_profile_activity_stats(uuid) IS
  'Marketplace-trust stats for a profile. bounties_posted/bounties_completed are poster-side; hunter_completed is hunter-side. rating_avg/rating_count are ratings RECEIVED that pass fn_rating_counts_toward_reputation (2026-10-02) -- the same rows get_user_reviews lists.';

CREATE OR REPLACE FUNCTION public.get_profile_activity_stats_batch(target_user_ids uuid[])
RETURNS TABLE(
  user_id uuid,
  bounties_posted int,
  bounties_completed int,
  hunter_completed int,
  first_bounty_posted_at timestamptz,
  rating_avg numeric,
  rating_count int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  with ids as (
    select unnest(target_user_ids) as id
  ),
  posted as (
    select coalesce(b.poster_id, b.user_id) as id, count(*) as n,
           min(b.created_at) as first_posted_at
    from public.bounties b
    where coalesce(b.poster_id, b.user_id) = any(target_user_ids)
      and b.status in ('open', 'in_progress', 'completed')
    group by coalesce(b.poster_id, b.user_id)
  ),
  posted_completed as (
    select coalesce(b.poster_id, b.user_id) as id, count(*) as n
    from public.bounties b
    where coalesce(b.poster_id, b.user_id) = any(target_user_ids)
      and b.status = 'completed'
    group by coalesce(b.poster_id, b.user_id)
  ),
  hunter_completed as (
    select b.accepted_by as id, count(*) as n
    from public.bounties b
    where b.accepted_by = any(target_user_ids)
      and b.status = 'completed'
    group by b.accepted_by
  ),
  rating_stats as (
    select r.to_user_id as id, round(avg(r.rating), 2) as avg_rating, count(*) as n
    from public.ratings r
    where r.to_user_id = any(target_user_ids)
      and public.fn_rating_counts_toward_reputation(r.verified_at, r.hidden_at, r.bounty_id, r.from_user_id, r.to_user_id)
    group by r.to_user_id
  )
  select
    ids.id,
    coalesce(posted.n, 0)::int,
    coalesce(posted_completed.n, 0)::int,
    coalesce(hunter_completed.n, 0)::int,
    posted.first_posted_at,
    rating_stats.avg_rating,
    coalesce(rating_stats.n, 0)::int
  from ids
  left join posted           on posted.id = ids.id
  left join posted_completed on posted_completed.id = ids.id
  left join hunter_completed on hunter_completed.id = ids.id
  left join rating_stats     on rating_stats.id = ids.id;
$$;

COMMENT ON FUNCTION public.get_profile_activity_stats_batch(uuid[]) IS
  'Batched sibling of get_profile_activity_stats (e.g. a bounty''s applicants). Same columns/semantics; ratings filtered by fn_rating_counts_toward_reputation.';

-- The share-profile / share-og-image edge functions read these as service_role.
GRANT EXECUTE ON FUNCTION public.get_profile_activity_stats(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_activity_stats_batch(uuid[]) TO service_role;

-- ============================================================================
-- 8. The reviews behind the count, traceable to their transaction
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_reviews(
  p_user_id uuid,
  p_limit   int DEFAULT 20,
  p_offset  int DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  rating int,
  comment text,
  created_at timestamptz,
  rater_role text,
  rater_id uuid,
  rater_username text,
  rater_avatar text,
  bounty_id uuid,
  bounty_title text,
  bounty_completed_at timestamptz,
  is_for_honor boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id,
         r.rating::int,
         r.comment,
         r.created_at,
         r.rater_role,
         r.from_user_id,
         COALESCE(NULLIF(btrim(p.username), ''), NULLIF(btrim(p.display_name), '')),
         p.avatar,
         r.bounty_id,
         -- A bounty its poster later deleted is still the transaction, but its
         -- content is no longer published.
         CASE WHEN b.status::text = 'deleted' THEN NULL ELSE b.title END,
         b.completed_at::timestamptz,
         COALESCE(b.is_for_honor, false)
    FROM public.ratings r
    JOIN public.bounties b ON b.id = r.bounty_id
    LEFT JOIN public.profiles p ON p.id = r.from_user_id
   WHERE r.to_user_id = p_user_id
     AND public.fn_rating_counts_toward_reputation(r.verified_at, r.hidden_at, r.bounty_id, r.from_user_id, r.to_user_id)
   ORDER BY r.created_at DESC, r.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.get_user_reviews(uuid, int, int) IS
  'Ratings received by p_user_id that count as reputation (fn_rating_counts_toward_reputation), with the transaction they came from: rater + role, bounty, completion date, paid vs honor. Star-only ratings included (comment NULL).';

REVOKE ALL ON FUNCTION public.get_user_reviews(uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_reviews(uuid, int, int) TO authenticated, service_role;

-- ============================================================================
-- 9. Caller's rating status for one bounty (drives the hunter -> poster card)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_rating_status(p_bounty_id uuid)
RETURNS TABLE(
  rater_role text,
  ratee_id uuid,
  ratee_username text,
  eligible boolean,
  already_rated boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  pair AS (
    SELECT CASE WHEN me.uid = COALESCE(b.poster_id, b.user_id) THEN 'poster'
                WHEN me.uid = b.accepted_by THEN 'hunter' END AS rater_role,
           CASE WHEN me.uid = COALESCE(b.poster_id, b.user_id) THEN b.accepted_by
                WHEN me.uid = b.accepted_by THEN COALESCE(b.poster_id, b.user_id) END AS ratee_id,
           me.uid
      FROM public.bounties b, me
     WHERE b.id = p_bounty_id
       AND me.uid IS NOT NULL
  )
  SELECT pair.rater_role,
         pair.ratee_id,
         COALESCE(NULLIF(btrim(p.username), ''), NULLIF(btrim(p.display_name), '')),
         public.fn_rating_transaction_role(p_bounty_id, pair.uid, pair.ratee_id) IS NOT NULL,
         EXISTS (SELECT 1 FROM public.ratings r
                  WHERE r.bounty_id = p_bounty_id
                    AND r.from_user_id = pair.uid
                    AND r.to_user_id = pair.ratee_id)
    FROM pair
    LEFT JOIN public.profiles p ON p.id = pair.ratee_id
   WHERE pair.rater_role IS NOT NULL
     AND pair.ratee_id IS NOT NULL;
$$;

COMMENT ON FUNCTION public.get_my_rating_status(uuid) IS
  'For the calling user on one bounty: their side (poster|hunter), the counterparty, whether they may rate now (fn_rating_transaction_role) and whether they already have. No row when the caller is not a party.';

REVOKE ALL ON FUNCTION public.get_my_rating_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_rating_status(uuid) TO authenticated;

-- ============================================================================
-- 10. Legacy treatment: dry-run-first, reversible, never runs by itself
-- ============================================================================

-- Legacy evidence differs from the insert rule in two documented ways: a bounty
-- later soft-deleted still counts (the approved submission is the hunter's
-- evidence; deleting must not erase an earned rating), and no application row
-- is required (12 pre-2026-08-20 completed bounties have none). Participants and
-- the approved submission by the accepted hunter are still mandatory.
CREATE OR REPLACE FUNCTION public.admin_verify_legacy_ratings(p_dry_run boolean DEFAULT true)
RETURNS TABLE(rating_id uuid, outcome text, rater_role text, applied boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH c AS (
    SELECT r.id,
           CASE WHEN r.from_user_id = COALESCE(b.poster_id, b.user_id) AND r.to_user_id = b.accepted_by THEN 'poster'
                WHEN r.from_user_id = b.accepted_by AND r.to_user_id = COALESCE(b.poster_id, b.user_id) THEN 'hunter'
           END AS role,
           CASE
             WHEN r.bounty_id IS NULL OR b.id IS NULL THEN 'exclude:no_bounty'
             WHEN r.from_user_id IS NULL OR r.to_user_id IS NULL THEN 'exclude:party_missing'
             WHEN r.from_user_id = r.to_user_id THEN 'exclude:self_rating'
             WHEN b.accepted_by IS NULL
               OR NOT ((r.from_user_id = COALESCE(b.poster_id, b.user_id) AND r.to_user_id = b.accepted_by)
                    OR (r.from_user_id = b.accepted_by AND r.to_user_id = COALESCE(b.poster_id, b.user_id)))
               THEN 'exclude:not_participants'
             WHEN b.status::text NOT IN ('completed', 'archived', 'deleted')
               OR NOT EXISTS (SELECT 1 FROM public.completion_submissions cs
                               WHERE cs.bounty_id = b.id AND cs.hunter_id = b.accepted_by
                                 AND cs.status = 'approved')
               THEN 'exclude:not_completed'
             ELSE 'verify'
           END AS outcome
      FROM public.ratings r
      LEFT JOIN public.bounties b ON b.id = r.bounty_id
     WHERE r.verified_at IS NULL
  ),
  upd AS (
    UPDATE public.ratings r
       SET verified_at = now(),
           verification_source = 'legacy_backfill',
           rater_role = c.role
      FROM c
     WHERE NOT p_dry_run
       AND r.id = c.id
       AND c.outcome = 'verify'
       AND r.verified_at IS NULL
    RETURNING r.id
  )
  SELECT c.id, c.outcome, CASE WHEN c.outcome = 'verify' THEN c.role END,
         EXISTS (SELECT 1 FROM upd WHERE upd.id = c.id)
    FROM c
   ORDER BY c.outcome, c.id;
END;
$$;

COMMENT ON FUNCTION public.admin_verify_legacy_ratings(boolean) IS
  'Classifies every unverified rating (verify / exclude:<reason>). p_dry_run=true (default) writes nothing. false stamps verified_at/rater_role on the verify rows with verification_source=legacy_backfill. Undo: admin_revert_legacy_rating_verification(). Service role only.';

CREATE OR REPLACE FUNCTION public.admin_revert_legacy_rating_verification()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n int;
BEGIN
  UPDATE public.ratings
     SET verified_at = NULL, verification_source = NULL, rater_role = NULL
   WHERE verification_source = 'legacy_backfill';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verify_legacy_ratings(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_revert_legacy_rating_verification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_verify_legacy_ratings(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_revert_legacy_rating_verification() TO service_role;

COMMIT;
