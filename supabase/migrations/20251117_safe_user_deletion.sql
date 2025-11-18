-- Migration: Safe User Deletion
-- Description: Allow deletion of auth users by handling cascading relationships gracefully
-- Date: 2025-11-17
-- 
-- This migration solves the issue where Supabase auth user deletion fails due to:
-- 1. Active posted bounties with applications
-- 2. User working on bounties as hunter
-- 3. Escrowed funds in wallet transactions
--
-- Solution:
-- - Change foreign key constraints to use ON DELETE SET NULL or ON DELETE CASCADE as appropriate
-- - Create a database function to handle user deletion cleanup
-- - Add trigger to automatically clean up data when auth.users row is deleted

BEGIN;

-- Step 1: Update foreign key constraints to prevent deletion blocking

-- For bounties table: Change user_id constraint to ON DELETE SET NULL
-- This allows bounties to persist even after user deletion (orphaned but visible)
ALTER TABLE bounties 
  DROP CONSTRAINT IF EXISTS bounties_user_id_fkey,
  ADD CONSTRAINT bounties_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES profiles(id) 
    ON DELETE SET NULL;

-- For bounty_requests table: Keep CASCADE on bounty_id but SET NULL on user_id
-- This preserves request history but anonymizes the hunter
ALTER TABLE bounty_requests 
  DROP CONSTRAINT IF EXISTS bounty_requests_user_id_fkey,
  ADD CONSTRAINT bounty_requests_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES profiles(id) 
    ON DELETE SET NULL;

-- For completion_submissions: SET NULL on hunter_id to preserve submission records
ALTER TABLE completion_submissions 
  DROP CONSTRAINT IF EXISTS completion_submissions_hunter_id_fkey,
  ADD CONSTRAINT completion_submissions_hunter_id_fkey 
    FOREIGN KEY (hunter_id) 
    REFERENCES profiles(id) 
    ON DELETE SET NULL;

