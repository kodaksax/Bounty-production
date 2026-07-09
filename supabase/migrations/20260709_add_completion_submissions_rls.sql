-- Migration: Add RLS policies for completion_submissions table
-- Date: 2026-07-09
--
-- Purpose:
--   The `completion_submissions` table was created in
--   `20251022_inprogress_flow.sql` with its Row Level Security (RLS) policies
--   left commented out. Its sibling table `completion_ready` later received
--   explicit policies (`20260309_add_completion_ready_rls.sql`), but
--   `completion_submissions` never did.
--
--   Under PostgreSQL, enabling RLS on a table without any permissive policy
--   denies all access to non-superuser roles (the "default-deny" behaviour,
--   see supabase/ops/RLS_AUDIT.md). When RLS is enabled on this table in
--   production, authenticated hunters can no longer INSERT their work
--   submissions and neither the hunter nor the poster can SELECT them via the
--   client. The result is that a submitted bounty "does not persist" and the
--   review progress never updates.
--
--   This migration enables RLS (idempotent) and adds safe policies so the
--   client-side completion flow works while keeping data scoped to the
--   participants of a bounty.
--
-- Policy summary:
--   - SELECT: the assigned hunter (auth.uid() = hunter_id) OR the poster of
--     the related bounty (matches poster_id, falling back to the legacy
--     user_id column for rows not yet migrated to poster_id).
--   - INSERT: only the authenticated hunter may create a submission for
--     themselves (auth.uid() = hunter_id).
--   - UPDATE: only the poster of the related bounty may update a submission
--     (used for approve / reject / request-revision actions).
--
--   The service role (backend APIs, Edge Functions, SECURITY DEFINER RPCs)
--   bypasses RLS and continues to operate normally.

BEGIN;

-- Enable RLS (idempotent)
ALTER TABLE public.completion_submissions ENABLE ROW LEVEL SECURITY;

-- SELECT: hunter who submitted, or the poster of the related bounty
DROP POLICY IF EXISTS "completion_submissions_select_participants" ON public.completion_submissions;
CREATE POLICY "completion_submissions_select_participants"
  ON public.completion_submissions
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = hunter_id
    OR EXISTS (
      SELECT 1 FROM public.bounties b
      WHERE b.id = completion_submissions.bounty_id
        AND (auth.uid() = b.poster_id OR auth.uid() = b.user_id)
    )
  );

-- INSERT: only the authenticated hunter may submit their own work
DROP POLICY IF EXISTS "completion_submissions_insert_hunter" ON public.completion_submissions;
CREATE POLICY "completion_submissions_insert_hunter"
  ON public.completion_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = hunter_id);

-- UPDATE: only the poster of the related bounty may update a submission
-- (approve / reject / request revision)
DROP POLICY IF EXISTS "completion_submissions_update_poster" ON public.completion_submissions;
CREATE POLICY "completion_submissions_update_poster"
  ON public.completion_submissions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bounties b
      WHERE b.id = completion_submissions.bounty_id
        AND (auth.uid() = b.poster_id OR auth.uid() = b.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bounties b
      WHERE b.id = completion_submissions.bounty_id
        AND (auth.uid() = b.poster_id OR auth.uid() = b.user_id)
    )
  );

-- Ensure the authenticated role has the required table privileges
GRANT SELECT, INSERT, UPDATE ON public.completion_submissions TO authenticated;

COMMIT;
