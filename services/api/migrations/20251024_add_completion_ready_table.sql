-- Add completion_ready table to track when hunters mark work as ready for review
CREATE TABLE IF NOT EXISTS completion_ready (
  bounty_id uuid PRIMARY KEY REFERENCES bounties(id) ON DELETE CASCADE,
  hunter_id uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  ready_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_completion_ready_hunter_id ON completion_ready(hunter_id);
