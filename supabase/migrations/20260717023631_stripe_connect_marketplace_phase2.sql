-- Migration: stripe_connect_marketplace_phase2
-- Purpose: (1) close an anon-callable privilege gap on dispute money-movement
--          RPCs, (2) harden search_path on the oldest money RPCs, (3) add
--          additive Stripe-native payment tracking (bounty_payments table +
--          a feature-flag column on bounties). No existing tables, columns,
--          or rows are dropped or renamed. Fully additive / backward compatible.
--
-- Recovered from production during the 2026-07 migration drift audit: this
-- migration was applied live to production via a direct SQL execution but
-- the file itself was never committed to the repository. Reconstructed
-- verbatim from supabase_migrations.schema_migrations.statements so replays
-- (e.g. rebasing a Staging/preview branch) are reproducible going forward.

-- 1) SECURITY FIX: anon-callable dispute money-movement RPCs
REVOKE EXECUTE ON FUNCTION public.fn_close_dispute_hold(integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_open_dispute_hold(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_open_dispute_hold(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_refund_wallet_escrow_for_dispute(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_release_wallet_escrow_for_dispute(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_dispute_loss_transaction(uuid, numeric, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_profile_balance_not_frozen(uuid) FROM anon;

-- 2) Harden search_path on the oldest money RPCs
ALTER FUNCTION public.update_balance(uuid, numeric) SET search_path = public;
ALTER FUNCTION public.apply_deposit(uuid, numeric, text, jsonb) SET search_path = public;
ALTER FUNCTION public.apply_refund(uuid, numeric, text, text, text, jsonb) SET search_path = public;

-- 3) Additive: Stripe-native marketplace payment lifecycle tracking.
CREATE TABLE IF NOT EXISTS public.bounty_payments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id                   uuid NOT NULL REFERENCES public.bounties(id),
  poster_id                   uuid NOT NULL,
  hunter_id                   uuid,
  stripe_payment_intent_id    text UNIQUE,
  stripe_charge_id            text,
  stripe_transfer_id          text,
  stripe_refund_id            text,
  transfer_group              text,
  amount                      numeric NOT NULL CHECK (amount > 0),
  platform_fee_amount         numeric,
  application_fee_amount_cents integer,
  capture_method              text NOT NULL DEFAULT 'manual' CHECK (capture_method IN ('manual', 'automatic')),
  status                      text NOT NULL DEFAULT 'pending_payment' CHECK (
                                status IN (
                                  'pending_payment',
                                  'authorized',
                                  'captured',
                                  'released',
                                  'refund_pending',
                                  'refunded',
                                  'canceled',
                                  'disputed',
                                  'failed'
                                )
                              ),
  capture_deadline            timestamptz,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bounty_payments_bounty_id ON public.bounty_payments (bounty_id);
CREATE INDEX IF NOT EXISTS idx_bounty_payments_poster_id ON public.bounty_payments (poster_id);
CREATE INDEX IF NOT EXISTS idx_bounty_payments_hunter_id ON public.bounty_payments (hunter_id);
CREATE INDEX IF NOT EXISTS idx_bounty_payments_status ON public.bounty_payments (status);

ALTER TABLE public.bounty_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY bounty_payments_select_participant ON public.bounty_payments
  FOR SELECT
  USING (auth.uid() = poster_id OR auth.uid() = hunter_id);

CREATE OR REPLACE FUNCTION public.set_bounty_payments_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounty_payments_updated_at ON public.bounty_payments;
CREATE TRIGGER trg_bounty_payments_updated_at
  BEFORE UPDATE ON public.bounty_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_bounty_payments_updated_at();

-- 4) Additive: feature-flag column
ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS payment_architecture_version smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.bounties.payment_architecture_version IS
  '1 = legacy wallet-ledger escrow (profiles.balance / wallet_transactions). 2 = Stripe-native marketplace payment (see bounty_payments table). Additive migration; existing bounties remain 1.';

COMMENT ON TABLE public.bounty_payments IS
  'Stripe-native marketplace payment lifecycle per bounty (Phase 2 of the Stripe Connect migration). Coexists with wallet_transactions/profiles.balance during transition; only bounties with payment_architecture_version = 2 use this table.';
