-- =====================================================================
-- Reconciliation findings: give a finding a stable identity.
--
-- THE FINDING (2026-09-01)
-- The Daily Brief reported "288 critical financial mismatches" for 08-31,
-- broken down as 192 orphan_stripe_payout + 96
-- completed_withdrawal_without_payout_total, and described the backlog as
-- climbing from ~22/day on 08-28 to ~288/day on 08-30/31.
--
-- None of that was a financial trend. Verified against production:
--
--   SELECT count(*), count(DISTINCT details->>'payoutId'), count(DISTINCT run_at)
--   FROM reconciliation_findings
--   WHERE run_at >= '2026-08-31' AND run_at < '2026-09-01'
--     AND finding_type = 'orphan_stripe_payout';
--   -- 192 rows, 2 distinct payouts, 96 distinct runs
--
-- The `reconciliation` Edge Function writes findings with a plain INSERT, and
-- cron job `stripe-payout-reconciliation-15min` invokes it every 15 minutes:
-- 96 runs/day x 2 unresolved payouts = 192, and 96 runs x 1 invariant rollup
-- = 96. Total 288. The underlying issue count was THREE, and it was flat.
--
-- The 08-28 -> 08-31 "climb" is the same artifact: the 15-minute job did not
-- exist for the whole of 08-28 (22 runs that day, 96 on each full day after).
-- The backlog counter was measuring the cron schedule, not the system.
--
-- WHY THIS MATTERS BEYOND TIDINESS
-- A number that inflates with observation frequency cannot be used to decide
-- anything. It hides real movement (three new orphans would have been lost
-- inside the noise of 288) and it trains operators to ignore the critical
-- channel. Deduplication here is what makes the count mean "open problems".
--
-- WHAT THIS MIGRATION DOES NOT DO
-- It touches no financial record. wallet_transactions, profiles and balances
-- are untouched. Superseded duplicate OBSERVATIONS are not deleted — they are
-- marked resolved with an explicit resolution string so the history of what
-- was observed when remains fully auditable and reversible.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Identity, first/last seen, and how many times it has been observed.
-- ---------------------------------------------------------------------
ALTER TABLE public.reconciliation_findings
  ADD COLUMN IF NOT EXISTS finding_key      text,
  ADD COLUMN IF NOT EXISTS first_seen_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at     timestamptz,
  ADD COLUMN IF NOT EXISTS occurrence_count integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.reconciliation_findings.finding_key IS
  'Stable identity of the underlying problem: finding_type + durable subject (payout id, transaction id, account id) — never anything that varies per run. Mirrors buildFindingKey()/findingSubject() in supabase/functions/reconciliation/reconciliation-logic.ts.';
COMMENT ON COLUMN reconciliation_findings.occurrence_count IS
  'How many reconciliation runs have observed this same problem. Growth here means the problem persists, NOT that new problems appeared.';
COMMENT ON COLUMN public.reconciliation_findings.last_seen_at IS
  'Most recent run that still observed this problem. A finding whose last_seen_at has stopped advancing has stopped reproducing and is a candidate for resolution.';

-- ---------------------------------------------------------------------
-- 2. Derive the identity for rows that already exist.
--
-- Kept in one SQL function so the rule has a single definition on the DB side
-- and can be re-applied if new historical rows are ever imported.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reconciliation_finding_key(
  p_finding_type text,
  p_details      jsonb,
  p_user_id      uuid DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
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
      -- Rollups describe a set, not a row: one open rollup per type is correct.
      WHEN 'completed_withdrawal_without_payout_total' THEN p_finding_type
      WHEN 'completed_withdrawal_without_payout_grandfathered' THEN p_finding_type
      WHEN 'invariant_sweep_failed'      THEN p_finding_type
      WHEN 'platform_balance_drift'      THEN p_finding_type
      ELSE NULL
    END AS subject
  ) s;
$$;

COMMENT ON FUNCTION public.fn_reconciliation_finding_key(text, jsonb, uuid) IS
  'Stable identity for a reconciliation finding. Must stay in sync with findingSubject()/buildFindingKey() in supabase/functions/reconciliation/reconciliation-logic.ts.';

UPDATE public.reconciliation_findings
SET finding_key   = public.fn_reconciliation_finding_key(finding_type, details, user_id),
    first_seen_at = COALESCE(first_seen_at, run_at),
    last_seen_at  = COALESCE(last_seen_at, run_at)
