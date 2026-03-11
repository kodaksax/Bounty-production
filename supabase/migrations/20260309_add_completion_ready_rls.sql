-- Migration: Add RLS policies for completion_ready table
-- Date: 2026-03-09
--
-- Purpose:
--   Enable Row Level Security (RLS) on the `completion_ready` table and provide
--   safe policies so authenticated users can mark their own work as "ready".
--
-- Notes:
--   - INSERT/UPDATE are restricted so that only the hunter (auth.uid()) may
--     create or update their own ready record (auth.uid() = hunter_id).
--   - SELECT is allowed to authenticated users so client-side code can read
--     ready records for UI flows. If you prefer stricter read rules, adjust
--     the USING clause accordingly (e.g., allow the poster or the hunter only).

BEGIN;

-- Enable RLS (idempotent)
ALTER TABLE public.completion_ready ENABLE ROW LEVEL SECURITY;

-- SELECT: allow authenticated clients to read ready records (UI needs this)
DROP POLICY IF EXISTS "completion_ready_select_authenticated" ON public.completion_ready;
CREATE POLICY "completion_ready_select_authenticated"
  ON public.completion_ready
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: only the authenticated hunter may insert a ready record for themselves
DROP POLICY IF EXISTS "completion_ready_insert_hunter" ON public.completion_ready;
CREATE POLICY "completion_ready_insert_hunter"
  ON public.completion_ready
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = hunter_id);

-- UPDATE: only the authenticated hunter may update their own ready record
DROP POLICY IF EXISTS "completion_ready_update_hunter" ON public.completion_ready;
CREATE POLICY "completion_ready_update_hunter"
  ON public.completion_ready
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = hunter_id)
  WITH CHECK (auth.uid() = hunter_id);

-- Ensure authenticated role has required privileges
GRANT SELECT, INSERT, UPDATE ON public.completion_ready TO authenticated;

COMMIT;
