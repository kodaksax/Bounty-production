-- Migration: Add message column to bounty_requests table
-- Description: Adds an optional application message/pitch from the hunter
-- Date: 2026-03-04
--
-- Root Cause:
-- The BountyRequest type in database.types.ts includes a `message` field, and the
-- frontend sends a `message` when creating a bounty request. However, the original
-- migration (20251119_add_bounty_requests_table.sql) did not include this column,
-- causing Supabase to reject inserts with the error:
--   "column "message" of relation "bounty_requests" does not exist"
-- This caused the "Failed to submit application. Please try again." error shown to users.

BEGIN;

ALTER TABLE public.bounty_requests
  ADD COLUMN IF NOT EXISTS message text;

COMMENT ON COLUMN public.bounty_requests.message IS
  'Optional application message or pitch from the hunter when applying for a bounty';

COMMIT;
