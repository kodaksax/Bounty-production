# Supabase Realtime Messaging Setup Guide

This guide walks you through setting up Supabase Realtime 1:1 messaging for BOUNTYExpo.

## Prerequisites

- A Supabase project (create one at [supabase.com](https://supabase.com))
- Project URL and anon key added to your `.env` file
- Access to Supabase SQL Editor

## 1. Database Schema

Run the following SQL in your Supabase SQL Editor to create the required tables:

```sql
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
```

## 2. Row Level Security (RLS) Policies

Enable RLS and create policies to ensure users can only access their own conversations:

```sql
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
CREATE POLICY "Users can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (true);

-- Only participants can update conversations
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
CREATE POLICY "Users can add conversation participants"
  ON conversation_participants FOR INSERT
  WITH CHECK (true);

-- Users can only update their own participant record (for soft delete, last_read_at)
CREATE POLICY "Users can update their own participant record"
  ON conversation_participants FOR UPDATE
  USING (user_id = auth.uid());

-- ====================================
-- Messages Policies
-- ====================================

-- Users can view messages in conversations they're participants of (and haven't deleted)
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
CREATE POLICY "Users can update their own messages"
  ON messages FOR UPDATE
  USING (sender_id = auth.uid());

-- Users can delete their own messages
CREATE POLICY "Users can delete their own messages"
  ON messages FOR DELETE
  USING (sender_id = auth.uid());
```

## 3. Enable Realtime

Add the tables to the Realtime publication for live updates:

```sql
-- ====================================
-- Add tables to Realtime publication
-- ====================================

-- Drop existing publication if it exists and recreate
DROP PUBLICATION IF EXISTS supabase_realtime;

CREATE PUBLICATION supabase_realtime FOR TABLE
  conversations,
  conversation_participants,
  messages;

-- Alternative: If supabase_realtime already exists, just add tables
-- ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
-- ALTER PUBLICATION supabase_realtime ADD TABLE conversation_participants;
-- ALTER PUBLICATION supabase_realtime ADD TABLE messages;
```

### Enable Realtime in Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **Database** → **Replication**
3. Enable Realtime for the following tables:
   - `conversations`
   - `conversation_participants`
   - `messages`

## 4. Storage Bucket Setup (Profile Avatars)

Create a public storage bucket for profile pictures:

### Via SQL:
```sql
-- Create bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('Profilepictures', 'Profilepictures', true)
ON CONFLICT (id) DO NOTHING;
```

### Via Supabase Dashboard:
1. Navigate to **Storage** in the Supabase dashboard
2. Click **New Bucket**
3. Name: `Profilepictures`
4. Check **Public bucket**
5. Click **Create bucket**

### Storage Policies:

```sql
-- ====================================
-- Storage Policies for Profile Pictures
-- ====================================

-- Allow public read access to all profile pictures
CREATE POLICY "Public can view profile pictures"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'Profilepictures');

-- Allow authenticated users to upload their own profile picture
CREATE POLICY "Users can upload their own profile picture"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'Profilepictures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to update their own profile picture
CREATE POLICY "Users can update their own profile picture"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'Profilepictures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to delete their own profile picture
CREATE POLICY "Users can delete their own profile picture"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'Profilepictures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

## 5. Test Data (Optional)

For testing, you can insert sample conversations:

```sql
-- Create a test 1:1 conversation between two users
-- Replace <user1_id> and <user2_id> with actual profile IDs

DO $$
DECLARE
  conv_id UUID;
  user1_id UUID := '<user1_id>'; -- Replace with actual user ID
  user2_id UUID := '<user2_id>'; -- Replace with actual user ID
BEGIN
  -- Create conversation
  INSERT INTO conversations (is_group)
  VALUES (false)
  RETURNING id INTO conv_id;

  -- Add participants
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES
    (conv_id, user1_id),
    (conv_id, user2_id);

  -- Add a test message
  INSERT INTO messages (conversation_id, sender_id, text)
  VALUES (conv_id, user1_id, 'Hey! This is a test message.');

  RAISE NOTICE 'Test conversation created with ID: %', conv_id;
END $$;
```

## 6. Environment Configuration

Update your `.env` file with Supabase credentials:

```env
# Supabase Configuration (for Auth & Realtime Messaging)
EXPO_PUBLIC_SUPABASE_URL="https://your-project-ref.supabase.co"
EXPO_PUBLIC_SUPABASE_ANON_KEY="your-anon-key-here"
```

## 7. Verification Checklist

After completing setup, verify:

- [ ] All tables created successfully (conversations, conversation_participants, messages)
- [ ] RLS enabled on all three tables
- [ ] RLS policies created and working
- [ ] Triggers created for timestamp updates
- [ ] Tables added to Realtime publication
- [ ] Realtime enabled in dashboard for all three tables
- [ ] Profilepictures bucket created and public
- [ ] Storage policies configured
- [ ] Environment variables set in .env

## 8. Testing the Setup

### Test 1: Create a conversation
```sql
-- As user 1
INSERT INTO conversations (is_group) VALUES (false) RETURNING id;
-- Note the returned conversation ID

-- Add participants (replace <conversation_id>, <user1_id>, <user2_id>)
INSERT INTO conversation_participants (conversation_id, user_id)
VALUES
  ('<conversation_id>', '<user1_id>'),
  ('<conversation_id>', '<user2_id>');
```

### Test 2: Send a message
```sql
-- As user 1 (replace IDs)
INSERT INTO messages (conversation_id, sender_id, text)
VALUES ('<conversation_id>', '<user1_id>', 'Hello from user 1!');
```

### Test 3: Verify RLS
Try accessing data as different users to ensure RLS policies work correctly.

### Test 4: Realtime subscription
In your app, subscribe to messages and verify you receive real-time updates when new messages are inserted.

## Troubleshooting

### Issue: RLS policies not working
- Ensure `auth.uid()` returns a valid UUID in your context
- Check that users are properly authenticated
- Verify the profiles table has matching user IDs

### Issue: Realtime not working
- Confirm tables are in the `supabase_realtime` publication
- Check Realtime is enabled in the dashboard
- Verify your client is properly subscribed to the channel

### Issue: Storage upload fails
- Ensure bucket exists and is public
- Check storage policies are correctly configured
- Verify file path follows pattern: `<user_id>/<filename>`

## Next Steps

After completing setup:
1. Test the messaging functionality in your app
2. Verify messages sync in real-time between users
3. Test soft-delete functionality for conversations
4. Verify avatar uploads and display
5. Test offline/online scenarios

## References

- [Supabase Realtime Documentation](https://supabase.com/docs/guides/realtime)
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
