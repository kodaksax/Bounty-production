-- Migration: create MessageMedia storage bucket and set public access
-- Run with supabase CLI or psql as appropriate for your environment

-- Create storage bucket
-- Note: Supabase storage buckets are usually created via the Storage API or CLI.
-- This SQL creates the storage extension objects if available and documents the intent.

-- If your deployment uses the Storage REST API or UI, create a bucket named 'MessageMedia'
-- with public access for read (or configure a signed URL flow if you prefer restricted access).

-- RLS and policies for messages table: add `media_url` handling and ensure only participants can insert

-- Add column media_url to messages (string) if not present
ALTER TABLE IF EXISTS public.messages
ADD COLUMN IF NOT EXISTS media_url text;

-- Example policy: allow authenticated users to insert messages only for conversations they participate in
-- Ensure `conversation_participants` has `user_id` and `conversation_id` columns

-- Revoke default public insert if present and add more restrictive policy
-- (Adjust policy names if your DB already has them)

-- Allow inserts when the authenticated user is a participant of the conversation
CREATE POLICY IF NOT EXISTS "messages_insert_if_participant" ON public.messages
FOR INSERT TO public
USING (auth.uid() IS NOT NULL)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = new.conversation_id
      AND cp.user_id = auth.uid()
      AND cp.deleted_at IS NULL
  )
);

-- Allow selects for participants
CREATE POLICY IF NOT EXISTS "messages_select_if_participant" ON public.messages
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id = auth.uid()
      AND cp.deleted_at IS NULL
  )
);

-- For updates/deletes, similar policies should be added based on your app needs

-- NOTE: Apply these changes carefully in staging first. Adjust roles and schema names as needed.
