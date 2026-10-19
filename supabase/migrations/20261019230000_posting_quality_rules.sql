-- Migration: Posting quality rules for new bounties (SBA-03, server side)
-- Created: 2026-10-19
--
-- PROBLEM (docs/audits/shoal-behavioral-audit.md, SBA-03):
--   Of 19 genuine bounties since 09-10, 12 carry an exact one-tap template
--   title and 16 have no description at all. A template tap filled the title,
--   category and price and skipped ahead, so a location and "Post Bounty"
--   were all that stood between a curious new user and a live listing. One
--   account published five in six minutes and never came back. Those posts
--   drew 222 applications that nobody answered.
--
--   The composer now asks "What exactly, and when?" on step 1 and saves it as
--   the description. This migration is the backstop for every build already
--   installed and for every other write path (the service-role relay in
--   api/server.js, services/api).
--
-- WHAT THIS DOES
--   trg_bounties_enforce_posting_quality, BEFORE INSERT on bounties:
--     1. An in-person bounty needs a description of at least 20 characters
--        (whitespace trimmed, the same rule as lib/utils/bounty-validation.ts
--        validateDescription). Online bounties are not checked here.
--        SWITCHED OFF on deploy: posting_policy_config.require_in_person_description
--        defaults to false. Installed builds (2.1.x) have no way to add a
--        description before publishing and OTA cannot reach them, so turning
--        it on before the next native build would block every in-person post
--        from them (17 of 18 genuine app posts since 09-10 would have been
--        refused). Decision (product, 2026-10-19): ship the switch off, turn it
--        on once the build with the step-1 field has most active posters:
--          UPDATE public.posting_policy_config
--             SET require_in_person_description = true, updated_at = now()
--           WHERE id;
--     2. An account whose profile is less than 24 hours old can have at most
--        2 bounties with status 'open'. A third insert is refused until one
--        closes or the account turns a day old. A per-poster advisory lock
--        serialises the count so two concurrent inserts can't both see 1.
--   Both raise check_violation with a sentence the app shows as-is (see
--   lib/utils/bounty-publish-error.ts). Neither matches the RLS wording the
--   client uses to fall back to the relay, so a refusal is not retried there.
--
-- WHO IS EXEMPT
--   * Internal and test accounts: profiles.is_internal = true (the only
--     internal-account filter in this project). bounties.is_test is NOT an
--     exemption, because a client can send is_test = true on its own insert.
--   * The paid web intake: fn_create_bounty_from_pending, called by the
--     webhooks function after Stripe has CAPTURED the customer's money. A
--     refusal there would leave a charged customer with no bounty and Stripe
--     retrying the event. That intake creates the poster's account in the same
--     request, so every web poster is "new" and would otherwise hit rule 2 on
--     their third paid post. The web form already sends descriptions (all 8
--     web bounties to date have 20+ characters); the place to enforce rule 1
--     for the web is the form, before payment.
--     The exemption reads the PL/pgSQL call stack (GET DIAGNOSTICS
--     PG_CONTEXT), which a client cannot forge, rather than a flag column or
--     setting a client could send. fn_create_bounty_from_pending itself is not
--     redefined: its live body is not tracked in this repo.
--
-- NOT CHANGED
--   * UPDATEs. Legacy in-person bounties with no description stay editable.
--   * fn_bounties_enforce_posting_policy (honor posts / minimum amount).
--
-- ROLLBACK: supabase/rollbacks/production/20261019230000_posting_quality_rules.down.sql

ALTER TABLE public.posting_policy_config
  ADD COLUMN IF NOT EXISTS require_in_person_description boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.posting_policy_config.require_in_person_description IS
  'SBA-03: when true, trg_bounties_enforce_posting_quality refuses in-person bounties with under 20 characters of description. Off until the native build with the step-1 "What exactly, and when?" field is out.';

CREATE OR REPLACE FUNCTION public.fn_bounties_enforce_posting_quality()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_poster       uuid := COALESCE(NEW.poster_id, NEW.user_id);
  v_internal     boolean;
  v_joined_at    timestamptz;
  v_open         integer;
  v_context      text;
  v_require_desc boolean;
BEGIN
  -- Paid web intake (see WHO IS EXEMPT). Must stay first: nothing below may
  -- refuse a bounty the customer has already paid for.
  GET DIAGNOSTICS v_context = PG_CONTEXT;
  IF position('function fn_create_bounty_from_pending(' IN v_context) > 0
     OR position('function public.fn_create_bounty_from_pending(' IN v_context) > 0 THEN
    RETURN NEW;
  END IF;

  -- No owner: trg_bounties_owner_reference_required refuses the row.
  IF v_poster IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.is_internal, p.created_at
    INTO v_internal, v_joined_at
  FROM public.profiles p
  WHERE p.id = v_poster;

  IF COALESCE(v_internal, false) THEN
    RETURN NEW;
  END IF;

  -- Rule 1: in-person bounties say what, exactly, and when. Off unless the
  -- switch is on (a missing config row reads as off).
  SELECT c.require_in_person_description
    INTO v_require_desc
  FROM public.posting_policy_config c
  WHERE c.id = true;

  IF COALESCE(v_require_desc, false)
     AND NEW.work_type = 'in_person'
     AND char_length(btrim(COALESCE(NEW.description, ''), E' \t\r\n')) < 20 THEN
    RAISE EXCEPTION 'In-person bounties need a description of at least 20 characters.'
      USING ERRCODE = 'check_violation',
            HINT    = 'Say what exactly needs doing, and when.';
  END IF;

  -- Rule 2: at most 2 open bounties in an account's first 24 hours.
  IF v_joined_at IS NOT NULL
     AND v_joined_at > now() - interval '24 hours'
     AND COALESCE(NEW.status::text, 'open') = 'open' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('bounties:new_account_open_cap:' || v_poster::text, 0)
    );

    SELECT count(*)
      INTO v_open
    FROM public.bounties b
    WHERE (b.poster_id = v_poster OR b.user_id = v_poster)
      AND b.status = 'open';

    IF v_open >= 2 THEN
      RAISE EXCEPTION 'New accounts can have 2 open bounties on their first day. You can post more tomorrow.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_bounties_enforce_posting_quality() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_bounties_enforce_posting_quality() IS
  'SBA-03: in-person bounties need a 20+ character description (when posting_policy_config.require_in_person_description); accounts under 24h old may have 2 open bounties. Exempt: profiles.is_internal, and fn_create_bounty_from_pending (paid web intake).';

DROP TRIGGER IF EXISTS trg_bounties_enforce_posting_quality ON public.bounties;
CREATE TRIGGER trg_bounties_enforce_posting_quality
  BEFORE INSERT ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounties_enforce_posting_quality();
