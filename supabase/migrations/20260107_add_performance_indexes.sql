-- Performance Index Migration
-- Created: 2026-01-07
-- Purpose: Add indexes to optimize slow queries identified through analysis
--
-- This migration adds composite and single-column indexes to improve query performance
-- for common access patterns in the BountyExpo application.

-- ============================================================================
-- NOTIFICATIONS INDEXES
-- ============================================================================

-- Index for fetching user notifications ordered by time (very common query)
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at 
ON notifications(user_id, created_at DESC);

-- Index for filtering unread notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_read 
ON notifications(user_id, read);

-- Index for notification type filtering
CREATE INDEX IF NOT EXISTS idx_notifications_type 
ON notifications(type);

-- ============================================================================
-- BOUNTIES INDEXES
-- ============================================================================

-- Composite index for filtering bounties by status and sorting by creation time
CREATE INDEX IF NOT EXISTS idx_bounties_status_created_at 
ON bounties(status, created_at DESC);

-- Composite index for user's bounties filtered by status
CREATE INDEX IF NOT EXISTS idx_bounties_user_id_status 
ON bounties(user_id, status);

-- Index for hunter's accepted bounties
CREATE INDEX IF NOT EXISTS idx_bounties_hunter_id 
ON bounties(hunter_id) WHERE hunter_id IS NOT NULL;

-- Index for filtering by status and hunter (for hunter dashboard)
CREATE INDEX IF NOT EXISTS idx_bounties_hunter_id_status 
ON bounties(hunter_id, status) WHERE hunter_id IS NOT NULL;

-- Index for stale bounty detection
CREATE INDEX IF NOT EXISTS idx_bounties_is_stale 
ON bounties(is_stale) WHERE is_stale = true;

-- Index for time-sensitive bounties with deadline filtering
CREATE INDEX IF NOT EXISTS idx_bounties_deadline 
ON bounties(deadline) WHERE deadline IS NOT NULL AND status = 'open';

-- ============================================================================
-- WALLET TRANSACTIONS INDEXES
-- ============================================================================

-- Index for user transaction history ordered by time
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id_created_at 
ON wallet_transactions(user_id, created_at DESC);

-- Index for bounty-related transactions
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_bounty_id 
ON wallet_transactions(bounty_id) WHERE bounty_id IS NOT NULL;

-- Index for transaction type filtering
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type 
ON wallet_transactions(type);

-- Index for transaction status
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status 
ON wallet_transactions(status);

-- Composite index for filtering by user and type
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id_type 
ON wallet_transactions(user_id, type);

-- ============================================================================
-- BOUNTY REQUESTS INDEXES
-- ============================================================================

-- Composite index for filtering requests by bounty and status
CREATE INDEX IF NOT EXISTS idx_bounty_requests_bounty_id_status 
ON bounty_requests(bounty_id, status);

-- Composite index for user's requests by status
CREATE INDEX IF NOT EXISTS idx_bounty_requests_user_id_status 
ON bounty_requests(user_id, status);

-- Index on status for global filtering
CREATE INDEX IF NOT EXISTS idx_bounty_requests_status 
ON bounty_requests(status);

-- ============================================================================
-- CONVERSATIONS & MESSAGING INDEXES
-- ============================================================================

-- Index for soft-deleted participants filtering
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id_deleted_at 
ON conversation_participants(user_id, deleted_at);

-- Index for conversation participants lookup without deleted
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id_deleted_at 
ON conversation_participants(conversation_id, deleted_at);

-- Index for unread message tracking
CREATE INDEX IF NOT EXISTS idx_conversation_participants_last_read_at 
ON conversation_participants(conversation_id, user_id, last_read_at);

-- Index for message status tracking (delivery/read receipts)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_status 
ON messages(conversation_id, status);

-- Index for messages by sender
CREATE INDEX IF NOT EXISTS idx_messages_sender_id 
ON messages(sender_id);

