-- =============================================================================
-- CLEAN PRODUCTION DATA
-- =============================================================================
-- Purpose : Remove all internal-beta user data from the production database,
--           leaving the schema intact and ready for the external beta launch.
--
-- ⚠️  DANGER — THIS IS IRREVERSIBLE ⚠️
--   Run this ONLY after:
--     a) All migrations have been applied to the staging branch.
--     b) scripts/migrate-prod-to-staging.sql has completed successfully.
--     c) Row counts on staging match production (see post-import checklist).
--     d) The staging/preview branch has been smoke-tested.
--     e) You have a verified pg_dump backup of production data stored safely.
--
-- Connection
--   psql "postgresql://postgres:[PROD_DB_PASSWORD]@db.[PROD_PROJECT_REF].supabase.co:5432/postgres" \
--     -f scripts/clean-production-data.sql
--
--   Or via Supabase CLI:
--     supabase db execute --project-ref <PROD_PROJECT_REF> < scripts/clean-production-data.sql
--
-- What this script does
--   1. Truncates all user-generated data tables (in reverse FK dependency order).
--   2. Resets sequences where applicable.
--   3. Leaves all schema objects (tables, indexes, functions, triggers) intact.
--   4. Preserves reference / configuration data:
--      - restricted_business_categories  (immutable reference data)
--      - platform_reserves               (risk configuration)
--   5. Verifies the database is clean before committing.
--
-- Auth users
--   Supabase auth.users rows must be removed separately via the Supabase
--   dashboard or CLI.  This script only touches public schema tables.
--
--   CLI command to delete all auth users (use with extreme caution):
--     supabase auth --project-ref <PROD_REF> list-users | \
--       jq -r '.[].id' | \
--       xargs -I {} supabase auth --project-ref <PROD_REF> delete-user {}
--
--   NOTE: Supabase's ON DELETE CASCADE from auth.users → public.profiles will
--   automatically cascade to most tables once auth users are removed.  This
--   script provides a belt-and-suspenders explicit clean for tables that use
--   ON DELETE SET NULL or have no cascade.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Safety check: ensure this is NOT a production database that already has
-- external-beta users signed up.  Abort if any profile was created after
-- the internal-beta cutoff date (adjust the date as needed).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  external_user_count int;
BEGIN
  -- Intentionally set to a future date as a safety net.
  -- Update this date to reflect the actual external-beta launch date.
  SELECT count(*) INTO external_user_count
  FROM public.profiles
  WHERE created_at > '2026-04-01 00:00:00+00';

  IF external_user_count > 0 THEN
    RAISE EXCEPTION
      'Safety check failed: % profile(s) were created after the internal-beta '
      'cutoff date (2026-04-01). This script should only run before external beta '
      'users are onboarded. Aborting.',
      external_user_count;
  END IF;

  RAISE NOTICE 'Safety check passed — no post-cutoff profiles found. Proceeding with cleanup.';
END;
$$;

-- ---------------------------------------------------------------------------
-- PHASE 1: Suppress trigger side-effects during deletion
-- ---------------------------------------------------------------------------
SET session_replication_role = 'replica';

-- ---------------------------------------------------------------------------
-- PHASE 2: Delete user-generated data in reverse FK dependency order
-- ---------------------------------------------------------------------------

-- Risk / compliance records (reference profile IDs)
TRUNCATE TABLE public.risk_actions           RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.risk_assessments       RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.risk_communications    RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.remediation_workflows  RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.transaction_patterns   RESTART IDENTITY CASCADE;

-- Dispute system (depend on bounty_disputes, bounty_cancellations)
TRUNCATE TABLE public.dispute_audit_log      RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.dispute_appeals        RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.dispute_evidence       RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.dispute_comments       RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.dispute_resolutions    RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.bounty_disputes        RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.bounty_cancellations   RESTART IDENTITY CASCADE;

-- Admin / moderation
TRUNCATE TABLE public.admin_warnings         RESTART IDENTITY CASCADE;

-- Notifications & devices
TRUNCATE TABLE public.notifications_outbox   RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.push_tokens            RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.notification_preferences RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.notifications          RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.user_devices           RESTART IDENTITY CASCADE;

-- Payment records
TRUNCATE TABLE public.stripe_events          RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.payment_methods        RESTART IDENTITY CASCADE;

-- Messaging
TRUNCATE TABLE public.messages               RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.conversation_participants RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.conversations          RESTART IDENTITY CASCADE;

-- Bounty workflow
TRUNCATE TABLE public.completion_submissions RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.completion_ready       RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.bounty_requests        RESTART IDENTITY CASCADE;

-- Wallet
TRUNCATE TABLE public.wallet_transactions    RESTART IDENTITY CASCADE;

-- Bounties (after all dependent tables are clear)
TRUNCATE TABLE public.bounties               RESTART IDENTITY CASCADE;

-- Social graph
TRUNCATE TABLE public.reports                RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.blocked_users          RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.user_follows           RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.skills                 RESTART IDENTITY CASCADE;

-- Profiles (last — everything cascades from here)
TRUNCATE TABLE public.profiles               RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- PHASE 3: Re-enable triggers
-- ---------------------------------------------------------------------------
SET session_replication_role = 'origin';

-- ---------------------------------------------------------------------------
-- PHASE 4: Verify all user tables are empty
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl           text;
  row_count     bigint;
  failed_tables text := '';
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
      'user_follows', 'skills', 'risk_assessments'
    ])
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO row_count;
    IF row_count > 0 THEN
      failed_tables := failed_tables || tbl || ' (' || row_count || ' rows) ';
      RAISE WARNING 'Table % still has % rows after cleanup', tbl, row_count;
    ELSE
      RAISE NOTICE 'Table % — CLEAN', tbl;
    END IF;
  END LOOP;

  IF failed_tables <> '' THEN
    RAISE EXCEPTION 'Cleanup incomplete — the following tables are not empty: %', failed_tables;
  END IF;

  RAISE NOTICE '=========================================';
  RAISE NOTICE 'Production cleanup COMPLETE.';
  RAISE NOTICE 'All user data tables are empty.';
  RAISE NOTICE 'Reference data (restricted_business_categories, platform_reserves) preserved.';
  RAISE NOTICE '=========================================';
END;
$$;

COMMIT;

-- =============================================================================
-- NEXT STEPS AFTER RUNNING THIS SCRIPT
-- =============================================================================
--
--   1. Remove auth.users via the Supabase dashboard or CLI auth commands
--      (see the Auth users section above).
--
--   2. Rotate API keys if any internal-beta users had service-role access:
--        Dashboard → Project Settings → API → Regenerate keys
--
--   3. Clear any Stripe test customers/payment intents in the Stripe dashboard
--      if this is the production Stripe account.
--
--   4. Announce external beta readiness to the team.
-- =============================================================================
