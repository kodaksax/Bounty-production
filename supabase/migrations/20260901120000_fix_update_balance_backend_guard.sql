-- update_balance(): repair the "backend-only" guard and restore the profile-guard bypass.
--
-- An out-of-band rewrite replaced the guard with a check on
-- request.jwt.claims ->> 'role'.  That GUC is session-scoped: inside a
-- SECURITY DEFINER function reached from a client RPC it still holds the end
-- user's JWT, so the guard could not tell a direct client call from a nested
-- internal one and rejected every internal caller --
-- fn_reserve_bounty_escrow (AFTER INSERT trigger on bounties), apply_escrow,
-- apply_dispute_loss_transaction, fail_legacy_withdrawal,
-- fn_refund_wallet_escrow_for_dispute, fn_release_wallet_escrow_for_dispute.
--
-- Symptoms: posting a funded pay-at-post bounty, and accepting an applicant on
-- a pay-at-accept bounty (fn_accept_bounty_request ->
-- fn_reserve_escrow_for_acceptance -> apply_escrow -> update_balance), both
-- failed with 42501 'update_balance: backend-only function'.
--
-- The same rewrite also dropped the set_config('app.bypass_profile_guard', ...)
-- window that 20260719120000 added, so fixing the role check alone would only
-- uncover a second failure from
-- prevent_client_writes_to_protected_profile_columns().  Both are restored here.
--
-- This matches the body already live in production since 2026-08-31.

CREATE OR REPLACE FUNCTION public.update_balance(p_user_id uuid, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  -- Backend-only.  current_user is the *effective* role: the caller's PostgREST
  -- role for a direct call, and the definer (postgres) when reached from one of
  -- the SECURITY DEFINER wallet functions/triggers.  Unlike request.jwt.claims
  -- this distinguishes the two, so internal callers running inside an end
  -- user's transaction are not rejected.
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
$function$;

-- Grants stay the primary control; the in-body check is defence in depth.
REVOKE ALL ON FUNCTION public.update_balance(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_balance(uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.update_balance(uuid, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_balance(uuid, numeric) TO service_role;
