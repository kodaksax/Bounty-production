-- Rollback for 20261110120000_cancelled_bounty_money_reconciliation.sql
-- Restores the production definitions captured on 2026-11-10 (pg_get_functiondef).
--
-- REFUSES rather than deletes when the forward migration has been used:
--   - bounty_payments rows in status 'retained'
--   - platform_ledger rows with fee_type 'retained_bounty_funds'
--   - admin_action_log rows with action_type 'bounty_status_disposition'
--     (append-only; they are the audit trail of real money decisions)
-- Narrowing a CHECK under those rows would fail anyway; this says why first.
-- If they exist, keep the vocabulary (section 0) and roll back only the
-- functions: run this file with the DO block and section 0 removed.
--
-- reconciliation_findings rows of the two new types are kept (audit); they
-- simply stop being produced.

BEGIN;

DO $$
DECLARE
  v_retained int; v_ledger int; v_log int;
BEGIN
  SELECT count(*) INTO v_retained FROM public.bounty_payments WHERE status = 'retained';
  SELECT count(*) INTO v_ledger   FROM public.platform_ledger WHERE fee_type = 'retained_bounty_funds';
  SELECT count(*) INTO v_log      FROM public.admin_action_log WHERE action_type = 'bounty_status_disposition';
  IF v_retained + v_ledger + v_log > 0 THEN
    RAISE EXCEPTION 'dispositions already recorded (retained payments: %, ledger rows: %, audit rows: %); roll back the functions only (see header)',
      v_retained, v_ledger, v_log;
  END IF;
END $$;

-- Schedule
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bounty-money-reconciliation-daily';
  END IF;
END $$;

-- Admin status change: back to the 3-argument form.
DROP FUNCTION IF EXISTS public.admin_set_bounty_status(uuid, text, text, text, uuid);

CREATE FUNCTION public.admin_set_bounty_status(
  p_bounty_id uuid,
  p_status    text,
  p_reason    text DEFAULT NULL::text
)
RETURNS bounties
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row  public.bounties%rowtype;
  v_from text;
  v_held text;
