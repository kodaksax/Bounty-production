-- Phase 8: persisted reconciliation reports + 15-minute scheduled run.
--
-- Complements the existing per-issue public.reconciliation_findings table:
-- findings answer "what is wrong with this specific payout", reports answer
-- "was the system as a whole in sync at 14:15". Both are needed — a finding
-- that appears and disappears between runs is invisible without the run-level
-- record, and that is exactly the shape of a stuck-then-settled withdrawal.
--
-- Reports are descriptive only. Nothing in this system is authoritative over
-- Stripe, and nothing here repairs money; see docs/payments/RECONCILIATION.md.

CREATE TABLE IF NOT EXISTS public.reconciliation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),

  -- Wall-clock duration, for spotting a job that is degrading before it
  -- starts timing out and silently stops covering the window.
  duration_ms integer,

  -- Counts. Deliberately plain integers rather than a jsonb blob so health
  -- queries and alert thresholds can be expressed in SQL.
  reconciled integer NOT NULL DEFAULT 0,
  mismatched integer NOT NULL DEFAULT 0,
  orphan_stripe integer NOT NULL DEFAULT 0,
  orphan_ledger integer NOT NULL DEFAULT 0,
  stale_pending integer NOT NULL DEFAULT 0,

  -- Money, in cents, over the reconciliation window.
  total_stripe_amount_cents bigint NOT NULL DEFAULT 0,
  total_ledger_amount_cents bigint NOT NULL DEFAULT 0,
  -- stripe - ledger. Non-zero is a finding, never something to "correct".
  delta_cents bigint NOT NULL DEFAULT 0,

  -- GREEN | YELLOW | RED, computed by the job from the counts above.
  health text NOT NULL DEFAULT 'GREEN',

  -- Repairs the run judged provably safe and applied (e.g. Stripe says paid,
  -- ledger still said pending). Never includes anything that moves money.
  safe_repairs integer NOT NULL DEFAULT 0,

  -- Full unreconciled[] detail for the run.
  unreconciled jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Populated when the run itself failed. A report row is written even then,
  -- so a crashing job is visible as data rather than as an absence of data.
  error text,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reconciliation_reports IS
  'Run-level reconciliation snapshots (Phase 8). Descriptive only — never authoritative over Stripe.';
COMMENT ON COLUMN public.reconciliation_reports.delta_cents IS
  'stripe_total - ledger_total. Non-zero is a finding to surface, never a number to auto-correct.';
COMMENT ON COLUMN public.reconciliation_reports.error IS
  'Set when the run failed. A row is written on failure so a dead job is visible as data, not silence.';

CREATE INDEX IF NOT EXISTS idx_reconciliation_reports_run_at
  ON public.reconciliation_reports (run_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_reports_health
  ON public.reconciliation_reports (health, run_at DESC)
  WHERE health <> 'GREEN';

ALTER TABLE public.reconciliation_reports ENABLE ROW LEVEL SECURITY;

-- Admin-only. These reports aggregate across all users, so there is no
-- per-user read policy. Role comes from the JWT app_metadata: profiles.role
-- is unpopulated in production and would match nobody.
DROP POLICY IF EXISTS "Admins read reconciliation reports" ON public.reconciliation_reports;
CREATE POLICY "Admins read reconciliation reports"
  ON public.reconciliation_reports
  FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Supabase auto-grants to anon/authenticated on new tables; REVOKE FROM PUBLIC
-- alone does not remove those, so revoke explicitly before granting back.
REVOKE ALL ON public.reconciliation_reports FROM PUBLIC;
REVOKE ALL ON public.reconciliation_reports FROM anon;
REVOKE ALL ON public.reconciliation_reports FROM authenticated;
GRANT SELECT ON public.reconciliation_reports TO authenticated;
GRANT ALL ON public.reconciliation_reports TO service_role;

-- ---------------------------------------------------------------------------
-- 15-minute reconciliation run
-- ---------------------------------------------------------------------------
-- Mirrors the existing stripe-balance-reconciliation-hourly job's invocation
-- pattern (vault-held base URL + cron secret via net.http_post) so there is
-- one way to schedule an edge function in this project, not two.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payout-reconciliation-15min') THEN
    PERFORM cron.unschedule('payout-reconciliation-15min');
  END IF;
END;
$$;

SELECT cron.schedule(
  'payout-reconciliation-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_base_url') || '/reconciliation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reconciliation_cron_secret'), '')
    ),
    body := jsonb_build_object('action', 'run'),
    timeout_milliseconds := 55000
  );
  $$
);
