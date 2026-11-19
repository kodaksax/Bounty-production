-- Cancelled bounties that still hold captured money (P10, 2026-11-10)
--
-- THE CASE
-- Bounty 5e96aaed-93bd-4ade-ae39-93b073d9daff was cancelled by an admin on
-- 2026-10-07. Its bounty_payments row 7a665b48-5702-40a8-9184-fe7bf7a67daa is
-- still `captured` / `stripe_pending`: $35 captured on Stripe, never refunded,
-- never transferred. Nothing flagged it for a month: no reconciliation check
-- compares a bounty's status with its money.
--
-- Live sizing on 2026-11-10 (read-only):
--   cancelled/deleted/archived bounty + captured payment, no refund/transfer id:
--     3 rows, $50. 5e96aaed ($35, real); 213c13db ($10, deleted 2026-08-20,
--     is_test); 060079f5 ($5, deleted, is_test).
--   refund_pending with no stripe_refund_id:
--     5 rows, $71, oldest 2026-08-18. bdaa3028 ($15, real, archived) + 4 is_test.
--   (The 2026-10-07 analysis said 4 rows / $56; not re-checked against Stripe.)
--
-- WHAT THIS ADDS
-- 1. Two reconciliation findings, written by run_bounty_money_reconciliation()
--    through record_reconciliation_finding() (so one open row per payment):
--      cancelled_bounty_captured_payment  — bounty cancelled/deleted/archived,
--        payment `captured`, no stripe_refund_id, no stripe_transfer_id.
--      refund_pending_without_stripe_refund — payment `refund_pending` for
--        more than 24 h with no stripe_refund_id.
--    Severity: 'critical' for real money, 'warning' for is_test bounties. The
--    spec asked for "high"; reconciliation_findings_severity_check allows only
--    info/warning/critical, and critical is what pages (fn_alert_on_critical_finding).
--    reconciliation_known_exceptions is respected, and gains a subject_key so an
--    exception can name one payment instead of every finding for a poster.
--    Open findings whose condition has cleared are resolved automatically.
--    Scheduled daily at 09:05 UTC (after withdrawal-reconciliation-daily at
--    09:00, before reconciliation-findings-digest at 09:45).
--
-- 2. admin_set_bounty_status() takes a disposition. Since 20261012120100 it has
--    refused to end a bounty with any money held (55000 escrow_unsettled), which
--    stopped new strandings but left no way out for an already-captured v2
--    payment: the console has no admin refund or payout for bounty_payments.
--    Now, when the target is cancelled/archived/deleted and the only hold is a
--    `captured` payment with no refund or transfer id, the change requires one of:
--      refund_poster            — payment -> refund_pending; the admin console
--                                 then calls bounty-payments /admin-settle, which
--                                 runs the same Stripe refund code as /cancel.
--      keep_as_platform_revenue — platform_ledger row (fee_type
--                                 'retained_bounty_funds'), payment -> 'retained'.
--      pay_out_to_hunter        — records p_hunter_id on the payment; /admin-settle
--                                 then runs the same Stripe transfer as /release
--                                 (same idempotency key, so the two can't both pay).
--    Without one it refuses (55000, 'disposition_required'). Every disposition
--    writes admin_action_log (action_type 'bounty_status_disposition').
--    If /admin-settle never runs, the payment is still caught by one of the two
--    findings above, so it cannot go silent again.
--    Every other hold (wallet escrow, v3 funding, authorized/disputed payments,
--    a refund already in flight, completing or reopening) is refused exactly
--    as before.
--
-- Requires: 20261012120100_admin_financial_action_guards.sql,
--           20260901140000_reconciliation_finding_identity.sql.
-- Function bodies below were taken from pg_get_functiondef() on production on
-- 2026-11-10, not from earlier migration files (see migrations README).
--
-- Rollback: supabase/rollbacks/production/20261110120000_cancelled_bounty_money_reconciliation.down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Vocabulary
-- ---------------------------------------------------------------------------
-- 'retained': the platform kept the captured funds by admin decision. Terminal,
-- and not a hold (fn_bounty_unsettled_escrow_reason does not list it).
ALTER TABLE public.bounty_payments DROP CONSTRAINT IF EXISTS bounty_payments_status_check;
ALTER TABLE public.bounty_payments ADD CONSTRAINT bounty_payments_status_check CHECK (status = ANY (ARRAY[
  'pending_payment', 'authorized', 'captured', 'release_pending', 'released',
  'refund_pending', 'refunded', 'canceled', 'disputed', 'failed', 'retained'
]));

ALTER TABLE public.platform_ledger DROP CONSTRAINT IF EXISTS platform_ledger_fee_type_check;
ALTER TABLE public.platform_ledger ADD CONSTRAINT platform_ledger_fee_type_check
  CHECK (fee_type = ANY (ARRAY['platform_fee', 'retained_bounty_funds']));

ALTER TABLE public.admin_action_log DROP CONSTRAINT IF EXISTS admin_action_log_action_type_check;
ALTER TABLE public.admin_action_log ADD CONSTRAINT admin_action_log_action_type_check CHECK (action_type = ANY (ARRAY[
  'force_retry_withdrawal', 'manual_balance_adjustment', 'mark_externally_settled_withdrawal',
  'reverse_stripe_transfer', 'run_stripe_balance_sync', 'acknowledge_reconciliation_finding',
  'account_status_change', 'role_change', 'id_verification_review',
  'bounty_status_disposition'
]));

ALTER TABLE public.reconciliation_known_exceptions ADD COLUMN IF NOT EXISTS subject_key text;
COMMENT ON COLUMN public.reconciliation_known_exceptions.subject_key IS
  'Optional: the one subject this exception covers (for the bounty money findings, the bounty_payments id). NULL keeps the original meaning: every finding of finding_type for user_id.';

-- settlement_state is derived from status; a retained payment is settled on
-- the platform's own Stripe balance.
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
      WHEN NEW.status = 'retained' THEN 'stripe_settled'
      ELSE 'ledger_only'
    END::public.settlement_state_enum;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 1. Findings
-- ---------------------------------------------------------------------------
-- Live definition plus the two new types (keyed by payment).
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
      -- A bounty's status and its money disagree: one open row per payment.
      WHEN 'cancelled_bounty_captured_payment'
        THEN p_details->>'bounty_payment_id'
      WHEN 'refund_pending_without_stripe_refund'
        THEN p_details->>'bounty_payment_id'
      -- Rollups describe a set, not a row: one open rollup per type is correct.
      WHEN 'completed_withdrawal_without_payout_total' THEN p_finding_type
      WHEN 'completed_withdrawal_without_payout_grandfathered' THEN p_finding_type
      WHEN 'invariant_sweep_failed'      THEN p_finding_type
      WHEN 'platform_balance_drift'      THEN p_finding_type
      ELSE NULL
    END AS subject
  ) s;
