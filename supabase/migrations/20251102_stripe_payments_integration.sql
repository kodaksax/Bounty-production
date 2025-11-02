-- Stripe Payments Integration Migration
-- Created: 2025-11-02
-- Purpose: Add tables and columns for Stripe payment integration

-- Add Stripe-related columns to wallet_transactions
ALTER TABLE wallet_transactions 
ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
ADD COLUMN IF NOT EXISTS stripe_charge_id text,
ADD COLUMN IF NOT EXISTS stripe_transfer_id text,
ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Create indexes for Stripe ID lookups
CREATE INDEX IF NOT EXISTS idx_wallet_tx_stripe_payment_intent 
ON wallet_transactions(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_stripe_charge 
ON wallet_transactions(stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_stripe_transfer 
ON wallet_transactions(stripe_transfer_id) WHERE stripe_transfer_id IS NOT NULL;

-- Add Stripe Connect account ID to profiles for withdrawal support
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
ADD COLUMN IF NOT EXISTS stripe_customer_id text,
ADD COLUMN IF NOT EXISTS stripe_connect_onboarded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_connect 
ON profiles(stripe_connect_account_id) WHERE stripe_connect_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer 
ON profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Create payment_methods table for storing user payment methods
CREATE TABLE IF NOT EXISTS payment_methods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    stripe_payment_method_id text NOT NULL UNIQUE,
    type text NOT NULL DEFAULT 'card', -- card, bank_account, etc.
    card_brand text,
    card_last4 text,
    card_exp_month integer,
    card_exp_year integer,
    is_default boolean DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_methods_user_id ON payment_methods(user_id);
CREATE INDEX idx_payment_methods_stripe_id ON payment_methods(stripe_payment_method_id);

CREATE TRIGGER trg_payment_methods_updated_at
BEFORE UPDATE ON payment_methods
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Create stripe_events table for webhook event tracking (idempotency)
CREATE TABLE IF NOT EXISTS stripe_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_event_id text NOT NULL UNIQUE,
    event_type text NOT NULL,
    processed boolean DEFAULT false,
    processed_at timestamptz,
    event_data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stripe_events_event_id ON stripe_events(stripe_event_id);
CREATE INDEX idx_stripe_events_type ON stripe_events(event_type);
CREATE INDEX idx_stripe_events_processed ON stripe_events(processed, created_at);

-- Add comment to wallet_transactions for Stripe integration
COMMENT ON COLUMN wallet_transactions.stripe_payment_intent_id IS 'Stripe PaymentIntent ID for deposits';
COMMENT ON COLUMN wallet_transactions.stripe_charge_id IS 'Stripe Charge ID for charge-related transactions';
COMMENT ON COLUMN wallet_transactions.stripe_transfer_id IS 'Stripe Transfer ID for Connect payouts';
COMMENT ON COLUMN wallet_transactions.stripe_connect_account_id IS 'Stripe Connect account ID for the recipient';
COMMENT ON COLUMN wallet_transactions.metadata IS 'Additional metadata in JSON format';

-- Add RLS policies for payment_methods
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

-- Users can view their own payment methods
CREATE POLICY payment_methods_select_own ON payment_methods
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own payment methods
CREATE POLICY payment_methods_insert_own ON payment_methods
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own payment methods
CREATE POLICY payment_methods_update_own ON payment_methods
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own payment methods
CREATE POLICY payment_methods_delete_own ON payment_methods
    FOR DELETE
    USING (auth.uid() = user_id);

-- Add RLS policies for stripe_events (admin only, no user access needed)
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- No user access to stripe_events (backend/webhook only)
-- Service role will bypass RLS

-- Add helper function to get user's default payment method
CREATE OR REPLACE FUNCTION get_default_payment_method(p_user_id uuid)
RETURNS TABLE (
    id uuid,
    stripe_payment_method_id text,
    card_brand text,
    card_last4 text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pm.id,
        pm.stripe_payment_method_id,
        pm.card_brand,
        pm.card_last4
    FROM payment_methods pm
    WHERE pm.user_id = p_user_id AND pm.is_default = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add helper function to check if user has completed Connect onboarding
CREATE OR REPLACE FUNCTION has_stripe_connect(p_user_id uuid)
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM profiles 
        WHERE id = p_user_id 
        AND stripe_connect_account_id IS NOT NULL 
        AND stripe_connect_onboarded_at IS NOT NULL
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
