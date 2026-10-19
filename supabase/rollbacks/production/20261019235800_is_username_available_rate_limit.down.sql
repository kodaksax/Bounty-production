-- Rollback for 20261019235800_is_username_available_rate_limit.sql.
-- Restores the unthrottled function from 20261019195723 and drops the counter
-- table. Signatures and grants are unchanged, so no client is affected.

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

REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated, service_role;

DROP TABLE IF EXISTS public.username_check_rate_limits;
