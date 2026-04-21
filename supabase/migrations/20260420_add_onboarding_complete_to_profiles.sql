-- Migration: Add onboarding_complete to profiles
-- Created: 2026-04-20
-- Purpose: Track whether the user has finished Stripe Connect embedded onboarding.
--          Authoritative charges/payouts enablement still comes from Stripe via
--          the account.updated webhook into stripe_connect_{charges,payouts}_enabled.
--          This column is a convenience flag set when the embedded component fires
--          its onExit event and/or when the webhook sees both capabilities enabled.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false;

COMMENT ON COLUMN profiles.onboarding_complete IS
  'Whether the user has completed Stripe Connect embedded onboarding. Set optimistically on onExit and confirmed by the account.updated webhook when charges_enabled AND payouts_enabled.';

-- Backfill from existing state: anyone with both capabilities already enabled is complete.
UPDATE profiles
SET onboarding_complete = true
WHERE onboarding_complete IS DISTINCT FROM true
  AND stripe_connect_charges_enabled = true
  AND stripe_connect_payouts_enabled = true;
