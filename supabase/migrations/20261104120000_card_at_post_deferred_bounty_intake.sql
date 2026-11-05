-- Migration: card required at post, charged only when a hunter is accepted
-- Created: 2026-11-04
--
-- Stays on v1 wallet escrow: payment_architecture_version = 1, funding_mode =
-- 'at_accept'. Nothing here touches the v2 or v3 paths, and nothing is charged
-- at post.
--
-- WHAT THIS DOES
--   1. payment_experiment_config.card_at_post_scope gains 'all_posters'. This
--      migration does NOT select it: the live value stays as it is.
--   2. fn_get_posting_card_requirement: under 'all_posters', card_required =
--      amount > 0 AND no payment_methods row with type = 'card'.
--      'first_time_posters' behaves exactly as before.
--   3. fn_bounties_normalize_funding_mode: a bounty inserted by
--      fn_create_bounty_from_pending_deferred is always 'at_accept', whatever
--      the deferred_funding_* config says. Otherwise that kill switch would
--      turn the row 'at_post' and fn_reserve_bounty_escrow would debit a wallet
--      that was never funded. The check reads the PL/pgSQL call stack (the same
--      mechanism as fn_bounties_enforce_posting_quality), which a client cannot
--      forge, rather than a setting a client could send.
--   4. fn_create_bounty_from_pending_deferred: the card-saved counterpart of
--      fn_create_bounty_from_pending, called by the webhooks function for a
--      Checkout session with mode = 'setup'.
--   5. Index on payment_methods(user_id, is_default), if missing.
--   6. fn_new_account_open_cap_reached: lets bounty-checkout refuse a post the
--      new-account cap would refuse anyway, before the poster saves a card.
--   8. payment_experiment_config.web_card_at_post_enabled: the website's own
--      switch, off by default. bounty-checkout reads it to choose between a setup
--      session and today's payment session. card_at_post_scope only ever affects
--      the app, so the website can launch before the app build is out.
--   7. Sign-in hold. An anonymous web submission whose email matches an existing
--      account writes nothing to that account. The webhook parks the card on
--      the pending row (status 'awaiting_sign_in') and emails a sign-in link.
--      Signing in is not enough: the owner might click a link for a post a
--      stranger made in their name. poster-web lists the held post and only an
--      explicit "Post this bounty" calls fn_claim_pending_bounties for that one
--      row, which saves the card and creates the bounty.
--
-- BASED ON THE LIVE BODY
--   The insert list and validation are copied from the body of
--   fn_create_bounty_from_pending read from production on 2026-11-04, not from
--   20260818010000, which has drifted (see 20261019230000). The live
--   pending_bounties has work_type, deadline and geo columns and no metadata or
--   is_for_honor column.
--
-- DIFFERENCES FROM fn_create_bounty_from_pending
--   * Version 1, 'at_accept', no bounty_payments row, is_for_honor false.
--   * Replay: every status = 'created' row is a replay. The live function falls
--     through when resulting_bounty_id is NULL, which is what ON DELETE SET
--     NULL leaves once a poster deletes the bounty, so a redelivered event
--     would recreate a bounty the poster had deleted. It also has a second
--     check on bounty_payments.stripe_checkout_session_id; with no such row
--     here, the row lock on pending_bounties is what serialises deliveries.
--   * p_payment_method_id must be a card saved to this poster, so a bounty
--     cannot exist in this flow without the card that will pay for it.
--
-- NOT EXEMPT FROM fn_bounties_enforce_posting_quality, on purpose. Its
-- exemption matches 'function fn_create_bounty_from_pending(' including the
-- parenthesis, so it does not match this function's name, and it is left that
-- way. The exemption exists because that path has already captured the
-- customer's money; this one has not, and posting now costs nothing, which is
-- what the new-account cap guards against. bounty-checkout checks the cap first
-- so the poster is told; the trigger stays the backstop, and a refusal there is
-- terminal: the webhook records it and no one was charged.
--
-- Rollback: supabase/rollbacks/production/20261104120000_card_at_post_deferred_bounty_intake.down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The switch
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_experiment_config
  DROP CONSTRAINT IF EXISTS payment_experiment_config_card_at_post_scope_check;
