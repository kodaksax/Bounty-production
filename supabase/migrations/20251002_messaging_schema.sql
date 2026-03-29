-- ============================================================================
-- Messaging Schema Migration
-- Date: 2025-10-02
-- Purpose: Creates tables for real-time 1:1 and group messaging with RLS
--          and soft-delete support.
--
-- Prerequisites: baseline schema (20251001_baseline_schema.sql) must have
-- already created the `profiles` and `bounties` tables.
--
-- Tables created:
--   - conversations
--   - conversation_participants
--   - messages
-- ============================================================================

-- ============================================================================
-- CONVERSATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group   BOOLEAN NOT NULL DEFAULT false,
  bounty_id  UUID REFERENCES public.bounties(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  name       TEXT,
  avatar     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_bounty_id  ON public.conversations (bounty_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON public.conversations (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON public.conversations (created_by);

-- ============================================================================
-- CONVERSATION PARTICIPANTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,    -- Soft delete: NULL = active, non-NULL = hidden for this user
  last_read_at    TIMESTAMPTZ,
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id
  ON public.conversation_participants (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id
  ON public.conversation_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_deleted_at
  ON public.conversation_participants (deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  media_url       TEXT,
  reply_to        UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  is_pinned       BOOLEAN NOT NULL DEFAULT false,
  is_encrypted    BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id
  ON public.messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON public.messages (reply_to) WHERE reply_to IS NOT NULL;

-- ============================================================================
-- TIMESTAMP MAINTENANCE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_conversations_updated_at ON public.conversations;
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_messages_updated_at ON public.messages;
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cascade conversation.updated_at when a new message is inserted
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.conversations
  SET updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_conversation_on_message_insert ON public.messages;
CREATE TRIGGER update_conversation_on_message_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_conversation_on_message();

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.conversations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                 ENABLE ROW LEVEL SECURITY;

-- Helper: is a given user an active participant in a conversation?
CREATE OR REPLACE FUNCTION public.is_user_participant(p_conv_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = p_conv_id
      AND user_id         = p_user_id
      AND deleted_at IS NULL
  );
END;
$$;

-- Helper: can the current auth user manage a conversation (creator or active participant)?
CREATE OR REPLACE FUNCTION public.can_manage_conversation(p_conv_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id         = p_conv_id
      AND created_by = v_user
  )
  OR EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = p_conv_id
      AND user_id         = v_user
      AND deleted_at IS NULL
  );
END;
$$;

-- Conversations policies
DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
CREATE POLICY "Users can view their conversations"
  ON public.conversations FOR SELECT
  USING (
    created_by = auth.uid()
    OR public.is_user_participant(id, auth.uid()::uuid)
  );

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;
CREATE POLICY "Participants can update conversations"
  ON public.conversations FOR UPDATE
  USING (public.can_manage_conversation(id));

-- Conversation participants policies
DROP POLICY IF EXISTS "Users can view conversation participants" ON public.conversation_participants;
CREATE POLICY "Users can view conversation participants"
  ON public.conversation_participants FOR SELECT
  USING (public.is_user_participant(conversation_id, auth.uid()::uuid));

DROP POLICY IF EXISTS "Participants and owners can add conversation participants" ON public.conversation_participants;
CREATE POLICY "Participants and owners can add conversation participants"
  ON public.conversation_participants FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR public.can_manage_conversation(conversation_id)
  );

DROP POLICY IF EXISTS "Users can update their own participant record" ON public.conversation_participants;
CREATE POLICY "Users can update their own participant record"
  ON public.conversation_participants FOR UPDATE
  USING (user_id = auth.uid());

-- Messages policies
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
CREATE POLICY "Users can view messages in their conversations"
  ON public.messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversation_id FROM public.conversation_participants
      WHERE user_id = auth.uid() AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.messages;
CREATE POLICY "Users can send messages in their conversations"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND conversation_id IN (
      SELECT conversation_id FROM public.conversation_participants
      WHERE user_id = auth.uid() AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
CREATE POLICY "Users can update their own messages"
  ON public.messages FOR UPDATE
  USING (sender_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
CREATE POLICY "Users can delete their own messages"
  ON public.messages FOR DELETE
  USING (sender_id = auth.uid());

-- ============================================================================
-- REALTIME
-- ============================================================================

-- Add tables to the Supabase realtime publication (idempotent guard)
DO $$
BEGIN
  -- conversations
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;

  -- conversation_participants
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversation_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
  END IF;

  -- messages
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END;
$$;

-- ============================================================================
-- STORAGE: profile pictures bucket
-- (Also declared in baseline; kept here as fallback — ON CONFLICT DO NOTHING)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('Profilepictures', 'Profilepictures', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read
DROP POLICY IF EXISTS "Public can view profile pictures" ON storage.objects;
CREATE POLICY "Public can view profile pictures"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'Profilepictures');

-- Authenticated users manage their own folder (path: <user_id>/<filename>)
DROP POLICY IF EXISTS "Users can upload their own profile picture" ON storage.objects;
CREATE POLICY "Users can upload their own profile picture"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'Profilepictures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update their own profile picture" ON storage.objects;
CREATE POLICY "Users can update their own profile picture"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'Profilepictures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete their own profile picture" ON storage.objects;
CREATE POLICY "Users can delete their own profile picture"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'Profilepictures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
