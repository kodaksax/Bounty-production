-- Migration: Add onboarding_completed field
-- Description: Track whether a user has completed the onboarding flow
-- Date: 2025-11-22
-- 
-- This migration adds a boolean field to track onboarding completion.
-- When a user deletes their account and re-signs up, they will need to
-- go through onboarding again since this field will be null/false for new users.

BEGIN;

-- Add onboarding_completed column to profiles table
-- Default to false for new profiles
-- Existing profiles without this field should be considered incomplete until they complete onboarding
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- Set existing profiles to true (assume they've already gone through onboarding)
-- Only for profiles that have a username set
UPDATE profiles 
  SET onboarding_completed = true 
  WHERE username IS NOT NULL AND username != '';

COMMIT;