-- Index for pinned messages
CREATE INDEX IF NOT EXISTS idx_messages_is_pinned 
ON messages(conversation_id) WHERE is_pinned = true;

-- Index for conversations by bounty
CREATE INDEX IF NOT EXISTS idx_conversations_bounty_id 
ON conversations(bounty_id) WHERE bounty_id IS NOT NULL;

-- Index for conversation ordering by update time
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
ON conversations(updated_at DESC);

-- ============================================================================
-- OUTBOX EVENTS (Event Sourcing Pattern)
-- ============================================================================

-- Critical index for outbox worker processing pending events
CREATE INDEX IF NOT EXISTS idx_outbox_events_status_created_at 
ON outbox_events(status, created_at ASC) WHERE status = 'pending';

-- Index for retry logic
CREATE INDEX IF NOT EXISTS idx_outbox_events_status_retry_count 
ON outbox_events(status, retry_count);

-- Index for event type filtering
CREATE INDEX IF NOT EXISTS idx_outbox_events_type 
ON outbox_events(type);

-- ============================================================================
-- PUSH TOKENS
-- ============================================================================

-- Index for finding user's push tokens
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id 
ON push_tokens(user_id);

-- Unique index to prevent duplicate tokens
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_token_unique 
ON push_tokens(token);

-- Index for device-based lookup
CREATE INDEX IF NOT EXISTS idx_push_tokens_device_id 
ON push_tokens(device_id) WHERE device_id IS NOT NULL;

-- ============================================================================
-- NOTIFICATION PREFERENCES
-- ============================================================================

-- Note: notification_preferences already has a unique constraint on user_id
-- which serves as an index, but we ensure it exists explicitly
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_preferences_user_id 
ON notification_preferences(user_id);

-- ============================================================================
-- RISK MANAGEMENT INDEXES
-- ============================================================================

-- Risk assessments by user ordered by time
CREATE INDEX IF NOT EXISTS idx_risk_assessments_user_id_created_at 
ON risk_assessments(user_id, created_at DESC);

-- Risk assessments by level for monitoring
CREATE INDEX IF NOT EXISTS idx_risk_assessments_risk_level 
ON risk_assessments(risk_level);

-- Risk assessments by type
CREATE INDEX IF NOT EXISTS idx_risk_assessments_assessment_type 
ON risk_assessments(assessment_type);

-- Active risk actions by user
CREATE INDEX IF NOT EXISTS idx_risk_actions_user_id_status 
ON risk_actions(user_id, status);

-- Risk actions by severity for prioritization
CREATE INDEX IF NOT EXISTS idx_risk_actions_severity_status 
ON risk_actions(severity, status);

-- Automated vs manual risk actions
CREATE INDEX IF NOT EXISTS idx_risk_actions_automated 
ON risk_actions(automated, status);

-- Platform reserves by user and status
CREATE INDEX IF NOT EXISTS idx_platform_reserves_user_id_status 
ON platform_reserves(user_id, status);

-- Risk communications by user
CREATE INDEX IF NOT EXISTS idx_risk_communications_user_id 
ON risk_communications(user_id, sent_at DESC);

-- Risk communications by action
CREATE INDEX IF NOT EXISTS idx_risk_communications_risk_action_id 
ON risk_communications(risk_action_id);

-- Remediation workflows by user and status
CREATE INDEX IF NOT EXISTS idx_remediation_workflows_user_id_status 
ON remediation_workflows(user_id, status);

-- Remediation workflows by risk action
CREATE INDEX IF NOT EXISTS idx_remediation_workflows_risk_action_id 
ON remediation_workflows(risk_action_id);

-- Transaction patterns by user for fraud detection
CREATE INDEX IF NOT EXISTS idx_transaction_patterns_user_id_detected_at 
ON transaction_patterns(user_id, detected_at DESC);

-- Unreviewed transaction patterns
CREATE INDEX IF NOT EXISTS idx_transaction_patterns_reviewed 
ON transaction_patterns(reviewed, severity) WHERE reviewed = false;

