# Database Index Optimization

## Overview

This document describes the database index optimization implemented to improve query performance in the BountyExpo application. The optimization includes identifying slow queries, creating strategic indexes, and measuring performance improvements.

## Problem Statement

The application was experiencing performance issues due to:
1. **Sequential table scans** on frequently queried tables (notifications, bounties, messages)
2. **Missing composite indexes** for common query patterns (user + status, user + time)
3. **Unindexed foreign keys** in several relationships
4. **Slow sorting operations** without proper index support

## Analysis Process

### 1. Query Pattern Analysis

We analyzed the codebase to identify common query patterns:

- **Notification queries**: User notifications ordered by time, unread count filtering
- **Bounty queries**: Status filtering, user-owned bounties, hunter assignments
- **Messaging queries**: Conversation lookups, message history, soft-delete filtering
- **Wallet queries**: Transaction history ordered by time, bounty-specific transactions
- **Risk management queries**: User risk assessments, active risk actions

### 2. Slow Query Identification

Using the `analyze-slow-queries.js` script, we:
- Ran EXPLAIN ANALYZE on common queries
- Identified queries with sequential scans
- Measured execution times
- Calculated cache hit ratios
- Checked for missing indexes

### 3. Index Strategy

We created indexes following these principles:

#### Composite Indexes
For queries that filter AND sort:
```sql
-- Query: SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC
CREATE INDEX idx_notifications_user_id_created_at ON notifications(user_id, created_at DESC);
```

#### Covering Indexes
For queries that filter on multiple columns:
```sql
-- Query: SELECT * FROM bounties WHERE user_id = ? AND status = ?
CREATE INDEX idx_bounties_user_id_status ON bounties(user_id, status);
```

#### Partial Indexes
For queries with common WHERE conditions:
```sql
-- Only index non-null values to save space
CREATE INDEX idx_bounties_hunter_id ON bounties(hunter_id) WHERE hunter_id IS NOT NULL;
```

#### GIN Indexes
For full-text search:
```sql
CREATE INDEX idx_skills_text ON skills USING gin(to_tsvector('english', text));
```

## Indexes Created

### Notifications (High Traffic)
- `idx_notifications_user_id_created_at` - User feed queries (composite)
- `idx_notifications_user_id_read` - Unread filtering
- `idx_notifications_type` - Notification type filtering

### Bounties (Core Entity)
- `idx_bounties_status_created_at` - Public listing with time ordering
- `idx_bounties_user_id_status` - User's bounties by status
- `idx_bounties_hunter_id` - Hunter's accepted bounties (partial)
- `idx_bounties_hunter_id_status` - Hunter dashboard queries
- `idx_bounties_is_stale` - Stale bounty detection
- `idx_bounties_deadline` - Time-sensitive bounty filtering

### Wallet Transactions
- `idx_wallet_transactions_user_id_created_at` - Transaction history
- `idx_wallet_transactions_bounty_id` - Bounty-related transactions
- `idx_wallet_transactions_type` - Transaction type filtering
- `idx_wallet_transactions_status` - Status-based queries
- `idx_wallet_transactions_user_id_type` - User + type composite

### Messaging System
- `idx_conversation_participants_user_id_deleted_at` - User's active conversations
- `idx_conversation_participants_conversation_id_deleted_at` - Active participants
- `idx_conversation_participants_last_read_at` - Unread tracking
- `idx_messages_conversation_id_status` - Message delivery tracking
- `idx_messages_sender_id` - Sender-based lookups
- `idx_messages_is_pinned` - Pinned messages (partial)
- `idx_conversations_bounty_id` - Bounty conversations
- `idx_conversations_updated_at` - Conversation ordering

### Outbox Pattern (Critical for Event Processing)
- `idx_outbox_events_status_created_at` - Worker event processing (partial)
- `idx_outbox_events_status_retry_count` - Retry logic
- `idx_outbox_events_type` - Event type filtering

### Risk Management
- `idx_risk_assessments_user_id_created_at` - User risk history
- `idx_risk_assessments_risk_level` - Risk level monitoring
- `idx_risk_actions_user_id_status` - Active user actions
- `idx_risk_actions_severity_status` - Severity-based prioritization
- `idx_platform_reserves_user_id_status` - Reserve tracking
- `idx_transaction_patterns_reviewed` - Unreviewed patterns (partial)

### Other Entities
- `idx_bounty_requests_bounty_id_status` - Request filtering
- `idx_completion_submissions_status` - Submission workflow
- `idx_reports_status_created_at` - Pending reports (partial)
- `idx_profiles_username_lower` - Case-insensitive username search
- `idx_push_tokens_token_unique` - Unique token constraint

## Performance Measurement

### Before Migration

Run the baseline measurement:

```bash
npm run analyze:slow-queries
npm run measure:performance -- --output results/before.json
```

Expected issues:
- Sequential scans on notifications, conversations, bounties
- Execution times > 10ms for filtered + sorted queries
- Low cache hit ratios on large table scans

### After Migration

Run the migration and re-measure:

```bash
# Apply the migration
npm run db:migrate

# Or manually with psql
psql $DATABASE_URL -f supabase/migrations/20260107_add_performance_indexes.sql

# Measure performance
npm run measure:performance -- --output results/after.json

# Compare results
npm run measure:performance -- --compare results/before.json results/after.json
```

Expected improvements:
- **50-90% faster** for queries with new composite indexes
- **Sequential scans eliminated** on indexed columns
- **Better cache hit ratios** due to smaller index scans
- **Consistent sub-10ms response times** for most queries

