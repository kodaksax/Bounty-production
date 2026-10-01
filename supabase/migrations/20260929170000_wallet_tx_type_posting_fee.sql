-- Adds the 'posting_fee' wallet transaction type used by
-- 20260929170100_wallet_posting_fee.sql.
--
-- Its own migration because Postgres cannot use a new enum value inside the
-- transaction that added it, and that migration inserts rows of this type.
--
-- A distinct type rather than reusing 'escrow': every escrow sum in the schema
-- (get_platform_ledger_balance_cents, admin_bounty_financial_state, the client's
-- settled-escrow tagging) filters on type, so a fee booked as escrow would be
-- counted as money held for the hunter.

ALTER TYPE public.wallet_tx_type_enum ADD VALUE IF NOT EXISTS 'posting_fee';
