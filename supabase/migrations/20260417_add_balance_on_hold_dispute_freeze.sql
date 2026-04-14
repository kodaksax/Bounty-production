-- Migration: Add balance_on_hold for application-level dispute fund freezes
-- Created: 2026-04-17
-- Purpose: Prevent poster from withdrawing escrowed funds while a bounty dispute is open.
--
--   1. profiles.balance_on_hold  — reserves a specific dollar amount in the poster's
--      wallet while a dispute is open, without fully freezing all withdrawals (contrast
--      with balance_frozen which blocks ALL withdrawals for Stripe chargebacks).
--   2. bounty_disputes.hold_amount — records how much was actually held when the dispute
--      was opened, so the hold can be released for the exact same amount at resolution.
--   3. Extend bounty_disputes.status CHECK with application-level resolution statuses:
--      resolved_poster_wins, resolved_hunter_wins, cancelled.
--   4. fn_open_dispute_hold(p_dispute_id)   — places hold on poster's wallet.
--   5. fn_close_dispute_hold(p_dispute_id, p_new_status) — releases hold; deducts
--      balance on resolved_hunter_wins; updates dispute status atomically.
--   6. withdraw_balance(p_user_id, p_amount) — atomic withdrawal that enforces
--      balance - balance_on_hold >= p_amount before debiting.

-- ─── 1. Add balance_on_hold to profiles ──────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS balance_on_hold NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS check_balance_on_hold_non_negative;

ALTER TABLE public.profiles
  ADD CONSTRAINT check_balance_on_hold_non_negative
  CHECK (balance_on_hold >= 0);

COMMENT ON COLUMN public.profiles.balance_on_hold IS
  'Dollar amount currently reserved by open application-level disputes. '
  'Withdrawal paths must enforce: balance - balance_on_hold >= requested_amount. '
  'Incremented when a bounty_disputes row is inserted; decremented on resolution.';

-- ─── 2. Add hold_amount to bounty_disputes ───────────────────────────────────

ALTER TABLE public.bounty_disputes
  ADD COLUMN IF NOT EXISTS hold_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.bounty_disputes.hold_amount IS
  'Dollar amount placed on hold in the poster''s wallet when this dispute was opened. '
  'Used to release exactly the right amount at resolution.';

-- ─── 3. Extend bounty_disputes.status CHECK ──────────────────────────────────
-- The current constraint (after 20260414 migration) covers:
--   open | under_review | resolved | closed |
--   stripe_dispute | resolved_won | resolved_lost
-- Add application-level resolution statuses.

ALTER TABLE public.bounty_disputes
  DROP CONSTRAINT IF EXISTS bounty_disputes_status_check;

ALTER TABLE public.bounty_disputes
  ADD CONSTRAINT bounty_disputes_status_check
  CHECK (status IN (
    'open',
    'under_review',
    'resolved',
    'closed',
    'cancelled',
    'resolved_poster_wins',
    'resolved_hunter_wins',
    'stripe_dispute',
    'resolved_won',
    'resolved_lost'
  ));

-- ─── 4. fn_open_dispute_hold ─────────────────────────────────────────────────
-- Places a hold on the bounty poster's wallet equal to the bounty amount.
-- Idempotent: if hold_amount is already > 0 the function returns immediately.
-- The hold is capped at the poster's current balance to avoid the hold amount
-- exceeding the balance (which would never allow the hold to be resolved via
-- balance deduction).

