-- =====================================================================
-- Phase 4 — turn a silent `critical` finding into a real page.
--
-- Before this, a critical reconciliation finding did exactly two things:
-- insert a row into reconciliation_findings, and (for the Edge Function half)
-- print `[reconciliation-alert][CRITICAL]` to a log. The function's own
-- comment describes that prefix as "the searchable key" — searchable, not
-- routed. Somebody has to already suspect a problem to find it.
--
-- 953 findings have accumulated that way, including a hunter who was paid $38
-- in cash outside the app because a payout never landed.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_alert_on_critical_finding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipients uuid[];
  v_subject    text;
BEGIN
  -- Coalesce per finding_type per hour. The sweep re-detects the same backlog
  -- on every run; the first scheduled run alone would otherwise page 28 times.
  IF EXISTS (
    SELECT 1 FROM public.reconciliation_alerts_sent
    WHERE finding_type = NEW.finding_type
      AND sent_at > now() - INTERVAL '1 hour'
  ) THEN
    RETURN NULL;
  END IF;

  v_recipients := public.fn_admin_recipient_ids();

  IF array_length(v_recipients, 1) IS NULL THEN
    -- Loud, because the alternative is an alerting system that reports success
    -- while addressing nobody — the exact failure this migration set exists to
    -- prevent, reproduced one level up.
    RAISE WARNING
      'fn_alert_on_critical_finding: critical finding % has NO admin recipient; nobody was paged',
      NEW.finding_type;
    RETURN NULL;
  END IF;

  v_subject := COALESCE(
    NEW.details->>'transaction_id',
    NEW.details->>'payout_id',
    NEW.user_id::text,
    'see finding details'
  );

  INSERT INTO public.notifications_outbox (recipients, title, body, data)
  VALUES (
    to_jsonb(v_recipients),
    'Critical reconciliation finding',
    NEW.finding_type || ' — ' || v_subject,
    jsonb_build_object(
      -- `type` (not `kind`) is what process-notification reads, and it must be
      -- a registered type or it falls back to the marketplace category, which
      -- is user-disableable and quiet-hours suppressed. See migration
      -- 20260824020000.
      'type',         'reconciliation_alert',
      'finding_id',   NEW.id,
      'finding_type', NEW.finding_type,
      'severity',     NEW.severity,
      'details',      NEW.details
    )
  );

  INSERT INTO public.reconciliation_alerts_sent (finding_type, finding_id)
  VALUES (NEW.finding_type, NEW.id);

  RETURN NULL;

EXCEPTION WHEN OTHERS THEN
  -- An alerting failure must NEVER roll back the finding itself. A finding
  -- that vanishes is worse than one that arrives quietly: the reconciliation
  -- Edge Function already had a bug where every findings insert failed a CHECK
  -- constraint and the error was logged and swallowed, so the job reported
  -- healthy counts while writing nothing for weeks. Fail open, warn loudly.
  RAISE WARNING 'fn_alert_on_critical_finding failed for finding %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.fn_alert_on_critical_finding IS
  'AFTER INSERT on reconciliation_findings WHERE severity = critical. Enqueues an operator page via notifications_outbox (in-app + push, drained every minute). Coalesced per finding_type per hour. Fails open — never rolls back the finding.';

-- WHEN (...) is evaluated by Postgres, so the ~940 non-critical findings never
-- enter the function at all.
DROP TRIGGER IF EXISTS trg_reconciliation_findings_critical_alert ON public.reconciliation_findings;
CREATE TRIGGER trg_reconciliation_findings_critical_alert
  AFTER INSERT ON public.reconciliation_findings
  FOR EACH ROW
  WHEN (NEW.severity = 'critical')
  EXECUTE FUNCTION public.fn_alert_on_critical_finding();

-- ─── Suppress the known backlog exactly once ────────────────────────────────
-- Every currently-open critical finding is already known, documented in
-- docs/payment-architecture-audit.md, and scheduled for human decision in
-- Phase 5. Seeding reconciliation_alerts_sent with those types means the first
-- run of the newly-scheduled sweep pages only for something NEW.
--
-- Deliberately NOT a blanket "suppress everything for an hour": each type is
-- recorded individually, so a type absent from today's backlog still pages
-- immediately the first time it appears.
INSERT INTO public.reconciliation_alerts_sent (finding_type, finding_id, sent_at)
SELECT DISTINCT f.finding_type, NULL::uuid, now()
FROM public.reconciliation_findings f
WHERE f.severity = 'critical'
  AND f.acknowledged_at IS NULL
ON CONFLICT DO NOTHING;
