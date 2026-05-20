-- Migration: Make sender_id and receiver_id nullable on wallet_transactions
-- Created: 2026-05-20
--
-- Root cause:
--   The live wallet_transactions table has sender_id and receiver_id columns
--   defined as NOT NULL (no default), but none of the existing RPCs that insert
--   into this table (apply_deposit, apply_escrow, apply_refund, apply_release_tx,
--   fn_reserve_bounty_escrow, etc.) include these columns. This causes a
--   "null value in column 'sender_id' of relation 'wallet_transactions' violates
--   not-null constraint" error whenever any of those RPCs run.
--
--   These columns were added directly to the database outside of the migration
--   history and are not semantically required for all transaction types
--   (e.g. a wallet deposit has no separate sender/receiver — the user is both).
--
-- Fix:
--   Drop the NOT NULL constraint from both columns so all existing inserts
--   continue to work. Values remain available for transaction types where a
--   distinct sender and receiver are meaningful (e.g. peer-to-peer transfers).

ALTER TABLE public.wallet_transactions
  ALTER COLUMN sender_id   DROP NOT NULL,
  ALTER COLUMN receiver_id DROP NOT NULL;

COMMENT ON COLUMN public.wallet_transactions.sender_id   IS 'Optional: user initiating the funds movement (null for deposits, escrows, refunds)';
COMMENT ON COLUMN public.wallet_transactions.receiver_id IS 'Optional: user receiving the funds (null for deposits, escrows, refunds)';
