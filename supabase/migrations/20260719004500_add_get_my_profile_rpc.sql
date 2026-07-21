-- Migration: get_my_profile() -- self-read RPC for the profiles RLS hardening plan
-- Created: 2026-07-19
--
-- BACKGROUND: docs/withdrawals/08-profiles-rls-migration-strategy.md's step 5
-- (REVOKE SELECT on balance/stripe_*/risk_*/email/phone from
-- authenticated/anon) is blocked on a real gap found 2026-07-18: a
-- column-level REVOKE can't distinguish "read your own row" from "read
-- anyone's row", and lib/services/auth-profile-service.ts's self-read path
-- (fetchAndSyncProfile/fetchFreshProfileInBackground, populating AuthContext
-- on login) does `profiles.select('*').eq('id', <own-id>)` via the anon-key
-- client -- exactly what a blanket REVOKE would also break.
--
-- This function is that prerequisite: SECURITY DEFINER, hard-scoped to
-- auth.uid() with no caller-supplied id parameter (so there is no way to use
-- it to read another user's row, unlike an unsafe SECURITY DEFINER function
-- that trusts a caller-supplied p_user_id), returns every column regardless
-- of any future column REVOKE, since SECURITY DEFINER functions run with the
-- defining role's privileges, not the caller's.
--
-- NOT YET WIRED IN: auth-profile-service.ts still uses the direct
-- `.select('*').eq('id', userId)` self-read (which still works today, since
-- the REVOKE hasn't been applied). Migrating it to call this RPC instead --
-- and updating updateProfile()'s `.update(...).select()` RETURNING pattern,
-- which has the same problem and is covered by 16 tests in
-- __tests__/integration/edit-profile-flow.test.ts including a documented
-- past regression ("onboarding loop") -- is deliberately left as separate,
-- dedicated follow-up work rather than rushed through here. The column
-- REVOKE (step 5) should not be applied until that migration is done and
-- verified, or `updateProfile()`/`fetchAndSyncProfile()` will start failing
-- for every user, not just the cross-user leak this is meant to close.

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_profile() IS
  'Returns the calling user''s own profiles row (all columns), scoped to auth.uid() with no caller-supplied parameter. SECURITY DEFINER so it keeps working after profiles column-level REVOKE (see docs/withdrawals/08-profiles-rls-migration-strategy.md) -- safe because the row is hard-scoped server-side, not caller-supplied. Not yet called by any client code as of this migration; see the header comment for what still needs to migrate first.';

-- authenticated only -- there is no self to read for anon, and unlike
-- withdraw_balance/update_balance (service_role only, take a caller-supplied
-- user_id), this one is meant to be called directly by the client.
-- Postgres grants EXECUTE to PUBLIC by default on function creation, which
-- `anon` inherits -- not exploitable here (auth.uid() is NULL for anon, so
-- the WHERE clause matches nothing) but explicitly revoked anyway to match
-- stated intent rather than relying on an incidental safe default.
REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
