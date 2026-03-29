-- Risk Management System - Supabase Migration
-- This migration adds risk management tables and extends the profiles table
-- to support negative balance liability mitigation

-- ============================================================================
-- PART 1: Extend profiles table with risk management fields
-- ============================================================================

-- Add risk management columns to existing profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS business_category TEXT,
ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low',
ADD COLUMN IF NOT EXISTS risk_score INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS account_restricted BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS restriction_reason TEXT,
ADD COLUMN IF NOT EXISTS restricted_at TIMESTAMPTZ;

-- Add comments to document the columns
COMMENT ON COLUMN profiles.verification_status IS 'User verification status: pending, verified, rejected, under_review';
COMMENT ON COLUMN profiles.kyc_verified_at IS 'Timestamp when KYC verification was completed';
COMMENT ON COLUMN profiles.business_category IS 'Business category code for seller';
COMMENT ON COLUMN profiles.risk_level IS 'Risk level: low, medium, high, critical';
COMMENT ON COLUMN profiles.risk_score IS 'Numeric risk score from 0-100';
COMMENT ON COLUMN profiles.account_restricted IS 'Whether account has restrictions';
COMMENT ON COLUMN profiles.restriction_reason IS 'Reason for account restriction';
COMMENT ON COLUMN profiles.restricted_at IS 'Timestamp when account was restricted';

-- Add check constraints for risk management fields
ALTER TABLE profiles
ADD CONSTRAINT check_verification_status CHECK (verification_status IN ('pending', 'verified', 'rejected', 'under_review')),
ADD CONSTRAINT check_risk_level CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
ADD CONSTRAINT check_risk_score_range CHECK (risk_score >= 0 AND risk_score <= 100);

-- Create index for risk-based queries
CREATE INDEX IF NOT EXISTS idx_profiles_risk ON profiles(risk_level, account_restricted);

-- ============================================================================
-- PART 2: Create restricted business categories table
-- ============================================================================

CREATE TABLE IF NOT EXISTS restricted_business_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code TEXT NOT NULL UNIQUE,
  category_name TEXT NOT NULL,
  description TEXT,
  risk_level TEXT NOT NULL DEFAULT 'high',
  is_prohibited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT check_category_risk_level CHECK (risk_level IN ('low', 'medium', 'high', 'prohibited'))
);

-- Add comments
COMMENT ON TABLE restricted_business_categories IS 'Prohibited and restricted business categories for compliance';
COMMENT ON COLUMN restricted_business_categories.category_code IS 'Unique code for the category (e.g., gambling, adult_content)';
COMMENT ON COLUMN restricted_business_categories.is_prohibited IS 'If true, category is completely prohibited on platform';

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_restricted_categories_code ON restricted_business_categories(category_code);
CREATE INDEX IF NOT EXISTS idx_restricted_categories_prohibited ON restricted_business_categories(is_prohibited);

-- ============================================================================
-- PART 3: Create risk assessments table
-- ============================================================================

CREATE TABLE IF NOT EXISTS risk_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assessment_type TEXT NOT NULL,
  risk_score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  factors JSONB NOT NULL,
  assessed_by TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT check_assessment_type CHECK (assessment_type IN ('onboarding', 'periodic', 'triggered', 'manual')),
  CONSTRAINT check_assessment_risk_level CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT check_assessment_score_range CHECK (risk_score >= 0 AND risk_score <= 100)
);

-- Add comments
COMMENT ON TABLE risk_assessments IS 'Historical record of all risk assessments performed on users';
COMMENT ON COLUMN risk_assessments.factors IS 'Detailed breakdown of risk factors and their scores';

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_risk_assessments_user ON risk_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_created ON risk_assessments(created_at DESC);

-- ============================================================================
-- PART 4: Create risk actions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS risk_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  automated BOOLEAN NOT NULL DEFAULT false,
  triggered_by TEXT,
  metadata JSONB,
  actioned_by TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT check_action_type CHECK (action_type IN ('hold', 'restrict', 'delay_payout', 'require_verification', 'suspend', 'flag_for_review')),
  CONSTRAINT check_action_severity CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT check_action_status CHECK (status IN ('active', 'resolved', 'cancelled'))
);

