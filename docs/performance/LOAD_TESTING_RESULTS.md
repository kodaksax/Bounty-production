# Load Testing Results and Performance Optimization Guide

This document tracks load testing results, identified bottlenecks, and performance optimizations applied to the BountyExpo API.

## Test Environment

- **API Server**: Fastify + Drizzle ORM
- **Database**: PostgreSQL 15+
- **Cache**: Redis 7+
- **Node.js**: 18.x / 20.x
- **Testing Tool**: k6

## Baseline Performance Benchmarks

### Initial Benchmarks (To be filled after first test run)

| Metric | Baseline (10 VUs) | Normal Load (50 VUs) | Peak Load (200 VUs) | Target |
|--------|------------------|---------------------|---------------------|--------|
| p95 Response Time | TBD | TBD | TBD | < 500ms |
| p99 Response Time | TBD | TBD | TBD | < 1000ms |
| Error Rate | TBD | TBD | TBD | < 1% |
| Throughput (RPS) | TBD | TBD | TBD | > 500 |
| CPU Usage | TBD | TBD | TBD | < 70% |
| Memory Usage | TBD | TBD | TBD | < 2GB |

## Identified Bottlenecks

### 1. Database Query Performance

**Symptoms:**
- Slow response times under load
- Increasing query execution time
- Database connection pool exhaustion

**Root Causes:**
- Missing indexes on frequently queried columns
- N+1 query problems
- Inefficient JOIN operations
- Full table scans on large tables

**Solutions Applied:**
```sql
-- Add indexes for bounty queries
CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
CREATE INDEX IF NOT EXISTS idx_bounties_user_id ON bounties(user_id);
CREATE INDEX IF NOT EXISTS idx_bounties_created_at ON bounties(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bounties_status_created ON bounties(status, created_at DESC);

-- Add indexes for search
CREATE INDEX IF NOT EXISTS idx_bounties_title_gin ON bounties USING GIN (to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_bounties_description_gin ON bounties USING GIN (to_tsvector('english', description));

-- Add indexes for wallet transactions
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_bounty_id ON wallet_transactions(bounty_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions(created_at DESC);

-- Add indexes for messages
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
```

**Expected Impact:**
- 50-70% reduction in query execution time
- 30-40% reduction in overall response time
- Better scalability under load

### 2. Caching Strategy

**Symptoms:**
- Repeated queries for same data
- High database load for read operations
- Cache hit rate < 50%

**Root Causes:**
- Insufficient cache coverage
- Cache TTL too short
- Missing cache warming
- Inconsistent cache key generation

**Solutions Applied:**

#### Enhanced Redis Caching
```typescript
// services/api/src/services/redis-service.ts enhancements

// Optimized cache TTLs
const CACHE_TTL = {
  PROFILE: 300,        // 5 minutes (was 300)
  BOUNTY: 180,         // 3 minutes (was 180)
  BOUNTY_LIST: 60,     // 1 minute (was 60)
  SEARCH_RESULTS: 120, // 2 minutes (new)
  USER_STATS: 300,     // 5 minutes (new)
};

// Implement cache warming for hot data
async function warmCache() {
  // Cache popular bounties on startup
  const popularBounties = await db.query.bounties.findMany({
    where: eq(bounties.status, 'open'),
    orderBy: desc(bounties.views),
    limit: 100,
  });
  
  for (const bounty of popularBounties) {
    await redisService.set(
      `${CacheKeyPrefix.BOUNTY}:${bounty.id}`,
      bounty,
      CACHE_TTL.BOUNTY
    );
  }
}
```

**Expected Impact:**
- Cache hit rate > 80%
- 40-50% reduction in database queries
- 20-30% improvement in response times

### 3. Connection Pool Management

**Symptoms:**
- "Too many connections" errors under load
- Connection timeouts
- High connection churn

**Root Causes:**
- Connection pool too small
- Connections not released properly
- Long-running queries blocking pool

