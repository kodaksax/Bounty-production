-- Reverts 20261124184705_analytics_export_posthog_reader.sql.
--
-- Drops the three views, the analytics_export schema and the posthog_reader
-- role. Any PostHog warehouse source using posthog_reader stops syncing.
-- No base table or data is touched.
--
-- DROP ROLE fails if the role still has sessions or owns objects; disconnect
-- the PostHog source first.

BEGIN;

DROP VIEW IF EXISTS analytics_export.bounties_v;
DROP VIEW IF EXISTS analytics_export.bounty_events_v;
DROP VIEW IF EXISTS analytics_export.profiles_v;

DROP SCHEMA IF EXISTS analytics_export RESTRICT;

DROP ROLE IF EXISTS posthog_reader;

COMMIT;
