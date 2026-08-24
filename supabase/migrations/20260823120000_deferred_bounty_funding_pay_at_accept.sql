-- Migration: post-first / pay-at-accept bounty funding ("deferred funding")
-- Created: 2026-08-23
--
-- WHY
-- ---
-- Today the payment gate sits at bounty INSERT time. `trg_bounties_reserve_escrow`
-- (AFTER INSERT -> fn_reserve_bounty_escrow) debits the poster's custodial wallet
-- via update_balance(), which RAISEs SQLSTATE 23514 'Insufficient funds' when the
-- balance can't cover the amount. Because it is an AFTER INSERT trigger, that
-- exception rolls the INSERT back: a poster with an empty wallet literally cannot
-- create a paid bounty. The observed consequences are a hard block for posters
-- who have never deposited, and a 56% "for honor" ($0) escape rate.
--
-- This migration moves the money moment for ELIGIBLE posters from post time to
-- hunter-acceptance time, without removing escrow and without letting a hunter
-- ever start work on an unfunded bounty.
--
-- CANONICAL REPRESENTATIONS THIS BUILDS ON (verified against production, not docs)
-- --------------------------------------------------------------------------------
--   * Canonical escrow      : a public.wallet_transactions row with
--                             type='escrow' AND status='completed' AND bounty_id=<id>.
--                             (56 such rows live; public.bounty_payments — the v2
--                             Stripe-native table — has only 4 rows and 4 bounties
--                             at payment_architecture_version=2, so v1 is canonical.)
--   * Canonical wallet state: public.profiles.balance, mutated only through
--                             public.update_balance().
--   * Authoritative amount  : public.bounties.amount. The poster escrows exactly
--                             `amount`; the platform fee is taken out of the
--                             HUNTER's side at release time (see PLATFORM_FEE_PERCENT
--                             in supabase/functions/wallet/index.ts). There is no
--                             poster-side fee to add here.
--   * Canonical owner       : bounties.poster_id (bounties.user_id is the legacy
--                             mirror; both are written by the client and
--                             fn_reserve_bounty_escrow already COALESCEs them, so
--                             everything below does the same).
--   * Work-entry transition : bounties.status 'open' -> 'in_progress'.
--
-- WHAT THIS ADDS
-- --------------
--   1. bounties.funding_mode              'at_post' (legacy, default) | 'at_accept'
--   2. payment_experiment_config          server-side kill switch + scope + cap
--   3. fn_can_defer_bounty_funding()      authoritative eligibility decision
--   4. trg_bounties_normalize_funding_mode  BEFORE INSERT: a client can ASK for
--                                         'at_accept' but only the server GRANTS it
--   5. fn_reserve_bounty_escrow()         skips escrow for granted 'at_accept' rows
--   6. trg_bounties_enforce_funding_before_work  BEFORE UPDATE: the hard safety
--                                         invariant — an unfunded 'at_accept'
--                                         bounty can never reach a work state,
--                                         no matter which code path tries
--   7. fn_accept_bounty_request()         reserves escrow in the SAME transaction
--      accept_bounty_request()            as the acceptance
--   8. fn_get_bounty_funding_requirement() read model for the client's pay gate
--
-- ATOMICITY NOTE
-- --------------
-- No saga is required, and none is used. The external (Stripe) half of the money
-- movement is the wallet DEPOSIT, which already happens beforehand through the
-- existing, idempotent, webhook-driven top-up path. By the time acceptance runs,
-- the money is already custodial, so escrow-reservation + acceptance are a single
-- Postgres transaction. If the escrow fails, the acceptance rolls back with it:
-- the bounty stays 'open' and the request stays 'pending'. There is no state in
-- which a hunter is accepted onto an unfunded bounty.
--
-- REVERSIBILITY
-- -------------
-- See the DOWN block at the bottom of this file (commented). Nothing here rewrites
-- or reinterprets historical rows: every existing bounty keeps funding_mode
-- 'at_post', which reproduces exactly today's behaviour.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. bounties.funding_mode
-- ---------------------------------------------------------------------------

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS funding_mode text NOT NULL DEFAULT 'at_post';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bounties'::regclass
      AND conname  = 'bounties_funding_mode_check'
  ) THEN
    ALTER TABLE public.bounties
      ADD CONSTRAINT bounties_funding_mode_check
      CHECK (funding_mode IN ('at_post', 'at_accept'));
  END IF;
END $$;

