-- Admin warnings table: allows admins to issue guideline violation warnings to users
-- Warnings are stored so admins can track repeated offenses and users can see their history.

CREATE TABLE IF NOT EXISTS admin_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bounty_id UUID REFERENCES bounties(id) ON DELETE SET NULL,
  violation_type TEXT NOT NULL CHECK (violation_type IN (
    'spam', 'harassment', 'inappropriate_content', 'fraud', 'guideline_violation', 'other'
  )),
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_admin_warnings_user_id ON admin_warnings(user_id);
-- Index for admin audit trail
CREATE INDEX IF NOT EXISTS idx_admin_warnings_admin_id ON admin_warnings(admin_id);

-- Enable RLS
ALTER TABLE admin_warnings ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can manage warnings"
ON admin_warnings
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Users can only read their own warnings
CREATE POLICY "Users can read their own warnings"
ON admin_warnings
FOR SELECT
USING (user_id = auth.uid());
