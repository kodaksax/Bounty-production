-- Fix: "Jobs Completed" on a profile counted bounties the user POSTED and
-- completed, not bounties they completed AS THE HUNTER.
--
-- get_profile_activity_stats (20260905000000_profile_overhaul_banner_and_stats.sql)
-- was already correctly scoped as a POSTER-side stat (its own comment says so
-- explicitly), but every client caller (app/profile/[userId].tsx,
-- app/tabs/profile-screen.tsx, components/enhanced-profile-section.tsx) wires
-- its `bounties_completed` output straight into the "Jobs Completed" label,
-- which reads as a hunter-completion count. There was no client-safe way to
-- get the real hunter-side number: the correct query already exists in
-- admin_user_stats (20260826120000_add_admin_user_stats.sql, its `completed`
-- CTE: `accepted_by = user AND status = 'completed'`), but that function is
-- service_role-only, reachable only via the admin-profiles Edge Function.
--
-- This adds `hunter_completed` to get_profile_activity_stats, computed with
-- the same accepted_by-based logic as admin_user_stats, so ordinary profile
-- screens (self or another user's) have a real, correctly-scoped number to
-- show instead. `bounties_posted`/`bounties_completed`/`first_bounty_posted_at`
-- keep their exact prior definitions -- this is purely additive.
--
-- CREATE OR REPLACE FUNCTION cannot change a RETURNS TABLE signature (Postgres
-- 42P13), so the function must be dropped and recreated rather than replaced.

DROP FUNCTION IF EXISTS public.get_profile_activity_stats(uuid);

CREATE FUNCTION public.get_profile_activity_stats(target_user_id uuid)
RETURNS TABLE(
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
      -- Hunter-side completions: bounties this user was accepted onto and
      -- that actually finished. Distinct from bounties_completed above,
      -- which is the poster's own completed listings. Mirrors
      -- admin_user_stats's `completed` CTE exactly.
      SELECT COUNT(*)::int FROM public.bounties b
      WHERE b.accepted_by = target_user_id
        AND b.status = 'completed'
    ) AS hunter_completed,
    (
      SELECT MIN(b.created_at) FROM public.bounties b
      WHERE COALESCE(b.poster_id, b.user_id) = target_user_id
        AND b.status IN ('open', 'in_progress', 'completed')
    ) AS first_bounty_posted_at;
$$;

REVOKE ALL ON FUNCTION public.get_profile_activity_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_activity_stats(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_profile_activity_stats(uuid) IS
  'Marketplace-trust stats for a profile (own or another user''s). bounties_posted/bounties_completed are poster-side (excludes archived/deleted/cancelled/cancellation_requested); hunter_completed is the hunter-side "jobs I completed" count (accepted_by = target_user_id AND status = completed), added 2026-09-14 to fix "Jobs Completed" displaying the poster-side count on every profile. authenticated-only.';

NOTIFY pgrst, 'reload schema';