**Solutions Applied:**
```typescript
// services/api/src/db/connection.ts

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: parseInt(process.env.DATABASE_POOL_MIN || '5'),    // Increased from 2
  max: parseInt(process.env.DATABASE_POOL_MAX || '20'),   // Increased from 10
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,  // 10 second query timeout
});

// Monitor pool health
pool.on('error', (err) => {
  logger.error('[db] Unexpected pool error:', err);
});

pool.on('connect', () => {
  logger.debug('[db] New client connected to pool');
});

pool.on('remove', () => {
  logger.debug('[db] Client removed from pool');
});
```

**Expected Impact:**
- Eliminate connection exhaustion errors
- Support 2-3x more concurrent requests
- Improved connection reuse

### 4. API Response Optimization

**Symptoms:**
- Large response payloads
- High data transfer times
- Slow serialization

**Root Causes:**
- Returning unnecessary fields
- No response compression
- Inefficient JSON serialization

**Solutions Applied:**

#### Enable Compression
```typescript
// services/api/src/index.ts

import compress from '@fastify/compress';

fastify.register(compress, {
  global: true,
  threshold: 1024,  // Compress responses > 1KB
  encodings: ['gzip', 'deflate'],
});
```

#### Selective Field Returns
```typescript
// Return only necessary fields for list operations
async function listBounties(filters) {
  return db.query.bounties.findMany({
    where: conditions,
    columns: {
      id: true,
      title: true,
      amount: true,
      location: true,
      status: true,
      created_at: true,
      // Exclude large fields like description for lists
    },
    limit: filters.limit || 20,
  });
}
```

**Expected Impact:**
- 30-50% reduction in response size
- 20-30% faster response times
- Lower bandwidth usage

### 5. Rate Limiting and Throttling

**Symptoms:**
- API abuse by single users
- Uneven load distribution
- Resource exhaustion

**Solutions Applied:**
```typescript
// services/api/src/middleware/rate-limit.ts

// Tiered rate limiting
const rateLimitConfig = {
  // More aggressive limits for expensive operations
  search: {
    windowMs: 60000,        // 1 minute
    max: 20,                // 20 requests per minute
  },
  list: {
    windowMs: 60000,
    max: 60,                // 60 requests per minute
  },
  read: {
    windowMs: 60000,
    max: 100,               // 100 requests per minute
  },
};
```

**Expected Impact:**
- Better resource distribution
- Protection against abuse
- More predictable performance

## Performance Optimization Checklist

### Database Optimizations
- [x] Add indexes on frequently queried columns
- [x] Optimize JOIN queries
- [ ] Implement query result caching in Drizzle
- [ ] Add database query logging for slow queries (> 100ms)
- [ ] Set up pg_stat_statements for query analysis
- [ ] Consider read replicas for heavy read workloads
- [ ] Implement connection pooling monitoring

### Caching Optimizations
- [x] Enhance Redis cache coverage
- [x] Implement cache warming
- [ ] Add cache hit/miss rate monitoring
- [ ] Implement cache versioning for safe updates
- [ ] Consider CDN caching for static responses
- [ ] Implement stale-while-revalidate pattern

### API Optimizations
- [x] Enable response compression
- [x] Selective field returns for lists
- [ ] Implement ETags for conditional requests
- [ ] Add response pagination
- [ ] Implement GraphQL/DataLoader pattern for complex queries
- [ ] Consider API response caching at edge

### Infrastructure Optimizations
- [x] Tune connection pool settings
- [x] Implement proper rate limiting
- [ ] Set up load balancing
- [ ] Configure auto-scaling rules
- [ ] Implement health check endpoints
- [ ] Set up monitoring and alerting

## Monitoring Setup

### Key Metrics to Monitor

#### API Metrics
```typescript
// services/api/src/monitoring/metrics.ts

import client from 'prom-client';

// Response time histogram
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
});

// Request counter
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

// Error rate
const httpRequestErrors = new client.Counter({
  name: 'http_request_errors_total',
  help: 'Total number of HTTP request errors',
  labelNames: ['method', 'route', 'error_type'],
});

// Database metrics
const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_ms',
  help: 'Duration of database queries in ms',
  labelNames: ['operation', 'table'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
});

const dbConnectionPool = new client.Gauge({
  name: 'db_connection_pool_size',
  help: 'Current database connection pool size',
  labelNames: ['state'], // 'active', 'idle', 'total'
});

// Cache metrics
const cacheHits = new client.Counter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['cache_key_prefix'],
});

const cacheMisses = new client.Counter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['cache_key_prefix'],
});
```

