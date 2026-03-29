-- =============================================================================
-- MIGRATE PRODUCTION DATA TO STAGING
-- =============================================================================
-- Purpose : Copy all internal-beta user data from the production database
--           into the staging (preview / development) branch database.
--
-- When to run
--   After "supabase db push" has bootstrapped the staging branch schema,
--   run this script ONCE against the STAGING connection string to populate it
--   with existing user data before cleaning production for external beta.
--
-- Connection
--   psql "postgresql://postgres:[STAGING_DB_PASSWORD]@db.[STAGING_PROJECT_REF].supabase.co:5432/postgres" \
--     -f scripts/migrate-prod-to-staging.sql
--
--   Or via Supabase CLI:
--     supabase db execute --project-ref <STAGING_PROJECT_REF> < scripts/migrate-prod-to-staging.sql
--
-- Prerequisites
--   1. The staging branch has been fully bootstrapped with all migrations
--      (supabase db push against the staging project ref).
--   2. This script is run from the PRODUCTION database (or the INSERT VALUES
--      blocks below are pre-populated by the accompanying pg_dump step).
--   3. The staging branch auth.users rows must exist before profiles are
--      inserted — create them via:
--        supabase auth export-users --project-ref <PROD_REF> | \
--        supabase auth import-users --project-ref <STAGING_REF>
--
-- IMPORTANT
--   Run the script inside a single transaction so that any failure rolls back
--   the entire data set, avoiding partial imports.
--
-- Data copied (in dependency order)
--   1.  auth.users           – handled externally via CLI auth export/import
--   2.  profiles             – core user profiles
--   3.  user_follows         – follow graph
--   4.  blocked_users        – block relationships
--   5.  skills               – user skill tags
--   6.  bounties             – marketplace listings
--   7.  wallet_transactions  – financial history
--   8.  payment_methods      – stored payment instruments
--   9.  conversations        – chat threads
--   10. conversation_participants
--   11. messages             – chat messages
--   12. bounty_requests      – applications
--   13. completion_ready     – ready-to-submit markers
--   14. completion_submissions
--   15. notifications        – inbox
--   16. notification_preferences
--   17. push_tokens          – device tokens
--   18. notifications_outbox – queued notifications
--   19. bounty_cancellations – cancellation requests
--   20. bounty_disputes      – active disputes
--   21. dispute_resolutions
--   22. dispute_comments
--   23. dispute_evidence
--   24. dispute_appeals
--   25. dispute_audit_log
--   26. admin_warnings
--   27. stripe_events        – idempotent Stripe webhook log
--   28. user_devices         – registered devices
--   29. reports              – abuse reports
--   30. risk_assessments     – risk scoring data
--   31. push_tokens (profile_id variant from 20260316 migration)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- HELPER: disable triggers on a table for the duration of the import so that
-- side-effect triggers (balance updates, notification triggers, etc.) do not
-- fire for historical data.  Re-enable at the end.
-- ---------------------------------------------------------------------------

-- NOTE: session_replication_role = 'replica' suppresses BEFORE/AFTER triggers
--       and foreign-key checks for the current session.  This is safe here
--       because we are copying already-validated production data.
SET session_replication_role = 'replica';

