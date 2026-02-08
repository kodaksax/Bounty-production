-- Add reason column to wallet_transactions table
-- This allows storing the reason for refunds and other transaction types

ALTER TABLE wallet_transactions 
ADD COLUMN IF NOT EXISTS reason TEXT;
