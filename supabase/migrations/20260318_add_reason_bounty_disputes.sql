-- Ensure `reason` column exists on `bounty_disputes` (idempotent)
-- This migration is safe to run multiple times and will be a no-op
-- if the column already exists. It addresses runtime errors where the
-- schema in the DB is missing the `reason` column expected by the app.

ALTER TABLE bounty_disputes
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- NOTE: If you want to enforce NOT NULL for historical data, run the
-- following steps after verifying existing rows:
-- 1) UPDATE bounty_disputes SET reason = '' WHERE reason IS NULL;
-- 2) ALTER TABLE bounty_disputes ALTER COLUMN reason SET NOT NULL;
