Indexing & Benchmarking Quick Guide
=================================

Run these steps against a copy/snapshot of production data.

1) Back up DB / take snapshot.

2) Apply migrations (use Supabase CLI or psql). For large tables create indexes CONCURRENTLY:

```bash
# Example using psql and DATABASE_URL
psql "$DATABASE_URL" -f supabase/migrations/20260320_add_geom_and_index.sql
psql "$DATABASE_URL" -f supabase/migrations/20260320_open_feed_covering_index.sql
psql "$DATABASE_URL" -f supabase/migrations/20260320_category_status_index.sql
psql "$DATABASE_URL" -f supabase/migrations/20260320_search_tsv_fulltext.sql
psql "$DATABASE_URL" -f supabase/migrations/20260320_enable_pg_stat_statements.sql
```

3) Backfill `geom` if you have lat/lng. Adapt the backfill query in the `add_geom` migration.

4) Run EXPLAIN before/after on representative queries:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, amount, category, poster_id, created_at
FROM bounties
WHERE status = 'open'
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

5) Inspect `pg_stat_statements` and `pg_stat_user_indexes`:

```sql
SELECT query, calls, total_time, mean_time, rows
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 25;

SELECT relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes JOIN pg_indexes ON indexrelname = indexname
ORDER BY idx_scan DESC;
```

6) Run HTTP load tests against the API to verify end-to-end behavior (use `wrk` or `hey`):

```bash
# Example simple run against local server
wrk -t2 -c20 -d30s "http://localhost:3000/api/bounties?status=open&limit=20"
```

7) Iterate: drop unused indexes, adjust partial indexes, consider normalization for categories/tags.