WHERE finding_key IS NULL;

-- ---------------------------------------------------------------------
-- 3. Collapse the existing duplicate observations.
--
-- For each identity, the EARLIEST open row survives and becomes the canonical
-- finding: it carries first_seen_at from its own run, last_seen_at from the
-- most recent observation, and occurrence_count = how many runs saw it.
--
-- Every other row is marked resolved with an explicit resolution string.
-- Nothing is deleted. This is an observation log, not a financial ledger, and
-- the superseded rows remain queryable for audit:
--   SELECT * FROM reconciliation_findings
--   WHERE resolution = 'superseded_by_dedupe_20260901';
-- ---------------------------------------------------------------------
WITH ranked AS (
  SELECT id,
         finding_key,
         run_at,
         row_number() OVER (PARTITION BY finding_key ORDER BY run_at ASC, id ASC) AS rn,
         count(*)     OVER (PARTITION BY finding_key) AS total,
         min(run_at)  OVER (PARTITION BY finding_key) AS earliest,
         max(run_at)  OVER (PARTITION BY finding_key) AS latest
  FROM public.reconciliation_findings
  WHERE resolved_at IS NULL
    AND finding_key IS NOT NULL
)
UPDATE public.reconciliation_findings f
SET first_seen_at    = r.earliest,
    last_seen_at     = r.latest,
    occurrence_count = r.total
FROM ranked r
WHERE f.id = r.id
  AND r.rn = 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY finding_key ORDER BY run_at ASC, id ASC) AS rn
  FROM public.reconciliation_findings
  WHERE resolved_at IS NULL
    AND finding_key IS NOT NULL
)
UPDATE public.reconciliation_findings f
SET resolved_at = now(),
    resolution  = 'superseded_by_dedupe_20260901'
FROM ranked r
WHERE f.id = r.id
  AND r.rn > 1;

-- ---------------------------------------------------------------------
-- 4. Enforce one open finding per identity from here on.
--
-- Partial: a finding that is resolved and then genuinely recurs must be able
-- to insert again (and re-fire the critical alert trigger, which is
-- AFTER INSERT only). Recurrence after resolution is real news; re-observing
-- an already-open problem is not.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciliation_findings_open_key
  ON public.reconciliation_findings (finding_key)
  WHERE resolved_at IS NULL AND finding_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_open_lastseen
  ON public.reconciliation_findings (last_seen_at DESC)
  WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------
