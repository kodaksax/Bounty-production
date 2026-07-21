-- Migration: Add onboarding persona/version/progressive-completion tracking to profiles
-- Created: 2026-07-14
-- Purpose: The onboarding redesign (welcome.tsx) asks new users to pick a
--          marketplace persona ("Get something done" / "Start earning nearby")
--          but today that choice is only ever held in local AsyncStorage
--          (lib/context/onboarding-context.tsx) and discarded when onboarding
--          completes — the backend has no record of it. This migration adds:
--            1. primary_role — the persisted persona, distinct from the
--               existing `role` column (admin/user/moderator/staff), which is
--               a platform authorization role, not a marketplace persona.
--            2. onboarding_version — which onboarding flow a user completed,
--               so future onboarding redesigns can detect + migrate/re-prompt
--               users who went through an older version instead of guessing.
--            3. profile_completeness — progressive profile-completion
--               tracking (which optional fields are filled in), computed
--               client-side today and written here so it can also drive
--               server-side nudges/notifications later.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS primary_role text,
  ADD COLUMN IF NOT EXISTS onboarding_version smallint,
  ADD COLUMN IF NOT EXISTS profile_completeness jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_primary_role_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_primary_role_check
      CHECK (primary_role IS NULL OR primary_role IN ('poster', 'hunter', 'both'));
  END IF;
END $$;

COMMENT ON COLUMN profiles.primary_role IS
  'Marketplace persona selected during onboarding (poster/hunter/both). Distinct from profiles.role, which is a platform authorization role (admin/user/moderator/staff).';

COMMENT ON COLUMN profiles.onboarding_version IS
  'Which onboarding flow version the user completed (see lib/context/onboarding-context.tsx CURRENT_ONBOARDING_VERSION). Lets future onboarding redesigns detect and handle users who completed an older flow.';

COMMENT ON COLUMN profiles.profile_completeness IS
  'Progressive profile-completion tracking as {field: boolean}, e.g. {"avatar": true, "bio": false}. Computed client-side (lib/services/userProfile.ts) and mirrored here for server-side nudges.';
