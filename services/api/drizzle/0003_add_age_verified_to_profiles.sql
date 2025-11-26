-- Migration: Add age_verified and age_verified_at to profiles
-- Run this on your Postgres / Supabase database
-- NOTE: Review RLS policies - authenticated users must be allowed to read these columns where appropriate.

BEGIN;

-- Add age_verified column to profiles table
ALTER TABLE IF EXISTS profiles
ADD COLUMN IF NOT EXISTS age_verified boolean DEFAULT false;

-- Add age_verified_at timestamp column for audit purposes
ALTER TABLE IF EXISTS profiles
ADD COLUMN IF NOT EXISTS age_verified_at timestamptz;

-- Backfill from auth.users user_metadata if age_verified was stored there
-- This sets age_verified = true and age_verified_at = profile creation date for existing users
UPDATE profiles p
SET 
  age_verified = true,
  age_verified_at = p.created_at
FROM auth.users u
WHERE p.id = u.id
  AND (p.age_verified IS NULL OR p.age_verified = false)
  AND (u.raw_user_meta_data->>'age_verified')::boolean = true;

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_profiles_age_verified ON profiles(age_verified);

COMMIT;

-- Notes:
-- 1) Supabase's built-in auth.users table stores user_metadata in a JSON column. We prefer
--    storing age_verified in the application `profiles` table for easier querying and RLS.
-- 2) The age_verified_at timestamp provides an audit trail for compliance purposes.
-- 3) Ensure your RLS policies allow SELECT on `profiles.age_verified` where appropriate.
