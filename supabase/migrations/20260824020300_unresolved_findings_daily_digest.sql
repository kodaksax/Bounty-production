-- =====================================================================
-- Phase 4 — the digest, for everything that is not critical.
--
-- 940 findings are open at warning/info severity: 416 platform_balance_drift
-- and 524 connect_account_balance_drift. Promoting them to critical was
-- considered and rejected at review: balance drift routinely reflects ordinary
-- Stripe settlement-timing lag, so paging on it would reproduce the
-- alert-fatigue failure at thirty times the scale of the backlog problem.
--
-- The distinction that makes this a signal rather than a second firehose is
-- AGE, not severity:
--
--     a drift that clears on its own is noise; one that persists is the finding.
--
-- So: nothing under 48 hours old is ever mentioned.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_digest_unresolved_findings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows       jsonb;
  v_total      bigint;
  v_recipients uuid[];
BEGIN
  SELECT jsonb_agg(t ORDER BY t.n DESC), COALESCE(sum(t.n), 0)
  INTO v_rows, v_total
  FROM (
    SELECT
      finding_type,
      severity,
      count(*)     AS n,
      min(run_at)  AS oldest
    FROM public.reconciliation_findings
    WHERE acknowledged_at IS NULL
      AND severity IN ('warning', 'info')
      AND run_at < now() - INTERVAL '48 hours'
    GROUP BY finding_type, severity
  ) t;

  -- Silence is the healthy state. A digest that arrives every day regardless
  -- of content trains its recipients to delete it unread, at which point the
  -- day it matters is the day it is ignored.
  IF COALESCE(v_total, 0) = 0 THEN
    RETURN;
  END IF;

  v_recipients := public.fn_admin_recipient_ids();
  IF array_length(v_recipients, 1) IS NULL THEN
    RAISE WARNING 'fn_digest_unresolved_findings: no admin recipient; digest not sent';
    RETURN;
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data)
  VALUES (
    to_jsonb(v_recipients),
    'Reconciliation digest',
    v_total || ' unresolved findings older than 48h',
    jsonb_build_object(
      'type',      'reconciliation_alert',
      'digest',    true,
      'total',     v_total,
      'breakdown', v_rows
    )
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_digest_unresolved_findings failed: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.fn_digest_unresolved_findings IS
  'Daily roll-up of warning/info reconciliation findings unresolved for more than 48h. Sends nothing when there is nothing to say. Critical findings do not appear here — they page in real time via fn_alert_on_critical_finding().';

REVOKE ALL ON FUNCTION public.fn_digest_unresolved_findings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_digest_unresolved_findings() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_digest_unresolved_findings() TO service_role;

-- 09:45 UTC: after withdrawal-reconciliation-daily (09:00) and after the
-- invariant sweep scheduled at 09:30 by the next migration, so the digest
-- reflects the same morning's findings rather than yesterday's.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reconciliation-findings-digest';
    PERFORM cron.schedule(
      'reconciliation-findings-digest',
      '45 9 * * *',
      $cron$SELECT public.fn_digest_unresolved_findings();$cron$
    );
  ELSE
    RAISE WARNING 'pg_cron not enabled — fn_digest_unresolved_findings() created but NOT scheduled.';
  END IF;
END $$;
