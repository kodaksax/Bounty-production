-- Rollback for 20261021120000_funding_requirement_counts_v2_escrow.sql.
--
-- Restores the v1-only already_funded predicate, byte-for-byte the body
-- production ran before (20260823120000). The migration wrote no rows.
--
-- Rolling back reopens the defect: deleting or cancelling a paid website
-- bounty from the app skips the Stripe refund again. Builds carrying the
-- client-side half of the fix (lib/services/bounty-cancel-refund.ts asks
-- bounty_payments directly for v2 bounties) are not affected.

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
