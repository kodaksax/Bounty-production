-- Extend payment_methods to support US bank accounts linked via Stripe Financial Connections.
-- One unified row represents the bank for both deposits (PaymentMethod attached to the
-- Stripe Customer) and withdrawals (mirrored as an External Account on the user's
-- Stripe Connect account).

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_last4 text,
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS fc_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_external_account_id text,
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS mandate_id text;

-- Constrain verification_status to known values when present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_methods_verification_status_check'
  ) THEN
    ALTER TABLE payment_methods
      ADD CONSTRAINT payment_methods_verification_status_check
      CHECK (
        verification_status IS NULL OR verification_status IN (
          'verified',
          'pending_microdeposits',
          'failed'
        )
      );
  END IF;
END $$;

-- Quick lookup of a user's saved us_bank_account methods by stripe identifiers.
CREATE INDEX IF NOT EXISTS idx_payment_methods_user_type
  ON payment_methods(user_id, type);

CREATE INDEX IF NOT EXISTS idx_payment_methods_fc_account
  ON payment_methods(fc_account_id) WHERE fc_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_methods_external_account
  ON payment_methods(stripe_external_account_id) WHERE stripe_external_account_id IS NOT NULL;

COMMENT ON COLUMN payment_methods.type IS
  'Stripe payment method type: card | us_bank_account';
COMMENT ON COLUMN payment_methods.bank_name IS
  'Friendly bank name for us_bank_account methods (e.g. "Chase").';
COMMENT ON COLUMN payment_methods.bank_last4 IS
  'Last 4 digits of the linked bank account.';
COMMENT ON COLUMN payment_methods.account_type IS
  'us_bank_account account type: checking | savings.';
COMMENT ON COLUMN payment_methods.fc_account_id IS
  'Stripe Financial Connections account id (fca_*) used to derive both the PaymentMethod and the Connect external account.';
COMMENT ON COLUMN payment_methods.stripe_external_account_id IS
  'Mirror of the bank as an external account on the user''s Stripe Connect account (ba_*) — used for payouts/withdrawals.';
COMMENT ON COLUMN payment_methods.verification_status IS
  'verified | pending_microdeposits | failed. Null for cards.';
COMMENT ON COLUMN payment_methods.mandate_id IS
  'Stripe mandate id captured on first ACH debit, reused for subsequent off-session deposits.';
