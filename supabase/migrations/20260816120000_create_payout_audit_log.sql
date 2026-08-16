-- =====================================================================
-- payout_audit_log — the forensic trail the code has always written to
-- and which has never existed.
--
-- supabase/functions/connect/index.ts has called writePayoutAudit() at
-- every stage of the withdrawal flow since the native-payout work landed.
-- That helper inserts into `payout_audit_log`, logs on failure and swallows
-- the error, so the missing table produced no symptom — until the
-- 2026-08-13 instant-payout incident had to be reconstructed entirely from
-- Stripe's API because Bounty held no record of what it had attempted.
--
-- Writes come exclusively from Edge Functions using the service role. No
-- client ever reads or writes this table, so RLS is enabled with no
-- permissive policy: service_role bypasses RLS, everyone else sees nothing.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.payout_audit_log (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Lifecycle stage. Free text rather than an enum: this is an append-only
  -- audit trail, and a new event name must never be able to fail a write.
  event                           TEXT NOT NULL,

  payout_method                   TEXT,
  amount_cents                    INTEGER,
  currency                        TEXT DEFAULT 'usd',

  -- Connected-account balance as observed at the moment of the decision.
  balance_available_cents         BIGINT,
  balance_instant_available_cents BIGINT,

  stripe_payout_id                TEXT,
  stripe_connect_account_id       TEXT,
  idempotency_key                 TEXT,

  error_code                      TEXT,
  error_message                   TEXT,
  detail                          JSONB,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payout_audit_log
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.payout_audit_log
  DROP CONSTRAINT IF EXISTS payout_audit_log_user_id_fkey;

ALTER TABLE public.payout_audit_log
  ADD CONSTRAINT payout_audit_log_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON TABLE public.payout_audit_log IS
  'Append-only audit trail of every withdrawal/payout decision made by the connect Edge Function. Written by service role only. Created 2026-08-16 after the instant-payout fallback incident revealed writePayoutAudit() had been failing silently against a non-existent table.';

COMMENT ON COLUMN public.payout_audit_log.event IS
  'Lifecycle stage: withdrawal_validated, stripe_payout_created, instant_payout_failed, withdrawal_failed, etc.';

CREATE INDEX IF NOT EXISTS idx_payout_audit_log_user_created
  ON public.payout_audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_audit_log_payout
  ON public.payout_audit_log (stripe_payout_id)
  WHERE stripe_payout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payout_audit_log_event_created
  ON public.payout_audit_log (event, created_at DESC);

ALTER TABLE public.payout_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own payout audit log" ON public.payout_audit_log;
DROP POLICY IF EXISTS "Admins read all payout audit logs" ON public.payout_audit_log;

-- No policy is defined on purpose. service_role bypasses RLS; authenticated
-- and anon therefore have no path to this table. Revoke the default grants
-- explicitly as well -- Postgres auto-grants in ways that have surprised this
-- project before (see reference_supabase_anon_execute_grant).
REVOKE ALL ON public.payout_audit_log FROM PUBLIC;
REVOKE ALL ON public.payout_audit_log FROM anon;
REVOKE ALL ON public.payout_audit_log FROM authenticated;
GRANT ALL ON public.payout_audit_log TO service_role;