-- 5. The idempotent write path.
--
-- The Edge Function calls this instead of INSERT. On a repeat observation it
-- UPDATEs, which deliberately does NOT fire trg_reconciliation_findings_critical_alert
-- (AFTER INSERT only) — an operator should be paged when a problem appears,
-- not every 15 minutes while it remains open.
--
-- `details` is refreshed on repeat so age/count fields stay current, but
-- first_seen_at is never moved: how long a problem has been open is the single
-- most useful thing about it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_reconciliation_finding(
  p_finding_type text,
  p_severity     text,
  p_user_id      uuid,
  p_details      jsonb,
  p_auto_repaired boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text := public.fn_reconciliation_finding_key(p_finding_type, p_details, p_user_id);
  v_id  uuid;
BEGIN
  -- No durable subject: fall back to a plain insert rather than collapse
  -- unrelated findings onto one another. Silent over-merging of distinct
  -- problems would be a worse failure than duplication.
  IF v_key IS NULL THEN
    INSERT INTO public.reconciliation_findings
      (finding_type, severity, user_id, details, auto_repaired, first_seen_at, last_seen_at)
    VALUES (p_finding_type, lower(p_severity), p_user_id, p_details, p_auto_repaired, now(), now())
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.reconciliation_findings
    (finding_type, severity, user_id, details, auto_repaired,
     finding_key, first_seen_at, last_seen_at, occurrence_count)
  VALUES
    (p_finding_type, lower(p_severity), p_user_id, p_details, p_auto_repaired,
     v_key, now(), now(), 1)
  ON CONFLICT (finding_key) WHERE resolved_at IS NULL AND finding_key IS NOT NULL DO UPDATE
    SET last_seen_at     = now(),
        occurrence_count = reconciliation_findings.occurrence_count + 1,
        details          = EXCLUDED.details,
        -- Severity may legitimately escalate as a problem ages (a stale
        -- pending withdrawal crossing 72h). It must never silently de-escalate.
        severity         = CASE
          WHEN EXCLUDED.severity = 'critical' THEN 'critical'
          WHEN reconciliation_findings.severity = 'critical' THEN 'critical'
          WHEN EXCLUDED.severity = 'warning' OR reconciliation_findings.severity = 'warning' THEN 'warning'
          ELSE EXCLUDED.severity
        END
    RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_reconciliation_finding(text, text, uuid, jsonb, boolean) IS
  'Idempotent finding recorder. One open row per underlying problem; repeat observations bump occurrence_count/last_seen_at instead of appending. Severity ratchets up, never down.';

REVOKE ALL ON FUNCTION public.record_reconciliation_finding(text, text, uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_reconciliation_finding(text, text, uuid, jsonb, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_reconciliation_finding(text, text, uuid, jsonb, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.fn_reconciliation_finding_key(text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reconciliation_finding_key(text, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_reconciliation_finding_key(text, jsonb, uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 6. The honest open-backlog view.
--
-- Anything reporting "how many financial mismatches are open" must read this,
-- not count(*) on the table.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.reconciliation_open_findings AS
SELECT id,
       finding_key,
       finding_type,
       severity,
       user_id,
       details,
       first_seen_at,
       last_seen_at,
       occurrence_count,
       acknowledged_at,
       auto_repaired
FROM public.reconciliation_findings
WHERE resolved_at IS NULL;

COMMENT ON VIEW public.reconciliation_open_findings IS
  'One row per OPEN underlying problem. Use this for backlog counts. Counting reconciliation_findings directly counts observations, which scale with cron frequency — that is what produced the false "288 mismatches" figure on 2026-08-31.';

REVOKE ALL ON public.reconciliation_open_findings FROM PUBLIC;
REVOKE ALL ON public.reconciliation_open_findings FROM anon;
GRANT SELECT ON public.reconciliation_open_findings TO service_role;

-- ---------------------------------------------------------------------
-- Batch recorder.
--
-- The edge function used to call record_reconciliation_finding() once per
-- finding. A run that surfaces a real backlog produces tens of findings, so
-- that was tens of sequential PostgREST round-trips inside a function that
-- already has a 55s cron timeout — the cost grew with exactly the thing the
-- sweep exists to detect, and a slow run risked timing out before the report
-- was written.
--
-- This records the whole set in one call.
--
-- RESILIENCE: each element is applied in its own subtransaction (the EXCEPTION
-- block creates one) so a single malformed finding cannot roll back the rest.
-- The previous per-call loop had that property for free and it matters here:
-- findings that vanish are worse than a run that did not happen, because the
-- result looks like a clean pass. Failures are returned to the caller rather
-- than raised, so it can log them the same way it logged per-call errors.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_reconciliation_findings(p_findings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_element jsonb;
  v_recorded integer := 0;
  v_errors   jsonb := '[]'::jsonb;
BEGIN
  IF p_findings IS NULL OR jsonb_typeof(p_findings) <> 'array' THEN
    RAISE EXCEPTION 'record_reconciliation_findings expects a JSON array, got %',
      COALESCE(jsonb_typeof(p_findings), 'null');
  END IF;

  -- `value` is named explicitly: FOR-over-query binds into the scalar v_element
  -- only while the query yields exactly one column, and `SELECT *` leaves that
  -- dependent on the set-returning function's shape rather than stating it.
  FOR v_element IN SELECT value FROM jsonb_array_elements(p_findings)
  LOOP
    BEGIN
      PERFORM public.record_reconciliation_finding(
        v_element->>'finding_type',
        v_element->>'severity',
        NULLIF(v_element->>'user_id', '')::uuid,
        COALESCE(v_element->'details', '{}'::jsonb),
        COALESCE((v_element->>'auto_repaired')::boolean, false)
      );
      v_recorded := v_recorded + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'finding_type', v_element->>'finding_type',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('recorded', v_recorded, 'errors', v_errors);
END;
$$;

COMMENT ON FUNCTION public.record_reconciliation_findings(jsonb) IS
  'Batch form of record_reconciliation_finding: records an array of findings in ONE round trip. Each element is applied in its own subtransaction, so one bad finding cannot discard the rest; per-element failures come back in the returned errors array instead of raising.';

REVOKE ALL ON FUNCTION public.record_reconciliation_findings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_reconciliation_findings(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_reconciliation_findings(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_reconciliation_findings(jsonb) TO service_role;