CREATE OR REPLACE FUNCTION public.fn_open_dispute_hold(p_dispute_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounty_id    UUID;
  v_existing_hold NUMERIC;
  v_poster_id    UUID;
  v_bounty_amount NUMERIC;
  v_hold_amount  NUMERIC;
  v_poster_balance NUMERIC;
BEGIN
  -- Lock the dispute row; bail early if hold already placed.
  SELECT bounty_id, hold_amount
    INTO v_bounty_id, v_existing_hold
    FROM public.bounty_disputes
   WHERE id = p_dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute % not found', p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_existing_hold > 0 THEN
    -- Hold already placed (idempotent call).
    RETURN;
  END IF;

  IF v_bounty_id IS NULL THEN
    -- Stripe-originated dispute with no local bounty link; nothing to hold.
    RETURN;
  END IF;

  -- Get bounty amount and poster.
  SELECT user_id, amount
    INTO v_poster_id, v_bounty_amount
    FROM public.bounties
   WHERE id = v_bounty_id;

  IF NOT FOUND OR v_bounty_amount IS NULL OR v_bounty_amount <= 0 THEN
    -- Honor bounty or bounty not found; no monetary hold required.
    RETURN;
  END IF;

  -- Cap the hold at the poster's current balance so that the hold never
  -- exceeds available funds (prevents balance - on_hold going deeply negative
  -- for bounties where wallet-based escrow already deducted the amount).
  SELECT balance
    INTO v_poster_balance
    FROM public.profiles
   WHERE id = v_poster_id
     FOR UPDATE;

  v_hold_amount := LEAST(v_bounty_amount, GREATEST(0, v_poster_balance));

  IF v_hold_amount <= 0 THEN
    -- Nothing available to hold (escrow already deducted the full amount).
    RETURN;
  END IF;

  -- Place the hold.
  UPDATE public.profiles
     SET balance_on_hold = balance_on_hold + v_hold_amount
   WHERE id = v_poster_id;

  -- Record the held amount on the dispute for precise release later.
  UPDATE public.bounty_disputes
     SET hold_amount = v_hold_amount
   WHERE id = p_dispute_id;
END;
$$;

COMMENT ON FUNCTION public.fn_open_dispute_hold(UUID) IS
  'Places a wallet hold on the bounty poster equal to the bounty amount (capped at '
  'available balance) when a dispute is opened. Idempotent — safe to call more than once.';

GRANT EXECUTE ON FUNCTION public.fn_open_dispute_hold(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_open_dispute_hold(UUID) TO authenticated;

-- ─── 5. fn_close_dispute_hold ────────────────────────────────────────────────
-- Releases the wallet hold and updates the dispute status atomically.
--
-- p_new_status must be one of the terminal statuses:
--   resolved_hunter_wins  → also deducts hold_amount from poster's balance
--   resolved_poster_wins  → releases hold only (balance unchanged)
--   cancelled             → releases hold only (balance unchanged)
--   resolved              → releases hold only (balance unchanged)
--   closed                → releases hold only (balance unchanged)
--
-- For resolved_hunter_wins the balance deduction uses GREATEST(0, balance - hold)
-- to guard against double-deduction in wallet-based escrow flows (where the
-- balance may already have been reduced when the bounty was accepted).

CREATE OR REPLACE FUNCTION public.fn_close_dispute_hold(
  p_dispute_id UUID,
  p_new_status TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounty_id    UUID;
  v_hold_amount  NUMERIC;
  v_poster_id    UUID;
  v_current_status TEXT;
BEGIN
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

  -- Lock dispute row.
  SELECT bounty_id, hold_amount, status
    INTO v_bounty_id, v_hold_amount, v_current_status
    FROM public.bounty_disputes
   WHERE id = p_dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute % not found', p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Update the dispute status.
  UPDATE public.bounty_disputes
     SET status     = p_new_status,
         hold_amount = 0
   WHERE id = p_dispute_id;

  -- If no hold was placed, nothing else to do.
  IF v_hold_amount IS NULL OR v_hold_amount <= 0 THEN
    RETURN;
  END IF;

  IF v_bounty_id IS NULL THEN
    RETURN;
  END IF;

  -- Identify the poster.
  SELECT user_id
    INTO v_poster_id
    FROM public.bounties
   WHERE id = v_bounty_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Release the hold unconditionally.
  UPDATE public.profiles
     SET balance_on_hold = GREATEST(0, balance_on_hold - v_hold_amount)
   WHERE id = v_poster_id;

  -- For hunter wins: deduct the held amount from the poster's balance.
  -- Uses GREATEST(0, ...) to avoid negative balance in cases where wallet-based
  -- escrow already deducted the amount (preventing double deduction).
  IF p_new_status = 'resolved_hunter_wins' THEN
    UPDATE public.profiles
       SET balance = GREATEST(0, balance - v_hold_amount),
           updated_at = NOW()
     WHERE id = v_poster_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_close_dispute_hold(UUID, TEXT) IS
  'Releases the wallet hold placed by fn_open_dispute_hold and updates the dispute status '
  'atomically. On resolved_hunter_wins the hold amount is also deducted from the poster''s '
  'balance. Safe to call for disputes that had no hold (no-op).';

GRANT EXECUTE ON FUNCTION public.fn_close_dispute_hold(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_close_dispute_hold(UUID, TEXT) TO authenticated;

-- ─── 6. withdraw_balance RPC ─────────────────────────────────────────────────
-- Drop-in replacement for the withdrawal path of update_balance(-amount).
-- Enforces:  balance - balance_on_hold >= p_amount
--            balance_frozen = false  (delegates to existing assert helper)
-- Returns the new balance after deduction.

CREATE OR REPLACE FUNCTION public.withdraw_balance(
  p_user_id UUID,
  p_amount   NUMERIC
)
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
  UPDATE public.profiles
     SET balance    = balance - p_amount,
         updated_at = NOW()
   WHERE id = p_user_id
   RETURNING balance INTO v_new_balance;

  RETURN v_new_balance;
END;
$$;

COMMENT ON FUNCTION public.withdraw_balance(UUID, NUMERIC) IS
  'Atomically withdraws p_amount from a user wallet. Enforces: '
  '(1) balance_frozen = false, (2) balance - balance_on_hold >= p_amount. '
  'Use instead of update_balance(-amount) for all withdrawal paths.';

GRANT EXECUTE ON FUNCTION public.withdraw_balance(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_balance(UUID, NUMERIC) TO service_role;
