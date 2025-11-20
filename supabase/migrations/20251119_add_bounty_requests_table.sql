-- Migration: Create bounty_requests table
-- Description: Add table for bounty applications/requests
-- Date: 2025-11-19
--
-- This migration creates the bounty_requests table to track hunter applications for bounties.
-- It enables the complete bounty acceptance flow:
-- 1. Hunters can apply to bounties
-- 2. Posters can view, accept, or reject applications
-- 3. Accepting triggers escrow and conversation creation

BEGIN;

-- Create request status enum if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status_enum') THEN
    CREATE TYPE request_status_enum AS ENUM ('pending', 'accepted', 'rejected');
  END IF;
END $$;

-- Create bounty_requests table
CREATE TABLE IF NOT EXISTS public.bounty_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id uuid NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  -- hunter_id is the canonical applicant reference to profiles.id
  hunter_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- poster_id for denormalization and faster queries
  poster_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  status request_status_enum NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_bounty_hunter UNIQUE (bounty_id, hunter_id)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_bounty_requests_bounty_id 
  ON public.bounty_requests(bounty_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bounty_requests_hunter_id 
  ON public.bounty_requests(hunter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bounty_requests_poster_id 
  ON public.bounty_requests(poster_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bounty_requests_status 
  ON public.bounty_requests(status, created_at DESC);

-- Create trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION set_bounty_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bounty_requests_updated_at
  BEFORE UPDATE ON public.bounty_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_bounty_requests_updated_at();

-- Enable Row Level Security
ALTER TABLE public.bounty_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies

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

-- Policy: Users can view their own applications (as hunter)
CREATE POLICY "Hunters can view their own applications" 
  ON public.bounty_requests
  FOR SELECT
  USING (auth.uid() = hunter_id);

-- Policy: Users can create applications for bounties
CREATE POLICY "Hunters can create applications" 
  ON public.bounty_requests
  FOR INSERT
  WITH CHECK (auth.uid() = hunter_id);

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

-- Policy: Hunters can delete their own pending applications
CREATE POLICY "Hunters can delete their own pending applications" 
  ON public.bounty_requests
  FOR DELETE
  USING (auth.uid() = hunter_id AND status = 'pending');

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

-- Grant appropriate permissions
GRANT SELECT, INSERT ON public.bounty_requests TO authenticated;
GRANT UPDATE, DELETE ON public.bounty_requests TO authenticated;

-- Add helpful comments
COMMENT ON TABLE public.bounty_requests IS 
  'Tracks hunter applications for bounties. Part of the bounty acceptance flow.';

COMMENT ON COLUMN public.bounty_requests.hunter_id IS 
  'The user ID of the hunter applying for the bounty';

COMMENT ON COLUMN public.bounty_requests.poster_id IS 
  'The user ID of the bounty poster (denormalized for faster queries)';

COMMENT ON COLUMN public.bounty_requests.status IS 
  'Current status of the application: pending, accepted, or rejected';

COMMIT;

-- Instructions for verifying migration:
-- 1. Run this migration on your Supabase instance
-- 2. Verify the table exists: SELECT * FROM information_schema.tables WHERE table_name = 'bounty_requests';
-- 3. Verify RLS is enabled: SELECT * FROM pg_tables WHERE tablename = 'bounty_requests' AND rowsecurity = true;
-- 4. Test creating a bounty request as an authenticated user
-- 5. Test that posters can view and update requests for their bounties
