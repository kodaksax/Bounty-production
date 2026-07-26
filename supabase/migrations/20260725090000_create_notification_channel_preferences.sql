-- Notification redesign, migration 2/6: normalized per-category, per-channel
-- preference table, replacing the drifted public.notification_preferences shape
-- (DB has bare columns like `messages`/`applications`; every reader already
-- expects `_enabled`-suffixed columns that were never actually migrated in —
-- see services/api/src/services/notification-service.ts's mapPreferenceRow
-- fallback logic and process-notification/index.ts's readToggle()). Rather than
-- add a third column-naming convention, this is one normalized table so adding
-- an 8th category later is a data change, not a schema change.
--
-- public.notification_preferences is NOT dropped by this migration — it is left
-- in place, unused by new code, until a later migration confirms nothing else
-- still reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_channel_preferences (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category   text NOT NULL CHECK (category IN
               ('marketplace','messages','payments','security','verification','followers','marketing')),
  channel    text NOT NULL CHECK (channel IN ('push','email','sms','in_app')),
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, category, channel)
);

CREATE INDEX IF NOT EXISTS idx_notif_channel_prefs_user
  ON public.notification_channel_preferences (user_id);

DROP TRIGGER IF EXISTS trg_notification_channel_preferences_updated_at
  ON public.notification_channel_preferences;
CREATE TRIGGER trg_notification_channel_preferences_updated_at
  BEFORE UPDATE ON public.notification_channel_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.notification_channel_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_channel_prefs_select_own" ON public.notification_channel_preferences;
CREATE POLICY "notif_channel_prefs_select_own" ON public.notification_channel_preferences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_channel_prefs_insert_own" ON public.notification_channel_preferences;
CREATE POLICY "notif_channel_prefs_insert_own" ON public.notification_channel_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_channel_prefs_update_own" ON public.notification_channel_preferences;
CREATE POLICY "notif_channel_prefs_update_own" ON public.notification_channel_preferences
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_channel_prefs_delete_own" ON public.notification_channel_preferences;
CREATE POLICY "notif_channel_prefs_delete_own" ON public.notification_channel_preferences
  FOR DELETE USING (auth.uid() = user_id);

COMMIT;
