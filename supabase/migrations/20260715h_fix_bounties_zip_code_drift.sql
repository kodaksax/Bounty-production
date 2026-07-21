-- Migration: Fix schema drift — add missing bounties.zip_code column
-- Created: 2026-07-15
-- Purpose: bounties.zip_code was added directly against the live database
--          (likely as a hotfix for the "record \"new\" has no field
--          \"zip_code\"" error onboarding users hit when posting their
--          first bounty) but was never captured as a tracked migration —
--          so the repo's migration history didn't match production. Any
--          fresh environment (CI, a teammate's local Supabase, disaster
--          recovery) built purely from supabase/migrations/*.sql would be
--          missing this column and immediately reproduce that crash on the
--          onboarding "post a bounty" flow. Reconstructed idempotently
--          (matches the live column + comment verbatim) to close the gap —
--          see 20260714b_fix_selfie_submitted_at_drift.sql and
--          20260520193606_fix_bounties_username_nullable.sql for the same
--          drift-reconciliation pattern used elsewhere in this repo.

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS zip_code TEXT;

COMMENT ON COLUMN public.bounties.zip_code IS
  'Optional ZIP code entered by the poster. Powers future ZIP-matched bounty notifications.';
