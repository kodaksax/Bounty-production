-- Migration: fix_bounty_status_flow
-- Date: 2026-04-13
-- Purpose: Resolve multiple root causes that prevent bounties from transitioning
--          through their workflow stages (open → in_progress → completed).
--
-- Root causes addressed:
--   1. `bounties` table has RLS enabled but NO policies → all client-side
--      SELECT / INSERT / UPDATE / DELETE silently return 0 rows.
--   2. `poster_id` column may be NULL on older bounties → RLS policy check
--      `bounties.poster_id = auth.uid()` always fails for those rows.
--   3. `bounties.status` CHECK constraint is missing the values `deleted` and
--      `cancellation_requested` that the application code attempts to write.
--   4. Ensure `accepted_by` and `accepted_request_id` columns exist (also
--      added by 20260412_fix_staging_schema_issues but guarded here too).

BEGIN;

-- ============================================================================
-- 1. Ensure columns that might be missing in some environments
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'accepted_by'
  ) THEN
    ALTER TABLE public.bounties ADD COLUMN accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'accepted_request_id'
  ) THEN
    ALTER TABLE public.bounties ADD COLUMN accepted_request_id uuid;
  END IF;
END $$;

-- Add poster_id column (denormalized from user_id) if missing.
-- Use an explicit FK constraint name so PostgREST has exactly one named relationship
-- between bounties.poster_id and profiles.id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'poster_id'
  ) THEN
    ALTER TABLE public.bounties
      ADD COLUMN poster_id uuid,
      ADD CONSTRAINT bounties_poster_id_fkey
        FOREIGN KEY (poster_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Drop the old unnamed/generic fkey on poster_id if it still exists alongside
-- bounties_poster_id_fkey, which would cause PGRST201 ambiguous-relationship errors.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'bounties'
      AND constraint_name = 'bounties_profiles_fkey'
      AND constraint_type = 'FOREIGN KEY'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'bounties'
      AND constraint_name = 'bounties_poster_id_fkey'
      AND constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE public.bounties DROP CONSTRAINT IF EXISTS bounties_profiles_fkey;
  END IF;
END $$;

-- Backfill poster_id from user_id for rows where it is NULL.
-- Guard against environments where user_id column no longer exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'user_id'
  ) THEN
    UPDATE public.bounties
      SET poster_id = user_id
      WHERE poster_id IS NULL AND user_id IS NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 2. Expand bounties.status CHECK constraint to include all app-level values
--    The original constraint only covered 5 values; the app also writes
--    'deleted' and 'cancellation_requested'.
-- ============================================================================

-- Drop the old constraint (idempotent: only if it exists under the standard name)
ALTER TABLE public.bounties DROP CONSTRAINT IF EXISTS bounties_status_check;
ALTER TABLE public.bounties DROP CONSTRAINT IF EXISTS check_bounty_status;

-- Re-add with the full set of valid values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name    = 'bounties_status_check_full'
  ) THEN
    ALTER TABLE public.bounties
      ADD CONSTRAINT bounties_status_check_full
      CHECK (status IN (
        'open',
        'in_progress',
        'completed',
        'archived',
        'cancelled',
        'cancellation_requested',
        'deleted'
      ));
  END IF;
END $$;

-- ============================================================================
-- 3. RLS policies for the bounties table
--    The table has RLS enabled but previously had no policies, so every
--    client-side operation (including the poster updating their own bounty
--    after accepting a request) was silently blocked.
-- ============================================================================

-- Remove any stale policies before recreating them to keep things idempotent.
DROP POLICY IF EXISTS "Anyone can view non-archived bounties"         ON public.bounties;
DROP POLICY IF EXISTS "Authenticated users can view all bounties"     ON public.bounties;
DROP POLICY IF EXISTS "Users can view their own bounties"             ON public.bounties;
DROP POLICY IF EXISTS "Users can create bounties"                     ON public.bounties;
DROP POLICY IF EXISTS "Owners can update their own bounties"          ON public.bounties;
DROP POLICY IF EXISTS "Owners can delete their own bounties"          ON public.bounties;
DROP POLICY IF EXISTS "Hunters can view bounties they applied to"     ON public.bounties;

-- SELECT: any authenticated user can read any bounty (public marketplace feed).
CREATE POLICY "Authenticated users can view all bounties"
  ON public.bounties
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: authenticated users can post new bounties (must be the poster).
CREATE POLICY "Users can create bounties"
  ON public.bounties
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = poster_id
  );

-- UPDATE: the bounty poster can update their own bounty.
CREATE POLICY "Owners can update their own bounties"
  ON public.bounties
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = poster_id
  )
  WITH CHECK (
    auth.uid() = poster_id
  );

-- DELETE: the bounty poster can delete their own bounty.
CREATE POLICY "Owners can delete their own bounties"
  ON public.bounties
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = poster_id
  );

-- ============================================================================
-- 4. Reload PostgREST schema cache
-- ============================================================================
NOTIFY pgrst, 'reload schema';

COMMIT;
