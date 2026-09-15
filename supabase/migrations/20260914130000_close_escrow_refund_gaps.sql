-- Closes #819 and #820, both on the escrow/refund path where the
-- marketplace loop currently stalls: a hunter can be stuck waiting on a
-- poster who was never told, and escrowed money's terms can still be
-- edited out from under it on legacy bounties.
--
-- Verified against production (2026-09-14) before writing this:
--   * bounty_cancellations: 5 'pending' rows. 4 sit on bounties already
--     'cancelled', each still holding an unrefunded $1.00 escrow row (the
--     status flip landed, the refund never did). The 5th sits on a bounty
--     that is 'open', a different, unrelated anomaly this migration does
--     not touch.
--   * bounties: exactly 15 non-terminal funding_mode='at_post' bounties
--     hold completed escrow with no mismatch yet ($239.00: 13 in_progress
--     = $229, 1 open = $5, 1 cancellation_requested = $5) — matching #820's
--     reported exposure exactly.
--
-- BEGIN/ROLLBACK-verified before being applied for real.

BEGIN;

-- =============================================================================
-- PART 1 (#820) — lock amount/is_for_honor once escrow exists, for every
-- funding_mode, and gate honor/minimum-amount edits the same way inserts are
-- gated.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. fn_bounties_enforce_funding_before_work: the price/terms freeze
-- (previously the "ELSE" half of the at_accept-only escrow check) now applies
-- to ANY funded bounty, not only 'at_accept' ones. Legacy 'at_post' bounties
-- reserve escrow at INSERT (fn_reserve_bounty_escrow), so this is the branch
-- that actually protects the $239 currently exposed: a poster could UPDATE
-- amount or is_for_honor on an escrowed at_post bounty because the guard
-- returned immediately for anything that wasn't 'at_accept'.
--
-- The "no work state without funding" invariant and the pre-escrow
-- applications-lock stay scoped to 'at_accept' exactly as before — those are
-- about a deferred bounty that hasn't been funded yet, which has no at_post
-- equivalent (at_post bounties are funded at INSERT or not created at all).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_bounties_enforce_funding_before_work()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_funding  boolean;
  v_has_requests boolean;
BEGIN
  -- funding_mode is immutable. Otherwise the guard below could be sidestepped
  -- by first flipping the row back to 'at_post'.
  IF NEW.funding_mode IS DISTINCT FROM OLD.funding_mode THEN
    RAISE EXCEPTION 'bounty_funding_mode_is_immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.payment_architecture_version IS DISTINCT FROM OLD.payment_architecture_version THEN
    RAISE EXCEPTION 'bounty_payment_architecture_version_is_immutable'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    WHERE (
      COALESCE(NEW.payment_architecture_version, 1) = 1
      AND EXISTS (
        SELECT 1 FROM public.wallet_transactions wt
        WHERE wt.bounty_id = NEW.id
          AND wt.type      = 'escrow'
          AND wt.status    = 'completed'
      )
    ) OR (
      COALESCE(NEW.payment_architecture_version, 1) = 2
      AND EXISTS (
        SELECT 1 FROM public.bounty_payments bp
        WHERE bp.bounty_id = NEW.id
          AND bp.status IN ('authorized', 'captured', 'release_pending', 'refund_pending', 'released', 'refunded', 'canceled')
      )
    ) OR (
      COALESCE(NEW.payment_architecture_version, 1) = 3
      AND EXISTS (
        SELECT 1 FROM public.bounty_v3_funding bf
        WHERE bf.bounty_id = NEW.id
          AND bf.state IN ('authorized', 'awaiting_hunter_onboarding', 'capturing', 'released', 'expired', 'canceled')
      )
    )
  ) INTO v_has_funding;

  -- Price/terms freeze. Once escrow exists, release/refund settle against
  -- whatever was actually escrowed — true for a legacy at_post bounty exactly
  -- as much as a deferred at_accept one. Checked unconditionally, before the
  -- at_accept-only logic below, so it can never be skipped by funding_mode.
  IF v_has_funding THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
      RAISE EXCEPTION 'bounty_amount_locked_by_escrow'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.is_for_honor IS DISTINCT FROM OLD.is_for_honor THEN
      RAISE EXCEPTION 'bounty_honor_flag_locked_by_escrow'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF OLD.funding_mode <> 'at_accept' THEN
    RETURN NEW;
  END IF;

  -- Pre-escrow, at_accept only: editing stays open while nobody has applied
  -- yet, which is what a poster fixing a typo actually needs. Once
  -- applications exist, the amount hunters evaluated must be the amount that
  -- gets escrowed.
  IF NOT v_has_funding THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bounty_requests br WHERE br.bounty_id = NEW.id
    ) INTO v_has_requests;

    IF v_has_requests THEN
      IF NEW.amount IS DISTINCT FROM OLD.amount THEN
        RAISE EXCEPTION 'bounty_amount_locked_by_applications'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.is_for_honor IS DISTINCT FROM OLD.is_for_honor THEN
        RAISE EXCEPTION 'bounty_honor_flag_locked_by_applications'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- THE invariant: no work state without funding. Unchanged, at_accept only.
  IF NEW.status::text IN ('in_progress', 'completed', 'cancellation_requested')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.is_for_honor IS NOT TRUE
     AND COALESCE(NEW.amount, 0) > 0
     AND NOT v_has_funding
  THEN
    RAISE EXCEPTION 'bounty_not_funded'
      USING ERRCODE  = '23514',
            HINT     = 'Escrow must be reserved before this bounty can enter work. '
                       'Accept the hunter via fn_accept_bounty_request, which reserves '
                       'escrow in the same transaction.';
  END IF;

  IF NEW.accepted_by IS NOT NULL
     AND NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
     AND NEW.is_for_honor IS NOT TRUE
     AND COALESCE(NEW.amount, 0) > 0
     AND NOT v_has_funding
  THEN
    RAISE EXCEPTION 'bounty_not_funded'
      USING ERRCODE = '23514',
            HINT    = 'A hunter cannot be assigned to an unfunded bounty.';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger itself is unchanged (BEFORE UPDATE, all columns) — only the