$function$;

-- A payment the poster can't get back and the hunter never got. Shared by the
-- finding and the admin guard so the two can't disagree.
CREATE OR REPLACE FUNCTION public.fn_bounty_stranded_captured_payment(p_bounty_id uuid)
RETURNS public.bounty_payments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT bp.*
    FROM public.bounty_payments bp
   WHERE bp.bounty_id = p_bounty_id
     AND bp.status = 'captured'
     AND NULLIF(btrim(COALESCE(bp.stripe_refund_id, '')), '') IS NULL
     AND NULLIF(btrim(COALESCE(bp.stripe_transfer_id, '')), '') IS NULL
   ORDER BY bp.created_at DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fn_bounty_stranded_captured_payment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bounty_stranded_captured_payment(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bounty_stranded_captured_payment(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.run_bounty_money_reconciliation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r        record;
  v_keys   text[] := ARRAY[]::text[];
  v_count  integer := 0;
BEGIN
  -- cancelled_bounty_captured_payment
  FOR r IN
    SELECT bp.id, bp.bounty_id, bp.poster_id, bp.amount, bp.status, bp.settlement_state,
           bp.created_at, bp.updated_at, b.status::text AS bounty_status,
           COALESCE(b.is_test, false) AS is_test, b.updated_at AS bounty_updated_at
      FROM public.bounty_payments bp
      JOIN public.bounties b ON b.id = bp.bounty_id
     WHERE b.status::text IN ('cancelled', 'deleted', 'archived')
       AND bp.status = 'captured'
       AND NULLIF(btrim(COALESCE(bp.stripe_refund_id, '')), '') IS NULL
       AND NULLIF(btrim(COALESCE(bp.stripe_transfer_id, '')), '') IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.reconciliation_known_exceptions e
          WHERE e.finding_type = 'cancelled_bounty_captured_payment'
            AND (e.subject_key = bp.id::text
                 OR (e.subject_key IS NULL AND e.user_id = bp.poster_id)))
  LOOP
    PERFORM public.record_reconciliation_finding(
      'cancelled_bounty_captured_payment',
      CASE WHEN r.is_test THEN 'warning' ELSE 'critical' END,
      r.poster_id,
      jsonb_build_object(
        'bounty_payment_id', r.id,
        'bounty_id', r.bounty_id,
        'bounty_status', r.bounty_status,
        'payment_status', r.status,
        'settlement_state', r.settlement_state,
        'amount', r.amount,
        'is_test', r.is_test,
        'captured_at', r.created_at,
        'bounty_status_changed_at', r.bounty_updated_at,
        'action', 'Choose a disposition: admin_set_bounty_status(..., p_disposition => refund_poster | keep_as_platform_revenue | pay_out_to_hunter) or scripts/ops for a reviewed one-off.'
      ));
    v_keys := v_keys || ('cancelled_bounty_captured_payment:' || r.id::text);
    v_count := v_count + 1;
  END LOOP;

  -- refund_pending_without_stripe_refund (24 h grace: the refund call and its
  -- webhook normally land within minutes)
  FOR r IN
    SELECT bp.id, bp.bounty_id, bp.poster_id, bp.amount, bp.updated_at, bp.created_at,
           b.status::text AS bounty_status, COALESCE(b.is_test, false) AS is_test,
           bp.metadata->'admin_disposition' AS admin_disposition
      FROM public.bounty_payments bp
      LEFT JOIN public.bounties b ON b.id = bp.bounty_id
     WHERE bp.status = 'refund_pending'
       AND NULLIF(btrim(COALESCE(bp.stripe_refund_id, '')), '') IS NULL
       AND bp.updated_at < now() - interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM public.reconciliation_known_exceptions e
          WHERE e.finding_type = 'refund_pending_without_stripe_refund'
            AND (e.subject_key = bp.id::text
                 OR (e.subject_key IS NULL AND e.user_id = bp.poster_id)))
  LOOP
    PERFORM public.record_reconciliation_finding(
      'refund_pending_without_stripe_refund',
      CASE WHEN r.is_test THEN 'warning' ELSE 'critical' END,
      r.poster_id,
      jsonb_build_object(
        'bounty_payment_id', r.id,
        'bounty_id', r.bounty_id,
        'bounty_status', r.bounty_status,
        'amount', r.amount,
        'is_test', r.is_test,
        'refund_pending_since', r.updated_at,
        'age_hours', round(EXTRACT(EPOCH FROM (now() - r.updated_at)) / 3600),
        'admin_disposition', r.admin_disposition,
        'action', 'Check Stripe for a refund on this PaymentIntent; if none, retry bounty-payments /admin-settle (admin disposition) or /cancel (poster).'
      ));
    v_keys := v_keys || ('refund_pending_without_stripe_refund:' || r.id::text);
    v_count := v_count + 1;
  END LOOP;

  -- Resolve open findings whose condition has cleared (refunded, released,
  -- retained, or now a known exception). The audit row stays.
  UPDATE public.reconciliation_findings f
     SET resolved_at = now(),
         resolution  = COALESCE(f.resolution, 'auto: condition cleared on ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
   WHERE f.finding_type IN ('cancelled_bounty_captured_payment', 'refund_pending_without_stripe_refund')
     AND f.resolved_at IS NULL
     AND f.finding_key IS NOT NULL
     AND NOT (f.finding_key = ANY (v_keys));

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.run_bounty_money_reconciliation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_bounty_money_reconciliation() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_bounty_money_reconciliation() TO service_role;

COMMENT ON FUNCTION public.run_bounty_money_reconciliation() IS
  'Daily: flags bounties whose status and money disagree (cancelled_bounty_captured_payment, refund_pending_without_stripe_refund). Idempotent; resolves findings whose condition cleared.';

-- ---------------------------------------------------------------------------
-- 2. Admin status change with a disposition
-- ---------------------------------------------------------------------------
-- The 3-argument form is replaced, not overloaded: PostgREST resolves RPCs by
-- argument names, and two candidates for (p_bounty_id, p_status, p_reason)
-- would make every existing call ambiguous.
DROP FUNCTION IF EXISTS public.admin_set_bounty_status(uuid, text, text);

CREATE FUNCTION public.admin_set_bounty_status(
  p_bounty_id   uuid,
  p_status      text,
  p_reason      text DEFAULT NULL::text,
  p_disposition text DEFAULT NULL::text,
  p_hunter_id   uuid DEFAULT NULL::uuid
)
RETURNS bounties
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row      public.bounties%rowtype;
  v_from     text;
  v_held     text;
  v_payment  public.bounty_payments%rowtype;
  v_admin    uuid := auth.uid();
  v_disp     jsonb;
BEGIN
  PERFORM public.admin_assert_role();

  IF p_status NOT IN ('open','in_progress','completed','archived','cancelled','cancellation_requested','deleted') THEN
    RAISE EXCEPTION 'invalid bounty status: %', p_status USING ERRCODE = '22023';
  END IF;

  IF p_disposition IS NOT NULL
     AND p_disposition NOT IN ('refund_poster', 'keep_as_platform_revenue', 'pay_out_to_hunter') THEN
    RAISE EXCEPTION 'invalid disposition: %', p_disposition USING ERRCODE = '22023';
  END IF;

  -- Lock the row so the escrow check and the update see the same state.
  SELECT * INTO v_row FROM public.bounties WHERE id = p_bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty % not found', p_bounty_id USING ERRCODE = 'P0002';
  END IF;

  v_from := v_row.status::text;

  -- Idempotent no-op: already in the requested status (double submission,
  -- stale admin list, or a race with another admin session). A disposition is
  -- never applied on this path: it would move money without a status change.
  IF v_from = p_status AND p_disposition IS NULL THEN
    RETURN v_row;
  END IF;

  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'a reason is required for an admin status change' USING ERRCODE = '22023';
  END IF;

  -- An already-cancelled bounty that still holds money (5e96aaed) can take a
  -- disposition without another status move: cancelled -> cancelled.
  IF v_from <> p_status AND NOT public.admin_bounty_status_transition_allowed(v_from, p_status) THEN
    RAISE EXCEPTION 'illegal bounty status transition: % -> %', v_from, p_status USING ERRCODE = '22023';
  END IF;

  -- Lock the payment too, so a webhook or a poster refund can't change it
  -- between this check and the disposition below.
  PERFORM 1 FROM public.bounty_payments WHERE bounty_id = p_bounty_id FOR UPDATE;
  v_payment := public.fn_bounty_stranded_captured_payment(p_bounty_id);

  IF p_disposition IS NOT NULL AND (v_payment.id IS NULL OR p_status NOT IN ('cancelled', 'archived', 'deleted')) THEN
    RAISE EXCEPTION 'a disposition applies only when ending a bounty that holds a captured payment'
      USING ERRCODE = '22023';
  END IF;

  -- Anything that ends the engagement, or puts it back on the market, must
  -- not leave money behind. Resuming (cancellation_requested -> in_progress)
  -- and starting work (open -> in_progress) keep the escrow where it is.
  IF p_status IN ('completed', 'cancelled', 'archived', 'deleted', 'open') THEN
    v_held := public.fn_bounty_unsettled_escrow_reason(p_bounty_id);

    IF v_held = 'stripe_payment_captured' AND v_payment.id IS NOT NULL
       AND p_status IN ('cancelled', 'archived', 'deleted') THEN
      IF p_disposition IS NULL THEN
        RAISE EXCEPTION 'disposition_required:stripe_payment_captured'
          USING ERRCODE = '55000',
                DETAIL  = format('bounty_payment %s holds %s captured', v_payment.id, v_payment.amount),
                HINT    = 'Pass p_disposition: refund_poster, keep_as_platform_revenue, or pay_out_to_hunter (with p_hunter_id).';
      END IF;
      -- Handled below; nothing else may be held.
    ELSIF v_held IS NOT NULL THEN
      RAISE EXCEPTION 'escrow_unsettled:%', v_held
        USING ERRCODE = '55000',
              HINT = 'Settle the money first: approve the cancellation (refunds the poster) or resolve the dispute (release or refund).';
    END IF;
  END IF;

  IF p_disposition IS NOT NULL THEN
    v_disp := jsonb_build_object(
      'disposition', p_disposition,
      'admin_id', v_admin,
      'reason', btrim(p_reason),
      'at', now(),
      'bounty_status_from', v_from,
      'bounty_status_to', p_status);

    IF p_disposition = 'refund_poster' THEN
      -- The Stripe refund itself runs in bounty-payments /admin-settle, the
      -- same code /cancel uses. Until it lands, this row is what
      -- refund_pending_without_stripe_refund watches.
      UPDATE public.bounty_payments
         SET status   = 'refund_pending',
             metadata = metadata || jsonb_build_object('admin_disposition', v_disp)
       WHERE id = v_payment.id;

    ELSIF p_disposition = 'keep_as_platform_revenue' THEN
      INSERT INTO public.platform_ledger (bounty_id, amount, fee_type, description, metadata)
      VALUES (p_bounty_id, v_payment.amount, 'retained_bounty_funds',
              'Captured bounty funds kept by the platform (admin disposition)',
              jsonb_build_object('bounty_payment_id', v_payment.id, 'admin_id', v_admin,
                                 'reason', btrim(p_reason),
                                 'stripe_charge_id', v_payment.stripe_charge_id));
      UPDATE public.bounty_payments
         SET status   = 'retained',
             metadata = metadata || jsonb_build_object('admin_disposition', v_disp)
       WHERE id = v_payment.id;

    ELSE -- pay_out_to_hunter
      IF p_hunter_id IS NULL THEN
        RAISE EXCEPTION 'pay_out_to_hunter needs p_hunter_id' USING ERRCODE = '22023';
      END IF;
      IF p_hunter_id = v_row.poster_id THEN
        RAISE EXCEPTION 'the poster cannot be paid out their own bounty' USING ERRCODE = '22023';
      END IF;
      -- Same rule as admin_apply_balance_adjustment: no admin pays themselves.
      IF p_hunter_id = v_admin THEN
        RAISE EXCEPTION 'an admin cannot pay out to their own account; use a reviewed ops script'
          USING ERRCODE = '42501';
      END IF;
      -- Only someone who was on this job: the accepted hunter, an applicant, or
      -- an applicant whose request row no longer exists but whose
      -- application.submitted event does.
      IF NOT (
           p_hunter_id IS NOT DISTINCT FROM v_row.accepted_by
        OR EXISTS (SELECT 1 FROM public.bounty_requests r
                    WHERE r.bounty_id = p_bounty_id AND r.hunter_id = p_hunter_id)
        OR EXISTS (SELECT 1 FROM public.bounty_events e
                    WHERE e.bounty_id = p_bounty_id
                      AND e.event_type = 'application.submitted'
                      AND e.actor_id = p_hunter_id)
      ) THEN
        RAISE EXCEPTION 'hunter % never applied to bounty %', p_hunter_id, p_bounty_id USING ERRCODE = '22023';
      END IF;
      -- The transfer runs in bounty-payments /admin-settle with the same
      -- idempotency key as /release. Until then the row stays captured and
      -- cancelled_bounty_captured_payment keeps reporting it.
      UPDATE public.bounty_payments
         SET hunter_id = p_hunter_id,
             metadata  = metadata || jsonb_build_object('admin_disposition', v_disp || jsonb_build_object('hunter_id', p_hunter_id))
       WHERE id = v_payment.id;
    END IF;

    INSERT INTO public.admin_action_log
      (admin_user_id, action_type, target_user_id, target_transaction_id, amount, reason, result, metadata)
    VALUES
      (v_admin, 'bounty_status_disposition', v_row.poster_id, NULL, v_payment.amount, btrim(p_reason), 'success',
       jsonb_build_object('bounty_id', p_bounty_id, 'bounty_payment_id', v_payment.id,
                          'disposition', p_disposition, 'hunter_id', p_hunter_id,
                          'from', v_from, 'to', p_status));
  END IF;

  IF v_from <> p_status THEN
    EXECUTE format('UPDATE public.bounties SET status = %L, updated_at = now() WHERE id = $1', p_status)
      USING p_bounty_id;
  END IF;

  IF to_regprocedure(
       'public.record_bounty_event(text,text,text,uuid,uuid,timestamptz,numeric,text,jsonb)'
     ) IS NOT NULL THEN
    PERFORM public.record_bounty_event(
      'admin.status_changed:' || p_bounty_id::text || ':'
        || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
      'admin.status_changed', 'system', p_bounty_id, v_admin, now(), v_payment.amount, NULL,
      jsonb_build_object('from', v_from, 'to', p_status, 'reason', btrim(p_reason),
                         'disposition', p_disposition, 'bounty_payment_id', v_payment.id));
  END IF;

  SELECT * INTO v_row FROM public.bounties WHERE id = p_bounty_id;
  RETURN v_row;
END;
$$;

-- Same grants as before: callable by signed-in users, gated by admin_assert_role().
REVOKE ALL ON FUNCTION public.admin_set_bounty_status(uuid, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_bounty_status(uuid, text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_bounty_status(uuid, text, text, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Schedule
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron is not enabled — bounty-money-reconciliation-daily was NOT scheduled.';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bounty-money-reconciliation-daily';
  PERFORM cron.schedule(
    'bounty-money-reconciliation-daily',
    '5 9 * * *',
    'SELECT public.run_bounty_money_reconciliation();'
  );
END $$;

COMMIT;
