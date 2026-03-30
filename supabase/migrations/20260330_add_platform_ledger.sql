-- Migration: Add platform_ledger table
-- Replaces the zero-UUID PLATFORM_ACCOUNT_ID workaround used in wallet_transactions.
-- Platform fees are now stored in a dedicated table that does not require a user UUID,
-- making fee records queryable and reportable without polluting wallet_transactions.

CREATE TABLE IF NOT EXISTS public.platform_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id   UUID REFERENCES public.bounties(id) ON DELETE SET NULL,
  amount      NUMERIC(12, 2) NOT NULL,
  fee_type    TEXT NOT NULL DEFAULT 'platform_fee'
                CHECK (fee_type IN ('platform_fee')),
  description TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying fees by bounty
CREATE INDEX IF NOT EXISTS idx_platform_ledger_bounty_id
  ON public.platform_ledger (bounty_id);

-- Index for time-based reporting
CREATE INDEX IF NOT EXISTS idx_platform_ledger_created_at
  ON public.platform_ledger (created_at DESC);

COMMENT ON TABLE public.platform_ledger IS 'Dedicated ledger for platform fee revenue. Does not reference auth.users so it is never polluted by fake/ghost user IDs.';
COMMENT ON COLUMN public.platform_ledger.amount IS 'Fee amount in USD (dollars, not cents)';
COMMENT ON COLUMN public.platform_ledger.fee_type IS 'Type of platform fee (currently only platform_fee)';

-- RLS: Only service-role can write; admins can read
ALTER TABLE public.platform_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_ledger_service_role_all"
  ON public.platform_ledger FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.platform_ledger TO service_role;