BEGIN
  PERFORM public.admin_assert_role();

  IF p_status NOT IN ('open','in_progress','completed','archived','cancelled','cancellation_requested','deleted') THEN
    RAISE EXCEPTION 'invalid bounty status: %', p_status USING ERRCODE = '22023';
  END IF;

  -- Lock the row so the escrow check and the update see the same state.
  SELECT * INTO v_row FROM public.bounties WHERE id = p_bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty % not found', p_bounty_id USING ERRCODE = 'P0002';
  END IF;

  v_from := v_row.status::text;

  -- Idempotent no-op: already in the requested status (double submission,
  -- stale admin list, or a race with another admin session).
  IF v_from = p_status THEN
    RETURN v_row;
  END IF;

  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'a reason is required for an admin status change' USING ERRCODE = '22023';
  END IF;

  IF NOT public.admin_bounty_status_transition_allowed(v_from, p_status) THEN
    RAISE EXCEPTION 'illegal bounty status transition: % -> %', v_from, p_status USING ERRCODE = '22023';
  END IF;

  -- Anything that ends the engagement, or puts it back on the market, must
  -- not leave money behind. Resuming (cancellation_requested -> in_progress)
  -- and starting work (open -> in_progress) keep the escrow where it is.
  IF p_status IN ('completed', 'cancelled', 'archived', 'deleted', 'open') THEN
    v_held := public.fn_bounty_unsettled_escrow_reason(p_bounty_id);
    IF v_held IS NOT NULL THEN
      RAISE EXCEPTION 'escrow_unsettled:%', v_held
        USING ERRCODE = '55000',
              HINT = 'Settle the money first: approve the cancellation (refunds the poster) or resolve the dispute (release or refund).';
    END IF;
  END IF;

  EXECUTE format('UPDATE public.bounties SET status = %L, updated_at = now() WHERE id = $1', p_status)
    USING p_bounty_id;

  IF to_regprocedure(
       'public.record_bounty_event(text,text,text,uuid,uuid,timestamptz,numeric,text,jsonb)'
     ) IS NOT NULL THEN
    PERFORM public.record_bounty_event(
      'admin.status_changed:' || p_bounty_id::text || ':'
        || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
      'admin.status_changed', 'system', p_bounty_id, auth.uid(), now(), NULL, NULL,
      jsonb_build_object('from', v_from, 'to', p_status, 'reason', btrim(p_reason)));
  END IF;

  SELECT * INTO v_row FROM public.bounties WHERE id = p_bounty_id;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_bounty_status(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_bounty_status(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_bounty_status(uuid, text, text) TO authenticated, service_role;

-- Findings
DROP FUNCTION IF EXISTS public.run_bounty_money_reconciliation();
DROP FUNCTION IF EXISTS public.fn_bounty_stranded_captured_payment(uuid);

CREATE OR REPLACE FUNCTION public.fn_reconciliation_finding_key(p_finding_type text, p_details jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- Detail key casing is NOT uniform across producers: the `reconciliation`
  -- Edge Function writes camelCase (transactionId, payoutId, accountId) while
  -- the DB-side run_withdrawal_reconciliation() writes snake_case
  -- (transaction_id, stripe_account_id). Both are accepted here rather than
  -- normalised at the source, because rewriting historical details would edit
  -- the audit record. Verified against every open finding_type in production
  -- on 2026-09-01: with these fallbacks, 0 open findings fail to derive a key.
  SELECT CASE
    WHEN subject IS NULL OR btrim(subject) = '' THEN NULL
    ELSE p_finding_type || ':' || btrim(subject)
  END
  FROM (
    SELECT CASE p_finding_type
      WHEN 'orphan_stripe_payout'        THEN p_details->>'payoutId'
      WHEN 'orphan_ledger_withdrawal'    THEN p_details->>'payoutId'
      WHEN 'payout_id_never_recorded'    THEN p_details->>'payoutId'
      WHEN 'completed_withdrawal_without_payout'
        THEN COALESCE(p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'stale_pending_withdrawal'
        THEN COALESCE(p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'withdrawal_missing_transfer_id'
        THEN COALESCE(p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'stuck_pending_withdrawal'
        THEN COALESCE(p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'connect_account_mismatch'
        THEN COALESCE(p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'stripe_account_unreadable'
        THEN COALESCE(p_details->>'accountId', p_details->>'stripe_account_id')
      WHEN 'connect_account_balance_drift'
        THEN COALESCE(p_details->>'stripe_account_id', p_details->>'accountId', p_user_id::text)
      -- balance_drift is per user and its details carry only the amounts.
      WHEN 'balance_drift'
        THEN COALESCE(p_details->>'transaction_id', p_details->>'user_id', p_user_id::text)
      WHEN 'amount_mismatch'
        THEN COALESCE(p_details->>'payoutId', p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'status_mismatch'
        THEN COALESCE(p_details->>'payoutId', p_details->>'transactionId', p_details->>'transaction_id')
      -- Liquidity anomaly (BNTY-02): one open row per bounty that can never be
      -- matched because it is in_person with no location.
      WHEN 'bounty_liquidity_no_candidates'
        THEN COALESCE(p_details->>'bountyId', p_details->>'bounty_id')
      -- The poster gave an address but we never turned it into a point.
      WHEN 'bounty_location_not_geocoded'
        THEN COALESCE(p_details->>'bountyId', p_details->>'bounty_id')
      -- Rollups describe a set, not a row: one open rollup per type is correct.
      WHEN 'completed_withdrawal_without_payout_total' THEN p_finding_type
      WHEN 'completed_withdrawal_without_payout_grandfathered' THEN p_finding_type
      WHEN 'invariant_sweep_failed'      THEN p_finding_type
      WHEN 'platform_balance_drift'      THEN p_finding_type
      ELSE NULL
    END AS subject
  ) s;
$function$;

CREATE OR REPLACE FUNCTION public.fn_derive_bounty_payment_settlement_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.settlement_state :=
    CASE
      WHEN NEW.status = 'released' AND NULLIF(TRIM(COALESCE(NEW.stripe_transfer_id, '')), '') IS NOT NULL THEN 'stripe_settled'
      WHEN NEW.status IN ('captured', 'release_pending') THEN 'stripe_pending'
      WHEN NEW.status IN ('refunded', 'canceled') AND NULLIF(TRIM(COALESCE(NEW.stripe_refund_id, '')), '') IS NOT NULL THEN 'stripe_settled'
      ELSE 'ledger_only'
    END::public.settlement_state_enum;
  RETURN NEW;
END;
$function$;

-- Section 0: vocabulary
ALTER TABLE public.reconciliation_known_exceptions DROP COLUMN IF EXISTS subject_key;

ALTER TABLE public.admin_action_log DROP CONSTRAINT IF EXISTS admin_action_log_action_type_check;
ALTER TABLE public.admin_action_log ADD CONSTRAINT admin_action_log_action_type_check CHECK (action_type = ANY (ARRAY[
  'force_retry_withdrawal', 'manual_balance_adjustment', 'mark_externally_settled_withdrawal',
  'reverse_stripe_transfer', 'run_stripe_balance_sync', 'acknowledge_reconciliation_finding',
  'account_status_change', 'role_change', 'id_verification_review'
]));

ALTER TABLE public.platform_ledger DROP CONSTRAINT IF EXISTS platform_ledger_fee_type_check;
ALTER TABLE public.platform_ledger ADD CONSTRAINT platform_ledger_fee_type_check
  CHECK (fee_type = 'platform_fee'::text);

ALTER TABLE public.bounty_payments DROP CONSTRAINT IF EXISTS bounty_payments_status_check;
ALTER TABLE public.bounty_payments ADD CONSTRAINT bounty_payments_status_check CHECK (status = ANY (ARRAY[
  'pending_payment', 'authorized', 'captured', 'release_pending', 'released',
  'refund_pending', 'refunded', 'canceled', 'disputed', 'failed'
]));

COMMIT;
