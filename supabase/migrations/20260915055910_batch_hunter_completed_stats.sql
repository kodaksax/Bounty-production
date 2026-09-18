-- Batched hunter-completion stats for applicant lists.
--
-- The applicant card (poster-facing trust layer) needs each applicant's
-- hunter-side completed-bounty count. get_profile_activity_stats
-- (20260905000000, extended 20260914130000 with hunter_completed) only takes
-- one user id -- calling it once per applicant would be an N+1 query pattern
-- against a list that can have many hunters. This adds a batched sibling,
-- following the same unnest-and-left-join shape as admin_user_stats
-- (20260826120000_add_admin_user_stats.sql), so the client can fetch stats
-- for an entire applicant list in one round trip.
--
-- Same aggregate-only, no-row-level-data shape as get_profile_activity_stats
-- -- granting this to `authenticated` (unlike admin_user_stats, which is
-- service_role-only) does not expose anything a poster couldn't already see
-- by calling get_profile_activity_stats once per applicant; it only makes
-- that pattern efficient.

CREATE OR REPLACE FUNCTION public.get_profile_activity_stats_batch(target_user_ids uuid[])
RETURNS TABLE(
  user_id uuid,
  bounties_posted int,
  bounties_completed int,
  hunter_completed int,
  first_bounty_posted_at timestamptz
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
  )
  select
    ids.id,
    coalesce(posted.n, 0)::int,
    coalesce(posted_completed.n, 0)::int,
    coalesce(hunter_completed.n, 0)::int,
    posted.first_posted_at
  from ids
  left join posted           on posted.id = ids.id
  left join posted_completed on posted_completed.id = ids.id
  left join hunter_completed on hunter_completed.id = ids.id;
$$;

REVOKE ALL ON FUNCTION public.get_profile_activity_stats_batch(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_activity_stats_batch(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_profile_activity_stats_batch(uuid[]) IS
  'Batched sibling of get_profile_activity_stats for lists of users (e.g. a bounty''s applicants) -- avoids one RPC call per applicant. Same columns/semantics as get_profile_activity_stats. authenticated-only.';

NOTIFY pgrst, 'reload schema';