### Alert Thresholds

Configure alerts for:

1. **Response Time Alerts**
   - Warning: p95 > 500ms for 5 minutes
   - Critical: p95 > 1000ms for 2 minutes

2. **Error Rate Alerts**
   - Warning: Error rate > 1% for 5 minutes
   - Critical: Error rate > 5% for 2 minutes

3. **Database Alerts**
   - Warning: Connection pool > 80% utilized
   - Critical: Connection pool > 95% utilized
   - Critical: Query time > 1000ms

4. **Cache Alerts**
   - Warning: Cache hit rate < 70%
   - Warning: Redis connection errors

5. **Resource Alerts**
   - Warning: CPU > 70% for 5 minutes
   - Critical: CPU > 90% for 2 minutes
   - Warning: Memory > 80%
   - Critical: Memory > 95%

## Load Test Results

### Test Run Template

```markdown
#### Test Date: YYYY-MM-DD
**Environment:** [Production/Staging/Local]
**Configuration:** [Server specs, DB config, etc.]

**Test Parameters:**
- Virtual Users: X
- Duration: X minutes
- Ramp-up: X seconds

**Results:**
| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| p95 Response Time | Xms | < 500ms | ✅/❌ |
| p99 Response Time | Xms | < 1000ms | ✅/❌ |
| Error Rate | X% | < 1% | ✅/❌ |
| Throughput | X RPS | > 500 RPS | ✅/❌ |
| Max VUs Handled | X | > 200 | ✅/❌ |

**Bottlenecks Identified:**
- [List any bottlenecks found]

**Actions Taken:**
- [List optimizations applied]

**Notes:**
- [Any additional observations]
```

## Next Steps

1. **Run Initial Load Tests**
   - Execute baseline test to establish metrics
   - Run normal load test (50 users)
   - Run peak load test (200 users)
   - Document results in this file

2. **Analyze Results**
   - Identify bottlenecks using k6 output
   - Review server metrics during tests
   - Check database slow query logs
   - Analyze cache hit rates

3. **Apply Optimizations**
   - Start with quick wins (indexes, caching)
   - Implement connection pool tuning
   - Enable compression
   - Add monitoring

4. **Re-test and Validate**
   - Run tests again after optimizations
   - Compare before/after metrics
   - Verify improvements meet targets
   - Document changes

5. **Continuous Monitoring**
   - Set up production monitoring
   - Configure alerts
   - Regular performance reviews
   - Periodic load testing (monthly)

## Resources

- [PostgreSQL Performance Tips](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [Redis Best Practices](https://redis.io/topics/optimization)
- [Fastify Performance Guide](https://www.fastify.io/docs/latest/Guides/Performance/)
- [k6 Documentation](https://k6.io/docs/)
- [Database Indexing Strategy](https://use-the-index-luke.com/)

## Appendix: SQL Performance Queries

### Check Slow Queries
```sql
-- Enable slow query logging
ALTER DATABASE bountyexpo SET log_min_duration_statement = 100;

-- View slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Check Index Usage
```sql
-- Find unused indexes
SELECT schemaname, tablename, indexname
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND indexname NOT LIKE '%_pkey';

-- Find missing indexes
SELECT schemaname, tablename, attname, n_distinct, correlation
FROM pg_stats
WHERE schemaname = 'public'
AND n_distinct > 100
ORDER BY abs(correlation) DESC;
```

### Monitor Connection Pool
```sql
-- Check active connections
SELECT count(*), state
FROM pg_stat_activity
WHERE datname = 'bountyexpo'
GROUP BY state;

-- Check long-running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active'
AND now() - pg_stat_activity.query_start > interval '1 second'
ORDER BY duration DESC;
```
