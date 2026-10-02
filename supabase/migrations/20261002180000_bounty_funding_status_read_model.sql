-- =====================================================================
-- Hunter-visible funding state (trust-spine audit T10, client item 6)
-- =====================================================================
-- Hunters could not tell whether the reward on a bounty is actually held.
-- The only read model, fn_get_bounty_funding_requirement, is poster-only
-- because it returns the poster's wallet balance. Prod 2026-10-02: of 16
-- open external paid bounties, 1 has money held and 15 are pay-at-accept
-- with nothing held, and the UI said nothing about either.
--
-- get_bounty_funding_status(uuid[]) returns one coarse state per bounty:
--   held               money is held for this bounty right now
--   held_on_selection  open, funding_mode = 'at_accept', nothing held yet:
--                      escrow is reserved inside fn_accept_bounty_request,
--                      and trg_bounties_enforce_funding_before_work refuses
--                      in_progress without it
--   not_held           a paid bounty with nothing held that is not waiting
--                      on selection (legacy rows, refunded, released)
--   not_applicable     for honor, or no amount
--
-- "Held" is the predicate fn_bounty_credibility_signals already uses
-- on prod (20261001140000), per payment architecture:
--   v1  completed escrow row and no completed refund/release row
--   v2  bounty_payments.status IN ('authorized','captured')
--   v3  bounty_v3_funding.state IN ('authorized','awaiting_hunter_onboarding','capturing')
-- Each probe is an index lookup by bounty_id (prod 2026-10-02:
-- idx_wallet_transactions_bounty_id, idx_bounty_payments_bounty_id,
-- bounty_v3_funding_pkey), and only the bounty's own architecture is probed.
--
-- Why SECURITY DEFINER, and how visibility is kept: the ledger/payment
-- tables are participant-only under RLS by design, so an INVOKER function
-- cannot answer for a hunter. The definer role (postgres) has BYPASSRLS, so
-- the function applies the bounties SELECT visibility rule itself. Live
-- policies (prod 2026-10-02): bounties_select_authenticated (USING true)
-- and the RESTRICTIVE bounties_select_moderation_hold
-- (fn_bounty_moderation_visible). The function applies the latter whenever
-- it exists; where it doesn't (an environment missing 20261001140000), that
-- policy can't exist either, so RLS there is just `true`. A bounty the
-- caller can't SELECT returns no row. scripts/verify-bounty-funding-status.js
-- fails if bounties gains any other SELECT policy, so this rule can't drift
-- silently.
--
-- No amounts, balances, ids or counterparties are returned. anon gets
-- nothing: signed-out visitors see no funding line.
--
-- Nothing is written. No backfill.
--
-- DONE MEANS OBSERVED: Supabase API logs show 200s for
-- POST /rest/v1/rpc/get_bounty_funding_status from app clients (not the
-- verify script) once a build carrying the funding line reaches devices.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_bounty_funding_status(uuid[]);
--   DROP FUNCTION IF EXISTS public.fn_bounty_funding_held(uuid);
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_bounty_funding_held(p_bounty_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT CASE COALESCE(b.payment_architecture_version, 1)
      WHEN 1 THEN
        EXISTS (SELECT 1 FROM public.wallet_transactions wt
                WHERE wt.bounty_id = b.id AND wt.type = 'escrow' AND wt.status = 'completed')
        AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions wt
                        WHERE wt.bounty_id = b.id AND wt.type IN ('refund', 'release')
                          AND wt.status = 'completed')
      WHEN 2 THEN
        EXISTS (SELECT 1 FROM public.bounty_payments bp
                WHERE bp.bounty_id = b.id AND bp.status IN ('authorized', 'captured'))
      WHEN 3 THEN
        EXISTS (SELECT 1 FROM public.bounty_v3_funding bf
                WHERE bf.bounty_id = b.id
                  AND bf.state IN ('authorized', 'awaiting_hunter_onboarding', 'capturing'))
      ELSE false
    END
    FROM public.bounties b
    WHERE b.id = p_bounty_id
  ), false);
$$;

COMMENT ON FUNCTION public.fn_bounty_funding_held(uuid) IS
  'True when money is held for this bounty right now, per payment architecture. Same predicate as the escrow_funded signal in fn_bounty_credibility_signals (20261001140000). Internal helper: no visibility check, so never granted to clients.';

REVOKE ALL ON FUNCTION public.fn_bounty_funding_held(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bounty_funding_held(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_bounty_funding_held(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bounty_funding_held(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_bounty_funding_status(p_bounty_ids uuid[])
RETURNS TABLE(bounty_id uuid, funding_state text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- A feed page at most; this is a display read, not an export.
  v_ids        uuid[] := p_bounty_ids[1:100];
  v_visibility text   := 'true';
BEGIN
  IF auth.uid() IS NULL OR v_ids IS NULL THEN
    RETURN;
  END IF;

  -- Mirror the RESTRICTIVE bounties_select_moderation_hold policy (see header).
  IF to_regprocedure('public.fn_bounty_moderation_visible(uuid,uuid,uuid,uuid)') IS NOT NULL THEN
    v_visibility := 'public.fn_bounty_moderation_visible(b.id, b.poster_id, b.user_id, b.accepted_by)';
  END IF;

  RETURN QUERY EXECUTE format($q$
    SELECT
      b.id,
      CASE
        WHEN COALESCE(b.is_for_honor, false) OR COALESCE(b.amount, 0) <= 0 THEN 'not_applicable'
        WHEN public.fn_bounty_funding_held(b.id) THEN 'held'
        WHEN b.status::text = 'open' AND b.funding_mode = 'at_accept' THEN 'held_on_selection'
        ELSE 'not_held'
      END
    FROM public.bounties b
    WHERE b.id = ANY ($1)
      AND %s
  $q$, v_visibility) USING v_ids;
END;
$$;

COMMENT ON FUNCTION public.get_bounty_funding_status(uuid[]) IS
  'Hunter-facing funding state per bounty: held | held_on_selection | not_held | not_applicable. Coarse by design: no amounts, balances or ids. Applies the bounties SELECT visibility rule itself (SECURITY DEFINER). See 20261002180000.';

REVOKE ALL ON FUNCTION public.get_bounty_funding_status(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_bounty_funding_status(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bounty_funding_status(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
