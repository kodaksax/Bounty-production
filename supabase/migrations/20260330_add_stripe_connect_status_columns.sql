-- Migration: Add Stripe Connect status columns to profiles
-- Created: 2026-03-30
-- Purpose: Store Stripe Connect account status fields synced from account.updated webhook

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_requirements jsonb DEFAULT NULL;

COMMENT ON COLUMN profiles.stripe_connect_charges_enabled IS 'Whether the Connect account can accept charges (synced from Stripe)';
COMMENT ON COLUMN profiles.stripe_connect_payouts_enabled IS 'Whether the Connect account can receive payouts (synced from Stripe)';
COMMENT ON COLUMN profiles.stripe_connect_requirements IS 'Stripe Connect account requirements/verification status (synced from Stripe)';
