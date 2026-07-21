-- Migration: Disambiguate profiles.onboarding_complete from profiles.onboarding_completed
-- Created: 2026-07-14
-- Purpose: Two near-identically-named, unrelated columns existed on profiles:
--            - onboarding_completed (2025-11-22): has the app finished its
--              own onboarding wizard? Read/written in ~50 places across
--              auth, navigation gating, and onboarding itself. Canonical —
--              left untouched.
--            - onboarding_complete (2026-04-20): has the user finished
--              Stripe Connect's embedded payout onboarding? Written only by
--              app/wallet/connect/embedded-onboarding.tsx (optimistic client
--              flag) and supabase/functions/webhooks/index.ts (authoritative,
--              from the account.updated webhook). Never read anywhere — the
--              migration that introduced it already documented
--              stripe_connect_charges_enabled/stripe_connect_payouts_enabled
--              as the real source of truth, making this column pure
--              write-only telemetry that happened to collide in name with
--              the unrelated, load-bearing onboarding_completed.
--          Renaming (not dropping) preserves the historical signal while
--          removing the naming collision. A plain RENAME COLUMN is a
--          metadata-only operation — no data is rewritten, no downtime.

ALTER TABLE profiles
  RENAME COLUMN onboarding_complete TO stripe_connect_onboarding_complete;

COMMENT ON COLUMN profiles.stripe_connect_onboarding_complete IS
  'Optimistic/webhook-confirmed flag: has the user completed Stripe Connect embedded onboarding? stripe_connect_charges_enabled AND stripe_connect_payouts_enabled remain the authoritative source. Formerly named onboarding_complete — renamed to avoid collision with the unrelated onboarding_completed (app onboarding wizard).';
