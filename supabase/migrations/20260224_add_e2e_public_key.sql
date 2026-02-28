-- Migration: Add e2e_public_key column for end-to-end encrypted messaging
-- Description: Each user's X25519 public key is stored here so that other users
--              can encrypt messages specifically for them. The matching private key
--              never leaves the user's device (stored in expo-secure-store).
-- Date: 2026-02-24

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS e2e_public_key TEXT;

COMMENT ON COLUMN profiles.e2e_public_key IS
  'X25519 public key (base64) used for end-to-end encrypted messaging via nacl.box. '
  'The private key is kept exclusively on the owner''s device in expo-secure-store.';

COMMIT;
