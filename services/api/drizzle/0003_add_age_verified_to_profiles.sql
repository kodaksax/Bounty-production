-- Draft migration: Add age_verified to profiles
-- Run this on your Postgres / Supabase database
-- NOTE: Review RLS policies - authenticated users must be allowed to read this column where appropriate.

BEGIN;

-- Add column to profiles table
ALTER TABLE IF EXISTS profiles
ADD COLUMN IF NOT EXISTS age_verified boolean DEFAULT false NOT NULL;

-- Optional: Backfill from auth.users user_metadata if you store age_verified there
-- This assumes auth.users.user_metadata contains a JSON field with {"age_verified": true}
-- Update profiles by joining on auth.users - adjust schema/owner as needed
-- UPDATE profiles p
-- SET age_verified = (u.user_metadata->>'age_verified')::boolean
-- FROM auth.users u
-- WHERE p.id = u.id
-- AND (p.age_verified IS NULL OR p.age_verified = false)

COMMIT;

-- Notes:
-- 1) Supabase's built-in auth.users table stores user_metadata in a JSON column. We prefer
--    storing age_verified in the application `profiles` table for easier querying and RLS.
-- 2) If you want to store it in auth.users, be aware you cannot easily ALTER the auth.users
--    table managed by Supabase; instead use `supabase.auth.updateUser` server-side or via Admin API
--    to set user_metadata.age_verified when creating accounts.
-- 3) Ensure your RLS policies allow SELECT on `profiles.age_verified` where appropriate.
