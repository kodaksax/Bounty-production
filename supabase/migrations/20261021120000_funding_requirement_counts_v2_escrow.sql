-- fn_get_bounty_funding_requirement: a held v2 payment counts as funded.
--
-- The defect. `already_funded` was true only for a completed v1 `escrow`
-- wallet_transactions row. A v2 bounty (payment_architecture_version = 2,
-- the website's Stripe Checkout flow, funding_mode 'at_post') holds its money
-- in bounty_payments instead, so for every paid web bounty the function said
-- already_funded = false.
--
-- The one reader is lib/services/bounty-cancel-refund.ts planCancelRefund,
-- behind every poster "Delete" / "Cancel and refund" in the app. Given false it
-- concluded nothing was held, told the poster "You haven't been charged for
-- it, so there's nothing to refund", skipped /bounty-payments/cancel and
-- deleted the bounty. The charge stayed `captured` in Stripe with no refund.
-- Production: bounty 060079f5 ($5, paid on the website 2026-10-08 15:56,
-- deleted from the app 2.5 minutes later) is still `captured`.
--
-- The fix is here rather than only in the app because builds already on
-- phones run the same code: once already_funded is true, they route a v2
-- bounty to /bounty-payments/cancel (Stripe refund) before deleting it. No
-- release or OTA is needed for this to take effect.
--
-- What does NOT change:
--   - requires_funding / amount_required / shortfall. For an at_post bounty
--     requires_funding was already false; an at_accept bounty with a held v2
--     payment (none exist today) is correctly reported as not needing funding.
--   - The v1 predicate, the poster-only check, SECURITY DEFINER, search_path,
--     the signature and therefore the existing grants (CREATE OR REPLACE keeps
--     them: authenticated only, no anon/PUBLIC).
--
-- 'authorized' (a manual-capture hold) and 'captured' are the v2 states in
-- which money is held for the poster and /bounty-payments/cancel gives it
-- back. pending_payment holds nothing; refund_pending / refunded / canceled
-- are already on their way back; released belongs to the hunter. v3 is not
-- included: v3_rollout_config.enabled = false and bounty_v3_funding has no
-- rows, so there is no v3 escrow to report.
--
-- Rollback: supabase/rollbacks/production/20261021120000_funding_requirement_counts_v2_escrow.down.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_get_bounty_funding_requirement(p_bounty_id uuid)
RETURNS TABLE(
  bounty_id          uuid,
  funding_mode       text,
  requires_funding   boolean,
  amount_required    numeric,
  already_funded     boolean,
  poster_balance     numeric,
  shortfall          numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounty      public.bounties%ROWTYPE;
  v_poster_id   uuid;
  v_funded      boolean;
  v_balance     numeric;
  v_requires    boolean;
  v_amount      numeric;
BEGIN
  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty_not_found';
  END IF;

  v_poster_id := COALESCE(v_bounty.poster_id, v_bounty.user_id);

  -- Poster-only: this exposes a wallet balance.
  IF auth.uid() IS NULL OR auth.uid() <> v_poster_id THEN
    RAISE EXCEPTION 'Only the bounty poster can read funding requirements'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.wallet_transactions wt
    WHERE wt.bounty_id = v_bounty.id
      AND wt.type      = 'escrow'
      AND wt.status    = 'completed'
  ) OR EXISTS (
    SELECT 1 FROM public.bounty_payments bp
    WHERE bp.bounty_id = v_bounty.id
      AND bp.status    IN ('authorized', 'captured')
  ) INTO v_funded;

  SELECT balance INTO v_balance FROM public.profiles WHERE id = v_poster_id;
  v_balance := COALESCE(v_balance, 0);

  v_amount   := COALESCE(v_bounty.amount, 0);
  v_requires := v_bounty.funding_mode = 'at_accept'
                AND v_bounty.is_for_honor IS NOT TRUE
                AND v_amount > 0
                AND NOT v_funded;

  RETURN QUERY SELECT
    v_bounty.id,
    v_bounty.funding_mode,
    v_requires,
    CASE WHEN v_requires THEN v_amount ELSE 0::numeric END,
    v_funded,
    v_balance,
    CASE WHEN v_requires THEN GREATEST(0::numeric, v_amount - v_balance) ELSE 0::numeric END;
END;
$$;

COMMIT;
