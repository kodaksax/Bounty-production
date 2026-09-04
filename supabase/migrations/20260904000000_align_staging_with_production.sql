-- Converge a Supabase project onto the schema and ACLs the app actually expects.
--
-- Written because staging had drifted far enough from production that whole product
-- areas could not be exercised at all -- the Shoal swarm's payment, completion, payout,
-- messaging and race scenarios all depend on writes that were failing for schema
-- reasons, not product reasons. Each section below was confirmed BROKEN on staging by
-- executing the app's own write against it inside a rolled-back transaction, not
-- inferred from reading migrations.
--
-- Idempotent and environment-agnostic on purpose: every section is a no-op where the
-- object is already correct, so this is safe to run on production (where it changes
-- nothing but the surplus anon grants) and on any preview branch.
--
-- Deliberately NOT included, with reasons:
--   * public.user_ratings -- staging has it as the compatibility VIEW that
--     20260415_add_ratings_table.sql intends, and lib/services/ratings.ts and
--     completion-service.ts write it with that view's legacy column names
--     (user_id/rater_id/score). Verified working on staging. Production has a NEWER
--     standalone table with ratee_id/is_public/flagged, which those two fallback paths
--     would fail against -- so production is the outlier here, not staging. Reshaping
--     staging to match production would BREAK the app. Tracked separately.
--   * public.backup_bounty_requests_duplicates -- a one-off backup snapshot taken
--     during an incident, not part of the schema. Nothing reads it.

-- ===========================================================================
-- 1. reports -- the old two-column-subject shape, which every app write missed
-- ===========================================================================
-- lib/services/report-service.ts inserts {reporter_id, content_type, content_id,
-- reason, details, status}. Staging had {user_id, reported_user_id, bounty_id, reason,
-- description, ...}, so EVERY report insert failed with
-- `column "reporter_id" of relation "reports" does not exist`. Reporting a bounty, a
-- profile or a message was silently impossible.
--
-- Renames rather than drops, so an environment that already has rows keeps them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='reports' AND column_name='user_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='reports' AND column_name='reporter_id') THEN
    ALTER TABLE public.reports RENAME COLUMN user_id TO reporter_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='reports' AND column_name='description')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='reports' AND column_name='details') THEN
    ALTER TABLE public.reports RENAME COLUMN description TO details;
  END IF;
END $$;

ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS content_id   UUID;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS details      TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reviewed_at       TIMESTAMPTZ;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS resolution_notes  TEXT;

-- Backfill the new subject columns from the old ones before they stop being written.
-- A profile report and a bounty report were previously distinguished by WHICH column
-- was non-null; content_type/content_id carries that distinction explicitly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='reports' AND column_name='reported_user_id') THEN
    UPDATE public.reports
       SET content_type = COALESCE(content_type, 'profile'),
           content_id   = COALESCE(content_id, reported_user_id)
     WHERE reported_user_id IS NOT NULL AND content_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='reports' AND column_name='bounty_id') THEN
    UPDATE public.reports
       SET content_type = COALESCE(content_type, 'bounty'),
           content_id   = COALESCE(content_id, bounty_id)
     WHERE bounty_id IS NOT NULL AND content_id IS NULL;
  END IF;
END $$;

-- The legacy subject columns carry FKs that would keep rejecting message reports
-- (a message is neither a profile nor a bounty). Drop them once backfilled.
ALTER TABLE public.reports DROP COLUMN IF EXISTS reported_user_id;
ALTER TABLE public.reports DROP COLUMN IF EXISTS bounty_id;

-- Match production: reporter_id survives the reporter's deletion as NULL rather than
-- taking the report row with it, so moderation history is not erasable by deleting an
-- account.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid='public.reports'::regclass AND conname='reports_user_id_fkey') THEN
    ALTER TABLE public.reports RENAME CONSTRAINT reports_user_id_fkey TO reports_reporter_id_fkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.reports'::regclass AND conname='reports_reporter_id_fkey') THEN
    ALTER TABLE public.reports
      ADD CONSTRAINT reports_reporter_id_fkey
      FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_content_type_content_id
  ON public.reports (content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_reports_status_created_at
  ON public.reports (status, created_at DESC) WHERE status = 'pending';

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Staging had only the two admin policies, so even with the right columns a reporter
-- could not have inserted or read their own report. These four complete the set to
-- match production exactly.
DROP POLICY IF EXISTS reports_insert_own ON public.reports;
CREATE POLICY reports_insert_own ON public.reports
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = reporter_id);

