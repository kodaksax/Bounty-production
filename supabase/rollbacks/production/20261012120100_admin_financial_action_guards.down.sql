-- Rollback for 20261012120100_admin_financial_action_guards.sql
-- Restores the production definitions captured on 2026-10-12.
--
-- Deliberately NOT restored: wallet_transactions_type_check. Re-adding it
-- would make admin_adjustment rows (the enum allows them) fail again and, if
-- any adjustment was recorded meanwhile, the ADD CONSTRAINT itself would fail.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_apply_balance_adjustment(uuid, uuid, numeric, text, text, uuid);
DROP INDEX IF EXISTS public.idx_wallet_tx_admin_adjustment_idempotency;

CREATE OR REPLACE FUNCTION public.admin_set_bounty_status(p_bounty_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS bounties
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row  public.bounties%rowtype;
  v_from text;
BEGIN
  PERFORM public.admin_assert_role();

  IF p_status NOT IN ('open','in_progress','completed','archived','cancelled','cancellation_requested','deleted') THEN
    RAISE EXCEPTION 'invalid bounty status: %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty % not found', p_bounty_id USING ERRCODE = 'P0002';
  END IF;

  v_from := v_row.status::text;

  IF v_from = p_status THEN
    RETURN v_row;
  END IF;

  IF NOT public.admin_bounty_status_transition_allowed(v_from, p_status) THEN
    RAISE EXCEPTION 'illegal bounty status transition: % -> %', v_from, p_status USING ERRCODE = '22023';
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
      jsonb_build_object('from', v_from, 'to', p_status, 'reason', p_reason));
  END IF;

  SELECT * INTO v_row FROM public.bounties WHERE id = p_bounty_id;
  RETURN v_row;
END;
$function$;

DROP FUNCTION IF EXISTS public.fn_bounty_unsettled_escrow_reason(uuid);

COMMIT;
