-- Migration: Add payout_failed_at column to profiles
-- Created: 2026-03-30
-- Purpose: Track when a hunter's Stripe payout fails so support can follow up.
--          Referenced by the payout.failed webhook handler in consolidated-webhooks.ts.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS payout_failed_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN profiles.payout_failed_at IS 'Timestamp of the most recent failed Stripe payout (set by payout.failed webhook for support follow-up)';