-- =============================================================================
-- STEP 1: Export user data from PRODUCTION and insert here.
--
-- OPTION A – Using pg_dump (recommended for large datasets)
-- ---------------------------------------------------------
-- Run on the PRODUCTION host:
--
--   pg_dump \
--     "postgresql://postgres:[PROD_PASSWORD]@db.[PROD_REF].supabase.co:5432/postgres" \
--     --data-only \
--     --no-privileges \
--     --no-owner \
--     --column-inserts \
--     --table=public.profiles \
--     --table=public.bounties \
--     --table=public.wallet_transactions \
--     --table=public.payment_methods \
--     --table=public.conversations \
--     --table=public.conversation_participants \
--     --table=public.messages \
--     --table=public.bounty_requests \
--     --table=public.completion_ready \
--     --table=public.completion_submissions \
--     --table=public.notifications \
--     --table=public.notification_preferences \
--     --table=public.push_tokens \
--     --table=public.notifications_outbox \
--     --table=public.bounty_cancellations \
--     --table=public.bounty_disputes \
--     --table=public.dispute_resolutions \
--     --table=public.dispute_comments \
--     --table=public.dispute_evidence \
--     --table=public.dispute_appeals \
--     --table=public.dispute_audit_log \
--     --table=public.admin_warnings \
--     --table=public.stripe_events \
--     --table=public.user_devices \
--     --table=public.reports \
--     --table=public.blocked_users \
--     --table=public.user_follows \
--     --table=public.skills \
--     --table=public.risk_assessments \
--     --table=public.risk_actions \
--     --table=public.risk_communications \
--     --table=public.remediation_workflows \
--     --table=public.transaction_patterns \
--     --table=public.platform_reserves \
--     > /tmp/prod_data_export.sql
--
-- Then apply the dump to staging (append this file after the dump):
--
--   cat /tmp/prod_data_export.sql scripts/migrate-prod-to-staging.sql | \
--     psql "postgresql://postgres:[STAGING_PASSWORD]@db.[STAGING_REF].supabase.co:5432/postgres"
--
--
-- OPTION B – Live cross-database copy using dblink (requires dblink extension)
-- ---------------------------------------------------------------------------
-- If both databases are accessible from the same PostgreSQL server or via
-- dblink:
--
--   CREATE EXTENSION IF NOT EXISTS dblink;
--
--   INSERT INTO public.profiles
--   SELECT * FROM dblink(
--     'host=db.[PROD_REF].supabase.co user=postgres password=[PROD_PASS] dbname=postgres',
--     'SELECT * FROM public.profiles'
--   ) AS t(
--     id uuid, username text, email text, name text, display_name text,
--     avatar text, bio text, location text, portfolio text, title text,
--     languages text[], skills text[], role text, balance numeric,
--     created_at timestamptz, updated_at timestamptz
--     -- add any columns added by subsequent migrations …
--   )
--   ON CONFLICT (id) DO NOTHING;
--
--   -- Repeat for each table in dependency order (same order as the
--   -- table list under STEP 1 above).
-- =============================================================================


-- =============================================================================
-- STEP 2: Validate row counts after import
-- =============================================================================

DO $$
DECLARE
  tbl       text;
  row_count bigint;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'profiles', 'bounties', 'wallet_transactions', 'payment_methods',
      'conversations', 'conversation_participants', 'messages',
      'bounty_requests', 'completion_ready', 'completion_submissions',
      'notifications', 'notification_preferences', 'push_tokens',
      'notifications_outbox', 'bounty_cancellations', 'bounty_disputes',
      'dispute_resolutions', 'dispute_comments', 'dispute_evidence',
      'dispute_appeals', 'dispute_audit_log', 'admin_warnings',
      'stripe_events', 'user_devices', 'reports', 'blocked_users',
      'user_follows', 'skills'
    ])
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO row_count;
    RAISE NOTICE 'Table %-40s: % rows', tbl, row_count;
  END LOOP;
END;
$$;


-- =============================================================================
-- STEP 3: Re-enable triggers
-- =============================================================================

SET session_replication_role = 'origin';

-- =============================================================================
-- STEP 4: Refresh materialized views / search vectors (if applicable)
-- =============================================================================

-- Refresh full-text search vectors for all imported bounties
UPDATE public.bounties
SET search_tsv = to_tsvector('english',
  coalesce(title, '') || ' ' || coalesce(description, '')
)
WHERE search_tsv IS NULL;

COMMIT;

-- =============================================================================
-- POST-IMPORT CHECKLIST
-- =============================================================================
-- After running this script verify:
--
--   1. profiles count matches production:
--        SELECT count(*) FROM public.profiles;
--
--   2. bounties count matches:
--        SELECT count(*), status FROM public.bounties GROUP BY status;
--
--   3. wallet balances are consistent:
--        SELECT sum(balance) FROM public.profiles;
--
--   4. No broken FK references:
--        SELECT count(*) FROM public.bounties WHERE user_id NOT IN
--        (SELECT id FROM public.profiles) AND user_id IS NOT NULL;
--
--   5. Auth users imported:
--        SELECT count(*) FROM auth.users;
-- =============================================================================
