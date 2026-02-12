-- Migration: Fix bounty_requests RLS policy to use correct poster reference
-- Description: Update RLS policies to check bounties.user_id instead of bounties.poster_id
-- Date: 2026-02-12
--
-- The bounty_requests RLS policies were checking bounties.poster_id which doesn't
-- exist in production. This migration updates all policies to use bounties.user_id
-- (the actual column name in the bounties table).

BEGIN;

-- Drop existing policies
DROP POLICY IF EXISTS "Posters can view requests for their bounties" ON public.bounty_requests;
DROP POLICY IF EXISTS "Posters can update requests for their bounties" ON public.bounty_requests;
DROP POLICY IF EXISTS "Posters can delete requests for their bounties" ON public.bounty_requests;

-- Recreate policies with correct column reference

-- Policy: Users can view requests for their own bounties (as poster)
CREATE POLICY "Posters can view requests for their bounties" 
  ON public.bounty_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bounties 
      WHERE bounties.id = bounty_requests.bounty_id 
      AND bounties.user_id = auth.uid()
    )
  );

-- Policy: Posters can update requests for their bounties (accept/reject)
CREATE POLICY "Posters can update requests for their bounties" 
  ON public.bounty_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.bounties 
      WHERE bounties.id = bounty_requests.bounty_id 
      AND bounties.user_id = auth.uid()
    )
  );

-- Policy: Posters can delete requests for their bounties
CREATE POLICY "Posters can delete requests for their bounties" 
  ON public.bounty_requests
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.bounties 
      WHERE bounties.id = bounty_requests.bounty_id 
      AND bounties.user_id = auth.uid()
    )
  );

COMMIT;

-- Instructions for verifying migration:
-- 1. Run this migration on your Supabase instance
-- 2. Try accepting a bounty request as the poster
-- 3. Verify the update succeeds and returns the updated request
-- 4. Check that non-posters cannot update requests
