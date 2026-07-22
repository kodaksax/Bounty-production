-- Migration: Stripe <-> wallet balance reconciliation infrastructure
-- Created: 2026-07-21
-- Purpose:
--   20260721_add_scheduled_reconciliation.sql's daily run_withdrawal_reconciliation()
--   is DB-internal only (profiles.balance vs SUM(wallet_transactions)) — it
--   never calls the Stripe API, so it cannot catch manual Stripe Dashboard
--   payouts/adjustments, silently-failed webhook deliveries, or any drift
--   between what Stripe actually holds and what the ledger believes. This
--   migration adds the storage + scheduling for a real Stripe-vs-ledger
--   comparison, run both on-demand (admin-withdrawals action
--   'run_stripe_balance_sync') and via a new hourly pg_cron job. The actual
--   Stripe API calls and comparison logic live in the admin-withdrawals /
--   webhooks Edge Functions (Postgres cannot call the Stripe API directly);
--   this migration only adds: (1) extra columns on reconciliation_findings to
--   record repair outcomes, (2) a new stripe_balance_snapshots table for
--   point-in-time history/observability, (3) pg_net + a Vault-secret-driven
--   pg_cron job that invokes the Edge Function hourly.
--
--   Read/insert-only against wallet_transactions/profiles from this
--   migration's own SQL — the actual balance repairs it triggers (via HTTP,
--   not from this file) reuse the existing update_balance()/apply_refund()
--   RPCs, which already enforce the app.bypass_profile_guard contract. Safe
--   to enable live.
--
--   ⚠ Deliberately NOT included here: the actual secret *values* the cron
--   job's net.http_post() call depends on (edge_function_base_url,
--   reconciliation_cron_secret) — those must never be committed to git. They
--   are inserted separately via vault.create_secret(...) run directly against
--   the project (execute_sql, not this migration) as a post-deploy step. See
--   docs/withdrawals/15-stripe-balance-sync.md for the exact commands. Until
--   those secrets exist, the scheduled job's HTTP call will send a null/
--   mismatched Authorization header and the Edge Function will reject it
--   (fails closed — no-op, not a security hole).

-- ─── 0. Widen admin_action_log.action_type ───────────────────────────────────
-- Adds the two new admin-withdrawals actions this migration's Edge Function
-- changes introduce: an admin manually triggering the Stripe balance sweep,
-- and an admin acknowledging a reconciliation_findings row. Same
-- DROP/ADD CONSTRAINT approach as this table's prior widenings — unlike
-- wallet_transactions.type, action_type really is a plain CHECK constraint
-- live (confirmed alongside the audit for this change), not a drifted enum.
ALTER TABLE public.admin_action_log DROP CONSTRAINT IF EXISTS admin_action_log_action_type_check;
ALTER TABLE public.admin_action_log ADD CONSTRAINT admin_action_log_action_type_check
  CHECK (action_type IN (
    'force_retry_withdrawal',
    'manual_balance_adjustment',
    'mark_externally_settled_withdrawal',
    'reverse_stripe_transfer',
    'run_stripe_balance_sync',
    'acknowledge_reconciliation_finding'
  ));

-- ─── 1. Extend reconciliation_findings for repair tracking ──────────────────
ALTER TABLE public.reconciliation_findings
  ADD COLUMN IF NOT EXISTS resolution TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID,
  ADD COLUMN IF NOT EXISTS auto_repaired BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS repair_wallet_transaction_id UUID REFERENCES public.wallet_transactions(id);

COMMENT ON COLUMN public.reconciliation_findings.auto_repaired IS
  'True only when the finding was resolved by replaying a missed webhook''s own idempotent effect (see attemptRecoverableRepair in admin-withdrawals/webhooks). A bare balance-number mismatch with no corresponding Stripe object evidence is NEVER auto-repaired — it is always left for human review, per docs/withdrawals/04-automation-handler-guide.md.';

-- finding_type has no CHECK constraint (plain TEXT) — new values used by the
-- Stripe-balance sync (platform_balance_drift, connect_account_balance_drift,
-- missed_webhook_replayed, dispute_funds_movement, stripe_topup,
-- external_account_change) require no schema change here.

