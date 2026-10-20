-- Migration: first-time posters save a card when posting (SBA-05, option B)
-- Created: 2026-10-20
--
-- PROBLEM (docs/audits/shoal-behavioral-audit.md, SBA-05):
--   Since 2026-09-02 every paid app bounty is funding_mode = 'at_accept': the
--   poster is charged when they hire, not when they post. 0 of 17 genuine
--   at_accept bounties were hired, against 2 of 4 fund-at-post ones. Every
--   non-internal paid at_accept bounty since 09-02 came from a poster who had
--   never hired anyone, and only 2 of those 38 posts came from someone with a
--   card on file. A first-time poster therefore reaches the hire sheet with no
--   card and no balance, and "Pay $X & hire" first sends them off to link one.
--
-- DECISION (product, 2026-10-19): option B. Keep charging at hire. A
-- first-time app poster saves a card when posting (no charge), so hiring is
-- one tap. Before/after cohort, not an A/B test.
--
-- WHAT THIS DOES
--   1. fn_is_first_time_poster(uuid): the ONE definition of "first-time
--      poster". True when none of the user's bounties has ever reached
--      accepted or completed. Every caller below uses it; nothing else
--      re-derives it.
--   2. payment_experiment_config.card_at_post_scope: the switch.
--      'off' (default) | 'first_time_posters'. Off on deploy. Turning it on
--      affects only builds that read it (2.1.3 onward); older builds never ask.
--   3. fn_get_posting_card_requirement(numeric): what the composer asks before
--      "Post Bounty". Says whether THIS poster, for THIS amount, must have a
--      card saved. The app then applies the device-local exemptions the
--      server can't see (see "Where the rest of the rule lives").
--   4. fn_can_defer_bounty_funding: its dormant 'first_bounty' branch counted
--      "has never posted" — a second, different definition. It now calls
--      fn_is_first_time_poster. Live scope is 'all_bounties', which returns
--      before that branch, so today's behaviour does not change. Client
--      EXECUTE is revoked: the only callers are SECURITY DEFINER (the
--      normalize trigger and fn_can_i_defer_bounty_funding), and once the
--      branch reads hiring history, anon could otherwise ask it about any user.
--
-- WHERE THE REST OF THE RULE LIVES (app/screens/CreateBounty/quick/StepPay.tsx)
--   The server can't tell reliably whether someone has a card. The
--   payment_methods mirror misses cards saved through deposit sheets and keeps
--   cards detached on Stripe's side (54 attached vs 26 detached events, 20
--   card rows). The Stripe customer list the app already loads is the
--   authority, so the app makes the final call. It skips the requirement when:
--     * a card is already saved;
--     * the wallet balance already covers the reward ("Confirm & hire" is
--       already one tap);
--     * iOS reports Apple Pay is ready (product decision, 2026-10-19);
--     * the platform is web, where Stripe is stubbed and no card can be saved;
--     * the bounty is for honor / $0, or funds at post (v2 Stripe-native).
--   No server refusal on purpose (product decision, 2026-10-19): installed
--   builds can't save a card from the composer, and OTA can't reach them.
--
-- NOT CHANGED
--   * Funding mode. Paid app bounties stay 'at_accept'. Nothing is charged at
--     post, so StepPay's "You're charged when you accept a hunter" and the
--     hunter's "Payment not held yet" line stay true for every bounty.
--   * The acceptance and money path: fn_accept_bounty_request,
--     fn_reserve_escrow_for_acceptance, fn_reserve_bounty_escrow, apply_escrow,
--     refunds. The hire sheet already charges a saved card in one tap.
--
-- Rollback: supabase/rollbacks/production/20261020120000_first_time_poster_card_at_post.down.sql
-- Kill switch (no deploy):
--   UPDATE public.payment_experiment_config
--      SET card_at_post_scope = 'off', updated_at = now() WHERE id;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The definition
-- ---------------------------------------------------------------------------
-- "Reached accepted or completed" is read from every place that records it,
-- because no single column does on the live data:
--   * accepted_by / accepted_request_id / completed_at on the bounty;
--   * a status only an accepted bounty can have (cancellation_requested is
--     hunter-initiated, so it implies a hunter);
--   * an accepted bounty_requests row (survives the bounty being cancelled);
--   * the bounty_events ledger, which alone catches 5 production bounties that
--     were accepted or completed and later archived with the columns cleared.
-- Deleted and cancelled bounties count: a poster who hired once has hired.
-- The canonical poster is COALESCE(poster_id, user_id), written out so each
-- arm can use its own index.

CREATE OR REPLACE FUNCTION public.fn_is_first_time_poster(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.bounties b
        WHERE (b.poster_id = p_user_id
               OR (b.poster_id IS NULL AND b.user_id = p_user_id))
          AND (
                b.accepted_by IS NOT NULL
             OR b.accepted_request_id IS NOT NULL
             OR b.completed_at IS NOT NULL
             OR b.status IN ('in_progress', 'completed', 'cancellation_requested')
             OR EXISTS (
                  SELECT 1 FROM public.bounty_requests r
                   WHERE r.bounty_id = b.id
                     AND r.status = 'accepted'
                )
             OR EXISTS (
                  SELECT 1 FROM public.bounty_events e
                   WHERE e.bounty_id = b.id
                     AND e.event_type IN (
                       'application.accepted',
                       'bounty.accepted',
                       'bounty.in_progress',
                       'bounty.completed'
                     )
                )
          )
     );
