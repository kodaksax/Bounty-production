-- Rollback for 20261104120000_card_at_post_deferred_bounty_intake.sql.
--
-- Deploy order: roll the webhooks function back FIRST, or setup-mode sessions
-- will call a function that no longer exists (they fail and Stripe retries).
--
-- Bounties already created by the deferred intake are left alone. They are
-- ordinary v1 at_accept rows and fund at acceptance. The index predates the
-- migration (20260402) and is kept.
--
-- Holds still awaiting sign-in become 'expired', since nothing can claim them
-- after this. Their cards stay on the session's Stripe customer. The failures
-- index was already in production and is kept.
--
-- A scope of 'all_posters' cannot survive the restored constraint, so it falls
-- back to 'off' here.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_claim_pending_bounties(uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_new_account_open_cap_reached(uuid);
DROP FUNCTION IF EXISTS public.fn_create_bounty_from_pending_deferred(uuid, uuid, text, text);

ALTER TABLE public.payment_experiment_config DROP COLUMN IF EXISTS web_card_at_post_enabled;

UPDATE public.pending_bounties SET status = 'expired' WHERE status = 'awaiting_sign_in';

ALTER TABLE public.pending_bounties DROP CONSTRAINT IF EXISTS pending_bounties_status_check;
ALTER TABLE public.pending_bounties
  ADD CONSTRAINT pending_bounties_status_check
  CHECK (status IN ('pending_payment', 'paid', 'created', 'expired', 'failed'));

DROP INDEX IF EXISTS public.idx_pending_bounties_awaiting_claim;

ALTER TABLE public.pending_bounties
  DROP COLUMN IF EXISTS claim_user_id,
  DROP COLUMN IF EXISTS claim_card,
  DROP COLUMN IF EXISTS claim_requested_at,
  DROP COLUMN IF EXISTS claim_email_sent_at;

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

UPDATE public.payment_experiment_config
   SET card_at_post_scope = 'off', updated_at = now()
 WHERE card_at_post_scope = 'all_posters';

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

NOTIFY pgrst, 'reload schema';

COMMIT;
