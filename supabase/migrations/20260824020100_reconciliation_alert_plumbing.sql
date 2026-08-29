-- =====================================================================
-- Phase 4 — the two pieces the alert trigger depends on.
--
--   1. reconciliation_alerts_sent — coalescing ledger, so a backlog cannot
--      become a page storm.
--   2. fn_admin_recipient_ids()   — who gets paged.
-- =====================================================================

-- ─── 1. Coalescing ──────────────────────────────────────────────────────────
-- Without this, the first scheduled run of the reconciliation sweep pages for
-- a backlog that is already known and already being worked: 25 historical
-- withdrawals, 2 orphan payouts, 1 stuck withdrawal. An alerting system whose
-- debut is 28 simultaneous pages teaches its recipients to mute it, which is
-- strictly worse than the silence it replaced.
CREATE TABLE IF NOT EXISTS public.reconciliation_alerts_sent (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_type text        NOT NULL,
  finding_id   uuid        NULL,
  sent_at      timestamptz NOT NULL DEFAULT now()
);

-- The lookup the trigger performs on every critical insert: "have we paged for
-- this finding_type recently?" DESC so the most recent is found first.
CREATE INDEX IF NOT EXISTS idx_reconciliation_alerts_sent_type_time
  ON public.reconciliation_alerts_sent (finding_type, sent_at DESC);

ALTER TABLE public.reconciliation_alerts_sent ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only, matching reconciliation_findings and
-- admin_action_log. REVOKE from PUBLIC/anon explicitly — Supabase grants
-- table privileges to anon/authenticated by default and RLS alone is not the
-- whole story. Revoke from PUBLIC first (matches reconciliation_reports pattern)
-- then from the specific roles for belt-and-suspenders clarity.
REVOKE ALL ON public.reconciliation_alerts_sent FROM PUBLIC;
REVOKE ALL ON public.reconciliation_alerts_sent FROM anon;
REVOKE ALL ON public.reconciliation_alerts_sent FROM authenticated;

COMMENT ON TABLE public.reconciliation_alerts_sent IS
  'One row per critical-finding alert actually dispatched. Read by fn_alert_on_critical_finding() to suppress repeats of the same finding_type within an hour. Also the audit trail for "did anyone get paged for this".';

-- ─── 2. Recipients ──────────────────────────────────────────────────────────
-- Admins are identified by auth.users.raw_app_meta_data->>'role', NOT by
-- profiles.role. That column returns 0 rows in production and is dead — an
-- implementation reading it addresses nobody, dispatches nothing, and reports
-- success. This repo has hit that trap before; the resolver is centralised
-- here so there is one place to get it right.
CREATE OR REPLACE FUNCTION public.fn_admin_recipient_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(array_agg(u.id), '{}'::uuid[])
  FROM auth.users u
  -- Must have a profiles row: process-notification resolves recipients through
  -- profiles and push_tokens, so an auth user without one is a silent drop.
  JOIN public.profiles p ON p.id = u.id
  WHERE u.raw_app_meta_data->>'role' = 'admin';
$$;

COMMENT ON FUNCTION public.fn_admin_recipient_ids IS
  'Admin user ids for operator alerts, from auth.users.raw_app_meta_data->>role. Never use profiles.role — it is NULL for every row in production.';

REVOKE ALL ON FUNCTION public.fn_admin_recipient_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_recipient_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_recipient_ids() TO service_role;
