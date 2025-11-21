-- Migration: Fix conversations.created_by foreign key to allow profile deletion
-- Date: 2025-11-20
-- Purpose: Ensure deleting a profile does not fail due to conversations_created_by_fkey
-- Strategy: (1) Add created_by column if missing; (2) Drop existing FK; (3) Recreate with ON DELETE SET NULL

BEGIN;

-- Add column if it does not exist
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_by uuid;

-- Drop existing constraint if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'conversations' AND constraint_name = 'conversations_created_by_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE conversations DROP CONSTRAINT conversations_created_by_fkey';
  END IF;
END$$;

-- Recreate foreign key with ON DELETE SET NULL
ALTER TABLE conversations
  ADD CONSTRAINT conversations_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- Optional: backfill created_by from first participant if desired (safe no-op if column already populated)
-- UPDATE conversations c SET created_by = cp.user_id
-- FROM conversation_participants cp
-- WHERE c.created_by IS NULL AND cp.conversation_id = c.id
--   AND cp.joined_at = (
--     SELECT MIN(joined_at) FROM conversation_participants WHERE conversation_id = c.id
--   );

COMMIT;
