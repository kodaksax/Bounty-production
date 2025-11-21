-- Migration: allow conversations.created_by to be nullable and maintain ON DELETE SET NULL FK
-- Purpose: prevent profile deletion failures when conversations reference the user
-- Instructions: run in Supabase SQL editor or supabase CLI before retrying deletion

BEGIN;

-- Ensure the column allows NULL since the FK uses ON DELETE SET NULL during profile deletion
ALTER TABLE conversations
  ALTER COLUMN created_by DROP NOT NULL;

-- Recreate foreign key to guarantee ON DELETE SET NULL semantics
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_created_by_fkey,
  ADD CONSTRAINT conversations_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES profiles(id)
    ON DELETE SET NULL;

COMMIT;
