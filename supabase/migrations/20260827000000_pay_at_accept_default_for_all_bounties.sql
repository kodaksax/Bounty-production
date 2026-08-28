-- Migration: make pay-at-accept the DEFAULT funding mode for every bounty
-- Created: 2026-08-27
--
-- WHY
-- ---
-- 20260823120000 built the whole post-first/pay-at-accept mechanism but shipped
-- it as a gated experiment. In production it has never executed once: all 115
-- bounties are funding_mode='at_post'. Four gates each hold it shut —
--   1. PostHog flag 'post-first-pay-at-accept' was never created, so the client
--      resolves 'control' for every device and never even asks for deferral;
--   2. deferred_funding_scope='first_bounty' excludes every repeat poster;
--   3. deferred_funding_max_amount=250 excludes larger bounties;
--   4. uq_bounties_one_deferred_per_poster caps a poster at ONE deferred
--      bounty for their entire lifetime.
--
-- The product rule is now unconditional: creating a bounty is publishing an
-- offer and must never touch the poster's wallet; the money moment is
-- accepting an applicant. This migration makes that the default rather than an
-- experiment arm.
--
-- WHAT THIS DOES NOT CHANGE
-- -------------------------
-- Nothing about the acceptance path, the escrow representation, release,
-- refund, or dispute settlement. fn_accept_bounty_request already reserves
-- escrow in the same transaction as the acceptance, apply_escrow() is already
-- idempotent on (bounty_id, type='escrow', status='completed'), and
-- trg_bounties_enforce_funding_before_work already refuses to let an unfunded
-- bounty reach a work state. Those are the parts that make this safe, and they
-- are left exactly as they are.
--
-- Historical rows are untouched: all 115 existing bounties keep 'at_post' and
-- their existing escrow rows, so release/refund for them behaves identically.
-- funding_mode is immutable, so this only affects bounties created from here on.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Defuse the one-deferred-per-poster cap
-- ---------------------------------------------------------------------------
-- This index existed to bound blast radius while deferral was a first-bounty-only
-- experiment. Under an unconditional rule it is actively harmful: funding_mode is
-- immutable and the index covers deleted rows, so a poster's SECOND paid post
-- would fail with 23505 and they could never post again. Must be dropped BEFORE
-- the config is widened below.
DROP INDEX IF EXISTS public.uq_bounties_one_deferred_per_poster;

-- ---------------------------------------------------------------------------
-- 2. Configuration: universal scope, no amount cap
-- ---------------------------------------------------------------------------
-- The row is retained purely as the kill switch. Setting deferred_funding_enabled
-- to false still reverts every NEW post to at_post debiting with no deploy.

-- NULL now means "no cap". The existing CHECK (> 0) is NULL-tolerant, so it
-- keeps rejecting a nonsensical zero/negative cap if one is ever configured.
ALTER TABLE public.payment_experiment_config
  ALTER COLUMN deferred_funding_max_amount DROP NOT NULL;

COMMENT ON COLUMN public.payment_experiment_config.deferred_funding_max_amount IS
  'Optional risk cap. NULL (the default) means no cap: every wallet-funded bounty '
  'defers. Set a number to force larger bounties back onto the pre-funded path.';

-- Fresh environments must match production rather than reproducing the old
-- experiment defaults.
ALTER TABLE public.payment_experiment_config
  ALTER COLUMN deferred_funding_enabled    SET DEFAULT true,
  ALTER COLUMN deferred_funding_scope      SET DEFAULT 'all_bounties',
  ALTER COLUMN deferred_funding_max_amount SET DEFAULT NULL;

UPDATE public.payment_experiment_config
SET deferred_funding_enabled    = true,
    deferred_funding_scope      = 'all_bounties',
    deferred_funding_max_amount = NULL,
    updated_at                  = now()
WHERE id;

-- ---------------------------------------------------------------------------
-- 3. Eligibility — cap is now optional
-- ---------------------------------------------------------------------------
-- Same shape and privileges as 20260823120000; the only behavioural change is
-- that a NULL cap no longer disqualifies. The 'first_bounty' branch is kept
-- intact so the scope column remains a working narrowing lever.

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
  v_cfg         RECORD;
  v_prior_count bigint;
BEGIN
  IF p_poster_id IS NULL THEN
    RETURN false;
  END IF;

  -- A bounty with no money attached has nothing to defer.
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

  SELECT count(*) INTO v_prior_count
  FROM public.bounties b
  WHERE COALESCE(b.poster_id, b.user_id) = p_poster_id;

  RETURN v_prior_count = 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_can_defer_bounty_funding(uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. BEFORE INSERT — deferral is now the default, not a client request
-- ---------------------------------------------------------------------------
-- Previously the client had to ASK for 'at_accept' and the server merely
-- granted or refused. That coupling is exactly why the feature was inert: the
-- client never asked. Now the server decides unilaterally from the bounty's own
-- columns, so the outcome is identical whether the request comes from a current
-- build, a months-old build still on someone's phone, a raw PostgREST call, or
-- a server-side insert. The client's funding_mode input is ignored entirely.
--
-- Ineligible (still debited at post, unchanged):
--   * is_for_honor / amount <= 0 — no money to move;
--   * payment_architecture_version <> 1 — v2 funds through Stripe-native
--     bounty_payments, not the custodial wallet.

CREATE OR REPLACE FUNCTION public.fn_bounties_normalize_funding_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_for_honor IS TRUE
     OR COALESCE(NEW.payment_architecture_version, 1) <> 1
     OR NEW.amount IS NULL
     OR NEW.amount <= 0
  THEN
    NEW.funding_mode := 'at_post';
    RETURN NEW;
  END IF;

  IF public.fn_can_defer_bounty_funding(
       COALESCE(NEW.poster_id, NEW.user_id),
       NEW.amount
     )
  THEN
    NEW.funding_mode := 'at_accept';
  ELSE
    NEW.funding_mode := 'at_post';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounties_normalize_funding_mode ON public.bounties;
CREATE TRIGGER trg_bounties_normalize_funding_mode
  BEFORE INSERT ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.fn_bounties_normalize_funding_mode();

COMMENT ON COLUMN public.bounties.funding_mode IS
  'When the poster''s wallet is debited into escrow. ''at_accept'' (the default '
  'for every wallet-funded bounty since 2026-08-27) = escrow is reserved inside '
  'fn_accept_bounty_request when a hunter is selected. ''at_post'' = legacy '
  'behaviour, retained for pre-2026-08-27 rows, for-honor/$0 bounties, v2 '
  'Stripe-native bounties, and as the kill-switch fallback. Set ONLY by '
  'trg_bounties_normalize_funding_mode; client input is ignored, and the column '
  'is immutable after insert.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ===========================================================================
-- DOWN (reversal)
--   BEGIN;
--     UPDATE public.payment_experiment_config
--     SET deferred_funding_enabled = false WHERE id;   -- instant kill switch
--   COMMIT;
--
-- That alone restores at-post debiting for all NEW bounties without touching
-- code. Bounties already granted 'at_accept' keep their funding_mode and still
-- fund correctly at acceptance -- do NOT re-add uq_bounties_one_deferred_per_poster
-- while any poster holds more than one such row.
-- ===========================================================================
