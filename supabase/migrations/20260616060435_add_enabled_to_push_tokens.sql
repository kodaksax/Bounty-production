-- Backfilled from live production history during the 2026-07 migration
-- drift audit — this file did not previously exist in the repo even though
-- it was applied live (version 20260616060435). Reconstructed verbatim from
-- supabase_migrations.schema_migrations.statements so the repo matches
-- production exactly. Do not edit; if further changes are needed, add a new
-- migration instead.
ALTER TABLE public.push_tokens
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