## Index Maintenance

### Monitoring Index Usage

Check which indexes are being used:

```sql
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC
LIMIT 20;
```

### Finding Unused Indexes

Identify indexes that are never used (candidates for removal):

```sql
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE idx_scan = 0 
  AND indexname NOT LIKE 'pg_toast%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Checking Index Bloat

Monitor index size and potential bloat:

```sql
SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as size,
  idx_scan
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;
```

### Reindexing

If indexes become bloated over time, rebuild them:

```sql
-- Rebuild a specific index
REINDEX INDEX idx_notifications_user_id_created_at;

-- Rebuild all indexes on a table
REINDEX TABLE notifications;

-- Rebuild all indexes in database (requires downtime)
REINDEX DATABASE bountyexpo;
```

## Best Practices

### When to Add Indexes

✅ **DO index:**
- Foreign key columns used in JOINs
- Columns in WHERE clauses (especially high-frequency queries)
- Columns in ORDER BY clauses
- Columns used in GROUP BY
- Unique constraints and primary keys (automatic)

❌ **DON'T index:**
- Small tables (< 1000 rows)
- Columns with very low cardinality (e.g., boolean with 90% same value)
- Columns that are rarely queried
- Write-heavy tables where read performance is not critical

### Composite Index Order

The order of columns in a composite index matters:

```sql
-- For query: WHERE user_id = ? AND status = ? ORDER BY created_at DESC
-- Correct order (most selective first, then sort column):
CREATE INDEX idx ON table(user_id, status, created_at DESC);

-- This index can also be used for:
-- WHERE user_id = ?
-- WHERE user_id = ? ORDER BY created_at DESC
-- WHERE user_id = ? AND status = ?

-- But NOT for:
-- WHERE status = ?  (doesn't start with first column)
```

### Index Size vs Performance Trade-off

Indexes improve read performance but:
- Increase disk space usage
- Slow down INSERT/UPDATE/DELETE operations
- Require maintenance (VACUUM, REINDEX)

Monitor the trade-off:

```sql
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_table_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as indexes_size,
  ROUND(100.0 * pg_indexes_size(schemaname||'.'||tablename) / 
        NULLIF(pg_total_relation_size(schemaname||'.'||tablename), 0), 2) as index_ratio
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Query Optimization Tips

### Use EXPLAIN ANALYZE

Before creating an index, verify it will be used:

```sql
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM notifications 
WHERE user_id = '...' 
ORDER BY created_at DESC 
LIMIT 50;
```

Look for:
- **Seq Scan** → Need an index
- **Index Scan** → Index is being used ✅
- **Index Only Scan** → Best case, all data from index ✅
- **Bitmap Index Scan** → Multiple indexes combined
- High **Buffer** reads → Poor cache hit ratio

### Covering Indexes

For optimal performance, include all needed columns in the index:

```sql
-- Query needs: id, title, created_at
-- Instead of: CREATE INDEX idx ON bounties(status);
-- Better: CREATE INDEX idx ON bounties(status) INCLUDE (id, title, created_at);
-- (Note: INCLUDE syntax requires PostgreSQL 11+)
```

### Partial Indexes for Common Filters

Save space by only indexing rows that match a common filter:

```sql
-- Only index active bounties (most queries filter for this)
CREATE INDEX idx ON bounties(status, created_at) 
WHERE status IN ('open', 'in_progress');
```

## Testing

### Unit Tests

No unit tests needed for indexes (they're infrastructure).

### Integration Tests

Verify queries still work correctly:

```bash
npm run test:integration
```

### Performance Tests

Automated performance regression testing:

```bash
# Run before major releases
npm run test:performance

# Compare against baseline
npm run measure:performance -- --compare baseline.json current.json
```

## Rollback Plan

If indexes cause issues:

```sql
-- Drop specific index
DROP INDEX IF EXISTS idx_notifications_user_id_created_at;

-- Or rollback entire migration
psql $DATABASE_URL -f supabase/migrations/rollback_20260107.sql
```

Rollback script should contain:

```sql
-- Drop all indexes created in the migration
DROP INDEX IF EXISTS idx_notifications_user_id_created_at;
DROP INDEX IF EXISTS idx_notifications_user_id_read;
-- ... etc
```

## Monitoring in Production

### Key Metrics to Track

1. **Query execution time** (p50, p95, p99)
2. **Index usage statistics** (idx_scan, idx_tup_read)
3. **Cache hit ratio** (should be > 90%)
4. **Table/index sizes** (monitor growth)
5. **Sequential scans** (should decrease after migration)

### Alerting Thresholds

Set up alerts for:
- Query execution time > 100ms (p95)
- Sequential scans on large tables (> 10,000 rows)
- Cache hit ratio < 90%
- Unused indexes (idx_scan = 0 for > 7 days)
- Index bloat (> 30% wasted space)

## Resources

- [PostgreSQL Documentation - Indexes](https://www.postgresql.org/docs/current/indexes.html)
- [Use The Index, Luke!](https://use-the-index-luke.com/)
- [Explain Plan Visualization](https://explain.depesz.com/)
- [Index Advisor Tools](https://github.com/ankane/dexter)

## Next Steps

1. ✅ Create and apply index migration
2. ✅ Measure performance improvement
3. ⏳ Monitor production metrics for 2 weeks
4. ⏳ Identify any unused indexes
5. ⏳ Set up automated performance regression testing
6. ⏳ Document query patterns for future optimization
