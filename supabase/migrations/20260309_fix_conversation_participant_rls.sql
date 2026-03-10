-- Migration: Fix conversation_participants RLS policy to allow creators to add any participant
-- Date: 2026-03-09
-- Purpose: Allow conversation creators to add participants even when they're not yet in participant table
-- Issue: When creating a conversation, adding non-creator participant first failed RLS check because:
--   1. user_id ≠ auth.uid() (other person's ID != current user)
--   2. can_manage_conversation() failed because no participants existed yet and `created_by` might be NULL
-- Solution: Create helper function to check creator status independently, update INSERT policy priority

BEGIN;

-- Helper function: Check if current user is the conversation creator
-- Uses SECURITY DEFINER so it can query conversations table without RLS interference
CREATE OR REPLACE FUNCTION is_conversation_creator(p_conv_id uuid)
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
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the INSERT policy: prioritize creator check (which bypasses participant lookup)
-- This allows:
-- 1. The user being added is the current authenticated user, OR
-- 2. The current user is the conversation creator (can add any participant), OR
-- 3. The current user is already a participant (can add new participants)
DROP POLICY IF EXISTS "Participants and owners can add conversation participants" ON conversation_participants;
CREATE POLICY "Participants and owners can add conversation participants"
  ON conversation_participants FOR INSERT
  WITH CHECK (
    -- Allow if adding yourself
    user_id = auth.uid()
    -- Allow if you're the conversation creator (even before you're added as participant)
    OR is_conversation_creator(conversation_id)
    -- Allow if you're already a participant
    OR is_user_participant(conversation_id, auth.uid()::uuid)
  );

COMMIT;
