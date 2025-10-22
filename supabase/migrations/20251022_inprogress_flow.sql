-- Migration: In-Progress Bounty Management Flow
-- Description: Add tables for ready-to-submit markers and completion submissions
-- Date: 2025-10-22

-- Table: completion_ready
-- Purpose: Track when hunters mark a bounty as "ready to submit"
CREATE TABLE IF NOT EXISTS public.completion_ready (
  bounty_id uuid NOT NULL,
  hunter_id uuid NOT NULL,
  ready_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bounty_id, hunter_id)
);

-- Index for fast lookups by bounty_id
CREATE INDEX IF NOT EXISTS idx_completion_ready_bounty_id 
  ON public.completion_ready(bounty_id, ready_at DESC);

-- Table: completion_submissions
-- Purpose: Track hunter completion submissions with proof and status
CREATE TABLE IF NOT EXISTS public.completion_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id uuid NOT NULL,
  hunter_id uuid NOT NULL,
  message text,
  proof_items jsonb,
  status text NOT NULL CHECK (status IN ('pending', 'revision_requested', 'approved', 'rejected')),
  poster_feedback text,
  submitted_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  revision_count integer DEFAULT 0
);

-- Index for fast lookups by bounty_id and submission time
CREATE INDEX IF NOT EXISTS idx_completion_submissions_bounty_id 
  ON public.completion_submissions(bounty_id, submitted_at DESC);

-- Index for hunter's submissions
CREATE INDEX IF NOT EXISTS idx_completion_submissions_hunter_id 
  ON public.completion_submissions(hunter_id, submitted_at DESC);

-- Optional: Add accepted_by column to bounties table if it doesn't exist
-- This column tracks which hunter was accepted for the bounty
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bounties' AND column_name = 'accepted_by'
  ) THEN
    ALTER TABLE public.bounties ADD COLUMN accepted_by uuid;
  END IF;
END $$;

-- Grant appropriate permissions (adjust as needed for your RLS policies)
-- These are basic grants; you should customize based on your security requirements

-- Allow authenticated users to read their own completion data
GRANT SELECT ON public.completion_ready TO authenticated;
GRANT SELECT ON public.completion_submissions TO authenticated;

-- Allow hunters to insert/update their ready markers
GRANT INSERT, UPDATE ON public.completion_ready TO authenticated;

-- Allow hunters to insert their submissions
GRANT INSERT ON public.completion_submissions TO authenticated;

-- Allow posters to update submission status (for approval/revision requests)
GRANT UPDATE ON public.completion_submissions TO authenticated;

-- Note: You should implement Row Level Security (RLS) policies to ensure:
-- 1. Hunters can only mark their own bounties as ready
-- 2. Hunters can only submit for bounties they're assigned to
-- 3. Posters can only update submissions for their own bounties
-- 4. Users can only see submissions related to their bounties (as poster or hunter)

-- Example RLS policy for completion_submissions (enable and customize as needed):
-- ALTER TABLE public.completion_submissions ENABLE ROW LEVEL SECURITY;
-- 
-- CREATE POLICY "Users can view their own submissions" ON public.completion_submissions
--   FOR SELECT
--   USING (auth.uid() = hunter_id);
-- 
-- CREATE POLICY "Posters can view submissions for their bounties" ON public.completion_submissions
--   FOR SELECT
--   USING (
--     EXISTS (
--       SELECT 1 FROM public.bounties 
--       WHERE bounties.id = completion_submissions.bounty_id 
--       AND bounties.poster_id = auth.uid()
--     )
--   );
-- 
-- CREATE POLICY "Hunters can insert their own submissions" ON public.completion_submissions
--   FOR INSERT
--   WITH CHECK (auth.uid() = hunter_id);
-- 
-- CREATE POLICY "Posters can update submissions for their bounties" ON public.completion_submissions
--   FOR UPDATE
--   USING (
--     EXISTS (
--       SELECT 1 FROM public.bounties 
--       WHERE bounties.id = completion_submissions.bounty_id 
--       AND bounties.poster_id = auth.uid()
--     )
--   );
