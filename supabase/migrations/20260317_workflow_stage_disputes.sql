-- Workflow-Stage Dispute Support Migration
-- Allows disputes to be created during 'In Progress' and 'Review & Verify' stages
-- without requiring a prior cancellation request.

-- 1. Make cancellation_id nullable so workflow-stage disputes can exist without one
ALTER TABLE bounty_disputes ALTER COLUMN cancellation_id DROP NOT NULL;

-- 2. Add dispute_stage to track where the dispute originated
ALTER TABLE bounty_disputes ADD COLUMN IF NOT EXISTS dispute_stage TEXT NOT NULL DEFAULT 'cancellation'
  CHECK (dispute_stage IN ('in_progress', 'review_verify', 'cancellation'));

-- 3. Add respondent_id to track the other party in the dispute
ALTER TABLE bounty_disputes ADD COLUMN IF NOT EXISTS respondent_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 4. Add index for efficient bounty+stage lookups
CREATE INDEX IF NOT EXISTS idx_bounty_disputes_bounty_stage
  ON bounty_disputes(bounty_id, dispute_stage)
  WHERE status IN ('open', 'under_review');

-- 5. Add index for respondent-based queries
CREATE INDEX IF NOT EXISTS idx_bounty_disputes_respondent
  ON bounty_disputes(respondent_id)
  WHERE status IN ('open', 'under_review');

-- 6. RLS: Allow both poster and hunter to create workflow-stage disputes
-- (The existing cancellation-based INSERT policy only allows initiators of cancellations)
CREATE POLICY "Bounty participants can create workflow disputes" ON bounty_disputes
  FOR INSERT
  WITH CHECK (
    initiator_id = auth.uid()
    AND dispute_stage IN ('in_progress', 'review_verify')
    AND EXISTS (
      SELECT 1 FROM bounties b
      WHERE b.id = bounty_disputes.bounty_id
      AND b.status = 'in_progress'
      AND (
        b.user_id = auth.uid()        -- poster
        OR b.accepted_by = auth.uid() -- hunter
      )
    )
  );

-- 7. Allow respondents to view disputes they are party to
CREATE POLICY "Respondents can view their disputes" ON bounty_disputes
  FOR SELECT
  USING (
    respondent_id = auth.uid()
    OR initiator_id = auth.uid()
  );

-- 8. Allow respondents to view evidence on disputes they are party to
CREATE POLICY "Respondents can view dispute evidence" ON dispute_evidence
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bounty_disputes bd
      WHERE bd.id = dispute_evidence.dispute_id
      AND (bd.respondent_id = auth.uid() OR bd.initiator_id = auth.uid())
    )
  );

-- 9. Allow respondents to add evidence to disputes they are party to
CREATE POLICY "Respondents can add dispute evidence" ON dispute_evidence
  FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM bounty_disputes bd
      WHERE bd.id = dispute_evidence.dispute_id
      AND bd.status IN ('open', 'under_review')
      AND (bd.respondent_id = auth.uid() OR bd.initiator_id = auth.uid())
    )
  );

-- 10. Allow respondents to add comments to disputes they are party to
CREATE POLICY "Respondents can add dispute comments" ON dispute_comments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT is_internal
    AND EXISTS (
      SELECT 1 FROM bounty_disputes bd
      WHERE bd.id = dispute_comments.dispute_id
      AND bd.status IN ('open', 'under_review')
      AND (bd.respondent_id = auth.uid() OR bd.initiator_id = auth.uid())
    )
  );

-- 11. Allow respondents to view public comments on disputes they are party to
CREATE POLICY "Respondents can view dispute comments" ON dispute_comments
  FOR SELECT
  USING (
    NOT is_internal
    AND EXISTS (
      SELECT 1 FROM bounty_disputes bd
      WHERE bd.id = dispute_comments.dispute_id
      AND (bd.respondent_id = auth.uid() OR bd.initiator_id = auth.uid())
    )
  );