-- Add comments
COMMENT ON TABLE risk_actions IS 'Mitigation actions taken to reduce platform risk';
COMMENT ON COLUMN risk_actions.automated IS 'Whether action was taken automatically by system';
COMMENT ON COLUMN risk_actions.triggered_by IS 'What triggered this action (e.g., high_transaction_volume)';

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_risk_actions_user ON risk_actions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_risk_actions_status ON risk_actions(status);
CREATE INDEX IF NOT EXISTS idx_risk_actions_created ON risk_actions(created_at DESC);

-- ============================================================================
-- PART 5: Create platform reserves table
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform_reserves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reserve_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  percentage INTEGER,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  release_date TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT check_reserve_type CHECK (reserve_type IN ('rolling', 'fixed', 'transaction_based')),
  CONSTRAINT check_reserve_status CHECK (status IN ('active', 'released', 'expired')),
  CONSTRAINT check_reserve_amount CHECK (amount_cents >= 0),
  CONSTRAINT check_reserve_percentage CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100))
);

-- Add comments
COMMENT ON TABLE platform_reserves IS 'Platform reserves held to cover negative balance liability';
COMMENT ON COLUMN platform_reserves.amount_cents IS 'Amount held in reserve in cents';
COMMENT ON COLUMN platform_reserves.percentage IS 'Percentage of transaction volume (if applicable)';

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_reserves_user ON platform_reserves(user_id, status);
CREATE INDEX IF NOT EXISTS idx_platform_reserves_status ON platform_reserves(status);
CREATE INDEX IF NOT EXISTS idx_platform_reserves_release ON platform_reserves(release_date) WHERE status = 'active';

-- ============================================================================
-- PART 6: Create risk communications table
-- ============================================================================

CREATE TABLE IF NOT EXISTS risk_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  risk_action_id UUID REFERENCES risk_actions(id) ON DELETE SET NULL,
  communication_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  metadata JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  
  CONSTRAINT check_communication_type CHECK (communication_type IN ('email', 'in_app', 'sms', 'push')),
  CONSTRAINT check_communication_status CHECK (status IN ('sent', 'delivered', 'read', 'failed'))
);

-- Add comments
COMMENT ON TABLE risk_communications IS 'Audit trail of all risk-related communications with users';

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_risk_communications_user ON risk_communications(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_communications_action ON risk_communications(risk_action_id);
CREATE INDEX IF NOT EXISTS idx_risk_communications_sent ON risk_communications(sent_at DESC);

-- ============================================================================
-- PART 7: Create remediation workflows table
-- ============================================================================

CREATE TABLE IF NOT EXISTS remediation_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  risk_action_id UUID NOT NULL REFERENCES risk_actions(id) ON DELETE CASCADE,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  required_documents JSONB,
  submitted_documents JSONB,
  review_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT check_workflow_type CHECK (workflow_type IN ('document_verification', 'identity_check', 'business_verification', 'transaction_review')),
  CONSTRAINT check_workflow_status CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled'))
);

-- Add comments
COMMENT ON TABLE remediation_workflows IS 'Document verification and account restoration workflows';
COMMENT ON COLUMN remediation_workflows.required_documents IS 'JSON array of required documents';
COMMENT ON COLUMN remediation_workflows.submitted_documents IS 'JSON array of submitted documents';

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_remediation_workflows_user ON remediation_workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_remediation_workflows_status ON remediation_workflows(status);
CREATE INDEX IF NOT EXISTS idx_remediation_workflows_action ON remediation_workflows(risk_action_id);

-- ============================================================================
-- PART 8: Create transaction patterns table
-- ============================================================================

