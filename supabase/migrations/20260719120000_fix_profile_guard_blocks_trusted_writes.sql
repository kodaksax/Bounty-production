-- Migration: Let trusted SECURITY DEFINER functions bypass the profile write guard
-- Created: 2026-07-19
--
-- Context: prevent_client_writes_to_protected_profile_columns() (a BEFORE UPDATE
-- trigger on public.profiles, added directly to production outside of a tracked
-- migration during the 2026-07-17 Stripe Connect Phase 2 hardening) blocks any
-- UPDATE that touches financial/risk/verification/Stripe Connect columns unless
-- auth.role() = 'service_role'.
--
-- Bug: auth.role() reflects the JWT role of the *original PostgREST request*,
-- which stays 'authenticated' for the whole transaction even when a SECURITY
-- DEFINER function (owned by postgres, e.g. update_balance) performs the write
-- as a trusted side effect. SECURITY DEFINER elevates privilege checks, not the
-- PostgREST session GUCs, so the guard was rejecting its own intended callers.
--
-- Concretely this broke, in production, right now:
--   - Paid bounty creation (fn_reserve_bounty_escrow -> update_balance, fired as
--     an AFTER INSERT trigger on bounties from the client's authenticated INSERT)
--   - Dispute-loss settlement and escrow release/refund (apply_dispute_loss_transaction,
--     fn_release_wallet_escrow_for_dispute, fn_refund_wallet_escrow_for_dispute --
--     all route through update_balance)
--   - Withdrawals (withdraw_balance)
--   - Dispute hold release / balance unfreeze (fn_close_dispute_hold,
--     unfreeze_profile_if_no_open_disputes)
--
-- Fix: add a transaction-local bypass GUC (app.bypass_profile_guard) that only
-- these specific, already-reviewed, postgres-owned SECURITY DEFINER functions
-- set immediately around their own protected UPDATE statements. The guard trusts
-- the flag the same way it already trusts the service_role JWT. Direct client
-- writes (raw UPDATE profiles, or any function without this flag) are still
-- rejected exactly as before -- this does not reopen the balance-RLS hole that
-- was closed on 2026-07-17.

-- ─── 1. Guard trigger: accept the bypass flag alongside service_role ─────────
CREATE OR REPLACE FUNCTION public.prevent_client_writes_to_protected_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR current_setting('app.bypass_profile_guard', true) = 'on'
  THEN
    RETURN NEW;
  END IF;

  IF NEW.balance IS DISTINCT FROM OLD.balance
     OR NEW.balance_on_hold IS DISTINCT FROM OLD.balance_on_hold
     OR NEW.balance_frozen IS DISTINCT FROM OLD.balance_frozen
     OR NEW.withdrawal_count IS DISTINCT FROM OLD.withdrawal_count
     OR NEW.last_withdrawal_at IS DISTINCT FROM OLD.last_withdrawal_at
     OR NEW.cancellation_count IS DISTINCT FROM OLD.cancellation_count
     OR NEW.payout_failed_at IS DISTINCT FROM OLD.payout_failed_at
     OR NEW.payout_failure_code IS DISTINCT FROM OLD.payout_failure_code
     OR NEW.stripe_connect_account_id IS DISTINCT FROM OLD.stripe_connect_account_id
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_connect_onboarded_at IS DISTINCT FROM OLD.stripe_connect_onboarded_at
     OR NEW.stripe_connect_charges_enabled IS DISTINCT FROM OLD.stripe_connect_charges_enabled
     OR NEW.stripe_connect_payouts_enabled IS DISTINCT FROM OLD.stripe_connect_payouts_enabled
     OR NEW.stripe_connect_requirements IS DISTINCT FROM OLD.stripe_connect_requirements
     OR NEW.stripe_connect_onboarding_complete IS DISTINCT FROM OLD.stripe_connect_onboarding_complete
     OR NEW.charges_enabled IS DISTINCT FROM OLD.charges_enabled
     OR NEW.payouts_enabled IS DISTINCT FROM OLD.payouts_enabled
     OR NEW.details_submitted IS DISTINCT FROM OLD.details_submitted
     OR NEW.disabled_reason IS DISTINCT FROM OLD.disabled_reason
     OR NEW.risk_level IS DISTINCT FROM OLD.risk_level
     OR NEW.risk_score IS DISTINCT FROM OLD.risk_score
     OR NEW.account_restricted IS DISTINCT FROM OLD.account_restricted
     OR NEW.restriction_reason IS DISTINCT FROM OLD.restriction_reason
     OR NEW.restricted_at IS DISTINCT FROM OLD.restricted_at
     OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
     OR NEW.kyc_verified_at IS DISTINCT FROM OLD.kyc_verified_at
     OR NEW.id_verification_status IS DISTINCT FROM OLD.id_verification_status
     OR NEW.id_submitted_at IS DISTINCT FROM OLD.id_submitted_at
     OR NEW.id_reviewed_at IS DISTINCT FROM OLD.id_reviewed_at
     OR NEW.id_reviewer_id IS DISTINCT FROM OLD.id_reviewer_id
     OR NEW.age_verified IS DISTINCT FROM OLD.age_verified
     OR NEW.age_verified_at IS DISTINCT FROM OLD.age_verified_at
     OR NEW.phone_verified IS DISTINCT FROM OLD.phone_verified
     OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at
     OR NEW.selfie_submitted_at IS DISTINCT FROM OLD.selfie_submitted_at
     OR NEW.verified IS DISTINCT FROM OLD.verified
     OR NEW.role IS DISTINCT FROM OLD.role
  THEN
    RAISE EXCEPTION 'Direct client writes to financial, risk, verification, or Stripe Connect profile fields are not permitted. These are managed exclusively by server-side functions.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_client_writes_to_protected_profile_columns IS
  'BEFORE UPDATE guard on public.profiles blocking direct writes to financial/risk/'
  'verification/Stripe Connect columns. Bypassed for auth.role() = service_role '
  '(edge functions/webhooks) and for the app.bypass_profile_guard transaction-local '
  'flag, which only update_balance(), withdraw_balance(), fn_close_dispute_hold(), '
  'and unfreeze_profile_if_no_open_disputes() set around their own writes.';

-- ─── 2. update_balance: bypass around its single UPDATE ──────────────────────
-- Covers, transitively (all route through this function): fn_reserve_bounty_escrow
-- (paid bounty creation), apply_escrow, apply_dispute_loss_transaction,
-- fn_release_wallet_escrow_for_dispute, fn_refund_wallet_escrow_for_dispute.
CREATE OR REPLACE FUNCTION public.update_balance(p_user_id uuid, p_amount numeric)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  -- Update the balance in profiles table
  -- We use a single UPDATE statement with a WHERE clause for atomicity
  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  UPDATE profiles
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;

  PERFORM set_config('app.bypass_profile_guard', 'off', true);

  -- Check if user exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  -- Enforce non-negative balance constraint
  -- (Though we should also have a DB-level constraint, this provides immediate feedback)
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient funds: new balance would be %', v_new_balance USING ERRCODE = '23514';
  END IF;

  RETURN v_new_balance;
END;
$$;

-- ─── 3. withdraw_balance: bypass around its single UPDATE ────────────────────
CREATE OR REPLACE FUNCTION public.withdraw_balance(p_user_id uuid, p_amount numeric)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance        NUMERIC;
  v_balance_on_hold NUMERIC;
  v_balance_frozen  BOOLEAN;
  v_available      NUMERIC;
  v_new_balance    NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive, got %', p_amount
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock profile row for the duration of this transaction.
  SELECT balance, balance_on_hold, balance_frozen
    INTO v_balance, v_balance_on_hold, v_balance_frozen
    FROM public.profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile % not found', p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Enforce Stripe chargeback freeze (existing constraint).
  IF v_balance_frozen THEN
    RAISE EXCEPTION 'Balance is frozen for profile % due to an open Stripe dispute', p_user_id
      USING ERRCODE = 'P0001',
            HINT = 'Resolve all open Stripe disputes before withdrawing.';
  END IF;

  -- Enforce hold: available = balance - balance_on_hold.
  v_available := v_balance - COALESCE(v_balance_on_hold, 0);

  IF v_available < p_amount THEN
    RAISE EXCEPTION
      'Insufficient available balance: balance=% on_hold=% available=% requested=%',
      v_balance, v_balance_on_hold, v_available, p_amount
      USING ERRCODE = '23514',
            HINT = 'Part of your balance is reserved by an open dispute.';
  END IF;

  -- Deduct balance.
  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  UPDATE public.profiles
     SET balance    = balance - p_amount,
         updated_at = NOW()
   WHERE id = p_user_id
   RETURNING balance INTO v_new_balance;

  PERFORM set_config('app.bypass_profile_guard', 'off', true);

  RETURN v_new_balance;
END;
$$;

-- ─── 4. fn_close_dispute_hold: bypass around both profiles UPDATEs ───────────
CREATE OR REPLACE FUNCTION public.fn_close_dispute_hold(p_dispute_id integer, p_new_status text)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounty_id      UUID;
  v_hold_amount    NUMERIC;
  v_poster_id      UUID;
  v_current_status TEXT;
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' THEN
      RAISE EXCEPTION 'Admin role required to release a dispute hold'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_new_status NOT IN (
    'resolved_hunter_wins',
    'resolved_poster_wins',
    'cancelled',
    'resolved',
    'closed'
  ) THEN
    RAISE EXCEPTION 'Invalid resolution status for fn_close_dispute_hold: %', p_new_status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT bounty_id, hold_amount, status
    INTO v_bounty_id, v_hold_amount, v_current_status
    FROM public.bounty_disputes
   WHERE id = p_dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute % not found', p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bounty_disputes
     SET status      = p_new_status,
         hold_amount = 0
   WHERE id = p_dispute_id;

  IF v_hold_amount IS NULL OR v_hold_amount <= 0 THEN
    RETURN;
  END IF;

  IF v_bounty_id IS NULL THEN
    RETURN;
  END IF;

  SELECT user_id
    INTO v_poster_id
    FROM public.bounties
   WHERE id = v_bounty_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  UPDATE public.profiles
     SET balance_on_hold = GREATEST(0, balance_on_hold - v_hold_amount)
   WHERE id = v_poster_id;

  IF p_new_status = 'resolved_hunter_wins' THEN
    UPDATE public.profiles
       SET balance = GREATEST(0, balance - v_hold_amount)
     WHERE id = v_poster_id;
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'off', true);
END;
$$;

-- ─── 5. unfreeze_profile_if_no_open_disputes: bypass around its UPDATE ───────
CREATE OR REPLACE FUNCTION public.unfreeze_profile_if_no_open_disputes(p_user_id uuid)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_count bigint;
  v_was_frozen boolean;
BEGIN
  SELECT balance_frozen
    INTO v_was_frozen
    FROM public.profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile % not found', p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_was_frozen THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)
    INTO v_open_count
    FROM public.bounty_disputes
   WHERE initiator_id = p_user_id
     AND status = 'stripe_dispute';

  IF v_open_count > 0 THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  UPDATE public.profiles
     SET balance_frozen = false
   WHERE id = p_user_id;

  PERFORM set_config('app.bypass_profile_guard', 'off', true);

  RETURN true;
END;
$$;
