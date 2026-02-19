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
  retry_count INT := 0;
  max_retries INT := 10;
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
  
  -- Ensure username is unique by appending incrementing numbers
  -- Add maximum retry limit to prevent infinite loops
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = generated_username) AND retry_count < max_retries LOOP
    retry_count := retry_count + 1;
    generated_username := regexp_replace(substring(email_prefix from 1 for 20), '[^a-zA-Z0-9_]', '_', 'g') || '_' || retry_count::text;
  END LOOP;
  
  -- If we hit max retries, use full UUID to guarantee uniqueness
  IF retry_count >= max_retries THEN
    generated_username := 'user_' || NEW.id::text;
  END IF;

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

-- Validation: Prevent creating auth.users without a valid email
-- This BEFORE INSERT trigger will raise an exception and stop user creation
-- if the email is missing or does not match a basic email pattern.
CREATE OR REPLACE FUNCTION public.validate_new_user_email()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NULL OR trim(NEW.email) = '' THEN
    RAISE EXCEPTION 'auth: email is required for account creation';
  END IF;

  -- Basic email regex: local@domain.tld (TLD 2-24 chars)
  IF NOT (NEW.email ~* '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,24}$') THEN
    RAISE EXCEPTION 'auth: invalid email address';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop existing validation trigger if it exists
DROP TRIGGER IF EXISTS validate_auth_user_email ON auth.users;

-- Create trigger on auth.users table
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Create BEFORE INSERT trigger to validate email before the auth user is persisted
CREATE TRIGGER validate_auth_user_email
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_new_user_email();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.handle_new_user() IS 
  'Automatically creates a profile record when a new user signs up. '
  'This ensures profile data is always available and prevents skeleton loading issues.';

COMMIT;