CREATE TABLE IF NOT EXISTS transaction_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  details JSONB NOT NULL,
  threshold_exceeded BOOLEAN NOT NULL DEFAULT false,
  action_taken TEXT,
  reviewed BOOLEAN NOT NULL DEFAULT false,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT check_pattern_type CHECK (pattern_type IN ('high_velocity', 'unusual_amount', 'geographic_anomaly', 'chargebacks', 'refund_pattern')),
  CONSTRAINT check_pattern_severity CHECK (severity IN ('low', 'medium', 'high', 'critical'))
);

-- Add comments
COMMENT ON TABLE transaction_patterns IS 'Detected fraud and risk patterns in user transactions';
COMMENT ON COLUMN transaction_patterns.details IS 'Pattern-specific data and metrics';

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_transaction_patterns_user ON transaction_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_transaction_patterns_reviewed ON transaction_patterns(reviewed, severity);
CREATE INDEX IF NOT EXISTS idx_transaction_patterns_detected ON transaction_patterns(detected_at DESC);

-- ============================================================================
-- PART 9: Create updated_at triggers for timestamp management
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for tables with updated_at
CREATE TRIGGER update_restricted_business_categories_updated_at
  BEFORE UPDATE ON restricted_business_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_platform_reserves_updated_at
  BEFORE UPDATE ON platform_reserves
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_remediation_workflows_updated_at
  BEFORE UPDATE ON remediation_workflows
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 10: Enable Row Level Security (RLS)
-- ============================================================================

-- Enable RLS on all new tables
ALTER TABLE restricted_business_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reserves ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE remediation_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_patterns ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART 11: RLS Policies
-- ============================================================================

-- restricted_business_categories: Public read, admin write
CREATE POLICY "Anyone can view business categories"
  ON restricted_business_categories FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage business categories"
  ON restricted_business_categories FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- risk_assessments: Users can view their own, admins can view all
CREATE POLICY "Users can view their own risk assessments"
  ON risk_assessments FOR SELECT
  USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage risk assessments"
  ON risk_assessments FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- risk_actions: Users can view their own, admins can manage
CREATE POLICY "Users can view their own risk actions"
  ON risk_actions FOR SELECT
  USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage risk actions"
  ON risk_actions FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- platform_reserves: Users can view their own, admins can manage
CREATE POLICY "Users can view their own reserves"
  ON platform_reserves FOR SELECT
  USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage reserves"
  ON platform_reserves FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- risk_communications: Users can view their own, admins can manage
CREATE POLICY "Users can view their own communications"
  ON risk_communications FOR SELECT
  USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage communications"
  ON risk_communications FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- remediation_workflows: Users can view and update their own, admins can manage
CREATE POLICY "Users can view their own remediation workflows"
  ON remediation_workflows FOR SELECT
  USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Users can update their own remediation workflows"
  ON remediation_workflows FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage remediation workflows"
  ON remediation_workflows FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- transaction_patterns: Admin only
CREATE POLICY "Service role can manage transaction patterns"
  ON transaction_patterns FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- PART 12: Grant necessary permissions
-- ============================================================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- Grant table permissions
GRANT ALL ON restricted_business_categories TO service_role;
GRANT SELECT ON restricted_business_categories TO authenticated, anon;

GRANT ALL ON risk_assessments TO service_role;
GRANT SELECT ON risk_assessments TO authenticated;

GRANT ALL ON risk_actions TO service_role;
GRANT SELECT ON risk_actions TO authenticated;

GRANT ALL ON platform_reserves TO service_role;
GRANT SELECT ON platform_reserves TO authenticated;

GRANT ALL ON risk_communications TO service_role;
GRANT SELECT ON risk_communications TO authenticated;

GRANT ALL ON remediation_workflows TO service_role;
GRANT SELECT, UPDATE ON remediation_workflows TO authenticated;

GRANT ALL ON transaction_patterns TO service_role;

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Verify migration
DO $$
BEGIN
  RAISE NOTICE 'Risk Management System migration completed successfully!';
  RAISE NOTICE 'Tables created: 7';
  RAISE NOTICE 'Profiles table extended with 8 risk fields';
  RAISE NOTICE 'RLS policies applied to all tables';
  RAISE NOTICE 'Next step: Run seed script to populate restricted_business_categories';
END $$;
