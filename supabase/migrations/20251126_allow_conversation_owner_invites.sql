-- Allow conversation owners/participants to invite additional users without violating conversation_participants RLS
-- Run in Supabase SQL editor or via `supabase db push`

-- Helper grants: conversation creators or active participants can manage membership
CREATE OR REPLACE FUNCTION public.can_manage_conversation(p_conv_id uuid)
RETURNS boolean AS $$
DECLARE
  current_user uuid := auth.uid();
BEGIN
  IF current_user IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM conversations
    WHERE id = p_conv_id
      AND created_by = current_user
  )
  OR EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conv_id
      AND user_id = current_user
      AND deleted_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace the permissive INSERT policy with one that leverages the helper
DROP POLICY IF EXISTS "Users can add conversation participants" ON conversation_participants;
CREATE POLICY "Participants and owners can add conversation participants"
  ON conversation_participants FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR can_manage_conversation(conversation_id)
  );

-- Allow conversation creator to read/update the row before participant records exist
DROP POLICY IF EXISTS "Users can view their conversations" ON conversations;
DROP POLICY IF EXISTS "conversations_select_if_participant" ON conversations;
CREATE POLICY "Users can view their conversations"
  ON conversations FOR SELECT
  USING (
    conversations.created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_participants.conversation_id = conversations.id
        AND conversation_participants.user_id = auth.uid()
        AND conversation_participants.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Participants can update conversations" ON conversations;
CREATE POLICY "Participants can update conversations"
  ON conversations FOR UPDATE
  USING (
    conversations.created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_participants.conversation_id = conversations.id
        AND conversation_participants.user_id = auth.uid()
        AND conversation_participants.deleted_at IS NULL
    )
  );