-- For completion_ready: CASCADE delete is fine - no need to keep ready markers after user deletion
ALTER TABLE completion_ready 
  DROP CONSTRAINT IF EXISTS completion_ready_hunter_id_fkey,
  ADD CONSTRAINT completion_ready_hunter_id_fkey 
    FOREIGN KEY (hunter_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

-- For messages: Keep CASCADE - messages are personal data that should be deleted
-- (Already set to CASCADE in schema, but ensure it's correct)
ALTER TABLE messages 
  DROP CONSTRAINT IF EXISTS messages_user_id_fkey,
  ADD CONSTRAINT messages_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

-- For conversation_participants: CASCADE delete participation records
ALTER TABLE conversation_participants 
  DROP CONSTRAINT IF EXISTS conversation_participants_user_id_fkey,
  ADD CONSTRAINT conversation_participants_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

-- For wallet_transactions: SET NULL on user_id to preserve transaction history for audit
ALTER TABLE wallet_transactions 
  DROP CONSTRAINT IF EXISTS wallet_transactions_user_id_fkey,
  ADD CONSTRAINT wallet_transactions_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES profiles(id) 
    ON DELETE SET NULL;

-- For skills: CASCADE delete skills - they're user-specific
ALTER TABLE skills 
  DROP CONSTRAINT IF EXISTS skills_user_id_fkey,
  ADD CONSTRAINT skills_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

-- For reports: SET NULL to preserve report history
ALTER TABLE reports 
  DROP CONSTRAINT IF EXISTS reports_user_id_fkey,
  ADD CONSTRAINT reports_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES profiles(id) 
    ON DELETE SET NULL;

-- For blocked_users: CASCADE both columns - no need to keep blocks after user deletion
ALTER TABLE blocked_users 
  DROP CONSTRAINT IF EXISTS blocked_users_blocker_id_fkey,
  ADD CONSTRAINT blocked_users_blocker_id_fkey 
    FOREIGN KEY (blocker_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

ALTER TABLE blocked_users 
  DROP CONSTRAINT IF EXISTS blocked_users_blocked_id_fkey,
  ADD CONSTRAINT blocked_users_blocked_id_fkey 
    FOREIGN KEY (blocked_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

-- For payment_methods: CASCADE delete payment methods - they're personal
ALTER TABLE payment_methods 
  DROP CONSTRAINT IF EXISTS payment_methods_user_id_fkey,
  ADD CONSTRAINT payment_methods_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

-- Step 2: Create function to handle special cleanup before user deletion
CREATE OR REPLACE FUNCTION handle_user_deletion_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := OLD.id;
  
  -- 1. Handle active bounties: Archive them instead of leaving orphaned
  -- Bounties where user is the poster and they're still active
  UPDATE bounties 
  SET 
    status = 'archived',
    updated_at = NOW()
  WHERE user_id = v_user_id 
    AND status IN ('open', 'in_progress');
  
  -- 2. Handle escrowed funds: Release them back (create refund transactions)
  -- Find all escrow transactions for this user
  INSERT INTO wallet_transactions (
    user_id,
    type,
    amount,
    bounty_id,
    description,
    status,
    created_at
  )
  SELECT 
    NULL, -- user_id will be NULL after deletion
    'refund'::wallet_tx_type_enum,
    wt.amount,
    wt.bounty_id,
    'Auto-refund due to user account deletion',
    'completed'::wallet_tx_status_enum,
    NOW()
  FROM wallet_transactions wt
  WHERE wt.user_id = v_user_id 
    AND wt.type = 'escrow'
    AND wt.status = 'pending';
  
  -- Mark original escrow transactions as completed
  UPDATE wallet_transactions
  SET 
    status = 'completed',
    updated_at = NOW()
  WHERE user_id = v_user_id 
    AND type = 'escrow'
    AND status = 'pending';
  
  -- 3. Handle bounties where user is accepted hunter: Set accepted_by to NULL
  UPDATE bounties 
  SET 
    accepted_by = NULL,
    status = CASE 
      WHEN status = 'in_progress' THEN 'open'
      ELSE status 
    END,
    updated_at = NOW()
  WHERE accepted_by = v_user_id;
  
  -- 4. Reject pending bounty requests from this user
  UPDATE bounty_requests
  SET 
    status = 'rejected',
    updated_at = NOW()
  WHERE user_id = v_user_id 
    AND status = 'pending';
  
  -- 5. Clean up notification-related tables if they exist
  -- These tables may not exist in all deployments, so we handle them conditionally
  BEGIN
    DELETE FROM notifications WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN
      NULL; -- Table doesn't exist, skip
  END;
  
  BEGIN
    DELETE FROM push_tokens WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN
      NULL; -- Table doesn't exist, skip
  END;
  
  BEGIN
    DELETE FROM notification_preferences WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN
      NULL; -- Table doesn't exist, skip
  END;
  
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't block the deletion
    RAISE WARNING 'Error in handle_user_deletion_cleanup for user %: %', v_user_id, SQLERRM;
    RETURN OLD;
END;
$$;

-- Step 3: Create trigger on profiles deletion (which happens after auth.users deletion cascades)
DROP TRIGGER IF EXISTS trigger_user_deletion_cleanup ON profiles;
CREATE TRIGGER trigger_user_deletion_cleanup
  BEFORE DELETE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION handle_user_deletion_cleanup();

-- Step 4: Add helpful comments
COMMENT ON FUNCTION handle_user_deletion_cleanup() IS 
  'Handles cleanup of user data before profile deletion. Archives active bounties, refunds escrow, and cleans up references.';

COMMENT ON TRIGGER trigger_user_deletion_cleanup ON profiles IS
  'Automatically called before a profile is deleted to handle data cleanup and maintain referential integrity.';

-- Step 5: Ensure profiles table has proper CASCADE from auth.users
-- The profiles table should already have this, but let's verify it exists
DO $$
BEGIN
  -- Check if the foreign key exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'profiles' 
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'id'
  ) THEN
    -- Add the constraint if it doesn't exist
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_id_fkey
      FOREIGN KEY (id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;

-- Instructions for testing:
-- 1. Create a test user in Supabase auth
-- 2. Create a profile for that user
-- 3. Create some bounties, requests, and wallet transactions for that user
-- 4. Delete the user from Supabase auth (either via dashboard or admin API)
-- 5. Verify that:
--    - The user's profile is deleted
--    - Active bounties are archived
--    - Escrow funds are refunded
--    - References to the user are set to NULL (not blocking deletion)
--    - Related data is cleaned up appropriately