-- Transaction patterns by severity
CREATE INDEX IF NOT EXISTS idx_transaction_patterns_severity 
ON transaction_patterns(severity, detected_at DESC);

-- ============================================================================
-- PROFILES INDEXES
-- ============================================================================

-- Index for username lookups (case-insensitive search)
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower 
ON profiles(LOWER(username));

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email 
ON profiles(email) WHERE email IS NOT NULL;

-- Index for verified users
CREATE INDEX IF NOT EXISTS idx_profiles_age_verified 
ON profiles(age_verified) WHERE age_verified = true;

-- Index for Stripe Connect account lookup
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_connect_account 
ON profiles(stripe_connect_account_id) WHERE stripe_connect_account_id IS NOT NULL;

-- ============================================================================
-- COMPLETION SUBMISSIONS INDEXES
-- ============================================================================

-- Index for submissions by status
CREATE INDEX IF NOT EXISTS idx_completion_submissions_status 
ON completion_submissions(status);

-- Index for submissions by bounty and status
CREATE INDEX IF NOT EXISTS idx_completion_submissions_bounty_id_status 
ON completion_submissions(bounty_id, status);

-- Index for tracking submission times
CREATE INDEX IF NOT EXISTS idx_completion_submissions_submitted_at 
ON completion_submissions(submitted_at DESC);

-- ============================================================================
-- REPORTS INDEXES (Content Moderation)
-- ============================================================================

-- Composite index for content lookup
CREATE INDEX IF NOT EXISTS idx_reports_content_type_content_id 
ON reports(content_type, content_id);

-- Index for pending reports prioritization
CREATE INDEX IF NOT EXISTS idx_reports_status_created_at 
ON reports(status, created_at DESC) WHERE status = 'pending';

-- ============================================================================
-- BOUNTY CANCELLATIONS & DISPUTES INDEXES
-- ============================================================================

-- Index for cancellations by status
CREATE INDEX IF NOT EXISTS idx_bounty_cancellations_status_created_at 
ON bounty_cancellations(status, created_at DESC);

-- Index for disputes by status
CREATE INDEX IF NOT EXISTS idx_bounty_disputes_status_created_at 
ON bounty_disputes(status, created_at DESC);

-- ============================================================================
-- SKILLS INDEXES
-- ============================================================================

-- Skills are already indexed by user_id, ensure text search is possible
CREATE INDEX IF NOT EXISTS idx_skills_text 
ON skills USING gin(to_tsvector('english', text));

-- ============================================================================
-- COMMENT: Index Maintenance & Monitoring
-- ============================================================================

-- To monitor index usage, run:
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
-- FROM pg_stat_user_indexes
-- ORDER BY idx_scan DESC;

-- To find unused indexes:
-- SELECT schemaname, tablename, indexname, idx_scan
-- FROM pg_stat_user_indexes
-- WHERE idx_scan = 0 AND indexname NOT LIKE 'pg_toast%'
-- ORDER BY pg_relation_size(indexrelid) DESC;

-- To check index bloat:
-- SELECT schemaname, tablename, indexname,
--        pg_size_pretty(pg_relation_size(indexrelid)) as size
-- FROM pg_stat_user_indexes
-- ORDER BY pg_relation_size(indexrelid) DESC;

COMMENT ON INDEX idx_notifications_user_id_created_at IS 'Optimizes user notification feed queries';
COMMENT ON INDEX idx_bounties_status_created_at IS 'Optimizes bounty listing by status with time ordering';
COMMENT ON INDEX idx_wallet_transactions_user_id_created_at IS 'Optimizes user transaction history queries';
COMMENT ON INDEX idx_outbox_events_status_created_at IS 'Critical for outbox worker event processing';
COMMENT ON INDEX idx_messages_conversation_id_created_at IS 'Already exists - optimizes message fetching in conversations';
