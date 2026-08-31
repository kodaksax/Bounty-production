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
-- client runs with current_user = 'anon'/'authenticated' and is still rejected;
-- a nested call from one of the SECURITY DEFINER functions above runs with
-- current_user = 'postgres' (their owner) and is allowed.
--
-- Grants are the primary control and are re-asserted below: only postgres and
-- service_role hold EXECUTE, so PostgREST rejects a direct client call with
-- 42501 before the body ever runs.  The current_user check is defence in depth
-- in case a future grant is handed out by mistake.

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
  -- Backend-only.  current_user is the *effective* role: it is the caller's
  -- PostgREST role for a direct call, and the definer (postgres) when reached
  -- from one of the SECURITY DEFINER wallet functions/triggers.  Unlike
  -- request.jwt.claims this distinguishes the two, so internal callers running
  -- inside an end user's transaction are not rejected.
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'update_balance: backend-only function'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

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
