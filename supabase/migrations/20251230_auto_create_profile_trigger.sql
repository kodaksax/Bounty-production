-- Migration: Auto-create profile on auth user creation
-- Description: Ensure every authenticated user automatically gets a profile record
-- Date: 2025-12-30
-- 
-- This migration creates a trigger that automatically creates a profile
-- whenever a new user is created in auth.users. This prevents the
-- "perpetual skeleton loading" issue where screens wait indefinitely
-- for a profile that was never created.

BEGIN;

-- Create function to handle new user profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  generated_username TEXT;
  email_prefix TEXT;
BEGIN
  -- Generate username from email or use UUID prefix
  IF NEW.email IS NOT NULL THEN
    -- Extract prefix before @ symbol
    email_prefix := split_part(NEW.email, '@', 1);
    -- Clean up email prefix: replace dots, dashes with underscores, limit length
    generated_username := regexp_replace(substring(email_prefix from 1 for 20), '[^a-zA-Z0-9_]', '_', 'g');
  ELSE
    -- Fallback to UUID-based username
    generated_username := 'user_' || substring(NEW.id::text from 1 for 8);
  END IF;
  
  -- Ensure username is unique by appending numbers if needed
  -- Add maximum retry limit to prevent infinite loops
  DECLARE
    retry_count INT := 0;
    max_retries INT := 10;
  BEGIN
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = generated_username) AND retry_count < max_retries LOOP
      generated_username := generated_username || floor(random() * 100)::text;
      retry_count := retry_count + 1;
    END LOOP;
    
    -- If we hit max retries, fallback to UUID-based username
    IF retry_count >= max_retries THEN
      generated_username := 'user_' || substring(NEW.id::text from 1 for 8);
    END IF;
  END;

  -- Insert new profile with data from auth.users
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
  VALUES (
    NEW.id,
    generated_username,
    NEW.email,
    0.00,
    -- Check user_metadata for age_verified flag from signup
    COALESCE((NEW.raw_user_meta_data->>'age_verified')::boolean, false),
    -- Set age_verified_at timestamp if age was verified during signup
    CASE 
      WHEN COALESCE((NEW.raw_user_meta_data->>'age_verified')::boolean, false) = true 
      THEN NOW() 
      ELSE NULL 
    END,
    -- New users haven't completed onboarding yet
    false,
    NOW(),
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger on auth.users table
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.handle_new_user() IS 
  'Automatically creates a profile record when a new user signs up. '
  'This ensures profile data is always available and prevents skeleton loading issues.';

COMMIT;
