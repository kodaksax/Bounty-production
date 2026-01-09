-- Performance Optimization Indexes for BountyExpo API
-- Run this script to add indexes that improve query performance under load
-- 
-- Usage:
--   psql -U bountyexpo -d bountyexpo -f services/api/migrations/add-performance-indexes.sql
--
-- Before running, check existing indexes:
--   SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public';

-- ============================================================================
-- BOUNTIES TABLE INDEXES
-- ============================================================================

-- Index for listing bounties by status (most common query)
CREATE INDEX IF NOT EXISTS idx_bounties_status 
ON bounties(status) 
WHERE status IS NOT NULL;

-- Composite index for status + created_at (for sorted listings)
CREATE INDEX IF NOT EXISTS idx_bounties_status_created 
ON bounties(status, created_at DESC) 
WHERE status IS NOT NULL;

-- Index for finding bounties by user (poster's bounties)
CREATE INDEX IF NOT EXISTS idx_bounties_user_id 
ON bounties(user_id);

-- Index for finding accepted bounties
CREATE INDEX IF NOT EXISTS idx_bounties_accepted_by 
ON bounties(accepted_by) 
WHERE accepted_by IS NOT NULL;

-- Index for bounty category filtering
CREATE INDEX IF NOT EXISTS idx_bounties_category 
ON bounties(category) 
WHERE category IS NOT NULL;

-- Index for location-based queries
CREATE INDEX IF NOT EXISTS idx_bounties_location 
ON bounties(location) 
WHERE location IS NOT NULL;

-- Full-text search indexes for bounty title and description
CREATE INDEX IF NOT EXISTS idx_bounties_title_fts 
ON bounties USING GIN (to_tsvector('english', title));

CREATE INDEX IF NOT EXISTS idx_bounties_description_fts 
ON bounties USING GIN (to_tsvector('english', description));

-- Combined full-text search index for better performance
CREATE INDEX IF NOT EXISTS idx_bounties_combined_fts 
ON bounties USING GIN (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
);

-- ============================================================================
-- BOUNTY_REQUESTS TABLE INDEXES
-- ============================================================================

-- Index for finding requests by bounty
CREATE INDEX IF NOT EXISTS idx_bounty_requests_bounty_id 
ON bounty_requests(bounty_id);

-- Index for finding requests by user (hunter's applications)
CREATE INDEX IF NOT EXISTS idx_bounty_requests_user_id 
ON bounty_requests(user_id);

-- Index for finding requests by status
CREATE INDEX IF NOT EXISTS idx_bounty_requests_status 
ON bounty_requests(status) 
WHERE status IS NOT NULL;

-- Composite index for bounty + status queries
CREATE INDEX IF NOT EXISTS idx_bounty_requests_bounty_status 
ON bounty_requests(bounty_id, status);

-- Index for created_at sorting
CREATE INDEX IF NOT EXISTS idx_bounty_requests_created_at 
ON bounty_requests(created_at DESC);

-- ============================================================================
-- WALLET_TRANSACTIONS TABLE INDEXES
-- ============================================================================

-- Index for finding transactions by user
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id 
ON wallet_transactions(user_id);

-- Index for finding transactions by bounty
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_bounty_id 
ON wallet_transactions(bounty_id) 
WHERE bounty_id IS NOT NULL;

-- Index for transaction type filtering
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type 
ON wallet_transactions(type);

-- Index for transaction status
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status 
ON wallet_transactions(status) 
WHERE status IS NOT NULL;

-- Composite index for user + created_at (transaction history)
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created 
ON wallet_transactions(user_id, created_at DESC);

-- Index for pending transactions (for background processing)
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_pending 
ON wallet_transactions(status, created_at) 
WHERE status = 'pending';

-- ============================================================================
-- CONVERSATIONS TABLE INDEXES
-- ============================================================================

-- Index for finding conversations by bounty
CREATE INDEX IF NOT EXISTS idx_conversations_bounty_id 
ON conversations(bounty_id) 
WHERE bounty_id IS NOT NULL;

-- Index for conversation participants (if stored as array)
-- Note: Adjust column name based on actual schema
-- CREATE INDEX IF NOT EXISTS idx_conversations_participants 
-- ON conversations USING GIN (participant_ids);

-- Index for updated_at sorting (recent conversations)
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
ON conversations(updated_at DESC);

-- ============================================================================
-- MESSAGES TABLE INDEXES
-- ============================================================================

-- Index for finding messages by conversation
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id 
ON messages(conversation_id);

-- Index for finding messages by sender
CREATE INDEX IF NOT EXISTS idx_messages_sender_id 
ON messages(sender_id);

-- Composite index for conversation + created_at (message history)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
ON messages(conversation_id, created_at DESC);

-- Index for unread messages
CREATE INDEX IF NOT EXISTS idx_messages_read_status 
ON messages(is_read, created_at) 
WHERE is_read = false;

-- ============================================================================
-- USERS/PROFILES TABLE INDEXES
-- ============================================================================

-- Index for finding users by email (authentication)
CREATE INDEX IF NOT EXISTS idx_users_email 
ON users(email);

-- Index for user status (active/inactive)
CREATE INDEX IF NOT EXISTS idx_users_status 
ON users(status) 
WHERE status IS NOT NULL;

-- Index for created_at (user registration analytics)
CREATE INDEX IF NOT EXISTS idx_users_created_at 
ON users(created_at DESC);

-- ============================================================================
-- NOTIFICATIONS TABLE INDEXES
-- ============================================================================

-- Index for finding notifications by user
CREATE INDEX IF NOT EXISTS idx_notifications_user_id 
ON notifications(user_id);

-- Index for unread notifications
CREATE INDEX IF NOT EXISTS idx_notifications_unread 
ON notifications(user_id, is_read, created_at DESC) 
WHERE is_read = false;

-- Composite index for user + created_at (notification feed)
CREATE INDEX IF NOT EXISTS idx_notifications_user_created 
ON notifications(user_id, created_at DESC);

-- ============================================================================
-- ANALYTICS AND MONITORING
-- ============================================================================

-- After creating indexes, update table statistics for better query planning
ANALYZE bounties;
ANALYZE bounty_requests;
ANALYZE wallet_transactions;
ANALYZE conversations;
ANALYZE messages;
ANALYZE users;
ANALYZE notifications;

-- View index usage statistics (run after some load to verify effectiveness)
-- SELECT 
--   schemaname,
--   tablename,
--   indexname,
--   idx_scan as scans,
--   idx_tup_read as tuples_read,
--   idx_tup_fetch as tuples_fetched
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public'
-- ORDER BY idx_scan DESC;

-- Check for unused indexes (candidates for removal)
-- SELECT 
--   schemaname,
--   tablename,
--   indexname,
--   idx_scan
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public'
--   AND idx_scan = 0
--   AND indexname NOT LIKE '%_pkey'
-- ORDER BY tablename, indexname;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$ 
BEGIN
  RAISE NOTICE '✅ Performance indexes created successfully';
  RAISE NOTICE '📊 Run ANALYZE to update statistics';
  RAISE NOTICE '🔍 Monitor index usage with pg_stat_user_indexes';
  RAISE NOTICE '⚡ Re-run load tests to verify improvements';
END $$;
