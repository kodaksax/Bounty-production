-- Migration: Add notification_preferences table
-- Date: 2025-11-05

-- Create notification_preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  applications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  acceptances_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  completions_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  payments_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  messages_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  follows_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  system_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create index on user_id for efficient lookups
CREATE INDEX idx_notification_preferences_user_id ON notification_preferences(user_id);

-- Add comments for documentation
COMMENT ON TABLE notification_preferences IS 'Stores user preferences for which notification types they want to receive';
COMMENT ON COLUMN notification_preferences.applications_enabled IS 'Whether user wants notifications for bounty applications';
COMMENT ON COLUMN notification_preferences.acceptances_enabled IS 'Whether user wants notifications for bounty acceptances';
COMMENT ON COLUMN notification_preferences.completions_enabled IS 'Whether user wants notifications for bounty completions';
COMMENT ON COLUMN notification_preferences.payments_enabled IS 'Whether user wants notifications for payments';
COMMENT ON COLUMN notification_preferences.messages_enabled IS 'Whether user wants notifications for messages';
COMMENT ON COLUMN notification_preferences.follows_enabled IS 'Whether user wants notifications for new followers';
COMMENT ON COLUMN notification_preferences.reminders_enabled IS 'Whether user wants reminder notifications';
COMMENT ON COLUMN notification_preferences.system_enabled IS 'Whether user wants system notifications';
