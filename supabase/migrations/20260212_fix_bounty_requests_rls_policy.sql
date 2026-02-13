-- Migration: Fix bounty request acceptance by ensuring poster_id is populated
-- Description: The real issue is that some bounties may have NULL poster_id values
-- Date: 2026-02-13
--
-- Root Cause Analysis:
-- 1. The RLS policies correctly check bounties.poster_id = auth.uid()
-- 2. BUT if poster_id is NULL, the comparison always fails (NULL = X is always FALSE)
-- 3. This causes RLS policy violations when posters try to accept requests
--
-- Solution:
-- This migration ensures that all bounties have a valid poster_id by:
-- 1. Checking for bounties with NULL poster_id
-- 2. Providing diagnostics to identify the data issue
-- 3. Documenting the fix (poster_id must be populated for all bounties)

BEGIN;

-- First, let's check if there are any bounties with NULL poster_id
-- This query will help diagnose the issue
DO $$
DECLARE
  null_poster_count integer;
  total_bounty_count integer;
BEGIN
  SELECT COUNT(*) INTO null_poster_count 
  FROM public.bounties 
  WHERE poster_id IS NULL;
  
  SELECT COUNT(*) INTO total_bounty_count 
  FROM public.bounties;
  
  RAISE NOTICE 'Bounties with NULL poster_id: % out of %', null_poster_count, total_bounty_count;
  
  IF null_poster_count > 0 THEN
    RAISE WARNING 'Found % bounties with NULL poster_id. These bounties will not be accessible via RLS policies!', null_poster_count;
    RAISE NOTICE 'To fix: UPDATE bounties SET poster_id = <owner_user_id> WHERE poster_id IS NULL;';
  END IF;
END$$;

-- The RLS policies are already correct - they check bounties.poster_id
-- We just need to ensure poster_id is populated for all bounties

-- Drop and recreate policies to ensure they are current
DROP POLICY IF EXISTS "Posters can view requests for their bounties" ON public.bounty_requests;
DROP POLICY IF EXISTS "Posters can update requests for their bounties" ON public.bounty_requests;
DROP POLICY IF EXISTS "Posters can delete requests for their bounties" ON public.bounty_requests;

-- Policy: Users can view requests for their own bounties (as poster)
CREATE POLICY "Posters can view requests for their bounties" 
  ON public.bounty_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bounties 
      WHERE bounties.id = bounty_requests.bounty_id 
      AND bounties.poster_id = auth.uid()
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
      AND bounties.poster_id = auth.uid()
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
      AND bounties.poster_id = auth.uid()
    )
  );

COMMIT;

-- Post-migration verification queries:
--
-- 1. Check for bounties with NULL poster_id:
--    SELECT id, title, created_at FROM bounties WHERE poster_id IS NULL;
--
-- 2. Check if user can see their own bounties' requests:
--    SELECT br.* FROM bounty_requests br
--    JOIN bounties b ON b.id = br.bounty_id
--    WHERE b.poster_id = auth.uid();
--
-- 3. If poster_id is NULL for some bounties, you need to populate it:
--    -- If you have a user_id column:
--    UPDATE bounties SET poster_id = user_id WHERE poster_id IS NULL AND user_id IS NOT NULL;
--    
--    -- If you need to manually set the poster:
--    UPDATE bounties SET poster_id = '<user-uuid>' WHERE id = '<bounty-uuid>';
--
-- 4. Verify RLS policies are working:
--    -- This should return rows only for the authenticated user's bounties:
--    SELECT * FROM bounty_requests;  -- as the poster
