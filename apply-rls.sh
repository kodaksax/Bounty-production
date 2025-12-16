#!/bin/bash
# Apply RLS migration to Supabase database

SUPABASE_URL="https://xwlwqzzphmmhghiqvkeu.supabase.co"
PROJECT_ID="xwlwqzzphmmhghiqvkeu"
DB_PASSWORD="slFAaRGFlbONQW5K"

# SQL to execute
SQL='
-- Enable RLS on notifications table
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

-- Notifications: Users can only SELECT/INSERT/UPDATE their own notifications
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own" ON public.notifications
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable RLS on push_tokens table
ALTER TABLE IF EXISTS public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Push tokens: Users can only SELECT/INSERT/UPDATE/DELETE their own tokens
DROP POLICY IF EXISTS "push_tokens_select_own" ON public.push_tokens;
CREATE POLICY "push_tokens_select_own" ON public.push_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_insert_own" ON public.push_tokens;
CREATE POLICY "push_tokens_insert_own" ON public.push_tokens
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_update_own" ON public.push_tokens;
CREATE POLICY "push_tokens_update_own" ON public.push_tokens
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_delete_own" ON public.push_tokens;
CREATE POLICY "push_tokens_delete_own" ON public.push_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- Enable RLS on notification_preferences table
ALTER TABLE IF EXISTS public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Notification preferences: Users can only SELECT/INSERT/UPDATE their own preferences
DROP POLICY IF EXISTS "notification_preferences_select_own" ON public.notification_preferences;
CREATE POLICY "notification_preferences_select_own" ON public.notification_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_preferences_insert_own" ON public.notification_preferences;
CREATE POLICY "notification_preferences_insert_own" ON public.notification_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_preferences_update_own" ON public.notification_preferences;
CREATE POLICY "notification_preferences_update_own" ON public.notification_preferences
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
'

echo "Connecting to Supabase database and applying RLS policies..."
echo "$SQL" | psql -h db.xwlwqzzphmmhghiqvkeu.supabase.co -U postgres -d postgres

echo "✅ RLS policies applied successfully!"
