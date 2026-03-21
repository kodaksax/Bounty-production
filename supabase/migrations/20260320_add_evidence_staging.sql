-- Add staging columns to dispute_evidence to support multi-stage upload flow
BEGIN;

-- Make dispute_id nullable so evidence can be staged before a dispute exists
ALTER TABLE public.dispute_evidence
  ALTER COLUMN dispute_id DROP NOT NULL;

-- Add storage metadata and upload flags
ALTER TABLE public.dispute_evidence
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS uploaded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upload_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checksum text,
  ADD COLUMN IF NOT EXISTS staged_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Add an index to efficiently find staged/unverified evidence
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_uploaded_status
  ON public.dispute_evidence (uploaded, upload_verified, staged_at);

COMMIT;

-- Backfill note: existing rows currently have dispute_id not null; after this migration
-- they will remain linked to disputes. New evidence can be created with dispute_id NULL
-- until the client calls the commit endpoint which will link evidence rows to a dispute.
