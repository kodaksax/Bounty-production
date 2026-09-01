-- Migration: repair the backend-only guard on update_balance()
-- Created: 2026-08-31
--
-- A hardening pass added a runtime guard to public.update_balance() that reads
-- the *request* role out of request.jwt.claims and raises 42501 unless it is
-- service_role/supabase_admin:
--
--     v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
--     IF v_role IS NOT NULL AND v_role NOT IN ('service_role','supabase_admin') THEN
--       RAISE EXCEPTION 'update_balance: backend-only function' USING ERRCODE = '42501';
--
-- request.jwt.claims is a *session* GUC: it stays set to the end user's JWT for
-- the whole PostgREST request, including inside SECURITY DEFINER functions and
-- triggers.  So the guard did not just block direct client calls — it blocked
-- every legitimate internal caller reached from an authenticated session:
--
--     fn_reserve_bounty_escrow()            (AFTER INSERT trigger on bounties)
--     apply_escrow()
--     apply_dispute_loss_transaction()
--     fail_legacy_withdrawal()
--     fn_refund_wallet_escrow_for_dispute()
--     fn_release_wallet_escrow_for_dispute()
--
-- The user-visible symptom was that posting any funded v1 (pay-at-post) bounty
-- failed with `update_balance: backend-only function`, because the escrow
-- reservation trigger from 20260518 calls update_balance() in the poster's own
-- transaction.
--
-- The fix keeps the guard's intent but tests the right thing: current_user.
-- PostgREST does SET ROLE per request, so a direct rpc('update_balance') from a
-- client runs (and is rejected) as whatever role EXECUTE was granted to.  Note
-- that current_user does not itself distinguish a direct call from a nested
-- one: this SECURITY DEFINER function always executes as its owner
-- (postgres), on any call path.  Enforcement of "backend-only" is really done
-- by the EXECUTE grants below (only postgres/service_role hold EXECUTE, so
-- PostgREST 42501s a client call before the body runs); this in-body check is
-- defence in depth for if a grant is later handed out by mistake, asserting
-- that the function is running as a trusted owner role.
--
-- The same out-of-band rewrite also dropped the app.bypass_profile_guard
-- set_config() that 20260719120000 had put around the UPDATE, so this
-- migration restores it here too (rather than leaving update_balance broken a
-- second, deeper way until a follow-up migration lands): without it,
-- prevent_client_writes_to_protected_profile_columns() rejects the write to
-- profiles.balance from inside an end-user transaction.  The FOUND check is
-- also moved to sit immediately after the UPDATE, since PERFORM reassigns
-- FOUND and would otherwise mask a nonexistent p_user_id.

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

  -- Enforce non-negative balance.  The bounty escrow trigger relies on this
  -- 23514 to roll back an under-funded bounty INSERT.
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient funds: new balance would be %', v_new_balance
      USING ERRCODE = '23514';
  END IF;

  RETURN v_new_balance;
END;
$$;

-- Primary control: no client role may call this over PostgREST.
REVOKE ALL ON FUNCTION public.update_balance(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_balance(UUID, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.update_balance(UUID, NUMERIC) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_balance(UUID, NUMERIC) TO service_role;

COMMENT ON FUNCTION public.update_balance(UUID, NUMERIC) IS
  'Atomically updates a user balance and returns the new value. Enforces non-negative balance. '
  'Backend-only: EXECUTE is granted to service_role only, and the body rejects any current_user '
  'other than postgres/service_role/supabase_admin. Callable from SECURITY DEFINER wallet '
  'functions (fn_reserve_bounty_escrow, apply_escrow, ...) even inside an end-user transaction.';
