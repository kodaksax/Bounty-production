-- ============================================================================
-- Wallet posting fee: a flat fee debited from the poster's wallet at post.
--
-- A wallet-funded bounty already debits its reward into escrow in
-- fn_reserve_bounty_escrow. This debits the fee in the same trigger, as its own
-- 'posting_fee' wallet_transactions row. It is platform revenue:
--
--   * never part of escrow, so it cannot be released to the hunter or counted
--     as held funds (every escrow sum filters on type = 'escrow')
--   * not refunded when the bounty is cancelled; refunds return escrow only
--   * mirrored to ledger_entries as the existing 'platform_fee' leg
--
-- The amount lives in payment_experiment_config.wallet_posting_fee and
-- defaults to 0, which is off. Applying this migration changes nothing until
-- that value is set.
--
-- Charged only on the funded-at-post path. A deferred (at_accept) bounty skips
-- the whole trigger, and a bounty prepaid through the card checkout
-- (posting_checkout_attempt_id, see 20260921120000) already paid its fee
-- there, so it is not charged twice.
--
-- An under-funded wallet raises 23514 from update_balance, which aborts the
-- bounty INSERT exactly as a short escrow debit does.
-- ============================================================================

ALTER TABLE public.payment_experiment_config
  ADD COLUMN IF NOT EXISTS wallet_posting_fee numeric(10,2) NOT NULL DEFAULT 0
    CHECK (wallet_posting_fee >= 0);

COMMENT ON COLUMN public.payment_experiment_config.wallet_posting_fee IS
  'Flat fee in dollars debited from the poster''s wallet when a bounty is funded at post. 0 = off. Platform revenue, recorded as a posting_fee wallet transaction.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fee lookup for the client, so the composer's balance check and copy use
--    the server's number instead of a hard-coded one.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_get_wallet_posting_fee()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT wallet_posting_fee FROM public.payment_experiment_config WHERE id LIMIT 1),
    0
  );
$function$;

REVOKE ALL ON FUNCTION public.fn_get_wallet_posting_fee() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_get_wallet_posting_fee() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_get_wallet_posting_fee() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. fn_reserve_bounty_escrow: redefined from the live pg_get_functiondef, with
--    only the fee block (after the escrow debit) added.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_reserve_bounty_escrow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_id   uuid;
  v_amount      numeric;
  v_description text;
  v_tx_id       uuid;
  v_locked_id   uuid;
  v_fee         numeric;
BEGIN
  IF COALESCE(NEW.payment_architecture_version, 1) = 2 THEN
    RETURN NEW;
  END IF;

  IF NEW.funding_mode = 'at_accept' THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);
  v_amount    := NEW.amount;

  IF NEW.is_for_honor IS TRUE OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  IF v_poster_id IS NULL THEN
    RAISE EXCEPTION 'Cannot reserve escrow: bounty has no poster_id/user_id'
      USING ERRCODE = '23502';
  END IF;

  SELECT id INTO v_locked_id
  FROM public.profiles
  WHERE id = v_poster_id
  FOR UPDATE;

  IF v_locked_id IS NULL THEN
    RAISE EXCEPTION 'Cannot reserve escrow: poster profile % not found', v_poster_id
      USING ERRCODE = 'P0002';
  END IF;

  v_description := 'Escrow for bounty: ' || COALESCE(NEW.title, NEW.id::text);

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

  IF v_tx_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM update_balance(v_poster_id, -v_amount);

  -- Posting fee: platform revenue, debited next to escrow but never part of it.
  -- A card-checkout bounty already paid its fee; normalize has NULLed any
  -- unverified attempt id by now, so a non-null one is a real prepayment.
  IF NEW.posting_checkout_attempt_id IS NULL THEN
    SELECT COALESCE(wallet_posting_fee, 0) INTO v_fee
    FROM public.payment_experiment_config
    WHERE id
    LIMIT 1;

    IF COALESCE(v_fee, 0) > 0 THEN
      INSERT INTO public.wallet_transactions (
        user_id, bounty_id, type, amount, description, status, metadata
      ) VALUES (
        v_poster_id,
        NEW.id,
        'posting_fee',
        -v_fee,
        'Posting fee: ' || COALESCE(NEW.title, NEW.id::text),
        'completed',
        jsonb_build_object(
          'bounty_id',   NEW.id,
          'charged_at',  NOW(),
          'created_via', 'bounty_insert_trigger'
        )
      );

      PERFORM update_balance(v_poster_id, -v_fee);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Ledger mirror: map posting_fee to the existing platform_fee leg. Without
