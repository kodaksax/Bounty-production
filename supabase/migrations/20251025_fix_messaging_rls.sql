-- Migration: Fix RLS recursion for conversation_participants by using SECURITY DEFINER helper
-- Date: 2025-10-25

BEGIN;

-- Create a SECURITY DEFINER helper function that checks whether a user is an active participant
-- This avoids querying the same table from a policy (which can cause infinite recursion)
CREATE OR REPLACE FUNCTION public.is_user_participant(p_conv_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = p_conv_id
      AND user_id = p_user_id
      AND deleted_at IS NULL
  );
END;
$$;

-- Ensure the function is owned by the correct role (optional; will be set to the current executing role)
-- You can ALTER FUNCTION ... OWNER TO <role> if needed in your migration process.

-- Replace the conversation_participants SELECT policy to call the helper
DROP POLICY IF EXISTS "Users can view conversation participants" ON public.conversation_participants;
CREATE POLICY "Users can view conversation participants"
  ON public.conversation_participants FOR SELECT
  USING (
    -- auth.uid() is text; cast to uuid
    public.is_user_participant(conversation_id, auth.uid()::uuid)
  );

-- (Optional) grant execute on the helper to authenticated role so it can be called by policies
GRANT EXECUTE ON FUNCTION public.is_user_participant(uuid, uuid) TO authenticated;

COMMIT;
