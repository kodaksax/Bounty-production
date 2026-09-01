-- Migration: restore the app.bypass_profile_guard bypass inside update_balance()
-- Created: 2026-08-31
--
-- Follow-up to 20260831120000, which now includes this same bypass restoration
-- directly (so that migration is self-sufficient on its own and does not leave
-- update_balance() broken a second, deeper way if applied without this one).
-- This migration re-applies the identical, already-correct function body via
-- CREATE OR REPLACE — a no-op change over 20260831120000 — kept as its own
-- migration to match the original two-step history of how this was diagnosed
-- and fixed in production.
--
-- Context: the out-of-band hardening pass that added the request.jwt.claims
-- guard to update_balance() also rewrote the body *without* the profile-guard
-- bypass that 20260719120000 had put around its UPDATE.  The jwt guard raised
-- first, so this second break stayed masked until 20260831120000's guard fix;
-- posting a funded v1 bounty then failed one layer deeper with:
--
--     Direct client writes to financial, risk, verification, or Stripe Connect
--     profile fields are not permitted...
--
-- That comes from prevent_client_writes_to_protected_profile_columns(), the
-- BEFORE UPDATE trigger on profiles.  It exempts a write only when
-- auth.role() = 'service_role' (again read from the end user's JWT, so false
-- inside fn_reserve_bounty_escrow) or when the transaction-local GUC
-- app.bypass_profile_guard is 'on'.  update_balance() is the one trusted writer
-- that had stopped setting it.
--
-- This restores the bypass exactly as 20260719120000 specified it, on top of
-- the current_user guard from 20260831120000, and keeps the fix to a latent
-- defect in that original bypass ordering: PL/pgSQL's FOUND is reassigned by
-- PERFORM, and `SELECT set_config(...)` always returns a row, so the
-- `PERFORM set_config(...'off'...)` between the UPDATE and the `IF NOT FOUND`
-- check left FOUND permanently true.  The 'User not found' P0002 branch was
-- therefore dead: update_balance() for a nonexistent user silently returned
-- NULL instead of raising (and the NULL then skipped the < 0 check too).  The
-- FOUND test now sits immediately after the UPDATE, before any other statement
-- can clobber it.
--
-- Unchanged and still verified: only postgres and service_role hold EXECUTE.

CREATE OR REPLACE FUNCTION public.update_balance(
  p_user_id UUID,
  p_amount NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  -- Backend-only.  This is a SECURITY DEFINER function, so current_user is
  -- always its owner (postgres), on any call path — direct or nested. It does
  -- not distinguish a direct client call from a nested one from a trusted
  -- caller; the real "backend-only" enforcement is the EXECUTE grants below
  -- (only postgres/service_role hold EXECUTE, so PostgREST 42501s a direct
  -- client call before the body runs). This check is defence in depth for the
  -- case a grant is later handed out by mistake, asserting the function is
  -- running as a trusted owner role.
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'update_balance: backend-only function'
      USING ERRCODE = '42501';
  END IF;

  -- profiles.balance is a protected column: announce this as a trusted write so
  -- prevent_client_writes_to_protected_profile_columns() lets the UPDATE
  -- through.  Transaction-local (is_local = true), so it cannot leak past this
  -- transaction, and an aborted (sub)transaction rolls it back with everything
  -- else.
  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  UPDATE profiles
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;

  -- Must be tested here, before any other statement: PERFORM reassigns FOUND.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  -- Close the bypass window as soon as the trusted write is done.
  PERFORM set_config('app.bypass_profile_guard', 'off', true);

  -- The bounty escrow trigger relies on this 23514 to roll back an under-funded
  -- bounty INSERT.
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient funds: new balance would be %', v_new_balance
      USING ERRCODE = '23514';
  END IF;

  RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.update_balance(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_balance(UUID, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.update_balance(UUID, NUMERIC) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_balance(UUID, NUMERIC) TO service_role;
