-- Close the owner-refund / acceptance race (#883).
--
-- POST /wallet/refund and POST /bounty-payments/cancel ask
-- fn_owner_refund_block_reason whether the poster may take the escrow back,
-- then move money in later, separately committed calls. Between the two, the
-- poster can accept a hunter (fn_accept_bounty_request / accept_bounty_request).
-- Both writes succeed: the hunter is assigned to a bounty whose escrow has
-- already gone back to the poster, and the later release finds a refund and
-- refuses to pay.
--
-- Fix: the refund endpoints claim the bounty under the SAME row lock the accept
-- RPCs take before assigning a hunter, and acceptance refuses while a claim is
-- live.
--
--   fn_claim_owner_refund(bounty, caller)
--     SELECT ... FOR UPDATE on the bounty, evaluate fn_owner_refund_block_reason
--     (unchanged rule), and if allowed record a claim in the same transaction.
--     Returns NULL when claimed, the rule's verdict when blocked, or
--     owner_refund_in_progress if another refund already owns the claim.
--
--   fn_release_owner_refund_claim(bounty, caller)
--     Explicitly release only after a definitive failure that proves no refund
--     occurred. Unknown Stripe outcomes remain blocked for reconciliation.
--
--   fn_reserve_escrow_for_acceptance(bounty)
--     Called by BOTH accept RPCs after they lock the bounty and before any
--     write. It now raises if a live claim exists. The message starts with
--     'bounty_not_open', which every shipped client already maps to a 409
--     "no longer in the expected state", so no client change is needed.
--
-- Orderings (the bounty row lock is the serialisation point):
--   claim first  -> accept blocks on the lock, then sees the claim and raises.
--   accept first -> the claim blocks on the lock, then sees accepted_by and
--                   returns refund_requires_cancellation_or_dispute.
--
-- Claims are durable. Successful refunds remain blocked until the bounty is
-- deleted/terminal; definitive failures explicitly release the claim. Unknown
-- Stripe outcomes remain blocked for reconciliation.
--
-- Rollback: supabase/rollbacks/production/20261013140000_owner_refund_acceptance_race.down.sql
-- Deploy order: apply this migration BEFORE the edge functions that call
-- fn_claim_owner_refund. The gate fails closed (503) if the RPC is missing.

BEGIN;

CREATE TABLE IF NOT EXISTS public.bounty_owner_refund_claims (
  bounty_id  uuid PRIMARY KEY REFERENCES public.bounties(id) ON DELETE CASCADE,
  claimed_by uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bounty_owner_refund_claims IS
  'Durable claim written by fn_claim_owner_refund under the bounty row lock; '
  'fn_reserve_escrow_for_acceptance refuses acceptance while a claim is live (#883). '
  'Definitive refund failures release it explicitly; uncertain outcomes remain blocked. '
  'Server-only: RLS on, no policies, no client grants.';

ALTER TABLE public.bounty_owner_refund_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bounty_owner_refund_claims FROM PUBLIC;
REVOKE ALL ON TABLE public.bounty_owner_refund_claims FROM anon;
REVOKE ALL ON TABLE public.bounty_owner_refund_claims FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bounty_owner_refund_claims TO service_role;

CREATE OR REPLACE FUNCTION public.fn_claim_owner_refund(p_bounty_id uuid, p_caller uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_reason text;
BEGIN
  -- The same lock fn_accept_bounty_request / accept_bounty_request take before
  -- they assign a hunter. Waiting here means an in-flight acceptance has either
  -- committed (and the rule below sees it) or not started.
  PERFORM 1 FROM public.bounties WHERE id = p_bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'bounty_not_found';
  END IF;

  -- New statement, so a fresh READ COMMITTED snapshot taken after the lock.
  v_reason := public.fn_owner_refund_block_reason(p_bounty_id, p_caller);
  IF v_reason IS NOT NULL THEN
    RETURN v_reason;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bounty_owner_refund_claims
     WHERE bounty_id = p_bounty_id
  ) THEN
    RETURN 'owner_refund_in_progress';
  END IF;

  INSERT INTO public.bounty_owner_refund_claims (bounty_id, claimed_by, claimed_at)
  VALUES (p_bounty_id, p_caller, now())
  ON CONFLICT (bounty_id) DO NOTHING;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_release_owner_refund_claim(p_bounty_id uuid, p_caller uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Serialize release with both the claim and acceptance RPCs.
  PERFORM 1 FROM public.bounties WHERE id = p_bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  DELETE FROM public.bounty_owner_refund_claims
   WHERE bounty_id = p_bounty_id
     AND claimed_by = p_caller;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_release_owner_refund_claim(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_release_owner_refund_claim(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_release_owner_refund_claim(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_release_owner_refund_claim(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fn_claim_owner_refund(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_claim_owner_refund(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_claim_owner_refund(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_owner_refund(uuid, uuid) TO service_role;

-- Unchanged from 20260823120000 except the claim check at the top.
CREATE OR REPLACE FUNCTION public.fn_reserve_escrow_for_acceptance(p_bounty public.bounties)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poster_id uuid;
BEGIN
  -- #883: an owner refund claimed this bounty under the same row lock the
  -- caller already holds. Checked before the funding-mode early return so it
  -- covers every bounty, not just pay-at-accept ones.
  IF EXISTS (
    SELECT 1 FROM public.bounty_owner_refund_claims c
     WHERE c.bounty_id = p_bounty.id
  ) THEN
    RAISE EXCEPTION 'bounty_not_open: owner_refund_in_progress'
      USING ERRCODE = 'P0001',
            HINT    = 'The poster is cancelling this bounty and its escrow is being refunded.';
  END IF;

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

COMMIT;
