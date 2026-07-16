-- Add sender_id/receiver_id to wallet_transactions.
--
-- Reconstructed during the 2026-07 migration drift audit: this column
-- addition was applied live to production at some point but the migration
-- file was never committed — only a later fix
-- (20260520160555_fix_wallet_transactions_nullable_sender_receiver.sql,
-- itself backfilled from production history) survived, and it assumes these
-- columns already exist. That made every fresh full replay fail with
-- "column sender_id does not exist" once it reached that later migration.
--
-- Added nullable directly rather than replaying the original NOT NULL step:
-- the historical sequence created them NOT NULL and 20260520160555 relaxed
-- that constraint, but a NOT NULL ADD COLUMN with no default would fail here
-- against any wallet_transactions rows already inserted by earlier
-- migrations/seed data on a fresh replay. The end state after both
-- migrations run is identical either way (nullable, same FKs).
alter table public.wallet_transactions
  add column if not exists sender_id uuid references public.profiles(id) on delete set null,
  add column if not exists receiver_id uuid references public.profiles(id) on delete set null;
