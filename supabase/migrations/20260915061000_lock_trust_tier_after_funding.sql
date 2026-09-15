-- Forensic QA follow-up (2026-09-15): fn_bounties_enforce_funding_before_work
-- (20260915055722_close_escrow_refund_gaps.sql) locks `amount` and
-- `is_for_honor` once escrow exists, but never touched `trust_tier` /
-- `requires_id_verified`. Those columns (20260915053615_bounty_trust_tier.sql)
-- back a real safety promise: a hunter applies to (or a poster accepts into)
-- a high-risk bounty specifically because it requires ID verification. RLS on
-- bounties is `auth.uid() = poster_id` with no column restriction, so without
-- this the poster could silently
--   PATCH /bounties?id=eq.X {"requires_id_verified": false}
-- after funding — after hunters already applied or were accepted under that
-- promise — stripping the guarantee `hunter_meets_bounty_id_requirement`
-- exists to enforce, with no trace beyond the row's new value.
--
-- Same lock as amount/is_for_honor: only while funded. Pre-escrow, a poster
-- adjusting the risk tier while still editing an unfunded draft is fine and
-- unchanged.

BEGIN;

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
    -- Trust-tier / ID-verification requirement freeze. A hunter applied or
    -- was accepted on the strength of this promise; it cannot be quietly
    -- withdrawn once money is on the line.
    IF NEW.requires_id_verified IS DISTINCT FROM OLD.requires_id_verified THEN
      RAISE EXCEPTION 'bounty_id_requirement_locked_by_escrow'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.trust_tier IS DISTINCT FROM OLD.trust_tier THEN
      RAISE EXCEPTION 'bounty_trust_tier_locked_by_escrow'
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

NOTIFY pgrst, 'reload schema';

COMMIT;
