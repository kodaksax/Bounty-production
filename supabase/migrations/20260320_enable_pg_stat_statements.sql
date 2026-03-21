-- 2026-03-20 05: Enable pg_stat_statements for query monitoring
-- Requires superuser privileges. Supabase projects may require enabling via project settings.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Useful queries to inspect slow queries / index usage:
-- Top 25 slowest queries by total time
-- SELECT query, calls, total_time, mean_time, rows
-- FROM pg_stat_statements
-- ORDER BY total_time DESC
-- LIMIT 25;

-- Index usage summary
-- SELECT relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
-- FROM pg_stat_user_indexes JOIN pg_indexes ON indexrelname = indexname
-- ORDER BY idx_scan DESC;