COMMENT ON COLUMN public.bounties.funding_mode IS
  'When the poster''s wallet is debited into escrow. ''at_post'' (default, and the '
  'only value any pre-2026-08-23 row has) = fn_reserve_bounty_escrow debits at '
  'INSERT. ''at_accept'' = escrow is reserved inside fn_accept_bounty_request when '
  'a hunter is selected. Set ONLY by trg_bounties_normalize_funding_mode; a client '
  'asking for ''at_accept'' is a request, not a grant, and the column is immutable '
  'after insert.';

-- Hard, race-proof cap for the "first bounty only" scope. Two concurrent inserts
-- cannot both win an at_accept grant, because the unique index arbitrates after
-- the eligibility check. Covers deleted rows on purpose: a poster gets exactly
-- one deferred bounty, ever, and cannot recycle the grant by deleting it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bounties_one_deferred_per_poster
  ON public.bounties (poster_id)
  WHERE funding_mode = 'at_accept';

-- Supports fn_can_defer_bounty_funding's "has this poster ever posted?" probe.
CREATE INDEX IF NOT EXISTS idx_bounties_poster_id_created_at
  ON public.bounties (poster_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Server-side experiment configuration
-- ---------------------------------------------------------------------------
-- Deliberately a table and not an env var: this is the kill switch, and it has
-- to be flippable without an edge-function or app deploy. Single row, enforced
-- by the boolean primary key.

CREATE TABLE IF NOT EXISTS public.payment_experiment_config (
  id                          boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Master switch. Ships OFF: applying this migration changes NO behaviour
  -- until someone deliberately turns it on.
  deferred_funding_enabled    boolean NOT NULL DEFAULT false,
  -- 'first_bounty'  — only a poster with zero prior bounties (the conservative
  --                   default; existing posters are never swept in)
  -- 'all_bounties'  — every poster, every bounty
  -- Widening the experiment beyond the first bounty is this one UPDATE, not a
  -- code change.
  deferred_funding_scope      text NOT NULL DEFAULT 'first_bounty'
    CHECK (deferred_funding_scope IN ('first_bounty', 'all_bounties')),
  -- Risk cap: an unfunded bounty costs hunters their attention, so large
  -- amounts stay on the pre-funded path.
  deferred_funding_max_amount numeric(12,2) NOT NULL DEFAULT 250.00
    CHECK (deferred_funding_max_amount > 0),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.payment_experiment_config (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.payment_experiment_config ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated: the config is reachable only through the
-- SECURITY DEFINER functions below and through service_role. Admins read/write
-- it out-of-band. REVOKE explicitly rather than relying on RLS alone, and note
-- that REVOKE ... FROM PUBLIC does NOT cover anon's own grant on Supabase.
REVOKE ALL ON public.payment_experiment_config FROM PUBLIC;
REVOKE ALL ON public.payment_experiment_config FROM anon;
REVOKE ALL ON public.payment_experiment_config FROM authenticated;

COMMENT ON TABLE public.payment_experiment_config IS
  'Single-row server-side configuration for the post-first/pay-at-accept funding '
  'experiment. Not client-readable. Flip deferred_funding_enabled to false to kill '
  'the experiment instantly for NEW posts (bounties already granted at_accept keep '
  'their own funding_mode and still fund correctly at acceptance).';

-- ---------------------------------------------------------------------------
-- 3. Eligibility — the authoritative "does this poster qualify" decision
-- ---------------------------------------------------------------------------
-- Deterministic and derived only from persisted data. No client counters, no
-- local storage, no screen context.
--
-- "First bounty" is defined here as FIRST EVER CREATED BOUNTY: the poster has
-- zero rows in public.bounties (any status, including 'deleted'). Chosen over
-- "first funded" / "first completed" because:
--   * it is the moment the activation barrier actually bites (a poster who has
--     never posted is exactly the population that hits the hard balance block);
--   * it is monotonic and un-gameable — it can only ever be true once, so the
--     experiment cannot leak into repeat posters, and a poster cannot farm
--     unfunded bounties by deleting them;
--   * it needs no join against wallet_transactions, so it cannot disagree with
--     the escrow state it is supposed to precede.
-- The looser definitions remain reachable by setting deferred_funding_scope to
-- 'all_bounties' and layering the audience in PostHog instead.

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
  v_cfg          RECORD;
  v_prior_count  bigint;
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

  IF p_amount > v_cfg.deferred_funding_max_amount THEN
    RETURN false;
  END IF;

  IF v_cfg.deferred_funding_scope = 'all_bounties' THEN
    RETURN true;
  END IF;

  -- 'first_bounty': the poster must have no bounty of their own, at all.
  -- COALESCE(poster_id, user_id) mirrors fn_reserve_bounty_escrow so a legacy
  -- row that only ever set user_id still counts as a prior bounty.
  SELECT count(*) INTO v_prior_count
  FROM public.bounties b
  WHERE COALESCE(b.poster_id, b.user_id) = p_poster_id;

  RETURN v_prior_count = 0;
END;
$$;

-- Callable by the app so the posting flow can decide, BEFORE it shows a funding
-- screen, whether this poster will be granted deferred funding. Advisory only —
-- the grant itself is re-decided server-side at INSERT (below), so a stale or
-- forged client answer changes nothing.
GRANT EXECUTE ON FUNCTION public.fn_can_defer_bounty_funding(uuid, numeric) TO authenticated;

-- Convenience wrapper bound to the caller's own identity, so a client can never
-- probe another user's eligibility.
CREATE OR REPLACE FUNCTION public.fn_can_i_defer_bounty_funding(p_amount numeric)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.fn_can_defer_bounty_funding(auth.uid(), p_amount);
$$;

REVOKE ALL ON FUNCTION public.fn_can_i_defer_bounty_funding(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_can_i_defer_bounty_funding(numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_can_i_defer_bounty_funding(numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. BEFORE INSERT — the client asks, the server grants
-- ---------------------------------------------------------------------------
-- bounties rows are inserted straight through PostgREST (see
-- app/services/bountyService.ts -> baseBountyService.create), so the client
-- controls every column subject to RLS. Without this trigger, ANY poster could
-- set funding_mode='at_accept' and post an unlimited number of unfunded
-- bounties. The normaliser downgrades an ungranted request back to 'at_post',
-- which reproduces today's behaviour exactly: if their balance covers the
-- amount the post succeeds, otherwise the AFTER INSERT escrow trigger rolls it
-- back with the same 'Insufficient funds' error posters see today. Downgrading
-- rather than raising keeps a poster who simply has the money from being
-- blocked by a config race.

CREATE OR REPLACE FUNCTION public.fn_bounties_normalize_funding_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.funding_mode, 'at_post') <> 'at_accept' THEN
    NEW.funding_mode := 'at_post';
    RETURN NEW;
  END IF;

  -- Deferring is meaningless for a $0 / for-honor post, and the v2 Stripe-native
  -- path funds through bounty_payments rather than the wallet, so neither is
  -- eligible.
  IF NEW.is_for_honor IS TRUE
     OR COALESCE(NEW.payment_architecture_version, 1) <> 1
     OR NOT public.fn_can_defer_bounty_funding(
          COALESCE(NEW.poster_id, NEW.user_id),
          NEW.amount
        )
  THEN
    NEW.funding_mode := 'at_post';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounties_normalize_funding_mode ON public.bounties;
CREATE TRIGGER trg_bounties_normalize_funding_mode
  BEFORE INSERT ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.fn_bounties_normalize_funding_mode();

-- ---------------------------------------------------------------------------
-- 5. AFTER INSERT — skip the post-time debit for granted deferred bounties
-- ---------------------------------------------------------------------------
-- Body is byte-for-byte the production function with ONE added early return.

CREATE OR REPLACE FUNCTION public.fn_reserve_bounty_escrow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poster_id   uuid;
  v_amount      numeric;
  v_description text;
  v_tx_id       uuid;
  v_locked_id   uuid;
BEGIN
  -- v2 (Stripe-native per-bounty escrow): funded by a Stripe charge recorded
  -- in public.bounty_payments, never by the custodial wallet. Return before
  -- touching profiles or wallet_transactions. Reserving here would both
  -- double-fund the bounty and hard-fail website customers whose wallet
  -- balance is 0. Everything below is the original v1 logic, unchanged.
  IF COALESCE(NEW.payment_architecture_version, 1) = 2 THEN
    RETURN NEW;
  END IF;

  -- Deferred funding (post-first / pay-at-accept): escrow is reserved by
  -- fn_accept_bounty_request when a hunter is selected, inside the same
  -- transaction as the acceptance. Debiting here would defeat the entire
  -- point of the experiment. NEW.funding_mode has already been normalised by
  -- trg_bounties_normalize_funding_mode (a BEFORE INSERT trigger), so by the
  -- time this AFTER INSERT trigger reads it, 'at_accept' means GRANTED — it
  -- is never merely what the client asked for.
  IF NEW.funding_mode = 'at_accept' THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);
  v_amount    := NEW.amount;

  IF NEW.is_for_honor IS TRUE OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  IF v_poster_id IS NULL THEN
    RAISE EXCEPTION 'Cannot reserve escrow: bounty has no poster_id/user_id'
      USING ERRCODE = '23502';
  END IF;

  SELECT id INTO v_locked_id
  FROM public.profiles
  WHERE id = v_poster_id
  FOR UPDATE;

  IF v_locked_id IS NULL THEN
    RAISE EXCEPTION 'Cannot reserve escrow: poster profile % not found', v_poster_id
      USING ERRCODE = 'P0002';
  END IF;

  v_description := 'Escrow for bounty: ' || COALESCE(NEW.title, NEW.id::text);

  INSERT INTO public.wallet_transactions (
    user_id, bounty_id, type, amount, description, status, metadata
  ) VALUES (
    v_poster_id,
    NEW.id,
    'escrow',
    -v_amount,
    v_description,
    'completed',
    jsonb_build_object(
      'bounty_id',    NEW.id,
      'escrowed_at',  NOW(),
      'created_via',  'bounty_insert_trigger'
    )
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_tx_id;

  IF v_tx_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM update_balance(v_poster_id, -v_amount);

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. THE SAFETY INVARIANT — BEFORE UPDATE guard on bounties
-- ---------------------------------------------------------------------------
-- RLS on public.bounties is `bounties_update_own: auth.uid() = poster_id` with
-- NO column restriction, so a poster can PATCH any column of their own bounty
-- straight through PostgREST. Without this trigger a poster could simply
--   PATCH /bounties?id=eq.X {"status":"in_progress","accepted_by":"<hunter>"}
-- and put a hunter to work on a bounty that was never funded, or flip
-- is_for_honor to true after a hunter applied and get the work for free.
--
-- This trigger is the enforcement point, NOT fn_accept_bounty_request: it holds
-- regardless of which code path performs the UPDATE (RPC, edge function,
-- the client-side fallback in lib/services/bounty-request-service.ts, or a
-- hand-rolled REST call).
--
-- Deliberately scoped to funding_mode='at_accept'. Legacy 'at_post' bounties are
-- left alone because a handful of historical paid bounties genuinely have no
-- escrow row (the /wallet/release backfill path in supabase/functions/wallet
-- exists precisely for them); widening the guard would break those.

CREATE OR REPLACE FUNCTION public.fn_bounties_enforce_funding_before_work()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_escrow   boolean;
  v_has_requests boolean;
BEGIN
  -- funding_mode is immutable. Otherwise the guard below could be sidestepped
  -- by first flipping the row back to 'at_post'.
  IF NEW.funding_mode IS DISTINCT FROM OLD.funding_mode THEN
    RAISE EXCEPTION 'bounty_funding_mode_is_immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.funding_mode <> 'at_accept' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.wallet_transactions wt
    WHERE wt.bounty_id = NEW.id
      AND wt.type      = 'escrow'
      AND wt.status    = 'completed'
  ) INTO v_has_escrow;

  -- Price/terms freeze. A deferred bounty is advertised BEFORE it is paid for,
  -- so the amount hunters evaluated must be the amount that gets escrowed.
  -- Editing stays open while nobody has applied yet, which is what a poster
  -- fixing a typo actually needs.
  IF NOT v_has_escrow THEN
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
  ELSE
    -- Once escrowed, the escrowed amount is what release/refund settle against.
    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
      RAISE EXCEPTION 'bounty_amount_locked_by_escrow'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.is_for_honor IS DISTINCT FROM OLD.is_for_honor THEN
      RAISE EXCEPTION 'bounty_honor_flag_locked_by_escrow'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- THE invariant: no work state without funding.
  IF NEW.status::text IN ('in_progress', 'completed', 'cancellation_requested')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.is_for_honor IS NOT TRUE
     AND COALESCE(NEW.amount, 0) > 0
     AND NOT v_has_escrow
  THEN
    RAISE EXCEPTION 'bounty_not_funded'
      USING ERRCODE  = '23514',
            HINT     = 'Escrow must be reserved before this bounty can enter work. '
                       'Accept the hunter via fn_accept_bounty_request, which reserves '
                       'escrow in the same transaction.';
  END IF;

  -- A hunter must never be attached to an unfunded deferred bounty either, even
  -- if status is left alone.
  IF NEW.accepted_by IS NOT NULL
     AND NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
     AND NEW.is_for_honor IS NOT TRUE
     AND COALESCE(NEW.amount, 0) > 0
     AND NOT v_has_escrow
  THEN
    RAISE EXCEPTION 'bounty_not_funded'
      USING ERRCODE = '23514',
            HINT    = 'A hunter cannot be assigned to an unfunded bounty.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounties_enforce_funding_before_work ON public.bounties;
CREATE TRIGGER trg_bounties_enforce_funding_before_work
  BEFORE UPDATE ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.fn_bounties_enforce_funding_before_work();

-- ---------------------------------------------------------------------------
-- 7. Acceptance reserves escrow, in the same transaction
-- ---------------------------------------------------------------------------
-- Shared helper so both acceptance RPCs use identical logic.
--
-- apply_escrow() is already idempotent on (bounty_id, type='escrow',
-- status='completed'), so a retry after a client-side timeout that actually
-- committed reserves nothing a second time — it returns applied=false and the
-- acceptance proceeds. That is what makes "payment succeeded but the client
-- believes it failed" safe to simply retry.

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

-- --- fn_accept_bounty_request (the path the app actually uses) --------------
-- Reproduces the deployed production body verbatim (including the authz guard
-- added by 20260719010000 and the assert_account_active call added by
-- 20260726000000) with ONE inserted step: reserve escrow before transitioning.

CREATE OR REPLACE FUNCTION public.fn_accept_bounty_request(p_request_id text)
RETURNS TABLE(bounty json, accepted_request json)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req_row         RECORD;
  bounty_row      public.bounties%ROWTYPE;
  updated_bounty  RECORD;
  updated_request RECORD;
  v_request_id    uuid := p_request_id::uuid;
BEGIN
  SELECT * INTO req_row FROM public.bounty_requests WHERE id = v_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF req_row.status IS NULL OR req_row.status::text <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending';
  END IF;

  SELECT * INTO bounty_row FROM public.bounties WHERE id = req_row.bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty_not_found';
  END IF;

  IF auth.role() = 'authenticated' THEN
    IF bounty_row.poster_id IS NULL OR bounty_row.poster_id <> auth.uid() THEN
      RAISE EXCEPTION 'Only the bounty poster can accept a request'
        USING ERRCODE = '42501';
    END IF;
    PERFORM public.assert_account_active(auth.uid());
  END IF;

  IF bounty_row.status IS NULL OR bounty_row.status::text <> 'open' THEN
    RAISE EXCEPTION 'bounty_not_open';
  END IF;

  -- Pay-at-accept. Runs BEFORE any state transition, in this same transaction,
  -- and raises 'insufficient_funds_for_escrow' if the poster cannot cover the
  -- authoritative amount read from the locked bounty row above (never from the
  -- client). A failure here rolls back everything: the bounty stays 'open', the
  -- request stays 'pending', competing requests stay 'pending', and nothing
  -- anywhere claims the bounty is funded.
  PERFORM public.fn_reserve_escrow_for_acceptance(bounty_row);

  UPDATE public.bounties
  SET
    status              = 'in_progress',
    accepted_request_id = v_request_id,
    accepted_by         = req_row.hunter_id,
    updated_at          = now()
  WHERE id = bounty_row.id;

  UPDATE public.bounty_requests
  SET status = 'accepted', updated_at = now()
  WHERE id = v_request_id;

  UPDATE public.bounty_requests
  SET status = 'rejected', updated_at = now()
  WHERE bounty_id = bounty_row.id
    AND id <> v_request_id
    AND status::text = 'pending';

  SELECT * INTO updated_bounty  FROM public.bounties        WHERE id = bounty_row.id;
  SELECT * INTO updated_request FROM public.bounty_requests WHERE id = v_request_id;

  RETURN QUERY SELECT row_to_json(updated_bounty), row_to_json(updated_request);
EXCEPTION
  WHEN others THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_accept_bounty_request(text) TO authenticated;

-- --- accept_bounty_request(uuid) — the second, jsonb-returning acceptance RPC
-- Nothing in the app calls it today, but it is granted and live, so it gets the
-- same treatment rather than being left as a bypass.

CREATE OR REPLACE FUNCTION public.accept_bounty_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_actor_id uuid := auth.uid();
  v_request public.bounty_requests%rowtype;
  v_bounty public.bounties%rowtype;
  v_rejected_count integer := 0;
begin
  if v_actor_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  select * into v_request from public.bounty_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found: %', p_request_id using errcode = 'P0002';
  end if;

  select * into v_bounty from public.bounties where id = v_request.bounty_id for update;
  if not found then
    raise exception 'Bounty not found for request: %', p_request_id using errcode = 'P0002';
  end if;

  if v_bounty.poster_id <> v_actor_id then
    raise exception 'Only the bounty poster can accept a request' using errcode = '42501';
  end if;

  if v_request.poster_id <> v_actor_id then
    raise exception 'Request poster mismatch' using errcode = '42501';
  end if;

  if v_request.status <> 'pending'::public.request_status_enum then
    raise exception 'Request % is not pending (current: %)', p_request_id, v_request.status
      using errcode = 'P0001';
  end if;

  if v_bounty.status <> 'open'::public.bounty_status_enum then
    raise exception 'Bounty % is not open (current: %)', v_bounty.id, v_bounty.status
      using errcode = 'P0001';
  end if;

  if v_bounty.accepted_request_id is not null then
    raise exception 'Bounty % already has an accepted request', v_bounty.id
      using errcode = 'P0001';
  end if;

  -- Pay-at-accept, same transaction. See fn_accept_bounty_request above.
  perform public.fn_reserve_escrow_for_acceptance(v_bounty);

  update public.bounty_requests
  set status = 'accepted'::public.request_status_enum,
      accepted_at = now(),
      updated_at = now()
  where id = v_request.id;

  update public.bounty_requests
  set status = 'rejected'::public.request_status_enum,
      rejected_at = now(),
      updated_at = now()
  where bounty_id = v_request.bounty_id
    and id <> v_request.id
    and status = 'pending'::public.request_status_enum;

  get diagnostics v_rejected_count = row_count;

  update public.bounties
  set accepted_request_id = v_request.id,
      accepted_by = v_request.hunter_id,
      status = 'in_progress'::public.bounty_status_enum,
      updated_at = now()
  where id = v_request.bounty_id;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'bounty_id', v_request.bounty_id,
    'accepted_by', v_request.hunter_id,
    'rejected_other_pending_count', v_rejected_count
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.accept_bounty_request(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Read model for the client's pay-at-accept gate
-- ---------------------------------------------------------------------------
-- The client must never compute the amount to charge. This returns the
-- server's own numbers so the confirmation sheet, the shortfall and the
-- top-up prefill all come from the same place the escrow will.

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

REVOKE ALL ON FUNCTION public.fn_get_bounty_funding_requirement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_get_bounty_funding_requirement(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_get_bounty_funding_requirement(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ===========================================================================
-- DOWN (reversal) — run as a single transaction to fully undo this migration.
-- Safe at any time: no historical row is rewritten, and reverting simply
-- restores the post-time-only gate.
--
-- BEGIN;
--   -- Bounties already granted at_accept must be settled first, or they become
--   -- unacceptable (they have no escrow and the post-time trigger will not
--   -- backfill one). Check with:
--   --   SELECT id, poster_id, amount, status FROM public.bounties
--   --   WHERE funding_mode = 'at_accept';
--   DROP TRIGGER IF EXISTS trg_bounties_enforce_funding_before_work ON public.bounties;
--   DROP TRIGGER IF EXISTS trg_bounties_normalize_funding_mode      ON public.bounties;
--   DROP FUNCTION IF EXISTS public.fn_bounties_enforce_funding_before_work();
--   DROP FUNCTION IF EXISTS public.fn_bounties_normalize_funding_mode();
--   DROP FUNCTION IF EXISTS public.fn_get_bounty_funding_requirement(uuid);
--   DROP FUNCTION IF EXISTS public.fn_reserve_escrow_for_acceptance(public.bounties);
--   DROP FUNCTION IF EXISTS public.fn_can_i_defer_bounty_funding(numeric);
--   DROP FUNCTION IF EXISTS public.fn_can_defer_bounty_funding(uuid, numeric);
--   -- Restore the pre-migration bodies of fn_reserve_bounty_escrow,
--   -- fn_accept_bounty_request(text) and accept_bounty_request(uuid) by
--   -- re-running 20260719010000 / 20260726000000 / the 20260421 fix.
--   DROP INDEX IF EXISTS public.uq_bounties_one_deferred_per_poster;
--   DROP INDEX IF EXISTS public.idx_bounties_poster_id_created_at;
--   ALTER TABLE public.bounties DROP CONSTRAINT IF EXISTS bounties_funding_mode_check;
--   ALTER TABLE public.bounties DROP COLUMN IF EXISTS funding_mode;
--   DROP TABLE IF EXISTS public.payment_experiment_config;
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
-- ===========================================================================
