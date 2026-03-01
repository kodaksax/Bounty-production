-- Migration: Add ID verification columns to profiles
-- Description: Adds columns to track identity verification status and timestamps.
--              Also sets up storage RLS for the verification-docs bucket.
-- Date: 2026-03-02

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS id_verification_status TEXT DEFAULT 'unverified'
    CHECK (id_verification_status IN ('unverified','pending','verified','rejected')),
  ADD COLUMN IF NOT EXISTS id_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS id_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS id_reviewer_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_profiles_id_verification_status ON profiles(id_verification_status);

-- Storage bucket for verification documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'verification-docs',
  'verification-docs',
  false,
  10485760, -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: users can only read/write their own folder ({userId}/)
CREATE POLICY "Users can upload own verification docs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'verification-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can read own verification docs"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'verification-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can update own verification docs"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'verification-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'verification-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own verification docs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'verification-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;
