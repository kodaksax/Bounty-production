-- Migration: Add RLS policies for notifications and push_tokens tables
-- Date: 2025-12-16

-- Enable RLS on notifications table
ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;

-- Notifications: Users can only SELECT/INSERT/UPDATE their own notifications
CREATE POLICY notifications_select_own ON notifications
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY notifications_insert_own ON notifications
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY notifications_update_own ON notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable RLS on push_tokens table
ALTER TABLE IF EXISTS push_tokens ENABLE ROW LEVEL SECURITY;

-- Push tokens: Users can only SELECT/INSERT/UPDATE/DELETE their own tokens
CREATE POLICY push_tokens_select_own ON push_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY push_tokens_insert_own ON push_tokens
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY push_tokens_update_own ON push_tokens
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY push_tokens_delete_own ON push_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- Enable RLS on notification_preferences table (if it exists)
ALTER TABLE IF EXISTS notification_preferences ENABLE ROW LEVEL SECURITY;

-- Notification preferences: Users can only SELECT/INSERT/UPDATE their own preferences
CREATE POLICY notification_preferences_select_own ON notification_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY notification_preferences_insert_own ON notification_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY notification_preferences_update_own ON notification_preferences
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
