-- Migration: Backfill profiles for existing auth users without a profile
-- Description: Backwards-compatibility fix for auth users created before the
--   auto-create trigger (20251230) or in edge cases where the trigger failed.
--   These users will be directed to the onboarding flow on next sign-in because
--   onboarding_completed is set to false.
-- Date: 2026-02-21

BEGIN;

-- Create profiles for any auth.users that do not yet have a row in public.profiles.
-- Uses the same username generation logic as handle_new_user() but handles collisions
-- in bulk via a suffix derived from the user's UUID.
-- The INSERT and diagnostic are wrapped in a single DO block so GET DIAGNOSTICS
-- captures the row count from the INSERT, not from the block itself.
DO $$
DECLARE
  inserted_count INT;
BEGIN
  INSERT INTO public.profiles (
    id,
    username,
    email,
    balance,
    age_verified,
    age_verified_at,
    onboarding_completed,
    created_at,
    updated_at
  )
  SELECT
    u.id,
    -- Generate a username: clean email prefix up to 15 chars, then append a short
    -- UUID suffix to guarantee uniqueness across the batch.
    regexp_replace(
      substring(split_part(COALESCE(u.email, ''), '@', 1) FROM 1 FOR 15),
      '[^a-zA-Z0-9_]', '_', 'g'
    ) || '_' || substring(u.id::text FROM 1 FOR 6) AS username,
    u.email,
    0.00 AS balance,
    COALESCE((u.raw_user_meta_data->>'age_verified')::boolean, false) AS age_verified,
    CASE
      WHEN COALESCE((u.raw_user_meta_data->>'age_verified')::boolean, false) = true
      THEN u.created_at
      ELSE NULL
    END AS age_verified_at,
    -- Mark onboarding as incomplete so these users are directed to complete it
    false AS onboarding_completed,
    u.created_at,
    NOW() AS updated_at
  FROM auth.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = u.id
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'backfill_missing_profiles: inserted % profile(s) for existing auth users', inserted_count;
END;
$$;

COMMIT;
