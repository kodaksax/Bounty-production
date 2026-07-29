-- Audit trail for Connect-native payouts (Phases 4-5 of the Stripe Connect
-- native wallet migration — see docs/payments/CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md).
--
-- Under the legacy custodial model a withdrawal's story could be reconstructed
-- from profiles.balance movements plus wallet_transactions. Connect-native
-- payouts never touch profiles.balance, so that reconstruction is no longer
-- possible: the only record of "user asked to withdraw X, we validated it
-- against a Stripe balance of Y, Stripe said Z" is whatever we write down
-- ourselves. This table is that record.
--
-- Deliberately append-only and non-authoritative: it never drives behaviour,
-- it explains it. Stripe remains the source of truth for the money itself.

CREATE TABLE IF NOT EXISTS public.payout_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,

  -- Lifecycle stage. Not an enum: this log must be able to record events from
  -- a newer deploy than the database has been migrated for, rather than
  -- rejecting the insert and losing the audit record entirely.
  event text NOT NULL,

  payout_method text,
  amount_cents integer,
  currency text NOT NULL DEFAULT 'usd',

  -- The Stripe balance the request was validated against, captured at
  -- validation time. This is what makes an after-the-fact dispute answerable:
  -- "your account reported $X available when you requested $Y".
  balance_available_cents integer,
  balance_instant_available_cents integer,

  stripe_payout_id text,
  stripe_connect_account_id text,
  idempotency_key text,

  -- Populated on withdrawal_failed. Stripe's own code where there is one.
  error_code text,
  error_message text,

  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payout_audit_log IS
  'Append-only audit trail for Connect-native payouts. Explains payout decisions; never drives them. Stripe is the source of truth for the money.';
COMMENT ON COLUMN public.payout_audit_log.balance_available_cents IS
  'Connect account available balance at validation time, so a later dispute can be answered without replaying Stripe history.';

CREATE INDEX IF NOT EXISTS idx_payout_audit_log_user_created
  ON public.payout_audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_audit_log_payout_id
  ON public.payout_audit_log (stripe_payout_id)
  WHERE stripe_payout_id IS NOT NULL;

-- Correlates every event emitted for a single withdrawal attempt.
CREATE INDEX IF NOT EXISTS idx_payout_audit_log_idempotency
  ON public.payout_audit_log (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.payout_audit_log ENABLE ROW LEVEL SECURITY;

-- Users may read their own payout history. Writes come only from the edge
-- functions via the service role, which bypasses RLS — there is deliberately
-- no INSERT/UPDATE/DELETE policy for end users, so the trail cannot be forged
-- or erased by the account it describes.
DROP POLICY IF EXISTS "Users read own payout audit log" ON public.payout_audit_log;
CREATE POLICY "Users read own payout audit log"
  ON public.payout_audit_log
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admin read access uses the JWT app_metadata role. profiles.role is NOT used
-- here: it is unpopulated in production and would silently match nobody.
DROP POLICY IF EXISTS "Admins read all payout audit logs" ON public.payout_audit_log;
CREATE POLICY "Admins read all payout audit logs"
  ON public.payout_audit_log
  FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Lock down the table grants. REVOKE FROM PUBLIC alone is not sufficient:
-- Supabase auto-grants privileges to anon/authenticated, so those roles are
-- revoked explicitly before granting back only what is needed.
REVOKE ALL ON public.payout_audit_log FROM PUBLIC;
REVOKE ALL ON public.payout_audit_log FROM anon;
REVOKE ALL ON public.payout_audit_log FROM authenticated;
GRANT SELECT ON public.payout_audit_log TO authenticated;
GRANT ALL ON public.payout_audit_log TO service_role;
