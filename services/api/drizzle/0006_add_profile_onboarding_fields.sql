-- Migration: Add profile fields for onboarding completion
-- Description: Adds title, location, skills, and onboarding_completed to profiles table
-- These fields are collected during onboarding but were not being saved to Supabase

-- Add title column for professional title/role
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS title text;

-- Add location column for user's geographic location  
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS location text;

-- Add skills column as JSONB array for user's skills/expertise
-- Using JSONB allows efficient querying and indexing
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS skills jsonb DEFAULT '[]'::jsonb;

-- Add onboarding_completed flag to track if user finished onboarding
-- This helps determine if user should be shown onboarding screens
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN profiles.title IS 'User professional title or role (e.g., "Full Stack Developer")';
COMMENT ON COLUMN profiles.location IS 'User geographic location (e.g., "San Francisco, CA")';
COMMENT ON COLUMN profiles.skills IS 'Array of user skills stored as JSONB (e.g., ["React", "Node.js"])';
COMMENT ON COLUMN profiles.onboarding_completed IS 'Flag indicating if user has completed the onboarding flow';