DROP POLICY IF EXISTS reports_select_own ON public.reports;
CREATE POLICY reports_select_own ON public.reports
  FOR SELECT USING ((SELECT auth.uid()) = reporter_id);

DROP POLICY IF EXISTS reports_update_own ON public.reports;
CREATE POLICY reports_update_own ON public.reports
  FOR UPDATE USING ((SELECT auth.uid()) = reporter_id AND status = 'pending')
          WITH CHECK ((SELECT auth.uid()) = reporter_id);

DROP POLICY IF EXISTS reports_delete_own ON public.reports;
CREATE POLICY reports_delete_own ON public.reports
  FOR DELETE USING ((SELECT auth.uid()) = reporter_id AND status = 'pending');

-- Admin policies use the JWT app_metadata role: profiles.role is dead (always NULL).
DROP POLICY IF EXISTS reports_select_admin ON public.reports;
CREATE POLICY reports_select_admin ON public.reports
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS reports_update_admin ON public.reports;
CREATE POLICY reports_update_admin ON public.reports
  FOR UPDATE USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
          WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ===========================================================================
-- 2. client_logs -- absent, so write_client_log() raised on every call
-- ===========================================================================
-- 20260817000000_secure_client_log_ingestion.sql created the function on staging but
-- not its table, so lib/services/monitoring.ts's rpc('write_client_log') failed with
-- `relation "public.client_logs" does not exist` every time. Client-side error
-- reporting was therefore blind: the swarm could not have surfaced an error the app
-- tried to record.
CREATE TABLE IF NOT EXISTS public.client_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level      TEXT NOT NULL,
  message    TEXT NOT NULL,
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.client_logs ENABLE ROW LEVEL SECURITY;

-- No policies by design: reaching this table goes through write_client_log(), which is
-- SECURITY DEFINER and validates its payload. Direct access stays revoked.
REVOKE ALL ON TABLE public.client_logs FROM anon, authenticated;

-- ===========================================================================
-- 3. Tables present in production but absent on staging
-- ===========================================================================
-- None of these are on a path the mobile client takes (verified: no from('<table>')
-- and no rpc() call reaches them), so they are parity rather than a fix. They are
-- created anyway so the two projects stop diverging, and because the analytics pair is
-- reachable from SECURITY DEFINER functions that are granted to authenticated and
-- would raise if anything ever did call them.

CREATE TABLE IF NOT EXISTS public.users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username        TEXT NOT NULL,
  stripe_account_id VARCHAR,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  age_verified    BOOLEAN NOT NULL DEFAULT false,
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT users_handle_key UNIQUE (username)
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.analytics_user_facts (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  metric     TEXT NOT NULL,
  source_id  TEXT NOT NULL,
  amount     NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, metric, source_id),
  CONSTRAINT analytics_user_facts_metric_check CHECK (metric IN (
    'bounties_posted','paid_bounties_posted','bounties_claimed','bounties_completed','lifetime_gmv'))
);
ALTER TABLE public.analytics_user_facts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.analytics_person_outbox (
  user_id      UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  properties   JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  attempts     INTEGER NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  last_error   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT analytics_person_outbox_status_check
    CHECK (status IN ('pending','sending','sent','failed'))
);
ALTER TABLE public.analytics_person_outbox ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_analytics_person_outbox_pending
  ON public.analytics_person_outbox (status, scheduled_at, updated_at)
  WHERE status IN ('pending','sending','failed');

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id         UUID PRIMARY KEY,
  report_id  UUID REFERENCES public.reports(id),
  admin_id   UUID REFERENCES public.users(id),
  action     TEXT,
  notes      TEXT,
  created_at TIMESTAMP DEFAULT now()
);
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.region_waitlist_signups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email        TEXT NOT NULL,
  country_code TEXT,
  region       TEXT,
  source       TEXT NOT NULL DEFAULT 'mobile_onboarding',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.region_waitlist_signups ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS idx_region_waitlist_signups_email_country
  ON public.region_waitlist_signups (email, country_code);

