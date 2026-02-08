-- Add reason column to wallet_transactions table
-- This allows storing the reason for refunds and other transaction types

ALTER TABLE wallet_transactions 
ADD COLUMN IF NOT EXISTS reason TEXT;

-- Add index for querying transactions by reason if needed in the future
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reason 
ON wallet_transactions(reason) 
WHERE reason IS NOT NULL;
