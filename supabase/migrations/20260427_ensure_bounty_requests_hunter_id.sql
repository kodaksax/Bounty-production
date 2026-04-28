-- Migration: ensure_bounty_requests_hunter_id
-- Created: 2026-04-27
-- Issue: "record 'new' has no field 'hunter_id'" on bounty accept
--
-- Root Cause:
--   The `bounty_requests` table was originally created in some environments
--   with a `user_id` column (referenced in 20251117_safe_user_deletion.sql and
--   indexed in 20260107_add_performance_indexes.sql). Because
--   20251119_add_bounty_requests_table.sql uses `CREATE TABLE IF NOT EXISTS`,
--   it was a no-op on those environments and `hunter_id` was never added.
--
--   Migration 20260322_serverless_notification_triggers.sql then added
--   `trg_bounty_request_notification` which calls `handle_bounty_request_notification()`
--   — a function that references `NEW.hunter_id`. When `fn_accept_bounty_request`
--   fires this trigger via an UPDATE on bounty_requests, PostgreSQL raises:
--     "record 'new' has no field 'hunter_id'"
--
-- Fix:
--   1. Add `hunter_id` column to `bounty_requests` if it does not exist.
--   2. Backfill it from the existing `user_id` column where available.
--   3. Add `poster_id` column if it does not exist (also referenced by the
--      INSERT scenario of the same trigger function).
--   4. Also ensure the unique constraint on (bounty_id, hunter_id) exists.

BEGIN;

-- 1. Add hunter_id if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bounty_requests'
      AND column_name  = 'hunter_id'
  ) THEN
    ALTER TABLE public.bounty_requests
      ADD COLUMN hunter_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

    -- Backfill from user_id when available
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'bounty_requests'
        AND column_name  = 'user_id'
    ) THEN
      UPDATE public.bounty_requests
        SET hunter_id = user_id
        WHERE hunter_id IS NULL AND user_id IS NOT NULL;
    END IF;
  END IF;
END $$;

-- 2. Add poster_id if missing (used by the INSERT scenario in the trigger)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bounty_requests'
      AND column_name  = 'poster_id'
  ) THEN
    ALTER TABLE public.bounty_requests
      ADD COLUMN poster_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

    -- Backfill poster_id from the parent bounty's poster/user
    UPDATE public.bounty_requests br
      SET poster_id = COALESCE(b.poster_id, b.user_id)
      FROM public.bounties b
      WHERE b.id = br.bounty_id
        AND br.poster_id IS NULL;
  END IF;
END $$;

-- 3. Ensure the unique constraint (bounty_id, hunter_id) exists.
--    This is only meaningful once hunter_id is populated; guard against nulls.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'bounty_requests'
      AND constraint_name   = 'unique_bounty_hunter'
      AND constraint_type   = 'UNIQUE'
  ) THEN
    -- Only add constraint if there are no duplicate (bounty_id, hunter_id) pairs
    -- (old data may have duplicates if user_id was not unique per bounty).
    IF NOT EXISTS (
      SELECT bounty_id, hunter_id
        FROM public.bounty_requests
        WHERE hunter_id IS NOT NULL
        GROUP BY bounty_id, hunter_id
        HAVING COUNT(*) > 1
    ) THEN
      ALTER TABLE public.bounty_requests
        ADD CONSTRAINT unique_bounty_hunter UNIQUE (bounty_id, hunter_id);
    END IF;
  END IF;
END $$;

-- 4. Indexes to match what 20251119 would have created
CREATE INDEX IF NOT EXISTS idx_bounty_requests_hunter_id
  ON public.bounty_requests(hunter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bounty_requests_poster_id
  ON public.bounty_requests(poster_id, created_at DESC);

NOTIFY pgrst, 'reload schema';

COMMIT;
