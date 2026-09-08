-- Migration: Profile overhaul — banner column, public_profiles exposure, activity stats RPC
-- Created: 2026-09-05
--
-- Part of a broader profile-system overhaul (trust/personalization/marketplace-
-- conversion initiative). Profiles today are thin: no banner support exists at
-- any layer, "Jobs Completed" is hardcoded to 0 on one profile screen and
-- silently wrong (shows accepted, not completed) on the other, and there is no
-- safe way for a user to see how many bounties someone has posted/completed
-- without either querying `bounties` unfiltered (which leaks admin-removed
-- listings — see bug note below) or going through an admin-only RPC.
--
-- This migration verified the LIVE schema directly (via list_tables /
-- execute_sql against the project) rather than trusting migration history —
-- `profiles` has extensive, documented, previously-untracked drift (see
-- docs/withdrawals/08-profiles-rls-migration-strategy.md). Confirmed live:
--   - the bio column really is `about` (not `bio`)
--   - `skills` is jsonb, `skill_categories` is text[]
--   - no `banner_url`/`cover_image` column exists anywhere
--   - the `public_profiles` view (the ONLY channel for cross-user profile
--     reads — base-table SELECT RLS is self-only) currently exposes just:
--     id, username, display_name, avatar, location, about, verification_status,
--     created_at, e2e_public_key, stripe_identity_status, verified_since
--   - `prevent_client_writes_to_protected_profile_columns()` is a blocklist of
--     financial/risk/Stripe/verification columns; banner_url is not affected
--     and needs no entry
--   - the `profiles` storage bucket's policies key only on `bucket_id`, not on
--     a folder/owner scoped INSERT, so no new bucket/policy is needed for a
--     `<user_id>/banners/<file>` path

-- ============================================================================
-- 1. banner_url column
-- ============================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banner_url TEXT;

COMMENT ON COLUMN public.profiles.banner_url IS
  'URL of the user''s profile banner/cover image (stored in the profiles storage bucket under <user_id>/banners/). Optional — null means no banner set, not an error state.';

-- ============================================================================
-- 2. public_profiles view — add banner_url, skills, skill_categories
-- ============================================================================
-- This view is the only channel for cross-user profile reads. Any field the
-- profile UI needs to show on SOMEONE ELSE'S profile must be listed here or it
-- silently reads as null cross-user even though it's visible on your own
-- profile via a different read path (get_my_profile()). Deliberately no
-- security_invoker — this bypasses RLS via view-owner privilege by design.
--
-- IMPORTANT: `CREATE OR REPLACE VIEW` cannot reorder or rename an existing
-- output column (Postgres 42P16) — every pre-existing column below keeps its
-- exact original name AND ordinal position (location included, unchanged);
-- new columns are appended strictly at the end.
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  username,
  display_name,
  avatar,
  location,
  about,
  verification_status,
  created_at,
  e2e_public_key,
  stripe_identity_status,
  verified_since,
  banner_url,
  skills,
  skill_categories
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- ============================================================================
-- 3. get_profile_activity_stats — self- and cross-user-safe bounty stats
-- ============================================================================
-- BUG FIXED HERE: bounty-service.ts's getAll()/getByUserId() only excludes
-- status = 'archived' by default, not 'deleted' (the status an admin-removed
-- bounty gets, see 20260829120000_bounty_moderation_queue.sql), 'cancelled',
-- or 'cancellation_requested'. That means an admin-removed listing could still
-- count toward and appear in a poster's "Bounties Posted" history. This RPC is
-- the single, authoritative source of truth for the stat — it filters at the
-- source, so every caller (not just the new profile screens) gets the fix by
-- using it instead of re-deriving the count client-side.
--
-- Counts POSTED bounties only (matched on COALESCE(poster_id, user_id), since
-- both columns are still live and inconsistently populated across older
-- rows — see 20260413_fix_bounty_status_flow.sql). Hunter-side "jobs I
-- completed" is a distinct, pre-existing stat (bounty_requests status =
-- 'accepted') left untouched by this migration.
CREATE OR REPLACE FUNCTION public.get_profile_activity_stats(target_user_id uuid)
RETURNS TABLE(
  bounties_posted int,
  bounties_completed int,
  first_bounty_posted_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT
    COUNT(*) FILTER (WHERE status IN ('open', 'in_progress', 'completed'))::int AS bounties_posted,
    COUNT(*) FILTER (WHERE status = 'completed')::int AS bounties_completed,
    MIN(created_at) FILTER (WHERE status IN ('open', 'in_progress', 'completed')) AS first_bounty_posted_at
  FROM public.bounties
  WHERE COALESCE(poster_id, user_id) = target_user_id;
$$;

REVOKE ALL ON FUNCTION public.get_profile_activity_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_activity_stats(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_profile_activity_stats(uuid) IS
  'Marketplace-trust stats for a profile (own or another user''s). Excludes archived/deleted/cancelled/cancellation_requested bounties so admin-removed listings never count toward or appear in a poster''s visible history. authenticated-only — no confirmed anonymous profile-viewing flow exists in the client.';

NOTIFY pgrst, 'reload schema';