--    it the leg is NULL, the mirror insert fails its NOT NULL, and the
--    exception handler in fn_mirror_wallet_transaction_to_ledger drops the row
--    silently. Redefined from the live pg_get_functiondef; only the
--    'posting_fee' line is new.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ledger_upsert_from_wallet_transaction(wt wallet_transactions)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_leg    public.ledger_leg_enum;
  v_app    public.app_state_enum;
  v_stripe public.stripe_state_enum;
begin
  v_leg := (case wt.type::text
    when 'deposit'          then 'payment'
    when 'escrow'           then 'escrow_hold'
    when 'release'          then 'capture_release'
    when 'refund'           then 'refund'
    when 'withdrawal'       then 'payout'
    when 'posting_fee'      then 'platform_fee'
    when 'dispute_loss'     then 'dispute_loss'
    when 'admin_adjustment' then 'admin_adjustment'
  end)::public.ledger_leg_enum;

  if wt.type::text = 'withdrawal' then
    if wt.payout_method = 'manually_paid' then
      v_app := 'succeeded'; v_stripe := 'confirmed';
    elsif wt.stripe_payout_id is not null and wt.status::text = 'completed' then
      v_app := 'succeeded'; v_stripe := 'confirmed';
    elsif wt.stripe_payout_id is not null and wt.status::text = 'pending' then
      v_app := 'requested'; v_stripe := 'pending';
    elsif wt.status::text = 'failed' then
      v_app := 'failed';    v_stripe := 'failed';
    elsif wt.status::text = 'completed' and wt.stripe_payout_id is null then
      v_app := 'succeeded'; v_stripe := 'none';
    else
      v_app := 'requested'; v_stripe := 'none';
    end if;
  else
    v_app := (case wt.status::text
      when 'completed'     then 'succeeded'
      when 'manually_paid' then 'succeeded'
      when 'failed'        then 'failed'
      else 'requested'
    end)::public.app_state_enum;

    v_stripe := (case
      when wt.stripe_payment_intent_id is not null
        or wt.stripe_charge_id is not null
        or wt.stripe_transfer_id is not null
        or wt.stripe_refund_id is not null
      then 'confirmed' else 'none'
    end)::public.stripe_state_enum;
  end if;

  insert into public.ledger_entries (
    bounty_id, transfer_group, leg, app_state, stripe_state,
    amount_cents, currency,
    stripe_payment_intent_id, stripe_charge_id,
    stripe_transfer_id, stripe_payout_id,
    user_id, metadata, created_at, updated_at
  ) values (
    wt.bounty_id,
    coalesce(wt.bounty_id::text, wt.reference_id),
    v_leg, v_app, v_stripe,
    round(wt.amount * 100)::bigint, 'usd',
    wt.stripe_payment_intent_id, wt.stripe_charge_id,
    wt.stripe_transfer_id, wt.stripe_payout_id,
    coalesce(wt.user_id, wt.receiver_id, wt.sender_id),
    jsonb_build_object(
      'source',                       'wallet_transactions_mirror',
      'source_wallet_transaction_id', wt.id::text,
      'source_type',                  wt.type::text,
      'source_status',                wt.status::text,
      'source_payout_method',         wt.payout_method
    ),
    wt.created_at, wt.updated_at
  )
  on conflict ((metadata->>'source_wallet_transaction_id'))
    where metadata ? 'source_wallet_transaction_id'
  do update set
    leg                      = excluded.leg,
    app_state                = excluded.app_state,
    stripe_state             = excluded.stripe_state,
    amount_cents             = excluded.amount_cents,
    stripe_payment_intent_id = excluded.stripe_payment_intent_id,
    stripe_charge_id         = excluded.stripe_charge_id,
    stripe_transfer_id       = excluded.stripe_transfer_id,
    stripe_payout_id         = excluded.stripe_payout_id,
    metadata                 = excluded.metadata,
    updated_at               = now();
end;
$function$;

-- Set the fee per environment after applying, e.g. on staging:
--   UPDATE public.payment_experiment_config SET wallet_posting_fee = 1.00, updated_at = now();
