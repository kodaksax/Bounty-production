-- ROLLBACK for 20261002160000_rating_reputation_integrity
-- Written 2026-10-02 from the LIVE pre-migration state of staging (gwumwpoomwvkjyibdmpj).
-- It restores that environment exactly, including the writable user_ratings view;
-- run it only to back the migration out.

BEGIN;

DROP TRIGGER IF EXISTS trg_ratings_guard ON public.ratings;
DROP FUNCTION IF EXISTS public.fn_ratings_guard();
DROP FUNCTION IF EXISTS public.get_user_reviews(uuid, int, int);
DROP FUNCTION IF EXISTS public.get_my_rating_status(uuid);
DROP FUNCTION IF EXISTS public.admin_verify_legacy_ratings(boolean);
DROP FUNCTION IF EXISTS public.admin_revert_legacy_rating_verification();

-- stats RPCs: pre-migration bodies (identical on prod and staging apart from comments)
-- staging live body (pg_get_functiondef, 2026-10-02)
CREATE OR REPLACE FUNCTION public.get_profile_activity_stats(target_user_id uuid)
 RETURNS TABLE(bounties_posted integer, bounties_completed integer, hunter_completed integer, first_bounty_posted_at timestamp with time zone, rating_avg numeric, rating_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    (
      SELECT round(AVG(r.rating), 2) FROM public.ratings r
      WHERE r.to_user_id = target_user_id
    ) AS rating_avg,
    (
      SELECT COUNT(*)::int FROM public.ratings r
      WHERE r.to_user_id = target_user_id
    ) AS rating_count;
$function$;

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

-- policies: restore the 20261001120300 pair
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='ratings' LOOP EXECUTE format('DROP POLICY %I ON public.ratings', p.policyname); END LOOP; END $$;
CREATE POLICY ratings_select_all ON public.ratings FOR SELECT TO public USING (true);
CREATE POLICY ratings_insert_transaction_party
  ON public.ratings FOR INSERT TO authenticated
  WITH CHECK (
    from_user_id = (SELECT auth.uid())
    AND bounty_id IS NOT NULL
    AND rating >= 1 AND rating <= 5
    AND EXISTS (
      SELECT 1 FROM public.bounties b
       WHERE b.id = ratings.bounty_id
         AND b.accepted_by IS NOT NULL
         AND (b.status::text = 'completed'
              OR (b.status::text = 'archived' AND EXISTS (
                    SELECT 1 FROM public.completion_submissions cs
                     WHERE cs.bounty_id = b.id AND cs.status = 'approved')))
         AND (
           (ratings.from_user_id = COALESCE(b.poster_id, b.user_id) AND ratings.to_user_id = b.accepted_by)
           OR (ratings.from_user_id = b.accepted_by AND ratings.to_user_id = COALESCE(b.poster_id, b.user_id))
         )
    )
  );

DROP FUNCTION IF EXISTS public.fn_rating_counts_toward_reputation(timestamptz, timestamptz, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_rating_transaction_role(uuid, uuid, uuid);

ALTER TABLE public.bounties DROP CONSTRAINT IF EXISTS bounties_no_stored_rating;
ALTER TABLE public.ratings DROP CONSTRAINT IF EXISTS ratings_rating_whole_star;
ALTER TABLE public.ratings DROP CONSTRAINT IF EXISTS ratings_verification_consistent;
ALTER TABLE public.ratings DROP CONSTRAINT IF EXISTS ratings_verification_source_check;
ALTER TABLE public.ratings DROP CONSTRAINT IF EXISTS ratings_rater_role_check;
-- Drops the verification stamps (legacy_backfill included). Rating content is untouched.
ALTER TABLE public.ratings
  DROP COLUMN IF EXISTS hidden_reason,
  DROP COLUMN IF EXISTS hidden_at,
  DROP COLUMN IF EXISTS verification_source,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS rater_role;

REVOKE ALL ON public.ratings FROM anon, authenticated;
GRANT SELECT ON public.ratings TO anon;
GRANT SELECT, INSERT ON public.ratings TO authenticated;

-- user_ratings (staging: auto-updatable view over ratings) -- pre-migration grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ratings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_ratings TO authenticated;

COMMIT;
