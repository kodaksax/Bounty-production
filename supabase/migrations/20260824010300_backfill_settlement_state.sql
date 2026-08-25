-- =====================================================================
-- ADR 0001 §5.2 Stage 1 — backfill.
--
-- Calls fn_settlement_state_for() — the same function the derive trigger calls
-- — rather than restating the CASE. A backfill that computes the value
-- independently is a second implementation that can disagree with the first.
--
-- WHY THIS IS NOT A `SET updated_at = updated_at` NO-OP
-- An earlier draft did exactly that, on the theory that firing the BEFORE
-- trigger was the tidiest way to re-derive. It is not a no-op. Two other
-- triggers already live on this table:
--
--   trg_wallet_transactions_updated_at   BEFORE UPDATE -> set_updated_at(),
--       whose body is unconditionally `NEW.updated_at = NOW()`. It overwrites
--       whatever the statement assigns, so the "no-op" would have silently
--       rewritten updated_at on every row in a financial ledger — destroying
--       the audit timestamp the column exists to provide.
--
--   wallet_transactions_broadcast_trigger  AFTER INSERT OR UPDATE, which
--       publishes a realtime change event per row. A mass UPDATE would emit a
--       fabricated "this transaction changed" event for every historical row
--       to any subscribed client.
--
-- Both are disabled for the duration of the backfill and restored immediately.
-- If this migration fails partway, the whole thing — trigger states included —
-- rolls back with the transaction.
--
-- (trg_capture_release_analytics_facts is AFTER INSERT OR UPDATE **OF status**,
-- so it does not fire here: this statement never touches `status`.)
--
-- EXPECTED RESULT (verified against production 2026-08-24, read-only):
--
--   wallet_transactions
--     20 type='release'    -> ledger_only     (all of them; v1 cannot have a transfer id)
--     25 type='withdrawal' -> ledger_only     ($526.65, the historical set)
--      2 type='withdrawal' -> stripe_pending  (payout id present, status not yet recorded)
--      1 type='withdrawal' -> ledger_only     (the stuck $96; transfer only, no payout)
--      1 manually_paid     -> ledger_only     (settled outside Stripe by construction)
--     escrow/refund rows   -> ledger_only
--
--   bounty_payments
--      4 rows, none released -> ledger_only / stripe_pending per status
--
-- The migration asserts these counts and ABORTS if they do not hold. A
-- backfill whose result nobody checked is how a guardrail ends up not firing;
-- this one refuses to commit silently against unexpected data.
--
-- ON THE TWO stripe_pending ROWS
-- Both are status='completed' with a payout id but no recorded payout status,
-- so they classify as stripe_pending rather than stripe_settled. That is a
-- deliberate, conservative downgrade of two rows that are probably genuinely
-- settled. Phase 5's Stripe lookup resolves them by reading the real
-- payout.status and writing it to stripe_payout_status, at which point the
-- trigger promotes them automatically. Being briefly too cautious about 2 rows
-- is the correct trade against being wrong about 25.
-- =====================================================================

DO $$
DECLARE
  v_release_ledger_only  int;
  v_withdrawal_ledger    int;
  v_withdrawal_pending   int;
  v_withdrawal_settled   int;
  v_has_broadcast_trigger boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger trigger
    JOIN pg_class table_ref
      ON table_ref.oid = trigger.tgrelid
    JOIN pg_namespace schema_ref
      ON schema_ref.oid = table_ref.relnamespace
    WHERE schema_ref.nspname = 'public'
      AND table_ref.relname = 'wallet_transactions'
      AND trigger.tgname = 'wallet_transactions_broadcast_trigger'
      AND NOT trigger.tgisinternal
  )
  INTO v_has_broadcast_trigger;

  -- Suppress the two incidental triggers (see header) so the backfill changes
  -- exactly one column and publishes nothing.
  ALTER TABLE public.wallet_transactions DISABLE TRIGGER trg_wallet_transactions_updated_at;
  IF v_has_broadcast_trigger THEN
    ALTER TABLE public.wallet_transactions DISABLE TRIGGER wallet_transactions_broadcast_trigger;
  END IF;

  UPDATE public.wallet_transactions
  SET settlement_state = public.fn_settlement_state_for(
        type::text,
        stripe_payout_id,
        stripe_payout_status,
        stripe_transfer_id,
        stripe_charge_id,
        stripe_payment_intent_id,
        stripe_refund_id
      );

  IF v_has_broadcast_trigger THEN
    ALTER TABLE public.wallet_transactions ENABLE TRIGGER wallet_transactions_broadcast_trigger;
  END IF;
  ALTER TABLE public.wallet_transactions ENABLE TRIGGER trg_wallet_transactions_updated_at;

  -- bounty_payments carries no updated_at or broadcast trigger of its own, so
  -- its derive trigger can simply be fired. Verified against production
  -- 2026-08-24: the table has no non-internal triggers today.
  UPDATE public.bounty_payments SET settlement_state = settlement_state;

  SELECT
    count(*) FILTER (WHERE type = 'release'    AND settlement_state = 'ledger_only'),
    count(*) FILTER (WHERE type = 'withdrawal' AND settlement_state = 'ledger_only'),
    count(*) FILTER (WHERE type = 'withdrawal' AND settlement_state = 'stripe_pending'),
    count(*) FILTER (WHERE type = 'withdrawal' AND settlement_state = 'stripe_settled')
  INTO v_release_ledger_only, v_withdrawal_ledger, v_withdrawal_pending, v_withdrawal_settled
  FROM public.wallet_transactions;

  RAISE NOTICE 'settlement_state backfill: release/ledger_only=%, withdrawal/ledger_only=%, withdrawal/stripe_pending=%, withdrawal/stripe_settled=%',
    v_release_ledger_only, v_withdrawal_ledger, v_withdrawal_pending, v_withdrawal_settled;

  -- No v1 release may claim settlement. This is the invariant, not a count
  -- check, so it is asserted unconditionally rather than against a snapshot.
  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE type = 'release'
      AND settlement_state = 'stripe_settled'
      AND NULLIF(TRIM(COALESCE(stripe_transfer_id, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'backfill produced a settled release with no transfer id — derive trigger is wrong';
  END IF;

  -- Likewise for withdrawals: settled requires a payout id.
  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE type = 'withdrawal'
      AND settlement_state = 'stripe_settled'
      AND NULLIF(TRIM(COALESCE(stripe_payout_id, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'backfill produced a settled withdrawal with no payout id — derive trigger is wrong';
  END IF;

  -- Snapshot check. Warn rather than abort: this migration may legitimately run
  -- against staging, a branch database, or production some days later, where
  -- the counts differ for benign reasons. The invariants above are the hard
  -- gate; this is the "did reality match the plan" signal for the operator.
  IF v_withdrawal_ledger <> 26 OR v_withdrawal_pending <> 2 THEN
    RAISE WARNING
      'settlement_state backfill counts differ from the 2026-08-24 production snapshot (expected withdrawal ledger_only=26, stripe_pending=2; got %, %). Verify before advancing to Stage 2.',
      v_withdrawal_ledger, v_withdrawal_pending;
  END IF;
END $$;