-- outbox_events belongs to the separate services/api Node service, not the mobile
-- client. Created only where its enum already exists, so this never invents a type.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status2') THEN
    CREATE TABLE IF NOT EXISTS public.outbox_events (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      event_type    VARCHAR NOT NULL,
      entity_id     UUID,
      payload       JSONB NOT NULL,
      delivered_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT now(),
      status        status2 DEFAULT 'pending'::status2,
      attempts      INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      updated_at    TIMESTAMP NOT NULL DEFAULT now()
    );
    EXECUTE 'ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY';
    CREATE INDEX IF NOT EXISTS idx_outbox_events_event_type ON public.outbox_events (event_type);
    CREATE INDEX IF NOT EXISTS idx_outbox_events_created    ON public.outbox_events (created_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_events_status_attempts ON public.outbox_events (status, attempts);
  END IF;
END $$;

-- ===========================================================================
-- 4. anon grants -- staging had blanket GRANT ALL, production does not
-- ===========================================================================
-- Staging carried DELETE/INSERT/UPDATE/TRUNCATE/REFERENCES/TRIGGER for `anon` on 61
-- tables, including wallet_transactions, stripe_events, payout_audit_log and
-- admin_action_log -- none of which production grants anon at all. RLS is enabled
-- everywhere except PostGIS's spatial_ref_sys, so this was defence-in-depth rather
-- than an open door, but it means a single over-permissive policy on staging becomes
-- an unauthenticated write, and it makes staging a poor place to test authorisation.
--
-- The blanket grant came from a `GRANT ALL ... TO anon` at project setup; TRUNCATE on
-- spatial_ref_sys (RLS off) was reachable outright.

-- 4a. Privileges production never grants anon anywhere.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT table_name
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee = 'anon'
      AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon', r.table_name);
  END LOOP;
END $$;

-- 4b. Tables anon must not reach at all. Money, audit trails, reconciliation output and
--     internal caches -- production grants anon nothing on any of these.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'wallet_transactions','stripe_events','stripe_balance_snapshots','payout_audit_log',
    'admin_action_log','activation_moment_repair_snapshot','bounty_cancellations',
    'completion_ready','notifications_outbox','reconciliation_findings',
    'reconciliation_known_exceptions','reconciliation_reports','share_link_events',
    'user_follows','dispute_audit_log',
    'v_marketing_campaign_performance','v_marketing_dimension_performance',
    'v_marketing_user_outcomes','withdrawal_payout_confirmation','bounty_fund_lifecycle'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname=t) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;

-- 4c. Tables where production grants anon strictly less than staging did.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname='bounties') THEN
    -- Production: INSERT only (the pre-auth "post your first bounty" path).
    REVOKE SELECT, UPDATE, DELETE ON public.bounties FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname='bounty_payments') THEN
    REVOKE INSERT, UPDATE, DELETE ON public.bounty_payments FROM anon;   -- prod: SELECT
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname='completion_submissions') THEN
    REVOKE INSERT, UPDATE, DELETE ON public.completion_submissions FROM anon; -- prod: SELECT
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname='blocked_users') THEN
    REVOKE UPDATE ON public.blocked_users FROM anon;   -- prod: DELETE, INSERT, SELECT
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname='bounty_disputes') THEN
    REVOKE DELETE ON public.bounty_disputes FROM anon; -- prod: INSERT, SELECT, UPDATE
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname='user_activation_moments') THEN
    REVOKE DELETE ON public.user_activation_moments FROM anon; -- prod: INSERT, SELECT, UPDATE
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname='dispute_comments') THEN
    REVOKE UPDATE, DELETE ON public.dispute_comments FROM anon; -- prod: INSERT, SELECT
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname='dispute_evidence') THEN
    REVOKE UPDATE, DELETE ON public.dispute_evidence FROM anon; -- prod: INSERT, SELECT
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname='dispute_resolutions') THEN
    REVOKE UPDATE, DELETE ON public.dispute_resolutions FROM anon; -- prod: INSERT, SELECT
  END IF;
END $$;

-- 4d. Stop the next new table inheriting the same blanket grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;

-- 4e. PostGIS: attempted, but NOT effective from the `postgres` role.
--
-- public.spatial_ref_sys, geography_columns and geometry_columns are owned by
-- `supabase_admin` (the extension installs them), and a REVOKE issued by a non-owner
-- without grant option SUCCEEDS SILENTLY WITHOUT DOING ANYTHING -- no error, no change.
-- Verified by issuing it and re-reading the ACL. So this is left here for environments
-- whose migration runner is the owner, and is deliberately NOT asserted on afterwards.
--
-- Residual risk on staging, unfixable from here: spatial_ref_sys has RLS disabled and
-- anon retains TRUNCATE on it. That is PostGIS's SRID reference data, so the blast
-- radius is "geo queries stop resolving projections until the extension is repaired",
-- not user data. Production never had this grant. Escalate to a superuser to clear it.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['spatial_ref_sys','geography_columns','geometry_columns']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname=t
                 AND pg_get_userbyid(c.relowner) = current_user) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    ELSE
      RAISE NOTICE 'skipping public.% -- owned by another role, REVOKE would be a silent no-op', t;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
