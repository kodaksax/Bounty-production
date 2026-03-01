-- Migration: Add selfie_submitted_at column to profiles
-- Description: Tracks when a user submitted their selfie for liveness verification.
-- Date: 2026-03-02

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS selfie_submitted_at TIMESTAMPTZ;

COMMIT;
