-- Migration 0002: Add poster_id and hunter_id foreign key constraints and indexes
-- This migration is idempotent: it checks for existing columns/constraints before altering.

BEGIN;

-- Add poster_id column to bounties if missing (keep existing user_id for compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'bounties' AND column_name = 'poster_id'
  ) THEN
    ALTER TABLE bounties ADD COLUMN poster_id uuid;
  END IF;
END$$;

-- Backfill poster_id from user_id if present
UPDATE bounties SET poster_id = user_id WHERE poster_id IS NULL AND user_id IS NOT NULL;

-- Ensure profiles primary key exists (fail early if not)
-- Add FK constraint on poster_id -> profiles(id) if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.contype = 'f' AND t.relname = 'bounties' AND c.conname = 'bounties_poster_id_fkey'
  ) THEN
    ALTER TABLE bounties
      ADD CONSTRAINT bounties_poster_id_fkey FOREIGN KEY (poster_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END$$;

-- Add hunter_id column to bounty_requests if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'bounty_requests' AND column_name = 'hunter_id'
  ) THEN
    ALTER TABLE bounty_requests ADD COLUMN hunter_id uuid;
  END IF;
END$$;

-- Backfill hunter_id from user_id where applicable
UPDATE bounty_requests SET hunter_id = user_id WHERE hunter_id IS NULL AND user_id IS NOT NULL;

-- Add FK constraint on hunter_id -> profiles(id) if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.contype = 'f' AND t.relname = 'bounty_requests' AND c.conname = 'bounty_requests_hunter_id_fkey'
  ) THEN
    ALTER TABLE bounty_requests
      ADD CONSTRAINT bounty_requests_hunter_id_fkey FOREIGN KEY (hunter_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END$$;

-- Create indexes for quick joins (if not exist)
CREATE INDEX IF NOT EXISTS idx_bounties_poster_id ON bounties(poster_id);
CREATE INDEX IF NOT EXISTS idx_bounty_requests_hunter_id ON bounty_requests(hunter_id);

COMMIT;
