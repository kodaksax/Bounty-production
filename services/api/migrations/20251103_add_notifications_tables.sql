-- Migration: Add notifications and push_tokens tables
-- Date: 2025-11-03

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('application', 'acceptance', 'completion', 'payment', 'message', 'follow')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create index on user_id and read status for efficient queries
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- Create push_tokens table
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  device_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, token)
);

-- Create index on user_id for efficient token lookups
CREATE INDEX idx_push_tokens_user_id ON push_tokens(user_id);

-- Add comments for documentation
COMMENT ON TABLE notifications IS 'Stores in-app notifications for users';
COMMENT ON TABLE push_tokens IS 'Stores Expo push notification tokens for users';
COMMENT ON COLUMN notifications.type IS 'Type of notification: application, acceptance, completion, payment, message, follow';
COMMENT ON COLUMN notifications.data IS 'Additional data like bounty_id, message_id, user_id, etc.';
