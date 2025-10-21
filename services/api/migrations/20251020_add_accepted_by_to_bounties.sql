-- Migration: add accepted_by column to bounties
-- Date: 2025-10-20
-- Purpose: allow server to persist the hunter assigned to a bounty

-- Up: add column (nullable) and an index. Uses UUID referencing profiles.id when available.
BEGIN;

ALTER TABLE IF EXISTS bounties
  ADD COLUMN IF NOT EXISTS accepted_by uuid;

-- Optional: add a foreign key constraint if profiles table exists and you want referential integrity
-- Note: If you use row-level security (RLS) and restricted roles, ensure the migrations are applied
-- in a context that can create constraints (service role).
ALTER TABLE IF EXISTS bounties
  ADD CONSTRAINT IF NOT EXISTS bounties_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bounties_accepted_by ON bounties (accepted_by);

COMMIT;

-- Down (rollback): remove index, constraint, and column
-- To rollback, run the following statements in a safe maintenance window:
-- BEGIN;
-- ALTER TABLE IF EXISTS bounties DROP CONSTRAINT IF EXISTS bounties_accepted_by_fkey;
-- DROP INDEX IF EXISTS idx_bounties_accepted_by;
-- ALTER TABLE IF EXISTS bounties DROP COLUMN IF EXISTS accepted_by;
-- COMMIT;