-- ─── 2. stripe_balance_snapshots ─────────────────────────────────────────────
-- Point-in-time record of every reconciliation comparison (not just the ones
-- that produced a finding) — distinct concern from reconciliation_findings
-- (discrete anomalies): this is trend/observability history for the admin
-- dashboard and for confirming the sweep actually ran.
CREATE TABLE IF NOT EXISTS public.stripe_balance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scope TEXT NOT NULL CHECK (scope IN ('platform', 'connect_account')),
  user_id UUID,
  stripe_account_id TEXT,
  stripe_available_cents BIGINT NOT NULL,
  stripe_pending_cents BIGINT NOT NULL,
  ledger_reference_cents BIGINT NOT NULL,
  drift_cents BIGINT NOT NULL,
  reconciliation_finding_id UUID REFERENCES public.reconciliation_findings(id)
);

CREATE INDEX IF NOT EXISTS idx_stripe_balance_snapshots_captured_at
  ON public.stripe_balance_snapshots (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_balance_snapshots_user
  ON public.stripe_balance_snapshots (user_id, captured_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.stripe_balance_snapshots ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only, matching reconciliation_findings/admin_action_log.

COMMENT ON TABLE public.stripe_balance_snapshots IS
  'Point-in-time Stripe-vs-ledger balance comparisons (platform account and per connected account), written by every real-time balance.available webhook check and every hourly stripe-balance-reconciliation-hourly sweep. Written exclusively by service_role.';

-- ─── 3. Platform ledger total (read-only aggregate, avoids pulling every
-- profiles.balance row into the Edge Function just to sum it) ───────────────
CREATE OR REPLACE FUNCTION public.get_platform_ledger_balance_cents()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(ROUND(SUM(balance) * 100), 0)::bigint FROM public.profiles;
$$;

COMMENT ON FUNCTION public.get_platform_ledger_balance_cents() IS
  'Sum of every profiles.balance, in cents — the platform Stripe account''s available+pending balance should never fall below this. Used by comparePlatformBalance() in webhooks/admin-withdrawals. Read-only.';

REVOKE ALL ON FUNCTION public.get_platform_ledger_balance_cents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_ledger_balance_cents() TO service_role;

-- ─── 3b. stripe_events DLQ failure recording ─────────────────────────────────
-- retry_count/last_error/status/last_retry_at have existed on stripe_events
-- since 20260115_enhance_webhook_tracking.sql but nothing has ever written to
-- them — every webhook handler failure was previously only visible via
-- console.error grep. Called from webhooks/index.ts's top-level catch.
CREATE OR REPLACE FUNCTION public.record_stripe_event_failure(
  p_stripe_event_id TEXT,
  p_error_message TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stripe_events
  SET status = 'failed',
      last_error = p_error_message,
      last_retry_at = now(),
      retry_count = COALESCE(retry_count, 0) + 1
  WHERE stripe_event_id = p_stripe_event_id;
$$;

REVOKE ALL ON FUNCTION public.record_stripe_event_failure(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_stripe_event_failure(TEXT, TEXT) TO service_role;

-- ─── 4. pg_net (for the cron job to call the Edge Function over HTTP) ───────
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'pg_net could not be enabled by this migration (insufficient privilege) — enable it via Supabase Dashboard > Database > Extensions, then re-run this migration''s cron.schedule(...) block manually.';
END $$;

-- ─── 5. Hourly cron job: invoke admin-withdrawals { action: run_stripe_balance_sync } ──
-- Reuses the existing admin-withdrawals Edge Function (which already has the
-- Stripe SDK, service-role Supabase client, and the compare_stripe precedent)
-- rather than standing up a dedicated function. Auth is via a dedicated
-- reconciliation_cron_secret (NOT the Supabase service role key — a distinct,
-- narrowly-scoped bearer token so this one automation-only trigger can be
-- rotated without touching admin-withdrawals' other credentials) checked by
-- the function itself, not the Supabase platform JWT gateway.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'stripe-balance-reconciliation-hourly';
    PERFORM cron.schedule(
      'stripe-balance-reconciliation-hourly',
      '0 * * * *',
      $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_base_url') || '/admin-withdrawals',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reconciliation_cron_secret'), '')
        ),
        body := jsonb_build_object('action', 'run_stripe_balance_sync'),
        timeout_milliseconds := 55000
      );
      $cron$
    );
  ELSE
    RAISE WARNING 'pg_cron and/or pg_net are not both enabled on this project — stripe-balance-reconciliation-hourly was NOT scheduled. Enable both extensions (Database > Extensions in the Supabase dashboard) and re-run the cron.schedule(...) call from this migration manually.';
  END IF;
END $$;
