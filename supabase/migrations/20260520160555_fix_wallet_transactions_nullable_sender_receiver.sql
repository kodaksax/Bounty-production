-- Backfilled from live production history during the 2026-07 migration
-- drift audit — this file did not previously exist in the repo even though
-- it was applied live (version 20260520160555). Reconstructed verbatim from
-- supabase_migrations.schema_migrations.statements so the repo matches
-- production exactly. Do not edit; if further changes are needed, add a new
-- migration instead.
ALTER TABLE public.wallet_transactions
  ALTER COLUMN sender_id   DROP NOT NULL,
  ALTER COLUMN receiver_id DROP NOT NULL;

COMMENT ON COLUMN public.wallet_transactions.sender_id   IS 'Optional: user initiating the funds movement (null for deposits, escrows, refunds)';
COMMENT ON COLUMN public.wallet_transactions.receiver_id IS 'Optional: user receiving the funds (null for deposits, escrows, refunds)';
