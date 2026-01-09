-- Comprehensive Dispute Resolution System Migration
-- This migration enhances the existing dispute system with resolution records, comments, and audit trails

-- Note: Using CREATE TABLE IF NOT EXISTS for bounty_cancellations and bounty_disputes
-- as these tables may already exist from previous migrations. If they exist, this will
-- only add new columns if needed. For production, consider using ALTER TABLE statements
-- to explicitly add new columns to existing tables.

-- First, ensure the bounty_cancellations table exists with all necessary fields
CREATE TABLE IF NOT EXISTS bounty_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id UUID NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requester_type TEXT NOT NULL CHECK (requester_type IN ('poster', 'hunter')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'disputed')),
  responder_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  response_message TEXT,
  refund_amount INTEGER, -- Amount in cents
  refund_percentage INTEGER, -- Percentage (0-100)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Ensure the bounty_disputes table exists with enhanced fields
CREATE TABLE IF NOT EXISTS bounty_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cancellation_id UUID NOT NULL REFERENCES bounty_cancellations(id) ON DELETE CASCADE,
  bounty_id UUID NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  initiator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  evidence_json JSONB, -- Array of evidence items
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'closed')),
  resolution TEXT,
  resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- New fields for automation
  auto_close_at TIMESTAMPTZ, -- When to auto-close if no response
  escalated BOOLEAN NOT NULL DEFAULT FALSE,
  escalated_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create dispute_resolutions table for detailed resolution records
CREATE TABLE IF NOT EXISTS dispute_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES bounty_disputes(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('release', 'refund', 'split', 'other')),
  amount_to_hunter INTEGER DEFAULT 0, -- Amount in cents
  amount_to_poster INTEGER DEFAULT 0, -- Amount in cents
  rationale TEXT NOT NULL,
  metadata JSONB, -- Additional decision details
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(dispute_id) -- One resolution per dispute
);

-- Create dispute_comments table for mediation discussion
CREATE TABLE IF NOT EXISTS dispute_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES bounty_disputes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE, -- Internal admin notes vs public comments
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create dispute_evidence table for better evidence management
CREATE TABLE IF NOT EXISTS dispute_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES bounty_disputes(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('text', 'image', 'document', 'link')),
  content TEXT NOT NULL, -- URL for images/docs, text content, or link
  description TEXT,
  mime_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create dispute_appeals table for appeal mechanism
CREATE TABLE IF NOT EXISTS dispute_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES bounty_disputes(id) ON DELETE CASCADE,
  appellant_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'accepted', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create dispute_audit_log table for complete audit trail
