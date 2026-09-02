-- Secure the wallet-credit RPCs (apply_deposit / update_balance / apply_escrow).
--
-- Background
-- ----------
-- 20260310_apply_deposit.sql shipped with:
--
--     GRANT EXECUTE ON FUNCTION apply_deposit(UUID, NUMERIC, TEXT, JSONB) TO authenticated;
--
-- apply_deposit is SECURITY DEFINER and takes both the crediting user id and
-- the credit amount as parameters, with no verification that the supplied
-- stripe_payment_intent_id corresponds to a real, succeeded Stripe
-- PaymentIntent. Any holder of an `authenticated` JWT could therefore call the
-- RPC directly and mint arbitrary wallet balance for any account.
--
-- The same shape exists in two sibling RPCs that were also granted to
-- `authenticated`:
--
--   * update_balance(uuid, numeric)  -- adds an arbitrary delta straight to
--     profiles.balance with no ledger row at all.
--   * apply_escrow(uuid, uuid, numeric, text, jsonb) -- debits `-p_amount`, so
--     a NEGATIVE p_amount credits the balance instead of debiting it.
--
-- No client-side code calls any of the three; every legitimate caller runs
-- with the service role (supabase/functions/wallet, supabase/functions/payments,
-- supabase/functions/webhooks, supabase/functions/admin-withdrawals,
-- server/index.js, services/api consolidated-wallet-service) or is an internal
-- SECURITY DEFINER routine (fn_reserve_bounty_escrow calls update_balance and
-- runs as the function owner, so it is unaffected by these revokes).
--
-- This migration therefore:
--   1. Revokes EXECUTE from PUBLIC, anon and authenticated on all three.
--   2. Keeps/creates the service_role grant so the backend keeps working.
--   3. Adds a defense-in-depth caller-identity check inside each function so a
--      future accidental re-grant is not immediately exploitable.
--   4. Adds a positive-amount guard to apply_deposit and apply_escrow.
--   5. Verifies the resulting privileges and fails the migration if they are
--      not what this file claims.
--
-- Safe to apply to production: it removes privileges nothing legitimately uses
-- and preserves every service_role path.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard against unknown overloads.
--    The revokes below name one exact signature per function. If production
--    ever grew a second overload it would keep its old grants silently, so
--    fail loudly instead of pretending the lock-down was complete.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_name text;
  v_count int;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['apply_deposit', 'update_balance', 'apply_escrow'] LOOP
    SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    IF v_count <> 1 THEN
      RAISE EXCEPTION
        'Expected exactly 1 public.% function, found % -- resolve the overloads before locking down grants',
        v_name, v_count;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. apply_deposit -- recreate with a caller-identity guard.