-- function body above changed.

-- ---------------------------------------------------------------------------
-- 1b. Posting policy was INSERT-only (fn_bounties_enforce_posting_policy /
-- trg_bounties_enforce_posting_policy, 20260909000000). A poster could still
-- UPDATE an existing bounty to is_for_honor=true, or drop amount below the
-- minimum, on any row that 1a doesn't already lock (no escrow yet — an open,
-- unaccepted, un-escrowed bounty). New trigger, fires only when one of the
-- gated columns actually changes, so it never re-litigates a legacy
-- already-for-honor or already-below-minimum row that isn't being touched.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_bounties_enforce_posting_policy_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_honor_enabled boolean;
  v_minimum       numeric;
BEGIN
  IF NEW.is_for_honor IS NOT DISTINCT FROM OLD.is_for_honor
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount
  THEN
    RETURN NEW;
  END IF;

  SELECT honor_posts_enabled, minimum_amount
    INTO v_honor_enabled, v_minimum
  FROM public.posting_policy_config
  WHERE id = true;

  -- Same fail-closed default as the INSERT gate.
  v_honor_enabled := COALESCE(v_honor_enabled, false);
  v_minimum       := COALESCE(v_minimum, 5);

  IF NEW.is_for_honor IS DISTINCT FROM OLD.is_for_honor
     AND COALESCE(NEW.is_for_honor, false)
     AND NOT v_honor_enabled
  THEN
    RAISE EXCEPTION 'for-honor bounties are not currently accepted'
      USING ERRCODE = 'check_violation',
            HINT    = 'Set an amount for this bounty instead of switching it to for-honor.';
  END IF;

  IF (
       NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.is_for_honor IS DISTINCT FROM OLD.is_for_honor
     )
     AND NOT COALESCE(NEW.is_for_honor, false)
     AND COALESCE(NEW.amount, 0) < v_minimum
  THEN
    RAISE EXCEPTION 'bounty amount % is below the % minimum', COALESCE(NEW.amount, 0), v_minimum
      USING ERRCODE = 'check_violation',
            HINT    = 'Raise the amount to at least the minimum shown in the app.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bounties_enforce_posting_policy_on_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bounties_enforce_posting_policy_on_update() FROM anon;