CREATE TABLE IF NOT EXISTS dispute_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES bounty_disputes(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- e.g., 'created', 'status_changed', 'evidence_added', 'resolved', 'appealed'
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
  details JSONB, -- Additional action details
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_dispute_resolutions_dispute_id ON dispute_resolutions(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_comments_dispute_id ON dispute_comments(dispute_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_comments_internal ON dispute_comments(is_internal, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute_id ON dispute_evidence(dispute_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_type ON dispute_evidence(type);
CREATE INDEX IF NOT EXISTS idx_dispute_appeals_status ON dispute_appeals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_appeals_dispute_id ON dispute_appeals(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_audit_log_dispute_id ON dispute_audit_log(dispute_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bounty_disputes_auto_close ON bounty_disputes(auto_close_at) WHERE status IN ('open', 'under_review') AND auto_close_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bounty_disputes_escalated ON bounty_disputes(escalated, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bounty_disputes_last_activity ON bounty_disputes(last_activity_at DESC) WHERE status IN ('open', 'under_review');

-- Add RLS policies for dispute_resolutions
ALTER TABLE dispute_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view resolutions for disputes they're involved in" ON dispute_resolutions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bounty_disputes bd
      JOIN bounties b ON bd.bounty_id = b.id
      WHERE bd.id = dispute_resolutions.dispute_id
      AND (bd.initiator_id = auth.uid() OR b.poster_id = auth.uid() OR b.hunter_id = auth.uid())
    )
  );

CREATE POLICY "Only admins can create resolutions" ON dispute_resolutions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Add RLS policies for dispute_comments
ALTER TABLE dispute_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view public comments on their disputes" ON dispute_comments
  FOR SELECT
  USING (
    (NOT is_internal) AND EXISTS (
      SELECT 1 FROM bounty_disputes bd
      JOIN bounties b ON bd.bounty_id = b.id
      WHERE bd.id = dispute_comments.dispute_id
      AND (bd.initiator_id = auth.uid() OR b.poster_id = auth.uid() OR b.hunter_id = auth.uid())
    )
  );

CREATE POLICY "Admins can view all comments" ON dispute_comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Users can add comments to their disputes" ON dispute_comments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND NOT is_internal AND EXISTS (
      SELECT 1 FROM bounty_disputes bd
      JOIN bounties b ON bd.bounty_id = b.id
      WHERE bd.id = dispute_comments.dispute_id
      AND (bd.initiator_id = auth.uid() OR b.poster_id = auth.uid() OR b.hunter_id = auth.uid())
    )
  );

CREATE POLICY "Admins can add any comments" ON dispute_comments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Add RLS policies for dispute_evidence
ALTER TABLE dispute_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view evidence for disputes they're involved in" ON dispute_evidence
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bounty_disputes bd
      JOIN bounties b ON bd.bounty_id = b.id
      WHERE bd.id = dispute_evidence.dispute_id
      AND (bd.initiator_id = auth.uid() OR b.poster_id = auth.uid() OR b.hunter_id = auth.uid())
    )
  );

CREATE POLICY "Users can add evidence to their disputes" ON dispute_evidence
  FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid() AND EXISTS (
      SELECT 1 FROM bounty_disputes bd
      JOIN bounties b ON bd.bounty_id = b.id
      WHERE bd.id = dispute_evidence.dispute_id
      AND (bd.initiator_id = auth.uid() OR b.poster_id = auth.uid() OR b.hunter_id = auth.uid())
    )
  );

-- Add RLS policies for dispute_appeals
ALTER TABLE dispute_appeals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own appeals" ON dispute_appeals
  FOR SELECT
  USING (appellant_id = auth.uid());

CREATE POLICY "Admins can view all appeals" ON dispute_appeals
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Users can create appeals for their disputes" ON dispute_appeals
  FOR INSERT
  WITH CHECK (
    appellant_id = auth.uid() AND EXISTS (
      SELECT 1 FROM bounty_disputes bd
      JOIN bounties b ON bd.bounty_id = b.id
      WHERE bd.id = dispute_appeals.dispute_id
      AND bd.status = 'resolved'
      AND (bd.initiator_id = auth.uid() OR b.poster_id = auth.uid() OR b.hunter_id = auth.uid())
    )
  );

CREATE POLICY "Admins can update appeals" ON dispute_appeals
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Add RLS policies for dispute_audit_log
ALTER TABLE dispute_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all audit logs" ON dispute_audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "System can insert audit logs" ON dispute_audit_log
  FOR INSERT
  WITH CHECK (TRUE);

-- Create trigger to update last_activity_at on disputes
CREATE OR REPLACE FUNCTION update_dispute_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE bounty_disputes
  SET last_activity_at = NOW(),
      updated_at = NOW()
  WHERE id = NEW.dispute_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispute_evidence_activity_trigger
  AFTER INSERT ON dispute_evidence
  FOR EACH ROW
  EXECUTE FUNCTION update_dispute_last_activity();

CREATE TRIGGER dispute_comment_activity_trigger
  AFTER INSERT ON dispute_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_dispute_last_activity();

-- Create function to log audit events
CREATE OR REPLACE FUNCTION log_dispute_audit(
  p_dispute_id UUID,
  p_action TEXT,
  p_actor_id UUID,
  p_actor_type TEXT,
  p_details JSONB DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO dispute_audit_log (dispute_id, action, actor_id, actor_type, details)
  VALUES (p_dispute_id, p_action, p_actor_id, p_actor_type, p_details);
END;
$$ LANGUAGE plpgsql;

-- Create trigger to log dispute status changes
CREATE OR REPLACE FUNCTION log_dispute_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM log_dispute_audit(
      NEW.id,
      'status_changed',
      auth.uid(),
      CASE WHEN EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') 
           THEN 'admin' ELSE 'user' END,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispute_status_change_trigger
  AFTER UPDATE OF status ON bounty_disputes
  FOR EACH ROW
  EXECUTE FUNCTION log_dispute_status_change();

-- Create function to automatically set auto_close_at when dispute is created
CREATE OR REPLACE FUNCTION set_dispute_auto_close()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-close after 7 days if no response
  NEW.auto_close_at := NEW.created_at + INTERVAL '7 days';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_dispute_auto_close_trigger
  BEFORE INSERT ON bounty_disputes
  FOR EACH ROW
  EXECUTE FUNCTION set_dispute_auto_close();

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON dispute_resolutions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON dispute_comments TO authenticated;
GRANT SELECT, INSERT ON dispute_evidence TO authenticated;
GRANT SELECT, INSERT, UPDATE ON dispute_appeals TO authenticated;
GRANT SELECT, INSERT ON dispute_audit_log TO authenticated;
