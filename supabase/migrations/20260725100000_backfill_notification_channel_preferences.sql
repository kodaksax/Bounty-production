-- Notification redesign, migration 3/6: one-time backfill of
-- notification_channel_preferences from the legacy public.notification_preferences
-- table.
--
-- IMPORTANT: the live production schema for notification_preferences does NOT
-- match supabase/migrations/20251001_baseline_schema.sql — it actually has the
-- `_enabled`-suffixed granular columns (applications_enabled, acceptances_enabled,
-- completions_enabled, payments_enabled, messages_enabled, follows_enabled,
-- reminders_enabled, system_enabled) with NO channel-level columns
-- (push_enabled/email_enabled/in_app_enabled/sms_enabled do not exist in prod at
-- all). This is git/live schema drift discovered while applying this migration
-- (confirmed via information_schema.columns against the live project) — the
-- baseline migration file was apparently superseded by an out-of-band change
-- that was never committed. This backfill targets the columns that actually
-- exist in production.
--
-- Since prod never captured channel-level granularity (no push/email/in_app
-- split existed), the single legacy per-category boolean is applied uniformly
-- across all 3 real channels for that category — this preserves existing user
-- intent ("I turned off application notifications") without inventing
-- per-channel history that was never recorded.

BEGIN;

INSERT INTO public.notification_channel_preferences (user_id, category, channel, enabled)
SELECT
  np.user_id,
  cat.category,
  chan.channel,
  COALESCE(
    CASE cat.category
      WHEN 'marketplace'   THEN COALESCE(np.applications_enabled, np.acceptances_enabled, np.completions_enabled, np.reminders_enabled)
      WHEN 'messages'      THEN np.messages_enabled
      WHEN 'payments'      THEN np.payments_enabled
      WHEN 'followers'     THEN np.follows_enabled
      WHEN 'security'      THEN np.system_enabled
      WHEN 'verification'  THEN np.system_enabled
      ELSE NULL -- marketing has no legacy source; row-absent = allow default applies
    END,
    true
  ) AS enabled
FROM public.notification_preferences np
CROSS JOIN (VALUES ('marketplace'),('messages'),('payments'),('security'),
                    ('verification'),('followers'),('marketing')) AS cat(category)
CROSS JOIN (VALUES ('push'),('email'),('in_app')) AS chan(channel)
ON CONFLICT (user_id, category, channel) DO NOTHING;

COMMIT;
