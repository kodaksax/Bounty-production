-- v2 (card-funded) releases credit the hunter's Bounty balance.
--
-- Before: POST /bounty-payments/release created a Stripe Transfer from the
-- captured charge straight to the hunter's Connect account, and refused when
-- the hunter was not payout-ready.
--
-- After: the release credits the hunter's in-app balance, exactly like a v1
-- wallet release. The card money stays on the platform Stripe balance until
-- the hunter withdraws through the existing connect /withdraw flow, which is
-- where a Stripe Transfer + Payout is created. Both ways of posting (app
-- wallet, website card) now pay the hunter the same way.
--
-- Truthfulness (ADR 0001): the release row has no stripe_transfer_id, so
-- fn_derive_settlement_state() labels it 'ledger_only', and
-- fn_derive_bounty_payment_settlement_state() labels the payment
-- 'ledger_only' too (new status falls to its ELSE branch). Nothing here may
-- be described as "paid"; the web says "Added to the hunter's Bounty balance".
--
-- Platform balance check: get_platform_ledger_balance_cents() (sum of
-- profiles.balance) rises by the hunter's share while the charge stays on the
-- platform Stripe balance, so comparePlatformBalance stays consistent.

BEGIN;

-- 1. The new terminal status.
ALTER TABLE public.bounty_payments
  DROP CONSTRAINT IF EXISTS bounty_payments_status_check;

ALTER TABLE public.bounty_payments
  ADD CONSTRAINT bounty_payments_status_check CHECK (
    status IN (
      'pending_payment',
      'authorized',
      'captured',
      'release_pending',
      'released',
      'released_to_balance',
      'refund_pending',
      'refunded',
      'canceled',
      'disputed',
      'failed'
    )
  );

-- 2. The release, in one transaction: lock the payment, credit the hunter,
--    record the ledger row, mark the payment. The row lock + status check is
--    the idempotency guard: a second call (double click, retry, a concurrent
--    web + app approval) sees 'released_to_balance' and returns the original
--    ledger row without crediting again.
--
--    The Stripe ids go in metadata only. wallet_transactions.stripe_payment_intent_id
--    is unique and is how charge.dispute.created finds the *payer's* row;
--    putting the poster's PaymentIntent on the hunter's credit would point a
--    chargeback at the hunter.
--
--    metadata.source_charge_id is the card charge that funded this credit,
--    always set. The withdrawal path needs it for a Transfer's
--    source_transaction, and charge.dispute.created can use it to find the
--    hunter credited from a disputed charge
--    (metadata ->> 'source_charge_id' = dispute.charge).
CREATE OR REPLACE FUNCTION public.apply_v2_release_to_balance(
  p_bounty_payment_id uuid,
  p_hunter_id         uuid,
  p_charge_id         text,
  p_platform_fee      numeric,
  p_hunter_amount     numeric,
  p_request_id        text DEFAULT NULL
) RETURNS TABLE (applied boolean, transaction_id uuid, payment_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bp    public.bounty_payments%ROWTYPE;
  v_tx_id uuid;
  v_charge_id text;
BEGIN
  IF p_hunter_amount IS NULL OR p_hunter_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_payout' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bp FROM public.bounty_payments WHERE id = p_bounty_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_payment' USING ERRCODE = 'P0002';
  END IF;

  IF v_bp.status = 'released_to_balance' THEN
    SELECT wt.id INTO v_tx_id
      FROM public.wallet_transactions wt
     WHERE wt.bounty_id = v_bp.bounty_id
       AND wt.type::text = 'release'
       AND wt.metadata ->> 'bounty_payment_id' = v_bp.id::text
     ORDER BY wt.created_at
     LIMIT 1;
    RETURN QUERY SELECT FALSE, v_tx_id, v_bp.status;
    RETURN;
  END IF;

  -- 'failed' = a transfer from the old path failed or was reversed, so the
  -- money is back on the platform balance. Anything else (release_pending,
  -- released, refund_*, canceled, disputed) must not be credited.
  IF v_bp.status NOT IN ('authorized', 'captured', 'failed') THEN
    RAISE EXCEPTION 'invalid_status:%', v_bp.status USING ERRCODE = '55000';
  END IF;

  -- Every credit must record its source charge (metadata.source_charge_id).
  v_charge_id := COALESCE(v_bp.stripe_charge_id, p_charge_id);
  IF v_charge_id IS NULL OR v_charge_id = '' THEN
    RAISE EXCEPTION 'no_charge' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.wallet_transactions (user_id, bounty_id, type, amount, description, status, metadata)
  VALUES (
    p_hunter_id,
    v_bp.bounty_id,
    'release',
    p_hunter_amount,
    'Payment for bounty ' || v_bp.bounty_id::text,
    'completed',
    jsonb_build_object(
      'source', 'bounty_payments_v2_release_to_balance',
      'bounty_id', v_bp.bounty_id,
      'bounty_payment_id', v_bp.id,
      'poster_id', v_bp.poster_id,
      'source_charge_id', v_charge_id,
      'stripe_payment_intent_id', v_bp.stripe_payment_intent_id,
      'gross_amount', v_bp.amount,
      'platform_fee', p_platform_fee,
      'released_at', now(),
      'request_id', p_request_id,
      'idempotency_key', 'release_v2_balance_' || v_bp.id::text
    )
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.profiles
     SET balance = COALESCE(balance, 0) + p_hunter_amount,
         updated_at = now()
   WHERE id = p_hunter_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hunter profile not found for user %', p_hunter_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bounty_payments
     SET status = 'released_to_balance',
         hunter_id = p_hunter_id,
         platform_fee_amount = p_platform_fee,
         stripe_charge_id = v_charge_id,
         updated_at = now()
   WHERE id = v_bp.id;

  RETURN QUERY SELECT TRUE, v_tx_id, 'released_to_balance'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_v2_release_to_balance(uuid, uuid, text, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_v2_release_to_balance(uuid, uuid, text, numeric, numeric, text) TO service_role;

-- 3. Completion evidence: a completed wallet release row already satisfies
--    fn_bounty_has_confirmed_release (20261005010000), so the bounty can be
--    marked completed. Nothing to change there.

-- 4. The website's payout card (20261009000000) also appears for a balance credit.
CREATE OR REPLACE FUNCTION public.trg_thread_events_from_bounty_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hunter uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF NEW.status IN ('release_pending', 'released', 'released_to_balance') OR NEW.stripe_transfer_id IS NOT NULL THEN
      v_hunter := COALESCE(NEW.hunter_id, (SELECT accepted_by FROM public.bounties WHERE id = NEW.bounty_id));
      PERFORM public.fn_upsert_thread_event(NEW.bounty_id, v_hunter, 'payout', NEW.id,
        NEW.poster_id, 'Payment status updated.');
    ELSE
      PERFORM public.fn_touch_thread_events('payout', NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_thread_events_from_bounty_payments: % (payment %)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
