-- Reconstructed during the 2026-07 migration drift audit (Stripe Phase 2
-- rollout): fn_open_dispute_hold (both the integer and uuid overloads),
-- apply_dispute_loss_transaction, and apply_refund were applied live to
-- production at some point but were never captured in a migration file, so
-- a fresh replay (e.g. rebasing the Staging branch) failed with
-- "function ... does not exist" once it reached
-- 20260717023631_stripe_connect_marketplace_phase2.sql, which REVOKEs
-- privileges on all of them. Recreated here verbatim from production's
-- pg_proc definitions so replays are reproducible going forward.

CREATE OR REPLACE FUNCTION public.fn_open_dispute_hold(p_dispute_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM 1
    FROM public.bounty_disputes
   WHERE id = p_dispute_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute % not found', p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  -- No-op in current schema:
  -- bounty_disputes.hold_amount and profiles.balance_on_hold do not exist.
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_open_dispute_hold(p_dispute_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF NOT FOUND THEN
    -- Poster profile missing; nothing can be safely held.
    RETURN;
  END IF;

  v_hold_amount := LEAST(v_bounty_amount, GREATEST(0, COALESCE(v_poster_balance, 0)));

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
$function$;

CREATE OR REPLACE FUNCTION public.apply_dispute_loss_transaction(p_user_id uuid, p_amount numeric, p_description text, p_stripe_dispute_id text, p_stripe_payment_intent_id text)
 RETURNS TABLE(id uuid, user_id uuid, type text, amount numeric, description text, status text, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_existing_id uuid;
  v_inserted_id uuid;
BEGIN
  IF p_stripe_dispute_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.wallet_transactions
    WHERE type = 'dispute_loss'
      AND (metadata->>'stripe_dispute_id') = p_stripe_dispute_id
      AND status = 'completed'
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY
      SELECT id, user_id, type::text, amount, description, status::text, metadata
      FROM public.wallet_transactions
      WHERE id = v_existing_id;
      RETURN;
    END IF;
  END IF;

  -- Update balance (will raise on insufficient funds or other errors).
  PERFORM update_balance(p_user_id, p_amount);

  -- Insert the completed wallet transaction.
  INSERT INTO public.wallet_transactions (user_id, type, amount, description, status, metadata)
  VALUES (
    p_user_id,
    'dispute_loss',
    p_amount,
    p_description,
    'completed',
    jsonb_build_object('stripe_dispute_id', p_stripe_dispute_id, 'stripe_payment_intent_id', p_stripe_payment_intent_id)
  ) RETURNING id INTO v_inserted_id;

  RETURN QUERY
  SELECT id, user_id, type::text, amount, description, status::text, metadata
  FROM public.wallet_transactions
  WHERE id = v_inserted_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_profile_balance_not_frozen(p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance_frozen BOOLEAN;
BEGIN
  SELECT balance_frozen
  INTO v_balance_frozen
  FROM public.profiles
  WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile % not found', p_profile_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_balance_frozen THEN
    RAISE EXCEPTION 'Balance is frozen for profile %', p_profile_id
      USING ERRCODE = 'P0001',
            HINT = 'Open Stripe disputes must be resolved before withdrawals or other balance-moving operations are allowed.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_refund(p_user_id uuid, p_amount numeric, p_stripe_refund_id text, p_stripe_charge_id text, p_description text DEFAULT 'Payment refunded'::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(applied boolean, tx_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx_id       UUID;
  v_new_balance NUMERIC;
BEGIN
  -- Attempt to insert the refund transaction. If a row with the same
  -- stripe_refund_id already exists (partial unique index), ON CONFLICT
  -- suppresses the insert and v_tx_id stays NULL.
  INSERT INTO public.wallet_transactions (
    user_id,
    type,
    amount,
    description,
    status,
    stripe_charge_id,
    stripe_refund_id,
    metadata,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    'refund',
    p_amount,
    p_description,
    'completed',
    p_stripe_charge_id,
    p_stripe_refund_id,
    p_metadata,
    NOW(),
    NOW()
  )
  ON CONFLICT (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_tx_id;

  IF v_tx_id IS NOT NULL THEN
    -- Fresh insert; apply balance change in same transaction.
    UPDATE public.profiles
    SET balance = COALESCE(balance, 0) + p_amount,
        updated_at = NOW()
    WHERE id = p_user_id
    RETURNING balance INTO v_new_balance;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile not found for user %', p_user_id;
    END IF;

    -- Guard against negative resulting balance.
    IF v_new_balance < 0 THEN
      RAISE EXCEPTION 'Insufficient funds: new balance would be %', v_new_balance
        USING ERRCODE = '23514';
    END IF;

    RETURN QUERY SELECT TRUE, v_tx_id;
  ELSE
    -- Existing refund_id found. If it was previously failed, upgrade it
    -- to completed and apply balance change now.
    UPDATE public.wallet_transactions
    SET amount = p_amount,
        description = p_description,
        status = 'completed',
        stripe_charge_id = p_stripe_charge_id,
        metadata = p_metadata,
        updated_at = NOW()
    WHERE stripe_refund_id = p_stripe_refund_id
      AND status = 'failed'
    RETURNING id INTO v_tx_id;

    IF v_tx_id IS NOT NULL THEN
      UPDATE public.profiles
      SET balance = COALESCE(balance, 0) + p_amount,
          updated_at = NOW()
      WHERE id = p_user_id
      RETURNING balance INTO v_new_balance;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found for user %', p_user_id;
      END IF;

      IF v_new_balance < 0 THEN
        RAISE EXCEPTION 'Insufficient funds: new balance would be %', v_new_balance
          USING ERRCODE = '23514';
      END IF;

      RETURN QUERY SELECT TRUE, v_tx_id;
    END IF;

    -- True duplicate (already completed elsewhere).
    RETURN QUERY SELECT FALSE, NULL::UUID;
  END IF;
END;
$function$;
