-- Migration: Add payout_failure_code column to profiles
-- Stores the Stripe failure_code from the most recent payout.failed event
-- so the mobile app can display a human-friendly recovery message.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS payout_failure_code text DEFAULT NULL;

COMMENT ON COLUMN profiles.payout_failure_code IS
  'Stripe failure_code from the most recent payout.failed event (e.g. account_closed, insufficient_funds). Cleared when payout_failed_at is cleared.';
