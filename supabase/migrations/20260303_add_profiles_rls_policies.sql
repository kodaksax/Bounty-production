-- Migration: Add RLS policies for the profiles table
-- Date: 2026-03-03
--
-- The profiles table is used by the client-side Supabase SDK (anon/authenticated key).
-- Without proper RLS policies the PostgREST UPDATE/INSERT calls hang or silently
-- fail for authenticated users, causing the onboarding username-save step to time out.
--
-- Policy overview:
--   SELECT  → any authenticated user can read any profile (needed for viewing posters/hunters)
--   INSERT  → a user can only insert a row where id = their own auth.uid()
--   UPDATE  → a user can only update the row where id = their own auth.uid()
--   (DELETE is intentionally omitted – deletion is handled server-side with safe_user_deletion)

BEGIN;

-- Enable RLS (idempotent – safe to run even if already enabled)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user can read all profiles
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: user may only insert their own profile row
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- UPDATE: user may only update their own profile row
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Ensure the authenticated role still has the necessary table-level privileges
-- (these GRANTs are safe to repeat)
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

COMMIT;
