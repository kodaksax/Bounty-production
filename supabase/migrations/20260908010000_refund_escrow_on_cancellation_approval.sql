-- Return escrow to the poster when a cancellation request is granted.
--
-- WHY
-- ---
-- Approving a cancellation moved the marketplace status and nothing else.
-- `admin_set_bounty_status` is documented as a lifecycle-only move ("It does
-- not move any money"), and the admin screen's `cancellation_requested ->
-- cancelled` transition went through it, so granting a cancellation left:
--   * the escrow `wallet_transactions` row with no offsetting refund, and
--   * the `bounty_cancellations` row still `pending` with a NULL responder,
-- i.e. the poster's money stranded in escrow with the bounty already dead.
-- Seven bounties reached a terminal state that way, holding $64.00.
--
-- The escrow debits the poster at acceptance (see
-- fn_reserve_escrow_for_acceptance), so granting the cancellation has to put
-- that money back. This function is the settlement counterpart, modelled
-- directly on fn_refund_wallet_escrow_for_dispute — the established, audited
-- pattern for admin-driven v1 wallet settlement: SECURITY DEFINER, admin
-- guarded, idempotent, crediting through update_balance().
--
-- SCOPE
-- -----
-- v1 custodial wallet only (payment_architecture_version = 1), which is what
-- production runs. v2 bounties settle through Stripe
-- (bountyPaymentsService.cancelBountyPayment) and are left untouched here.
--
-- Refunds the FULL escrowed amount. `bounty_cancellations.refund_percentage`
-- is recorded as advice (calculateRecommendedRefund suggests 50 for an
-- in-progress bounty) but there is no flow that pays a hunter the remainder,
-- so honouring a partial percentage would strand the rest exactly the way
-- this migration exists to stop.

CREATE OR REPLACE FUNCTION public.admin_approve_bounty_cancellation(
  p_bounty_id UUID,
  p_reason    TEXT DEFAULT NULL
)
RETURNS TABLE(
  bounty_status           TEXT,
  refund_applied          BOOLEAN,
  refund_transaction_id   UUID,
  refund_amount           NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bounty              public.bounties%rowtype;
  v_from                TEXT;
  v_recipient_id        UUID;
  v_escrow_tx_id        UUID;
  v_escrow_tx_amount    NUMERIC;
  v_existing_settlement UUID;
  v_refund_tx_id        UUID;
  v_refund_amount       NUMERIC;
  v_applied             BOOLEAN := FALSE;
BEGIN
  PERFORM public.admin_assert_role();

  -- Lock the bounty for the whole settlement so two admins cannot both
  -- approve and both refund.
  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty % not found', p_bounty_id USING ERRCODE = 'P0002';
  END IF;

  v_from := v_bounty.status::text;

  -- 'cancelled' is accepted as an entry state on purpose: it lets a retry
  -- finish the settlement for a bounty whose status flip already landed but
  -- whose refund did not (exactly the shape of the stranded rows this fixes).
  IF v_from NOT IN ('cancellation_requested', 'cancelled') THEN
    RAISE EXCEPTION 'cannot approve cancellation from status %', v_from
      USING ERRCODE = '22023';
  END IF;

  -- ── Money ──────────────────────────────────────────────────────────────
  -- Skipped entirely when there is nothing to return: honor/zero-amount
  -- bounties, and v2 bounties whose escrow lives at Stripe rather than in
  -- wallet_transactions.
  IF NOT COALESCE(v_bounty.is_for_honor, FALSE)
     AND COALESCE(v_bounty.amount, 0) > 0
     AND COALESCE(v_bounty.payment_architecture_version, 1) = 1
  THEN
    -- Idempotency: never double-refund, and never refund after a release.
    SELECT id INTO v_existing_settlement
      FROM public.wallet_transactions
     WHERE bounty_id = p_bounty_id
       AND type   IN ('refund', 'release')
       AND status IN ('completed', 'pending')
     LIMIT 1;

    IF v_existing_settlement IS NULL THEN
      SELECT id, amount, user_id
        INTO v_escrow_tx_id, v_escrow_tx_amount, v_recipient_id
        FROM public.wallet_transactions
       WHERE bounty_id = p_bounty_id
         AND type      = 'escrow'
         AND status    = 'completed'
       LIMIT 1;

      -- Credit whoever was actually debited. Falls back to the bounty's own
      -- poster columns only if the escrow row somehow carries no user.
      v_recipient_id := COALESCE(
        v_recipient_id, v_bounty.poster_id, v_bounty.user_id
      );
      v_refund_amount := ABS(COALESCE(v_escrow_tx_amount, 0));

      IF v_escrow_tx_id IS NOT NULL
         AND v_refund_amount > 0
         AND v_recipient_id IS NOT NULL
      THEN
        INSERT INTO public.wallet_transactions (
          user_id, bounty_id, type, amount, description, status, metadata
        ) VALUES (
          v_recipient_id,
          p_bounty_id,
          'refund',
          v_refund_amount,
          'Refund for bounty ' || p_bounty_id::text || ': cancellation approved',
          'completed',
          jsonb_build_object(
            'bounty_id',             p_bounty_id,
            'escrow_transaction_id', v_escrow_tx_id,
            'reason',                COALESCE(p_reason, 'cancellation_approved'),
            'refund_percentage',     100,
            'original_escrow_amount', v_refund_amount,
            'approved_by',           auth.uid(),
            'refunded_at',           now()
          )
        )
        RETURNING id INTO v_refund_tx_id;

        -- Raises 23514 if this would drive the balance negative, which aborts
        -- the whole approval rather than half-settling it.
        PERFORM public.update_balance(v_recipient_id, v_refund_amount);
        v_applied := TRUE;
      ELSE
        v_refund_amount := NULL;
      END IF;
    ELSE
      -- Already settled; report the existing row rather than inventing money.
      v_refund_tx_id  := v_existing_settlement;
      v_refund_amount := NULL;
    END IF;
  END IF;

  -- ── Resolve the request ────────────────────────────────────────────────
  -- Leaving this `pending` is what made a granted cancellation look unhandled
  -- on both parties' screens.
  -- Aliased, and every right-hand column reference qualified, because this
  -- function's RETURNS TABLE declares an OUT parameter named `refund_amount`.
  -- An unqualified `refund_amount` inside the COALESCE matches both that
  -- parameter and the column, and PL/pgSQL refuses it at runtime:
  --   ERROR: column reference "refund_amount" is ambiguous (42702)
  -- which aborted the whole approval — no refund, no status change.
  UPDATE public.bounty_cancellations AS bc
     SET status           = 'accepted',
         responder_id     = COALESCE(bc.responder_id, auth.uid()),
         response_message = COALESCE(
           bc.response_message,
           COALESCE(p_reason, 'Cancellation approved by support.')
         ),
         refund_amount    = COALESCE(bc.refund_amount, v_refund_amount),
         resolved_at      = COALESCE(bc.resolved_at, now())
   WHERE bc.bounty_id = p_bounty_id
     AND bc.status    = 'pending';

  -- ── Marketplace status ─────────────────────────────────────────────────
  IF v_from <> 'cancelled' THEN
    UPDATE public.bounties
       SET status = 'cancelled', updated_at = now()
     WHERE id = p_bounty_id;
  END IF;

  IF to_regprocedure(
       'public.record_bounty_event(text,text,text,uuid,uuid,timestamptz,numeric,text,jsonb)'
     ) IS NOT NULL THEN
    PERFORM public.record_bounty_event(
      'admin.cancellation_approved:' || p_bounty_id::text || ':'
        || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
      'admin.cancellation_approved', 'system', p_bounty_id, auth.uid(), now(),
      v_refund_amount, NULL,
      jsonb_build_object(
        'from',           v_from,
        'to',             'cancelled',
        'reason',         p_reason,
        'refund_applied', v_applied,
        'refund_tx',      v_refund_tx_id
      ));
  END IF;

  RETURN QUERY SELECT 'cancelled'::TEXT, v_applied, v_refund_tx_id, v_refund_amount;
END;
$$;

-- New functions are created with EXECUTE granted to PUBLIC, which reaches the
-- unauthenticated `anon` role. This one is SECURITY DEFINER and moves money,
-- so the default grant has to come off before the intended one goes on.
REVOKE ALL ON FUNCTION public.admin_approve_bounty_cancellation(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_bounty_cancellation(UUID, TEXT)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
