-- Migration: Add age verification columns to profiles
-- Description: Store age verification status and timestamp for audit/compliance purposes
-- Date: 2025-11-26
-- 
-- This migration adds two columns to the profiles table:
-- 1. age_verified (boolean) - Whether the user has confirmed they are 18+
-- 2. age_verified_at (timestamptz) - When they confirmed (for audit purposes)
--
-- The age_verified_at timestamp is critical for compliance auditing, allowing us to
-- prove when a user agreed to the 18+ requirement.

BEGIN;

-- Add age_verified column to profiles table
-- Default to false for new profiles
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS age_verified BOOLEAN DEFAULT false;

-- Add age_verified_at timestamp column for audit purposes
-- This records when the user agreed to being 18+
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS age_verified_at TIMESTAMPTZ;

-- Backfill age_verified from auth.users user_metadata for existing users
-- This safely updates profiles where age_verified is currently NULL or false
-- and the user has age_verified: true in their auth metadata
UPDATE profiles p
SET 
  age_verified = true,
  age_verified_at = p.created_at  -- Use profile creation date as best approximation for existing users
FROM auth.users u
WHERE p.id = u.id
  AND (p.age_verified IS NULL OR p.age_verified = false)
  AND (u.raw_user_meta_data->>'age_verified')::boolean = true;

-- Create an index on age_verified for efficient filtering queries
-- This helps when filtering profiles by verification status
CREATE INDEX IF NOT EXISTS idx_profiles_age_verified ON profiles(age_verified);

COMMIT;

-- Notes:
-- 1) The age_verified column stores the boolean confirmation from sign-up
-- 2) The age_verified_at timestamp provides audit trail for compliance purposes
-- 3) Existing users who signed up with age_verified: true in user_metadata are
--    backfilled with age_verified = true and age_verified_at = their profile creation date
-- 4) New sign-ups will have both columns set during profile creation
-- 5) RLS policies should allow authenticated users to read their own age_verified status
