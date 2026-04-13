-- Migration: fix_staging_schema_issues
-- Date: 2026-04-12
-- Fixes three runtime errors observed in staging:
--   1. PGRST204 – 'accepted_by' column missing from bounties schema cache
--   2. PGRST202 – rpc_create_conversation function not found
--   3. (code-side fix) profiles.full_name → display_name (done in supabase-messaging.ts)

-- ============================================================================
-- 1. Ensure bounties.accepted_by column exists
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bounties'
      AND column_name  = 'accepted_by'
  ) THEN
    ALTER TABLE public.bounties ADD COLUMN accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 2. Ensure bounties.accepted_request_id column exists
--    (used by fn_accept_bounty_request from 20260323 migration)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bounties'
      AND column_name  = 'accepted_request_id'
  ) THEN
    ALTER TABLE public.bounties ADD COLUMN accepted_request_id uuid;
  END IF;
END $$;

-- ============================================================================
-- 3. Create rpc_create_conversation SECURITY DEFINER function
--    Called by the client after a request is accepted to bootstrap the chat.
--    Parameters:
--      p_bounty_id         – UUID of the related bounty (text-cast to uuid)
--      p_name              – display name for the conversation
--      p_participant_ids   – array of user UUIDs to add as participants
--    Returns: UUID of the newly created conversation
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_create_conversation(
  p_bounty_id       text,
  p_name            text,
  p_participant_ids text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_caller_id       uuid := auth.uid();
  v_participant     text;
  v_participant_ids text[] := COALESCE(p_participant_ids, ARRAY[]::text[]);
BEGIN
  -- Require an authenticated caller (function is granted to "authenticated" role,
  -- but be explicit here to avoid creating conversations with NULL creators)
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Ensure caller is included in the participant list and moved to the front
  IF array_position(v_participant_ids, v_caller_id::text) IS NULL THEN
    v_participant_ids := array_prepend(v_caller_id::text, v_participant_ids);
  ELSE
    -- Move caller to the front to ensure creator participant is inserted first
    v_participant_ids := array_remove(v_participant_ids, v_caller_id::text);
    v_participant_ids := array_prepend(v_caller_id::text, v_participant_ids);
  END IF;

  -- Create the conversation row; treat as group if more than 2 participants
  INSERT INTO public.conversations (bounty_id, name, is_group, created_by)
  VALUES (
    p_bounty_id::uuid,
    p_name,
    (array_length(v_participant_ids, 1) > 2),
    v_caller_id
  )
  RETURNING id INTO v_conversation_id;

  -- Add each participant (creator first to satisfy any RLS ordering requirements)
  FOREACH v_participant IN ARRAY v_participant_ids
  LOOP
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (v_conversation_id, v_participant::uuid)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END LOOP;

  RETURN v_conversation_id;
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.rpc_create_conversation(text, text, text[]) TO authenticated;

-- ============================================================================
-- 4. Reload PostgREST schema cache so new columns/functions are visible
-- ============================================================================
NOTIFY pgrst, 'reload schema';