$$;

COMMENT ON FUNCTION public.fn_is_first_time_poster(uuid) IS
  'SBA-05. The single definition of a first-time poster: none of the user''s '
  'bounties has ever reached accepted or completed. Backend-only; clients ask '
  'about themselves through fn_get_posting_card_requirement.';

-- Reveals another user's hiring history, so no client may call it directly.
REVOKE ALL ON FUNCTION public.fn_is_first_time_poster(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_is_first_time_poster(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_is_first_time_poster(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_is_first_time_poster(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The switch
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment_experiment_config
  ADD COLUMN IF NOT EXISTS card_at_post_scope text NOT NULL DEFAULT 'off';

ALTER TABLE public.payment_experiment_config
  DROP CONSTRAINT IF EXISTS payment_experiment_config_card_at_post_scope_check;
ALTER TABLE public.payment_experiment_config
  ADD CONSTRAINT payment_experiment_config_card_at_post_scope_check
  CHECK (card_at_post_scope IN ('off', 'first_time_posters'));

COMMENT ON COLUMN public.payment_experiment_config.card_at_post_scope IS
  'SBA-05. Who must save a card before posting a bounty that is charged at '
  'hire. ''off'' = nobody; ''first_time_posters'' = fn_is_first_time_poster. '
  'Read only by fn_get_posting_card_requirement, so builds before 2.1.3 are '
  'unaffected either way. No charge is ever made at post.';

-- ---------------------------------------------------------------------------
-- 3. What the composer asks
-- ---------------------------------------------------------------------------
-- Always answers about auth.uid(); there is no way to ask about someone else.
-- charged_at_hire reuses fn_can_defer_bounty_funding, the same eligibility
-- trg_bounties_normalize_funding_mode applies at INSERT, so a bounty that will
-- be charged at post is never told it needs a card for hiring.

CREATE OR REPLACE FUNCTION public.fn_get_posting_card_requirement(p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_scope           text;
  v_first_time      boolean;
  v_charged_at_hire boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'scope', 'off',
      'first_time_poster', false,
      'charged_at_hire', false,
      'card_required', false
    );
  END IF;

  SELECT c.card_at_post_scope INTO v_scope
    FROM public.payment_experiment_config c
   WHERE c.id
   LIMIT 1;
  v_scope := COALESCE(v_scope, 'off');

  v_first_time      := public.fn_is_first_time_poster(v_uid);
  v_charged_at_hire := public.fn_can_defer_bounty_funding(v_uid, p_amount);

  RETURN jsonb_build_object(
    'scope', v_scope,
    'first_time_poster', v_first_time,
    'charged_at_hire', v_charged_at_hire,
    'card_required', v_scope = 'first_time_posters' AND v_first_time AND v_charged_at_hire
  );
END;
$$;

COMMENT ON FUNCTION public.fn_get_posting_card_requirement(numeric) IS
  'SBA-05. Whether the calling poster must save a card before posting a bounty '
  'of p_amount. Advisory: the app applies the device-local exemptions (card '
  'already saved, balance covers it, Apple Pay ready, web) and no INSERT is '
  'ever refused for want of a card.';

REVOKE ALL ON FUNCTION public.fn_get_posting_card_requirement(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_get_posting_card_requirement(numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_get_posting_card_requirement(numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. One definition everywhere: fn_can_defer_bounty_funding
-- ---------------------------------------------------------------------------
-- Body identical to the live one (20260827000000, applied as 20260902024107)
-- except the 'first_bounty' branch.

CREATE OR REPLACE FUNCTION public.fn_can_defer_bounty_funding(
  p_poster_id uuid,
  p_amount    numeric
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg RECORD;
BEGIN
  IF p_poster_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN false;
  END IF;

  SELECT * INTO v_cfg FROM public.payment_experiment_config WHERE id LIMIT 1;
  IF NOT FOUND OR v_cfg.deferred_funding_enabled IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- NULL cap = uncapped.
  IF v_cfg.deferred_funding_max_amount IS NOT NULL
     AND p_amount > v_cfg.deferred_funding_max_amount
  THEN
    RETURN false;
  END IF;

  IF v_cfg.deferred_funding_scope = 'all_bounties' THEN
    RETURN true;
  END IF;

  -- 'first_bounty': defer only for a first-time poster (SBA-05 definition).
  -- Until 2026-10-20 this meant "has never posted", which disagreed with
  -- every other notion of a first-time poster.
  RETURN public.fn_is_first_time_poster(p_poster_id);
END;
$$;

-- Callers are SECURITY DEFINER (trg_bounties_normalize_funding_mode,
-- fn_can_i_defer_bounty_funding), so they run as the owner and keep working.
-- Clients go through fn_can_i_defer_bounty_funding, which only asks about
-- auth.uid().
REVOKE ALL ON FUNCTION public.fn_can_defer_bounty_funding(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_can_defer_bounty_funding(uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.fn_can_defer_bounty_funding(uuid, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_can_defer_bounty_funding(uuid, numeric) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