DROP TRIGGER IF EXISTS trg_bounties_enforce_posting_policy_on_update ON public.bounties;
CREATE TRIGGER trg_bounties_enforce_posting_policy_on_update
  BEFORE UPDATE OF is_for_honor, amount ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounties_enforce_posting_policy_on_update();

COMMENT ON TRIGGER trg_bounties_enforce_posting_policy_on_update ON public.bounties IS
  '#820: mirrors trg_bounties_enforce_posting_policy (INSERT) for UPDATE OF is_for_honor, amount, only when the value actually changes.';

-- =============================================================================
-- PART 2 (#819) — notify the poster when a hunter requests cancellation.
-- request_bounty_cancellation moved bounties.status and inserted the
-- bounty_cancellations row, but nothing told the poster. The hunter was left
-- stuck in cancellation_requested until the poster happened to open the
-- bounty. Body is otherwise byte-for-byte 20260908020000's version.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.request_bounty_cancellation(
  p_bounty_id UUID,
  p_reason    TEXT
)
RETURNS SETOF public.bounty_cancellations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bounty    public.bounties%rowtype;
  v_caller    UUID := auth.uid();
  v_has_v1_escrow boolean;
  v_poster_id UUID;
  v_hunter    TEXT;
  v_title     TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty % not found', p_bounty_id USING ERRCODE = 'P0002';
  END IF;

  -- The whole rule, enforced server-side rather than by which screen rendered
  -- the button.
  IF v_bounty.accepted_by IS NULL OR v_bounty.accepted_by <> v_caller THEN
    RAISE EXCEPTION 'only the accepted hunter may request cancellation'
      USING ERRCODE = '42501';
  END IF;

  IF v_bounty.status::text = 'cancellation_requested' THEN
    RAISE EXCEPTION 'a cancellation request is already open for this bounty'
      USING ERRCODE = '23505';
  END IF;

  IF v_bounty.status::text <> 'in_progress' THEN
    RAISE EXCEPTION 'cannot request cancellation from status %', v_bounty.status
      USING ERRCODE = '22023';
  END IF;

  v_has_v1_escrow :=
    COALESCE(v_bounty.payment_architecture_version, 1) = 1
    AND EXISTS (
      SELECT 1 FROM public.wallet_transactions wt
      WHERE wt.bounty_id = p_bounty_id
        AND wt.type      = 'escrow'
        AND wt.status    = 'completed'
    );

  v_poster_id := COALESCE(v_bounty.poster_id, v_bounty.user_id);
  v_hunter    := public.get_display_name(v_caller);
  v_title     := left(COALESCE(NULLIF(TRIM(v_bounty.title), ''), 'your bounty'), 80);

  -- For-honor bounties with no legacy v1 escrow hold no money, so there is
  -- nothing for the poster to weigh: they cancel outright, exactly as the old
  -- client-side branch did.
  IF COALESCE(v_bounty.is_for_honor, FALSE) AND NOT v_has_v1_escrow THEN
    UPDATE public.bounties
       SET status = 'cancelled', updated_at = now()
     WHERE id = p_bounty_id;

    IF v_poster_id IS NOT NULL THEN
      INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
      VALUES (
        jsonb_build_array(v_poster_id),
        'Bounty cancelled',
        v_hunter || ' cancelled "' || v_title
          || '." For-honor bounties don''t need your approval — you can repost it anytime.',
        jsonb_build_object(
          'type', 'cancellation_accepted',
          'bounty_id', p_bounty_id,
          'bountyId', p_bounty_id,
          'hunter_id', v_caller,
          'hunterId', v_caller,
          'auto_cancelled', true
        ),
        p_bounty_id::text
      );
    END IF;

    RETURN QUERY
      INSERT INTO public.bounty_cancellations (
        bounty_id, requester_id, requester_type, reason, status,
        refund_percentage, response_message, resolved_at
      ) VALUES (
        p_bounty_id, v_caller, 'hunter', p_reason, 'accepted',
        0,
        'Auto-accepted: for honor bounties do not require manual dispute resolution.',
        now()
      )
      RETURNING *;
    RETURN;
  END IF;

  UPDATE public.bounties
     SET status = 'cancellation_requested', updated_at = now()
   WHERE id = p_bounty_id;

  IF v_poster_id IS NOT NULL THEN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(v_poster_id),
      v_hunter || ' requested to cancel',
      v_hunter || ' has requested to cancel "' || v_title
        || '." Review the request to release them and get your funds back.',
      jsonb_build_object(
        'type', 'cancellation_request',
        'bounty_id', p_bounty_id,
        'bountyId', p_bounty_id,
        'hunter_id', v_caller,
        'hunterId', v_caller,
        'cancellation_reason', p_reason
      ),
      p_bounty_id::text
    );
  END IF;

  -- 100, not calculateRecommendedRefund's suggestion: approving this returns
  -- the whole escrow, and nothing in the settlement path ever pays a hunter a
  -- remainder, so a partial figure here would be a promise nobody keeps.
  RETURN QUERY
    INSERT INTO public.bounty_cancellations (
      bounty_id, requester_id, requester_type, reason, status, refund_percentage
    ) VALUES (
      p_bounty_id, v_caller, 'hunter', p_reason, 'pending', 100
    )
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.request_bounty_cancellation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_bounty_cancellation(UUID, TEXT)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Data fix: resolve the stale pending bounty_cancellations rows whose bounty
-- already reached 'cancelled' (the status flip landed at some point before
-- the hunter-only/refund-on-approval migrations existed; the refund never
-- did). Scoped deliberately to bounty status = 'cancelled' only — the queue
-- also holds one pending row on a bounty that is 'open', a different,
-- unrelated anomaly left untouched here. Mirrors
-- admin_approve_bounty_cancellation's settlement logic (idempotent, v1-only,
-- full-escrow refund) without its auth.jwt() admin check, which has no value
-- inside a migration.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_row              RECORD;
  v_escrow_tx_id     uuid;
  v_escrow_amount    numeric;
  v_recipient_id     uuid;
  v_already_settled  boolean;
