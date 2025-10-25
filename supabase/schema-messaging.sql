-- ====================================
-- BountyExpo Supabase Messaging Schema
-- ====================================
-- Run this script in your Supabase SQL Editor to set up
-- real-time 1:1 messaging with RLS and soft delete support
--
-- Prerequisites:
-- - A 'profiles' table must exist with columns: id, username, full_name, avatar
-- - A 'bounties' table must exist with column: id
--
-- Tables created:
-- - conversations
-- - conversation_participants
-- - messages

-- ====================================
-- Conversations Table
-- ====================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group BOOLEAN NOT NULL DEFAULT false,
  bounty_id UUID REFERENCES bounties(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for faster bounty-related conversation lookups
CREATE INDEX IF NOT EXISTS idx_conversations_bounty_id ON conversations(bounty_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- ====================================
-- Conversation Participants Table
-- ====================================
CREATE TABLE IF NOT EXISTS conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ, -- Soft delete: null = active, non-null = hidden for this user
  last_read_at TIMESTAMPTZ,
  UNIQUE(conversation_id, user_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id ON conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_deleted_at ON conversation_participants(deleted_at) WHERE deleted_at IS NULL;

-- ====================================
-- Messages Table
-- ====================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  media_url TEXT,
  reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false
);

-- Indexes for efficient message retrieval
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to) WHERE reply_to IS NOT NULL;

-- ====================================
-- Auto-update timestamps
-- ====================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for conversations
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for messages
DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ====================================
-- Update conversation timestamp on new message
-- ====================================
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_conversation_on_message_insert ON messages;
CREATE TRIGGER update_conversation_on_message_insert
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_on_message();

-- ====================================
-- Enable RLS
-- ====================================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ====================================
-- Conversations Policies
-- ====================================

-- Users can view conversations they're participants in (and haven't deleted)
DROP POLICY IF EXISTS "Users can view their conversations" ON conversations;
CREATE POLICY "Users can view their conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_participants.conversation_id = conversations.id
        AND conversation_participants.user_id = auth.uid()
        AND conversation_participants.deleted_at IS NULL
    )
  );

-- Users can create conversations (conversation_participants will be added separately)
DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
CREATE POLICY "Users can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (true);

-- Only participants can update conversations
DROP POLICY IF EXISTS "Participants can update conversations" ON conversations;
CREATE POLICY "Participants can update conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_participants.conversation_id = conversations.id
        AND conversation_participants.user_id = auth.uid()
        AND conversation_participants.deleted_at IS NULL
    )
  );

-- ====================================
-- Conversation Participants Policies
-- ====================================

-- Users can view participants of conversations they're in
DROP POLICY IF EXISTS "Users can view conversation participants" ON conversation_participants;
CREATE POLICY "Users can view conversation participants"
  ON conversation_participants FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_participants
      WHERE user_id = auth.uid()
        AND deleted_at IS NULL
    )
  );

-- Users can add participants when creating/joining conversations
DROP POLICY IF EXISTS "Users can add conversation participants" ON conversation_participants;
CREATE POLICY "Users can add conversation participants"
  ON conversation_participants FOR INSERT
  WITH CHECK (true);

-- Users can only update their own participant record (for soft delete, last_read_at)
DROP POLICY IF EXISTS "Users can update their own participant record" ON conversation_participants;
CREATE POLICY "Users can update their own participant record"
  ON conversation_participants FOR UPDATE
  USING (user_id = auth.uid());

-- ====================================
-- Messages Policies
-- ====================================

-- Users can view messages in conversations they're participants of (and haven't deleted)
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view messages in their conversations"
  ON messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_participants
      WHERE user_id = auth.uid()
        AND deleted_at IS NULL
    )
  );

-- Users can send messages in conversations they're participants of
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON messages;
CREATE POLICY "Users can send messages in their conversations"
  ON messages FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT conversation_id FROM conversation_participants
      WHERE user_id = auth.uid()
        AND deleted_at IS NULL
    )
    AND sender_id = auth.uid()
  );

-- Users can only update their own messages (for pinning, editing)
DROP POLICY IF EXISTS "Users can update their own messages" ON messages;
CREATE POLICY "Users can update their own messages"
  ON messages FOR UPDATE
  USING (sender_id = auth.uid());

-- Users can delete their own messages
DROP POLICY IF EXISTS "Users can delete their own messages" ON messages;
CREATE POLICY "Users can delete their own messages"
  ON messages FOR DELETE
  USING (sender_id = auth.uid());

-- ====================================
-- Add tables to Realtime publication
-- ====================================

-- Alternative: If supabase_realtime already exists, just add tables
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Note: If you get an error that tables are already in the publication, that's OK!
-- If you need to recreate the publication from scratch, use:
-- DROP PUBLICATION IF EXISTS supabase_realtime;
-- CREATE PUBLICATION supabase_realtime FOR TABLE conversations, conversation_participants, messages;

-- ====================================
-- Storage Bucket for Profile Pictures
-- ====================================

-- Create bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('Profilepictures', 'Profilepictures', true)
ON CONFLICT (id) DO NOTHING;

-- ====================================
-- Storage Policies for Profile Pictures
-- ====================================

-- IMPORTANT: Profile pictures should be stored with the path format:
-- <user_id>/<filename>
-- This ensures users can only access their own profile pictures for upload/update/delete
-- while maintaining public read access for all users

-- Allow public read access to all profile pictures
DROP POLICY IF EXISTS "Public can view profile pictures" ON storage.objects;
CREATE POLICY "Public can view profile pictures"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'Profilepictures');

-- Allow authenticated users to upload their own profile picture
-- Files must be in a folder named after the user's ID
DROP POLICY IF EXISTS "Users can upload their own profile picture" ON storage.objects;
CREATE POLICY "Users can upload their own profile picture"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'Profilepictures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to update their own profile picture
DROP POLICY IF EXISTS "Users can update their own profile picture" ON storage.objects;
CREATE POLICY "Users can update their own profile picture"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'Profilepictures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to delete their own profile picture
DROP POLICY IF EXISTS "Users can delete their own profile picture" ON storage.objects;
CREATE POLICY "Users can delete their own profile picture"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'Profilepictures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ====================================
-- Verification
-- ====================================

-- Run these queries to verify the setup:
-- SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('conversations', 'conversation_participants', 'messages');
-- SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('conversations', 'conversation_participants', 'messages');
-- SELECT pubname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- Setup complete! ✅
