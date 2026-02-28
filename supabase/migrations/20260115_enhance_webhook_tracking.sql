-- Webhook Tracking Enhancement Migration
-- Purpose: Add retry tracking and DLQ support to stripe_events

-- Add new columns for tracking
ALTER TABLE stripe_events 
ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_error text,
ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS last_retry_at timestamptz;

-- Update status based on existing processed column
UPDATE stripe_events 
SET status = CASE WHEN processed THEN 'processed' ELSE 'pending' END
WHERE status = 'pending';

-- Add index for efficient DLQ monitoring
CREATE INDEX IF NOT EXISTS idx_stripe_events_status_retry 
ON stripe_events(status, retry_count) 
WHERE status != 'processed';

-- Add column descriptions
COMMENT ON COLUMN stripe_events.retry_count IS 'Number of times this event has been retried';
COMMENT ON COLUMN stripe_events.last_error IS 'Last error message encountered during processing';
COMMENT ON COLUMN stripe_events.status IS 'Current processing status: pending, processing, processed, failed';
COMMENT ON COLUMN stripe_events.last_retry_at IS 'Timestamp of the last processing attempt';
