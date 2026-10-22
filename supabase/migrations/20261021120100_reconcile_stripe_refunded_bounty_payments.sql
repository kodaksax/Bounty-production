-- Reconcile v2 bounty_payments that Stripe refunded but Bounty never marked.
--
-- Why rows are stuck. The webhooks function pins apiVersion 2023-10-16, under
-- which `charge.refunded` payloads carry no `refunds` list. The handler read
-- `charge.refunds?.data ?? []`, so every v2 refund was written as
-- `refund_pending` with no refund id and never advanced. The handler is fixed
-- in the same change (supabase/functions/_shared/refund-reflection.ts), but
-- these events were already processed and Stripe will not resend them.
--
-- Production on 2026-10-21 (stripe_events evidence, read-only):
--   4 external rows, $61, refund_pending since 2026-09-03..05: Stripe says
--     refunded = true, amount_refunded = the full amount, refund succeeded.
--   2 internal-test rows, $20 (one refund_pending, one still `captured`).
-- Posters with these rows are shown "Refund on its way" for a refund their
-- bank received seven weeks ago.
--
-- What this adds, and nothing runs by itself:
--   admin_reconcile_stripe_refunded_bounty_payments(p_dry_run DEFAULT true)
--     Lists every captured / refund_pending row with stored refund-event proof
--     that currently succeeded refunds cover the full amount and, only with
--     p_dry_run => false, marks it `refunded`. For each refund id, only its
--     latest lifecycle event counts; a later failed/updated event invalidates
--     earlier succeeded evidence. charge.refunded snapshots alone are not proof.
--   admin_revert_stripe_refund_reconciliation()
--     Puts every row this reconciled back exactly as it was (status and
--     stripe_refund_id), using what the apply recorded in metadata.
-- Both are SECURITY DEFINER and executable by service_role only.
--
-- No money moves: this only records what Stripe already did. The status
-- change fires the existing triggers (settlement_state derive, the
-- bounty_events ledger, thread-event touch, which posts nothing new).
--
-- Runbook:
--   SELECT * FROM public.admin_reconcile_stripe_refunded_bounty_payments();        -- dry run; verify each row against Stripe
--   SELECT * FROM public.admin_reconcile_stripe_refunded_bounty_payments(false);   -- apply (needs a go)
--   SELECT public.admin_revert_stripe_refund_reconciliation();                     -- undo
-- Rollback (drops both functions; revert first if applied):
--   supabase/rollbacks/production/20261021120100_reconcile_stripe_refunded_bounty_payments.down.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_reconcile_stripe_refunded_bounty_payments(p_dry_run boolean DEFAULT true)
RETURNS TABLE(
  bounty_payment_id uuid,
  bounty_id         uuid,
  from_status       text,
  amount            numeric,
  refunded_cents    bigint,
  stripe_refund_id  text,
  applied           boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH refund_lifecycle AS (
    SELECT e.event_data->>'payment_intent' AS payment_intent_id,
           e.event_data->>'id' AS refund_id,
           e.event_data->>'amount' AS amount_cents,
           e.created_at AS lifecycle_at,
           CASE WHEN e.event_type = 'refund.failed' THEN 'failed'
                ELSE e.event_data->>'status' END AS status,
           row_number() OVER (
             PARTITION BY e.event_data->>'payment_intent', e.event_data->>'id'
             ORDER BY e.created_at DESC, e.id DESC
           ) AS lifecycle_rank
      FROM public.stripe_events e
     WHERE e.event_type IN ('refund.created', 'refund.updated', 'refund.failed')
       AND e.event_data->>'payment_intent' IS NOT NULL
       AND e.event_data->>'id' IS NOT NULL
  ),
  succeeded_refunds AS (
    SELECT payment_intent_id,
           sum((amount_cents)::bigint)::bigint AS succeeded_cents,
           (array_agg(refund_id ORDER BY lifecycle_at DESC, refund_id DESC))[1] AS proven_refund_id
      FROM refund_lifecycle
     WHERE lifecycle_rank = 1
       AND status = 'succeeded'
       AND amount_cents ~ '^[0-9]+$'
     GROUP BY payment_intent_id
  ),
  evidence AS (
    SELECT bp.id,
           bp.bounty_id,
           bp.status AS from_status,
           bp.amount,
           bp.stripe_refund_id AS refund_id_was,
           sr.succeeded_cents,
           sr.proven_refund_id
      FROM public.bounty_payments bp
      JOIN succeeded_refunds sr
        ON sr.payment_intent_id = bp.stripe_payment_intent_id
     WHERE bp.status IN ('captured', 'refund_pending')
       AND bp.stripe_payment_intent_id IS NOT NULL
  ),
  candidates AS (
    SELECT ev.*, COALESCE(ev.proven_refund_id, ev.refund_id_was) AS refund_id
      FROM evidence ev
     WHERE ev.succeeded_cents >= round(ev.amount * 100)
  ),
  upd AS (
    UPDATE public.bounty_payments bp
       SET status = 'refunded',
           stripe_refund_id = c.refund_id,
           metadata = COALESCE(bp.metadata, '{}'::jsonb) || jsonb_build_object(
             'refund_reconciled_by', 'admin_reconcile_stripe_refunded_bounty_payments',
             'refund_reconciled_at', now(),
             'refund_reconciled_from', c.from_status,
             'refund_reconciled_refund_id_was', c.refund_id_was,
             'refund_reconciled_metadata_was_null', bp.metadata IS NULL
           )
      FROM candidates c
     WHERE NOT p_dry_run
       AND bp.id = c.id
       AND bp.status = c.from_status
    RETURNING bp.id
  )
  SELECT c.id, c.bounty_id, c.from_status, c.amount, c.succeeded_cents, c.refund_id,
         EXISTS (SELECT 1 FROM upd WHERE upd.id = c.id)
    FROM candidates c
   ORDER BY c.from_status, c.id;
END;
$$;

COMMENT ON FUNCTION public.admin_reconcile_stripe_refunded_bounty_payments(boolean) IS
  'Marks captured/refund_pending bounty_payments refunded only when latest stored refund lifecycle events prove succeeded refunds cover the full amount. p_dry_run=true (default) writes nothing. Undo: admin_revert_stripe_refund_reconciliation(). Service role only.';

CREATE OR REPLACE FUNCTION public.admin_revert_stripe_refund_reconciliation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.bounty_payments bp
     SET status = bp.metadata->>'refund_reconciled_from',
         stripe_refund_id = bp.metadata->>'refund_reconciled_refund_id_was',
         metadata = CASE
           WHEN (bp.metadata->>'refund_reconciled_metadata_was_null')::boolean THEN NULL
           ELSE bp.metadata - 'refund_reconciled_by' - 'refund_reconciled_at' - 'refund_reconciled_from'
                            - 'refund_reconciled_refund_id_was' - 'refund_reconciled_metadata_was_null'
         END
   WHERE bp.metadata->>'refund_reconciled_by' = 'admin_reconcile_stripe_refunded_bounty_payments'
     AND bp.status = 'refunded';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.admin_revert_stripe_refund_reconciliation() IS
  'Undoes admin_reconcile_stripe_refunded_bounty_payments(false): restores each reconciled row''s status and stripe_refund_id. Service role only.';

REVOKE ALL ON FUNCTION public.admin_reconcile_stripe_refunded_bounty_payments(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_revert_stripe_refund_reconciliation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_stripe_refunded_bounty_payments(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_revert_stripe_refund_reconciliation() TO service_role;

COMMIT;
