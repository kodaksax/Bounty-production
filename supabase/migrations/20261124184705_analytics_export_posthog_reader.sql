-- Read-only analytics surface for the PostHog data warehouse.
--
-- Creates schema analytics_export with three column-limited views over the
-- authoritative marketplace and money tables, and a NOLOGIN role
-- posthog_reader that can read only those views. The password and LOGIN are
-- set out of band, never in a migration.
--
-- Views are owned by postgres and are NOT security_invoker, so they read the
-- base tables with the owner's rights (postgres owns the tables and bypasses
-- RLS). The reader gets no grant on any base table. No email, phone, name,
-- location or free-text column is exposed; bounty_events.metadata is excluded.
--
-- The schema must stay out of the API's exposed schemas (PostgREST
-- db_schemas). anon, authenticated and PUBLIC hold no privilege on it, so even
-- an accidental exposure would return permission errors.
--
-- Rollback: supabase/rollbacks/production/20261124184705_analytics_export_posthog_reader.down.sql

BEGIN;

CREATE SCHEMA analytics_export AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA analytics_export FROM PUBLIC, anon, authenticated;

COMMENT ON SCHEMA analytics_export IS
  'Read-only, PII-free views for the PostHog warehouse. Not exposed via the API. Read by posthog_reader only.';

-- bounties: completed_at is stored as timestamp without time zone in UTC
-- (same reading as capture_bounty_events in 20260828130000); expose it as
-- timestamptz so the warehouse does not shift it.
CREATE VIEW analytics_export.bounties_v
WITH (security_invoker = false) AS
SELECT
  b.id,
  b.poster_id,
  b.status,
  b.amount,
  b.category,
  b.funding_mode,
  b.payment_architecture_version,
  b.created_at,
  (b.completed_at AT TIME ZONE 'UTC') AS completed_at,
  p.is_internal AS poster_is_internal
FROM public.bounties b
LEFT JOIN public.profiles p ON p.id = b.poster_id;

CREATE VIEW analytics_export.bounty_events_v
WITH (security_invoker = false) AS
SELECT
  e.id,
  e.bounty_id,
  e.actor_id,
  e.event_type,
  e.source,
  e.amount,
  e.currency,
  e.occurred_at,
  e.created_at
FROM public.bounty_events e;

CREATE VIEW analytics_export.profiles_v
WITH (security_invoker = false) AS
SELECT
  p.id,
  p.created_at,
  p.is_internal,
  p.primary_role,
  p.account_status
FROM public.profiles p;

ALTER VIEW analytics_export.bounties_v      OWNER TO postgres;
ALTER VIEW analytics_export.bounty_events_v OWNER TO postgres;
ALTER VIEW analytics_export.profiles_v      OWNER TO postgres;

REVOKE ALL ON ALL TABLES IN SCHEMA analytics_export FROM PUBLIC, anon, authenticated;

-- Reader role. NOLOGIN until the password is set by hand:
--   ALTER ROLE posthog_reader WITH LOGIN PASSWORD '...';
CREATE ROLE posthog_reader NOLOGIN;

GRANT USAGE ON SCHEMA analytics_export TO posthog_reader;
GRANT SELECT ON analytics_export.bounties_v,
                analytics_export.bounty_events_v,
                analytics_export.profiles_v
  TO posthog_reader;

-- On PG16+ a CREATEROLE creator gets only ADMIN on the new role, which does
-- not allow SET ROLE. This lets postgres impersonate the reader for
-- verification (SET ROLE posthog_reader). INHERIT FALSE: postgres gains
-- nothing from the reader's privileges.
GRANT posthog_reader TO postgres WITH INHERIT FALSE, SET TRUE;

COMMIT;
