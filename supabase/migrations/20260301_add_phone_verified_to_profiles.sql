-- Migration: Add phone verification columns to profiles
-- Description: Store phone verification status and timestamp for trust/compliance purposes
-- Date: 2026-03-01
--
-- This migration adds two columns to the profiles table:
-- 1. phone_verified (boolean) - Whether the user has verified their phone number
-- 2. phone_verified_at (timestamptz) - When the verification occurred (for audit purposes)

BEGIN;

-- Add phone_verified column to profiles table
-- Default to false for new profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;

-- Add phone_verified_at timestamp column for audit purposes
-- This records when the user completed phone verification
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Backfill phone_verified from auth.users user_metadata for existing users
-- Safely updates profiles where phone_verified is currently NULL or false
-- and the user has phone_verified: true in their auth metadata
UPDATE profiles p
SET
  phone_verified = true,
  phone_verified_at = COALESCE(
    (u.raw_user_meta_data->>'phone_verified_at')::TIMESTAMPTZ,
    p.created_at
  )
FROM auth.users u
WHERE p.id = u.id
  AND (p.phone_verified IS NULL OR p.phone_verified = false)
  AND (u.raw_user_meta_data->>'phone_verified')::boolean = true;

-- Create a partial index on phone_verified for efficient filtering of verified users
CREATE INDEX IF NOT EXISTS idx_profiles_phone_verified
  ON profiles(phone_verified)
  WHERE phone_verified = true;

COMMIT;

-- Notes:
-- 1) phone_verified stores the boolean result of OTP verification
-- 2) phone_verified_at provides an audit trail for when verification occurred
-- 3) Existing users who have phone_verified: true in auth metadata are backfilled
-- 4) New verifications write both columns via phone-verification-service.ts
