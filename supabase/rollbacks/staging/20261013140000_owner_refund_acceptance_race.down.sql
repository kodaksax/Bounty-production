-- ROLLBACK for 20261013140000_owner_refund_acceptance_race
-- Written 2026-10-13. fn_reserve_escrow_for_acceptance below is the LIVE
-- pre-migration body on production (xwlwqzzphmmhghiqvkeu), read via
-- pg_get_functiondef that day; it matches 20260823120000 apart from comments.
--
-- Roll back the edge functions (wallet, bounty-payments) FIRST: their refund
-- gate calls fn_claim_owner_refund and fails closed (503) once it is dropped.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_reserve_escrow_for_acceptance(p_bounty public.bounties)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poster_id uuid;
BEGIN
  IF p_bounty.funding_mode <> 'at_accept' THEN
    RETURN;                                   -- legacy: already escrowed at post
  END IF;

  IF p_bounty.is_for_honor IS TRUE OR COALESCE(p_bounty.amount, 0) <= 0 THEN
    RETURN;                                   -- nothing to escrow
  END IF;

  v_poster_id := COALESCE(p_bounty.poster_id, p_bounty.user_id);
  IF v_poster_id IS NULL THEN
    RAISE EXCEPTION 'bounty_has_no_poster' USING ERRCODE = '23502';
  END IF;

  -- Serialise concurrent debits of this poster's balance, mirroring
  -- fn_reserve_bounty_escrow's own FOR UPDATE.
  PERFORM 1 FROM public.profiles WHERE id = v_poster_id FOR UPDATE;

  BEGIN
    PERFORM public.apply_escrow(
      v_poster_id,
      p_bounty.id,
      p_bounty.amount,
      'Escrow for bounty: ' || COALESCE(p_bounty.title, p_bounty.id::text),
      jsonb_build_object(
        'bounty_id',   p_bounty.id,
        'escrowed_at', now(),
        'created_via', 'accept_bounty_request',
        'funding_mode', 'at_accept'
      )
    );
  EXCEPTION
    -- update_balance() raises 23514 'Insufficient funds: ...'. Re-raise under a
    -- stable, greppable name so the client can route straight to the top-up
    -- gate instead of showing a generic failure. Re-raising (rather than
    -- swallowing) is what rolls the whole acceptance back.
    WHEN check_violation THEN
      RAISE EXCEPTION 'insufficient_funds_for_escrow'
        USING ERRCODE = '23514',
              HINT    = 'The poster''s wallet balance does not cover this bounty.';
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reserve_escrow_for_acceptance(public.bounties) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reserve_escrow_for_acceptance(public.bounties) FROM anon;
REVOKE ALL ON FUNCTION public.fn_reserve_escrow_for_acceptance(public.bounties) FROM authenticated;

DROP FUNCTION IF EXISTS public.fn_claim_owner_refund(uuid, uuid);
DROP TABLE IF EXISTS public.bounty_owner_refund_claims;

COMMIT;