--
--    Behaviour for service_role callers is unchanged: same parameters, same
--    return shape, same ON CONFLICT idempotency on stripe_payment_intent_id,
--    same atomic balance update.
--
--    The guard only fires for a JWT-bearing caller (PostgREST sets
--    request.jwt.claims). Direct superuser/psql sessions and SECURITY DEFINER
--    callers have no JWT claims and are unaffected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_deposit(
  p_user_id UUID,
  p_amount NUMERIC,
  p_payment_intent_id TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (applied boolean, tx_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tx_id UUID;
  v_claims jsonb;
  v_role text;
  v_caller uuid;
BEGIN
  -- Defense in depth ------------------------------------------------------
  -- EXECUTE is revoked from authenticated/anon/PUBLIC below, so this branch
  -- should be unreachable in production. It exists so that an accidental
  -- future re-grant does not immediately reopen the money-minting hole.
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_role := v_claims ->> 'role';

  IF v_role IS NOT NULL AND v_role NOT IN ('service_role', 'supabase_admin') THEN
    BEGIN
      v_caller := (v_claims ->> 'sub')::uuid;
    EXCEPTION WHEN others THEN
      v_caller := NULL;
    END;

    -- A non-service caller with no resolvable subject can never be authorized:
    -- fail closed rather than letting a NULL sub slip past the equality check.
    IF v_caller IS NULL OR v_caller <> p_user_id THEN
      RAISE EXCEPTION 'apply_deposit: caller may not deposit to a different user'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'apply_deposit: amount must be positive (got %)', p_amount
      USING ERRCODE = '22023';
  END IF;

  IF p_payment_intent_id IS NULL OR btrim(p_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'apply_deposit: payment intent id is required'
      USING ERRCODE = '22023';
  END IF;

  -- Try to insert the wallet transaction. If a transaction with the same
  -- stripe_payment_intent_id already exists (unique constraint), do nothing.
  INSERT INTO wallet_transactions(
    user_id, type, amount, description, status, stripe_payment_intent_id, metadata, created_at, updated_at
  ) VALUES (
    p_user_id, 'deposit', p_amount, 'Wallet deposit via Stripe', 'completed', p_payment_intent_id, p_metadata, NOW(), NOW()
  ) ON CONFLICT (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL) DO NOTHING
  RETURNING id INTO v_tx_id;

  IF v_tx_id IS NOT NULL THEN
    -- A new transaction row was inserted; update the profile balance atomically
    UPDATE profiles
    SET balance = COALESCE(balance, 0) + p_amount,
        updated_at = NOW()
    WHERE id = p_user_id;

    -- Ensure the update actually affected a row. If not, abort so the
    -- inserted wallet transaction is not left orphaned (keeps operation atomic).
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile not found for user %', p_user_id;
    END IF;

    RETURN QUERY SELECT true, v_tx_id;
  ELSE
    -- Transaction already existed; do not change balance
    RETURN QUERY SELECT false, NULL::UUID;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.apply_deposit(UUID, NUMERIC, TEXT, JSONB) IS
  'Atomically insert deposit transaction and update profile balance; idempotent by payment intent id. service_role only -- callers MUST verify the Stripe PaymentIntent (exists, succeeded, owned by p_user_id, amount from Stripe) before invoking.';

REVOKE ALL ON FUNCTION public.apply_deposit(UUID, NUMERIC, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_deposit(UUID, NUMERIC, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.apply_deposit(UUID, NUMERIC, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_deposit(UUID, NUMERIC, TEXT, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. update_balance -- arbitrary balance delta, no ledger row. Backend only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_balance(
  p_user_id UUID,
  p_amount NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_new_balance NUMERIC;
  v_role text;
BEGIN
  v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  IF v_role IS NOT NULL AND v_role NOT IN ('service_role', 'supabase_admin') THEN
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

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient funds: new balance would be %', v_new_balance USING ERRCODE = '23514';
  END IF;

  RETURN v_new_balance;
END;
$fn$;

COMMENT ON FUNCTION public.update_balance(UUID, NUMERIC) IS
  'Atomically updates a user balance and returns the new value. Enforces non-negative balance. service_role only.';

REVOKE ALL ON FUNCTION public.update_balance(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_balance(UUID, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.update_balance(UUID, NUMERIC) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_balance(UUID, NUMERIC) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. apply_escrow -- debits -p_amount, so a negative p_amount credits.
--    Reject non-positive amounts outright and restrict to the backend.
--    Body is otherwise identical to 20260518_atomic_bounty_escrow_reservation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_escrow(
  p_user_id    uuid,
  p_bounty_id  uuid,
  p_amount     numeric,
  p_description text,
  p_metadata   jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (
  applied        boolean,
  transaction_id uuid,
  new_balance    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_existing_id uuid;
  v_tx_id       uuid;
  v_new_balance numeric;
  v_curr_balance numeric;
  v_claims jsonb;
  v_role text;
  v_caller uuid;
BEGIN
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_role := v_claims ->> 'role';

  IF v_role IS NOT NULL AND v_role NOT IN ('service_role', 'supabase_admin') THEN
    BEGIN
      v_caller := (v_claims ->> 'sub')::uuid;
    EXCEPTION WHEN others THEN
      v_caller := NULL;
    END;
    IF v_caller IS NULL OR v_caller <> p_user_id THEN
      RAISE EXCEPTION 'apply_escrow: caller may not escrow funds for another user'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A negative amount would credit the balance instead of debiting it.
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'apply_escrow: amount must be positive (got %)', p_amount
      USING ERRCODE = '22023';
  END IF;

  -- Check for an already-committed escrow for this bounty (idempotency).
  SELECT id INTO v_existing_id
  FROM public.wallet_transactions
  WHERE bounty_id = p_bounty_id
    AND type      = 'escrow'
    AND status    = 'completed'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    SELECT balance INTO v_curr_balance FROM public.profiles WHERE id = p_user_id;
    RETURN QUERY SELECT false, v_existing_id, v_curr_balance;
    RETURN;
  END IF;

  INSERT INTO public.wallet_transactions (
    user_id, bounty_id, type, amount, description, status, metadata
  ) VALUES (
    p_user_id, p_bounty_id, 'escrow', -p_amount, p_description, 'completed', p_metadata
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_tx_id;

  IF v_tx_id IS NULL THEN
    SELECT id INTO v_tx_id
    FROM public.wallet_transactions
    WHERE bounty_id = p_bounty_id
      AND type      = 'escrow'
      AND status    = 'completed'
    LIMIT 1;
    SELECT balance INTO v_curr_balance FROM public.profiles WHERE id = p_user_id;
    RETURN QUERY SELECT false, v_tx_id, v_curr_balance;
    RETURN;
  END IF;

  v_new_balance := update_balance(p_user_id, -p_amount);

  RETURN QUERY SELECT true, v_tx_id, v_new_balance;
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_escrow(uuid, uuid, numeric, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_escrow(uuid, uuid, numeric, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_escrow(uuid, uuid, numeric, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_escrow(uuid, uuid, numeric, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Verify the privileges are actually what this migration claims.
--    A migration that "ran successfully" is not proof the guardrail is armed,
--    so assert the final state and abort the transaction if it is wrong.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sig text;
  v_role text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.apply_deposit(uuid, numeric, text, jsonb)',
    'public.update_balance(uuid, numeric)',
    'public.apply_escrow(uuid, uuid, numeric, text, jsonb)'
  ] LOOP
    -- anon and authenticated inherit anything granted to PUBLIC, so these two
    -- checks also cover the PUBLIC case...
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'Lock-down failed: % still has EXECUTE on %', v_role, v_sig;
      END IF;
    END LOOP;

    -- ...but check the PUBLIC grant explicitly too, so a future role that does
    -- not exist yet cannot inherit one. Grantee 0 in an ACL is PUBLIC.
    IF EXISTS (
      SELECT 1
      FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.oid = v_sig::regprocedure
        AND a.grantee = 0
        AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'Lock-down failed: PUBLIC still has EXECUTE on %', v_sig;
    END IF;

    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'Backend broken: service_role lacks EXECUTE on %', v_sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'apply_deposit / update_balance / apply_escrow: service_role only -- verified';
END;
$$;

COMMIT;