ALTER TABLE public.payment_experiment_config
  ADD CONSTRAINT payment_experiment_config_card_at_post_scope_check
  CHECK (card_at_post_scope IN ('off', 'first_time_posters', 'all_posters'));

COMMENT ON COLUMN public.payment_experiment_config.card_at_post_scope IS
  'Who must save a card before posting a bounty that is charged at hire. '
  '''off'' = nobody; ''first_time_posters'' = fn_is_first_time_poster; '
  '''all_posters'' = anyone posting a paid bounty with no card row in '
  'payment_methods. Read only by fn_get_posting_card_requirement. No charge is '
  'ever made at post.';

-- ---------------------------------------------------------------------------
-- 2. What the composer asks
-- ---------------------------------------------------------------------------
-- Same signature and response shape; CREATE OR REPLACE keeps the grants.
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
  v_has_card        boolean;
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

  SELECT EXISTS (
    SELECT 1 FROM public.payment_methods pm
     WHERE pm.user_id = v_uid
       AND pm.type = 'card'
  ) INTO v_has_card;

  RETURN jsonb_build_object(
    'scope', v_scope,
    'first_time_poster', v_first_time,
    'charged_at_hire', v_charged_at_hire,
    'card_required',
      (v_scope = 'first_time_posters' AND v_first_time AND v_charged_at_hire)
      OR (v_scope = 'all_posters' AND COALESCE(p_amount, 0) > 0 AND NOT v_has_card)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Funding mode: the deferred intake is always at_accept
-- ---------------------------------------------------------------------------
-- Body otherwise identical to 20260827000000.
CREATE OR REPLACE FUNCTION public.fn_bounties_normalize_funding_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_context text;
BEGIN
  GET DIAGNOSTICS v_context = PG_CONTEXT;
  IF position('function fn_create_bounty_from_pending_deferred(' IN v_context) > 0
     OR position('function public.fn_create_bounty_from_pending_deferred(' IN v_context) > 0 THEN
    NEW.funding_mode := 'at_accept';
    RETURN NEW;
  END IF;

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

-- ---------------------------------------------------------------------------
-- 4. The deferred intake
-- ---------------------------------------------------------------------------
-- Returns one row: { bounty_id, created }.
--   created = true  -> first call; the bounty was inserted.
--   created = false -> replay. bounty_id is NULL if the poster has since
--                      deleted the bounty.
-- Validation failures start with the function's name; the webhook treats those
-- as terminal rather than retrying them.
CREATE OR REPLACE FUNCTION public.fn_create_bounty_from_pending_deferred(
  p_pending_id        uuid,
  p_poster_id         uuid,
  p_setup_session_id  text,
  p_payment_method_id text
)
RETURNS TABLE(bounty_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pending      public.pending_bounties%ROWTYPE;
  v_bounty_id    uuid;
  v_funding_mode text;
  v_in_person    boolean;
BEGIN
  IF p_pending_id IS NULL THEN
    RAISE EXCEPTION 'fn_create_bounty_from_pending_deferred: p_pending_id is required';
  END IF;
  IF p_poster_id IS NULL THEN
    RAISE EXCEPTION 'fn_create_bounty_from_pending_deferred: p_poster_id is required';
  END IF;
  IF p_setup_session_id IS NULL OR length(p_setup_session_id) = 0 THEN
    RAISE EXCEPTION 'fn_create_bounty_from_pending_deferred: p_setup_session_id is required';
  END IF;
  IF p_payment_method_id IS NULL OR length(p_payment_method_id) = 0 THEN
    RAISE EXCEPTION 'fn_create_bounty_from_pending_deferred: p_payment_method_id is required';
  END IF;

  -- Serialises concurrent deliveries of the same pending row.
  SELECT * INTO v_pending
  FROM public.pending_bounties
  WHERE id = p_pending_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fn_create_bounty_from_pending_deferred: pending bounty % not found', p_pending_id;
  END IF;

  IF v_pending.status = 'created' THEN
    RETURN QUERY SELECT v_pending.resulting_bounty_id, false;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payment_methods pm
     WHERE pm.stripe_payment_method_id = p_payment_method_id
       AND pm.user_id = p_poster_id
       AND pm.type = 'card'
  ) THEN
    RAISE EXCEPTION 'fn_create_bounty_from_pending_deferred: card % is not saved to poster %',
      p_payment_method_id, p_poster_id;
  END IF;

  IF v_pending.title IS NULL OR length(btrim(v_pending.title)) < 3 THEN
    RAISE EXCEPTION 'fn_create_bounty_from_pending_deferred: pending bounty % has no usable title', p_pending_id;
  END IF;
  IF v_pending.amount IS NULL OR v_pending.amount <= 0 THEN
    RAISE EXCEPTION 'fn_create_bounty_from_pending_deferred: pending bounty % has invalid amount %', p_pending_id, v_pending.amount;
  END IF;

  -- A point only means something for in-person work.
  v_in_person := COALESCE(v_pending.work_type, 'online') = 'in_person';

  INSERT INTO public.bounties (
    user_id, poster_id, title, description, amount, location, category,
    deadline, status, work_type, is_for_honor, payment_architecture_version,
    funding_mode, latitude, longitude, zip_code, neighborhood
  ) VALUES (
    p_poster_id, p_poster_id,
    btrim(v_pending.title),
    COALESCE(NULLIF(btrim(COALESCE(v_pending.description, '')), ''), ''),
    v_pending.amount,
    NULLIF(btrim(COALESCE(v_pending.location, '')), ''),
    NULLIF(btrim(COALESCE(v_pending.category, '')), ''),
    v_pending.deadline,
    'open'::bounty_status_enum,
    COALESCE(v_pending.work_type, 'online')::work_type_enum,
    false, 1,
    'at_accept',
    CASE WHEN v_in_person THEN v_pending.latitude END,
    CASE WHEN v_in_person THEN v_pending.longitude END,
    CASE WHEN v_in_person THEN NULLIF(btrim(COALESCE(v_pending.zip_code, '')), '') END,
    CASE WHEN v_in_person THEN NULLIF(btrim(COALESCE(v_pending.neighborhood, '')), '') END
  )
  RETURNING id, bounties.funding_mode INTO v_bounty_id, v_funding_mode;

  -- If the trigger bypass above ever stops matching, the row would be at_post
  -- and fn_reserve_bounty_escrow would already have debited the poster. Raising
  -- rolls that debit back.
  IF v_funding_mode IS DISTINCT FROM 'at_accept' THEN
    RAISE EXCEPTION 'fn_create_bounty_from_pending_deferred: bounty funding_mode resolved to %, expected at_accept', v_funding_mode;
  END IF;

  UPDATE public.pending_bounties
     SET status = 'created',
         resulting_bounty_id = v_bounty_id,
         supabase_user_id = p_poster_id,
         stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, p_setup_session_id)
   WHERE id = p_pending_id;

  -- No point = no nearby hunter is ever told. Page an admin now; never let the
  -- alert fail the post.
  IF v_in_person AND (v_pending.latitude IS NULL OR v_pending.longitude IS NULL) THEN
    BEGIN
      PERFORM public.record_reconciliation_finding(
        'bounty_location_not_geocoded',
        'critical',
        p_poster_id,
        jsonb_build_object(
          'bountyId',        v_bounty_id,
          'pendingBountyId', p_pending_id,
          'title',           btrim(v_pending.title),
          'source',          v_pending.source,
          'note',            'Card-on-file in-person post arrived with address text but no point, so no nearby hunter was notified. Geocode the address in bounty_private_locations and set bounties.latitude/longitude.'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_create_bounty_from_pending_deferred: could not flag missing location for bounty %: %', v_bounty_id, SQLERRM;
    END;
  END IF;

  RETURN QUERY SELECT v_bounty_id, true;
END;
$$;

COMMENT ON FUNCTION public.fn_create_bounty_from_pending_deferred(uuid, uuid, text, text) IS
  'Converts a pending_bounties row into a live v1 at_accept bounty after a card '
  'was saved through Checkout (mode=setup). No charge and no bounty_payments row; '
  'escrow is reserved at acceptance. Idempotent: replays return created=false.';

REVOKE ALL ON FUNCTION public.fn_create_bounty_from_pending_deferred(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_create_bounty_from_pending_deferred(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_create_bounty_from_pending_deferred(uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_bounty_from_pending_deferred(uuid, uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Default-card lookup
-- ---------------------------------------------------------------------------
-- Already present in production as this partial index (20260402); a no-op there.
CREATE INDEX IF NOT EXISTS idx_payment_methods_user_default
  ON public.payment_methods(user_id, is_default)
  WHERE is_default = true;

-- ---------------------------------------------------------------------------
-- 6. The new-account cap, asked before checkout
-- ---------------------------------------------------------------------------
-- Same condition as rule 2 and the is_internal exemption in
-- fn_bounties_enforce_posting_quality (20261019230000). Keep them in step.
CREATE OR REPLACE FUNCTION public.fn_new_account_open_cap_reached(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT NOT COALESCE(p.is_internal, false)
       AND p.created_at > now() - interval '24 hours'
       AND (
         SELECT count(*) FROM public.bounties b
          WHERE (b.poster_id = p_user_id OR b.user_id = p_user_id)
            AND b.status = 'open'
       ) >= 2
      FROM public.profiles p
     WHERE p.id = p_user_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.fn_new_account_open_cap_reached(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_new_account_open_cap_reached(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_new_account_open_cap_reached(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_new_account_open_cap_reached(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. The sign-in hold
-- ---------------------------------------------------------------------------
ALTER TABLE public.pending_bounties
  ADD COLUMN IF NOT EXISTS claim_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claim_card          jsonb,
  ADD COLUMN IF NOT EXISTS claim_requested_at  timestamptz,
  ADD COLUMN IF NOT EXISTS claim_email_sent_at timestamptz;

COMMENT ON COLUMN public.pending_bounties.claim_user_id IS
  'The existing account an anonymous submission''s email matched. Nothing is '
  'written to that account until fn_claim_pending_bounties runs for this user.';
COMMENT ON COLUMN public.pending_bounties.claim_card IS
  'Card saved through Checkout, held until the claim: payment_method_id, '
  'customer_id, brand, last4, exp_month, exp_year. Cleared on claim.';

ALTER TABLE public.pending_bounties DROP CONSTRAINT IF EXISTS pending_bounties_status_check;
ALTER TABLE public.pending_bounties
  ADD CONSTRAINT pending_bounties_status_check
  CHECK (status IN ('pending_payment', 'paid', 'awaiting_sign_in', 'created', 'expired', 'failed'));

CREATE INDEX IF NOT EXISTS idx_pending_bounties_awaiting_claim
  ON public.pending_bounties(claim_user_id)
  WHERE status = 'awaiting_sign_in';

-- Present in production but never tracked in a migration; a no-op there. The
-- webhook and the claim below both conflict on it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_failures_session
  ON public.checkout_processing_failures(stripe_checkout_session_id);

-- Service role only: poster-web calls it with the id from a verified session,
-- after that user confirmed this specific post. A claim is good for 7 days; an
-- older hold is left in place and never acted on. Returns no row when the post
-- isn't awaiting this user.
DROP FUNCTION IF EXISTS public.fn_claim_pending_bounties(uuid);
CREATE OR REPLACE FUNCTION public.fn_claim_pending_bounties(p_user_id uuid, p_pending_id uuid)
RETURNS TABLE(pending_id uuid, bounty_id uuid, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row         public.pending_bounties%ROWTYPE;
  v_pm          text;
  v_customer    text;
  v_profile     text;
  v_is_default  boolean;
  v_bounty_id   uuid;
  v_reason      text;
BEGIN
  IF p_user_id IS NULL OR p_pending_id IS NULL THEN
    RAISE EXCEPTION 'fn_claim_pending_bounties: p_user_id and p_pending_id are required';
  END IF;

  FOR v_row IN
    SELECT p.* FROM public.pending_bounties p
     WHERE p.id = p_pending_id
       AND p.claim_user_id = p_user_id
       AND p.status = 'awaiting_sign_in'
       AND p.claim_requested_at > now() - interval '7 days'
     FOR UPDATE SKIP LOCKED
  LOOP
    v_reason := NULL;
    BEGIN
      IF NOT public.is_account_active(p_user_id) THEN
        RAISE EXCEPTION 'fn_create_bounty_from_pending_deferred: account % is not active', p_user_id;
      END IF;

      v_pm       := v_row.claim_card ->> 'payment_method_id';
      v_customer := v_row.claim_card ->> 'customer_id';

      SELECT pr.stripe_customer_id INTO v_profile
        FROM public.profiles pr WHERE pr.id = p_user_id FOR UPDATE;

      -- As in the webhook: never replace an existing customer. A card on a
      -- different one is saved, but accept-bounty-request will not charge it,
      -- so it must not become the default.
      v_is_default := v_profile IS NULL OR v_profile = v_customer;

      IF v_profile IS NULL AND v_customer IS NOT NULL THEN
        UPDATE public.profiles SET stripe_customer_id = v_customer WHERE id = p_user_id;
      END IF;

      IF v_is_default THEN
        UPDATE public.payment_methods
           SET is_default = false
         WHERE user_id = p_user_id
           AND is_default = true
           AND stripe_payment_method_id IS DISTINCT FROM v_pm;
      END IF;

      INSERT INTO public.payment_methods (
        user_id, stripe_payment_method_id, type, card_brand, card_last4,
        card_exp_month, card_exp_year, is_default
      ) VALUES (
        p_user_id, v_pm, 'card',
        v_row.claim_card ->> 'brand',
        v_row.claim_card ->> 'last4',
        (v_row.claim_card ->> 'exp_month')::integer,
        (v_row.claim_card ->> 'exp_year')::integer,
        v_is_default
      )
      ON CONFLICT (stripe_payment_method_id) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            is_default = EXCLUDED.is_default;

      SELECT d.bounty_id INTO v_bounty_id
        FROM public.fn_create_bounty_from_pending_deferred(
          v_row.id, p_user_id, v_row.stripe_checkout_session_id, v_pm
        ) d;

      UPDATE public.pending_bounties SET claim_card = NULL WHERE id = v_row.id;

      pending_id := v_row.id;
      bounty_id  := v_bounty_id;
      outcome    := 'created';
      RETURN NEXT;
    EXCEPTION
      -- Terminal only, as in the webhook. Anything else propagates and the hold
      -- stays and the poster can confirm again. This block's writes roll back, so
      -- a refused post leaves the account untouched.
      WHEN check_violation OR raise_exception THEN
        IF SQLSTATE = 'P0001'
           AND position('fn_create_bounty_from_pending_deferred:' IN SQLERRM) <> 1 THEN
          RAISE;
        END IF;
        v_reason := SQLERRM;
    END;

    IF v_reason IS NOT NULL THEN
      UPDATE public.pending_bounties
         SET status = 'failed', claim_card = NULL
       WHERE id = v_row.id;

      INSERT INTO public.checkout_processing_failures (
        stripe_checkout_session_id, pending_bounty_id, customer_email, reason
      ) VALUES (
        v_row.stripe_checkout_session_id, v_row.id, v_row.email,
        'bounty_creation_refused: ' || v_reason
      )
      ON CONFLICT (stripe_checkout_session_id) DO NOTHING;

      pending_id := v_row.id;
      bounty_id  := NULL;
      outcome    := 'failed';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_claim_pending_bounties(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_claim_pending_bounties(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_claim_pending_bounties(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_pending_bounties(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. The website's switch
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_experiment_config
  ADD COLUMN IF NOT EXISTS web_card_at_post_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payment_experiment_config.web_card_at_post_enabled IS
  'Website only. true = bounty-checkout saves a card and charges at hire (Checkout '
  'mode setup). false = pay up front (mode payment). Independent of '
  'card_at_post_scope, which only the app reads. Also the website''s kill switch.';

NOTIFY pgrst, 'reload schema';

COMMIT;
