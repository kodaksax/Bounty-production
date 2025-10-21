-- Create completion_submissions and ratings tables
CREATE TABLE IF NOT EXISTS completion_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id uuid NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  hunter_id uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  message text,
  proof_items jsonb,
  submitted_at timestamptz NOT NULL DEFAULT NOW(),
  status text NOT NULL DEFAULT 'pending',
  poster_feedback text,
  revision_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_completion_bounty_id ON completion_submissions(bounty_id);
CREATE INDEX IF NOT EXISTS idx_completion_hunter_id ON completion_submissions(hunter_id);

-- Ratings table
CREATE TABLE IF NOT EXISTS ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id uuid REFERENCES bounties(id) ON DELETE SET NULL,
  from_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  to_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  rating integer NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ratings_to_user ON ratings(to_user_id);
