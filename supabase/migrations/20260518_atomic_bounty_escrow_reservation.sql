-- Migration: Atomic escrow reservation on bounty INSERT
-- Created: 2026-05-18
-- Purpose: Close the double-spend vulnerability where a poster could create
-- multiple paid bounties from the same balance because the escrow reservation
-- (POST /wallet/escrow → apply_escrow RPC) was performed by the client *after*
-- the bounty row had already been inserted.  Between those two network calls
-- the local `balance` state is unchanged, so a rapid second tap (or a second
-- device, or an offline-queue replay) trivially passes the client-side balance
-- check and lets the same funds back another bounty.
--
-- This migration makes the reservation server-authoritative by attaching a
-- trigger to public.bounties.  On every INSERT of a paid bounty:
--   1. The poster's profiles row is acquired with FOR UPDATE — concurrent
--      bounty inserts for the same poster are serialized, eliminating the
--      TOCTOU race.
--   2. An idempotent escrow wallet_transactions row is inserted referencing
--      the new bounty.  The pre-existing partial unique index
--      idx_wallet_tx_one_escrow_per_bounty (from 20260417) prevents duplicate
--      escrow rows for the same bounty_id; this trigger relies on that index
--      via ON CONFLICT DO NOTHING.
--   3. update_balance(poster, -amount) deducts the funds atomically and raises
--      SQLSTATE 23514 ('insufficient_funds') if the balance would go negative.
--      A raised exception inside an AFTER trigger rolls back the entire
--      statement, including the bounty INSERT — so we never leave a paid
--      bounty in the database without a fully funded escrow.
--
-- Because the trigger fires in the same transaction as the INSERT, a paid
-- bounty either commits *together with* its escrow row and balance debit, or
-- not at all.  Honor bounties (is_for_honor = true OR amount is null/<=0)
-- bypass the reservation entirely.

-- ─── Trigger function ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_reserve_bounty_escrow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poster_id   uuid;
  v_amount      numeric;
  v_description text;
  v_tx_id       uuid;
  v_locked_id   uuid;
BEGIN
  -- Resolve poster id from either the modern poster_id column or the legacy
  -- user_id column.  Both are kept in sync by the application but defensive
  -- here so the trigger remains correct across either deployment.
  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);
  v_amount    := NEW.amount;

  -- Honor / unpriced bounties do not reserve funds.
  IF NEW.is_for_honor IS TRUE OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  IF v_poster_id IS NULL THEN
    RAISE EXCEPTION 'Cannot reserve escrow: bounty has no poster_id/user_id'
      USING ERRCODE = '23502';
  END IF;

  -- Lock the poster's profile row so concurrent paid-bounty INSERTs for the
  -- same user are serialized.  Without this lock two simultaneous transactions
  -- could both read the same balance, each pass update_balance independently,
  -- and only the second would fail — but only after the first had already
  -- committed a partial reservation.  The FOR UPDATE forces ordering.
  SELECT id INTO v_locked_id
  FROM public.profiles
  WHERE id = v_poster_id
  FOR UPDATE;

  IF v_locked_id IS NULL THEN
    RAISE EXCEPTION 'Cannot reserve escrow: poster profile % not found', v_poster_id
      USING ERRCODE = 'P0002';
  END IF;

  v_description := 'Escrow for bounty: ' || COALESCE(NEW.title, NEW.id::text);

  -- Insert the escrow ledger row first.  ON CONFLICT DO NOTHING leverages the
  -- partial unique index on (bounty_id) WHERE type='escrow' AND status='completed'
  -- so a second trigger invocation (e.g. via a re-run insert) cannot create a
  -- duplicate row.  If a row is skipped we leave balance untouched.
  INSERT INTO public.wallet_transactions (
    user_id, bounty_id, type, amount, description, status, metadata
  ) VALUES (
    v_poster_id,
    NEW.id,
    'escrow',
    -v_amount,
    v_description,
    'completed',
    jsonb_build_object(
      'bounty_id',    NEW.id,
      'escrowed_at',  NOW(),
      'created_via',  'bounty_insert_trigger'
    )
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_tx_id;

  -- No insert means an escrow row already exists for this bounty (extremely
  -- unlikely on INSERT, but possible in pathological re-fire scenarios).
  -- Do not touch the balance — the funds were already reserved earlier.
  IF v_tx_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Deduct funds.  update_balance raises 23514 if the result would be
  -- negative; the exception propagates out of the AFTER trigger and Postgres
  -- rolls back the entire INSERT statement, including the wallet_transactions
  -- row we inserted above.  Net effect on insufficient funds: nothing
  -- changes — no orphan bounty, no orphan escrow row, no partial debit.
  PERFORM update_balance(v_poster_id, -v_amount);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_reserve_bounty_escrow IS
  'AFTER INSERT trigger on public.bounties.  Atomically locks the poster, '
  'inserts an escrow wallet_transactions row, and deducts the bounty amount '
  'from profiles.balance.  Guarantees that a paid bounty cannot exist '
  'without a funded escrow, preventing double-spend across concurrent or '
  'retried bounty creations.';

-- ─── Trigger ─────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_bounties_reserve_escrow ON public.bounties;
CREATE TRIGGER trg_bounties_reserve_escrow
  AFTER INSERT ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_reserve_bounty_escrow();

-- ─── apply_escrow: return current balance on idempotent path ─────────────────
-- The client still calls POST /wallet/escrow immediately after creating the
-- bounty (for backward compatibility and to refresh local state).  After this
-- migration that call will *always* find an escrow row already present — the
-- trigger committed it.  The previous apply_escrow returned NULL new_balance
-- on the "already exists" path, which left the client without a way to resync
-- its cached balance.  We now select the current profiles.balance and return
-- it so the client can update its local state cleanly even on the idempotent
-- duplicate response.
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
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_tx_id       uuid;
  v_new_balance numeric;
  v_curr_balance numeric;
BEGIN
  -- Check for an already-committed escrow for this bounty (idempotency).
  SELECT id INTO v_existing_id
  FROM public.wallet_transactions
  WHERE bounty_id = p_bounty_id
    AND type      = 'escrow'
    AND status    = 'completed'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Return the caller's current balance so the client can resync without
    -- making a second round-trip to GET /wallet/balance.
    SELECT balance INTO v_curr_balance FROM public.profiles WHERE id = p_user_id;
    RETURN QUERY SELECT false, v_existing_id, v_curr_balance;
    RETURN;
  END IF;

  -- Insert the escrow transaction first (see 20260417 migration for the
  -- rationale around ordering INSERT before balance debit).
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
$$;

GRANT EXECUTE ON FUNCTION public.apply_escrow(uuid, uuid, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_escrow(uuid, uuid, numeric, text, jsonb) TO service_role;