BEGIN
  FOR v_row IN
    SELECT bc.id AS cancellation_id, bc.bounty_id,
           b.poster_id, b.user_id
    FROM public.bounty_cancellations bc
    JOIN public.bounties b ON b.id = bc.bounty_id
    WHERE bc.status = 'pending'
      AND b.status::text = 'cancelled'
      AND COALESCE(b.payment_architecture_version, 1) = 1
    FOR UPDATE OF bc
  LOOP
    v_escrow_tx_id  := NULL;
    v_escrow_amount := NULL;
    v_recipient_id  := NULL;

    SELECT EXISTS (
      SELECT 1 FROM public.wallet_transactions
      WHERE bounty_id = v_row.bounty_id
        AND type IN ('refund', 'release')
        AND status IN ('completed', 'pending')
    ) INTO v_already_settled;

    IF NOT v_already_settled THEN
      SELECT id, amount, COALESCE(user_id, v_row.poster_id, v_row.user_id)
        INTO v_escrow_tx_id, v_escrow_amount, v_recipient_id
        FROM public.wallet_transactions
       WHERE bounty_id = v_row.bounty_id
         AND type      = 'escrow'
         AND status    = 'completed'
       LIMIT 1;

      IF v_escrow_tx_id IS NOT NULL AND v_recipient_id IS NOT NULL THEN
        v_escrow_amount := ABS(v_escrow_amount);

        INSERT INTO public.wallet_transactions (
          user_id, bounty_id, type, amount, description, status, metadata
        ) VALUES (
          v_recipient_id,
          v_row.bounty_id,
          'refund',
          v_escrow_amount,
          'Refund for bounty ' || v_row.bounty_id::text || ': stale cancellation request backfill',
          'completed',
          jsonb_build_object(
            'bounty_id',              v_row.bounty_id,
            'escrow_transaction_id',  v_escrow_tx_id,
            'reason',                 'stale_cancellation_backfill_20260914',
            'refund_percentage',      100,
            'original_escrow_amount', v_escrow_amount,
            'refunded_at',            now()
          )
        );

        PERFORM public.update_balance(v_recipient_id, v_escrow_amount);
      END IF;
    END IF;

    UPDATE public.bounty_cancellations
       SET status           = 'accepted',
           response_message = COALESCE(
             response_message,
             'Auto-resolved: bounty was already cancelled; escrow settled by the 2026-09-14 backfill.'
           ),
           refund_amount    = COALESCE(refund_amount, v_escrow_amount),
           resolved_at      = now()
     WHERE id = v_row.cancellation_id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
