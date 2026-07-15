-- Migration: Fix schema drift — add missing selfie_submitted_at column
-- Created: 2026-07-14
-- Purpose: app/verification/selfie.tsx has always written
--          profiles.selfie_submitted_at, and a local migration file
--          (20260302_add_selfie_submitted_at.sql) already existed for it —
--          but the column was never actually present on the live database,
--          so every selfie submission has been silently failing with a
--          "column does not exist" error. This re-applies that migration's
--          effect (idempotently) to close the drift. No column rename or
--          repurposing is warranted: selfie liveness capture is a distinct
--          verification step from the ID front/back upload (tracked by
--          id_submitted_at), so it earns its own timestamp column.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS selfie_submitted_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.selfie_submitted_at IS
  'When the user submitted their liveness selfie (app/verification/selfie.tsx). Distinct from id_submitted_at (ID document upload).';
