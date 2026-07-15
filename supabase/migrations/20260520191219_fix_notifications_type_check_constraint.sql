-- Backfilled from live production history during the 2026-07 migration
-- drift audit — this file did not previously exist in the repo even though
-- it was applied live (version 20260520191219). Reconstructed verbatim from
-- supabase_migrations.schema_migrations.statements so the repo matches
-- production exactly. Do not edit; if further changes are needed, add a new
-- migration instead.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'application',
    'acceptance',
    'completion',
    'payment',
    'message',
    'follow',
    'cancellation_request',
    'cancellation_accepted',
    'cancellation_rejected',
    'dispute_created',
    'dispute_resolved',
    'workflow_dispute_created',
    'stale_bounty',
    'stale_bounty_cancelled',
    'stale_bounty_reposted'
  ));
