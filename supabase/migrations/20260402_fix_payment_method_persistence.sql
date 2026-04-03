-- Fix Payment Method Persistence
-- Created: 2026-04-02
-- Purpose: Backfill profiles.email from auth.users and ensure payment infrastructure is solid
--
-- Root cause: resolveStripeCustomerForUser in the payments edge function used
-- .upsert() which fails silently because the INSERT portion violates the NOT NULL
-- constraint on `username` before ON CONFLICT can redirect to UPDATE.
-- The stripe_customer_id column existed but was never populated.
--
-- This migration:
-- 1. Backfills profiles.email from auth.users where profiles.email IS NULL
-- 2. Ensures service-role RLS bypass policies exist for the payment_methods table
-- 3. Adds an index on payment_methods(user_id, is_default) for efficient lookups

-- 1. Backfill profiles.email from auth.users
-- Many profiles have email = NULL despite the auth user having an email.
-- This is needed because the payments edge function resolves the Stripe customer
-- email from profiles.email first.
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS NULL
  AND u.email IS NOT NULL;

-- 2. Ensure payment_methods RLS allows service-role operations
-- The service role already bypasses RLS (relforcerowsecurity = false), but
-- adding explicit service_role policies is a safety net for webhook-driven
-- payment method upserts (setup_intent.succeeded handler in the webhooks function).
DO $$
BEGIN
  -- Allow service_role to insert into payment_methods (webhook upsert path)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'payment_methods' AND policyname = 'service_role_manage_payment_methods'
  ) THEN
    CREATE POLICY service_role_manage_payment_methods ON payment_methods
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 3. Composite index for efficient default-payment-method lookup
CREATE INDEX IF NOT EXISTS idx_payment_methods_user_default
  ON payment_methods(user_id, is_default)
  WHERE is_default = true;

-- 4. Comment columns for documentation
COMMENT ON COLUMN profiles.stripe_customer_id IS 'Stripe Customer ID. Set by the payments edge function when the user first interacts with payment features.';
COMMENT ON COLUMN profiles.stripe_connect_account_id IS 'Stripe Connect Account ID for users who receive payouts.';
