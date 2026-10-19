-- Applied 2026-10-19: production as 20261019195723 (this file's version),
-- staging as 20261019194109 (apply-time versions differ per project).
--
-- Live username availability for sign-up and onboarding.
--
-- The client checked availability with a plain `profiles` SELECT, but every
-- SELECT policy on profiles is own-row only ((auth.uid() = id)) on staging and
-- production. Signed out at sign-up, the query could never see anyone else's
-- row, returned no row and no error, and so reported every username as
-- "available" until /auth/register answered 409 "Username already taken".
-- Shoal's 19 Oct poster-conversion run hit that contradiction 3 times in 6.
--
-- This function answers the one question without exposing any profile data:
-- is this name free (for the caller, if signed in)? It mirrors /auth/register's
-- rule: usernames are compared case-insensitively, since they are stored
-- lowercase and register lowercases what it is given. The caller's own row
-- doesn't count against them, so a signed-in user re-checking their current
-- name sees it as available.
--
-- Returns NULL for input that is not a well-formed username (3-24 of
-- [A-Za-z0-9_], register's own format rule), so the client never mistakes
-- "can't be a username" for "taken" or "free".
--
-- What it reveals: whether a username exists. That is already public (profile
-- pages, bounty cards) and already answered by register's 409, so this adds no
-- new disclosure, only the timing of it.

-- The lookup below is by lower(username). Production already has this index
-- (idx_profiles_username_lower); staging does not. Same name, so this is a
-- no-op where it exists.
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower ON public.profiles (lower(username));

CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_username IS NULL OR btrim(p_username) !~ '^[A-Za-z0-9_]{3,24}$' THEN NULL
    ELSE NOT EXISTS (
      SELECT 1
        FROM public.profiles p
       WHERE lower(p.username) = lower(btrim(p_username))
         AND p.id IS DISTINCT FROM auth.uid()
    )
  END;
$$;

COMMENT ON FUNCTION public.is_username_available(text) IS
  'Sign-up/onboarding username availability. NULL = malformed input; '
  'case-insensitive; the caller''s own row is ignored. Reveals existence only.';

-- Deliberately callable by signed-out clients: sign-up runs as anon. Grant
-- explicitly rather than relying on the default grant this project applies to
-- new public functions, and make sure no PUBLIC grant remains.
REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated, service_role;
