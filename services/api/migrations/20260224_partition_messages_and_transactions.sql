-- Migration: Implement table partitioning for messages and wallet_transactions
-- Date: 2026-02-24
-- Description: The authoritative SQL for this migration lives in:
--              supabase/migrations/20260224_partition_messages_and_transactions.sql
--
-- This stub exists so that environments which track migrations via
-- services/api/migrations/ also register this migration as applied.
-- Run the full migration from supabase/migrations/ before (or instead of) this file.

-- No-op: migration is fully executed via supabase/migrations/20260224_partition_messages_and_transactions.sql
SELECT 'Partitioning migration applied via supabase/migrations/20260224_partition_messages_and_transactions.sql' AS note;
