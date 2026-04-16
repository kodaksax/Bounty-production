-- Add missing updated_at and last_activity_at columns to bounty_disputes.
-- The `bounty_disputes` table was created before the comprehensive dispute system
-- migration (20260109) which assumed these columns already existed via
-- CREATE TABLE IF NOT EXISTS. The trigger `update_dispute_last_activity` tries
-- to SET updated_at = NOW() but fails with error 42703 if the column is absent.

ALTER TABLE public.bounty_disputes
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows so the columns are not NULL
UPDATE public.bounty_disputes
SET
  updated_at      = COALESCE(updated_at, created_at, NOW()),
  last_activity_at = COALESCE(last_activity_at, created_at, NOW())
WHERE updated_at IS NULL OR last_activity_at IS NULL;
