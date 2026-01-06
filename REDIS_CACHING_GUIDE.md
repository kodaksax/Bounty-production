# Redis Caching Implementation

## Overview

BOUNTYExpo uses Redis to cache frequently accessed data, improving API response times and reducing database load. This document describes the caching strategy, implementation details, and usage patterns.

## Architecture

### Components

1. **Redis Service** (`services/api/src/services/redis-service.ts`)
   - Connection management with automatic reconnection
   - Type-safe cache operations
   - TTL configuration per resource type
   - Error handling with graceful fallbacks
   - Cache invalidation utilities

2. **Configuration** (`services/api/src/config/index.ts`)
   - Redis connection settings
   - TTL values for different resource types
   - Enable/disable flag for caching

3. **Route Integration**
   - Profile routes: GET operations use cache, mutations invalidate
   - Bounty routes: GET operations use cache, mutations invalidate

## Caching Strategy

### Cache Keys

Cache keys follow a hierarchical pattern with prefixes:

```
bountyexpo:profile:{profileId}
bountyexpo:bounty:{bountyId}
bountyexpo:bounty:list:{queryParams}
```

### TTL (Time To Live) Values

| Resource | Default TTL | Rationale |
|----------|-------------|-----------|
| Profiles | 5 minutes (300s) | Profiles change infrequently |
| Bounties | 3 minutes (180s) | Bounty details are relatively stable |
| Bounty Lists | 1 minute (60s) | Lists change more frequently with new bounties |

These values can be configured via environment variables:

```bash
REDIS_TTL_PROFILE=300
REDIS_TTL_BOUNTY=180
REDIS_TTL_BOUNTY_LIST=60
```

## Cache Invalidation

### When Caches are Invalidated

1. **Profile Cache**
   - Invalidated on: Profile create/update (POST/PATCH)
   - Scope: Single profile by ID

2. **Bounty Cache**
   - Invalidated on: Bounty update, delete, status change
   - Scope: Single bounty by ID

3. **Bounty List Cache**
   - Invalidated on: Bounty create, update, delete, status change
   - Scope: All list queries (pattern match)
   - Reason: Lists contain aggregated data that may be affected

### Invalidation Patterns

```typescript
// Single resource invalidation
await cacheInvalidation.invalidateProfile(profileId);
await cacheInvalidation.invalidateBounty(bountyId);

// Bulk invalidation (lists)
await cacheInvalidation.invalidateBountyLists();
```

## Implementation Details

### Cached Endpoints

#### Profiles

**GET /api/profiles/:id**
- Cache Key: `profile:{id}`
- TTL: 5 minutes
- Invalidated by: POST/PATCH /api/profiles/:id

**GET /api/profile** (own profile)
- Cache Key: `profile:{userId}`
- TTL: 5 minutes
- Invalidated by: POST/PATCH /api/profiles

#### Bounties

**GET /api/bounties/:id**
- Cache Key: `bounty:{id}`
- TTL: 3 minutes
- Invalidated by: PATCH/DELETE /api/bounties/:id, status changes

**GET /api/bounties** (list)
- Cache Key: `bounty:list:{queryParams}`
- TTL: 1 minute
- Invalidated by: POST /api/bounties, any bounty mutations

### Cache Flow

```
Request → Check Cache → Cache Hit? → Return Cached Data
                     ↓ Cache Miss
                     → Query Database
                     → Store in Cache
                     → Return Data

Mutation → Update Database
        → Invalidate Related Caches
        → Return Response
```

## Configuration

### Environment Variables

```bash
# Redis connection
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                  # Optional
REDIS_DB=0                       # Database number
REDIS_KEY_PREFIX=bountyexpo:     # Key namespace
REDIS_ENABLED=true               # Enable/disable caching

# TTL settings
REDIS_TTL_PROFILE=300            # Profile cache TTL (seconds)
REDIS_TTL_BOUNTY=180             # Bounty cache TTL (seconds)
REDIS_TTL_BOUNTY_LIST=60         # Bounty list cache TTL (seconds)
```

### Docker Setup

Redis is configured in `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  container_name: bountyexpo-redis
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
  command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
```

**Configuration Highlights:**
- `appendonly yes`: Persistence for cache recovery
- `maxmemory 256mb`: Memory limit
- `maxmemory-policy allkeys-lru`: Eviction policy (Least Recently Used)

## Performance Benefits

### Expected Improvements

1. **Response Time**
   - Cache hit: ~5-10ms
   - Database query: ~50-100ms
   - **Improvement**: 5-20x faster for cached responses

2. **Database Load**
   - Reduces read queries by 60-80% (typical cache hit rate)
   - Allows database to handle more concurrent users
   - Reduces database costs in production

3. **Scalability**
   - Redis can handle 100,000+ operations per second
   - Horizontal scaling possible with Redis Cluster
   - Reduces bottleneck at database layer

## Monitoring and Debugging

### Check Cache Status

```bash
# Connect to Redis CLI
docker exec -it bountyexpo-redis redis-cli

# Check number of keys
DBSIZE

# View all keys (use with caution in production)
KEYS bountyexpo:*

# Get cache statistics
INFO memory
INFO stats

# Get a cached value
GET bountyexpo:profile:{id}

# Check TTL of a key
TTL bountyexpo:profile:{id}
```

### Test Cache Operations

```bash
cd services/api
npx tsx src/test-redis-simple.ts
```

### Clear Cache

```bash
# Flush all keys in current database
docker exec bountyexpo-redis redis-cli FLUSHDB

# Flush all databases
docker exec bountyexpo-redis redis-cli FLUSHALL

# Delete specific pattern
docker exec bountyexpo-redis redis-cli --scan --pattern 'bountyexpo:bounty:list:*' | xargs redis-cli DEL
```

## Error Handling

### Graceful Degradation

The Redis service is designed to fail gracefully:

1. If Redis is unavailable, requests fall back to direct database queries
2. Cache errors are logged but don't break API responses
3. Application continues to function without caching

### Connection Resilience

- Automatic reconnection on connection loss
- Retry strategy with exponential backoff
- Health checks to detect issues early

## Best Practices

### For Developers

1. **Always invalidate caches on mutations**
   ```typescript
   // After updating resource
   await cacheInvalidation.invalidateBounty(bountyId);
   ```

2. **Use appropriate TTLs**
   - Shorter TTL for frequently changing data
   - Longer TTL for stable data
   - Consider data consistency requirements

3. **Monitor cache hit rates**
   - High hit rate (>70%): Good caching strategy
   - Low hit rate (<30%): Review TTLs or cache keys

4. **Test with and without cache**
   - Test cache hits and misses
   - Verify invalidation works correctly
   - Test failure scenarios

### For Production

1. **Set appropriate memory limits**
   - Start with 256MB, adjust based on usage
   - Monitor memory usage over time

2. **Enable persistence**
   - Use AOF (Append Only File) for durability
   - Configure backup strategy

3. **Monitor Redis health**
   - Set up alerts for memory usage
   - Monitor connection count
   - Track cache hit rate

4. **Use Redis Sentinel or Cluster for HA**
   - For production, consider high availability setup
   - Replicas for read scaling
   - Automatic failover

## Future Enhancements

### Potential Improvements

1. **Cache Warming**
   - Pre-populate cache on application startup
   - Warm popular bounties/profiles

2. **Advanced Invalidation**
   - Tag-based invalidation for related resources
   - Selective invalidation based on mutation type

3. **Cache Analytics**
   - Track cache hit/miss rates per endpoint
   - Expose metrics for monitoring

4. **Rate Limiting**
   - Use Redis for distributed rate limiting
   - Replace in-memory rate limit cache

5. **Session Storage**
   - Store user sessions in Redis
   - Enable horizontal scaling of API servers

## Troubleshooting

### Common Issues

**Issue**: Connection refused
```bash
# Check if Redis is running
docker ps | grep redis

# Check Redis logs
docker logs bountyexpo-redis

# Restart Redis
docker compose restart redis
```

**Issue**: Out of memory
```bash
# Check memory usage
docker exec bountyexpo-redis redis-cli INFO memory

# Increase maxmemory in docker-compose.yml
# or flush old keys
docker exec bountyexpo-redis redis-cli FLUSHDB
```

**Issue**: Stale data in cache
- Verify TTL is appropriate for data volatility
- Check that invalidation is called on mutations
- Consider reducing TTL or clearing cache

**Issue**: Slow cache operations
- Check network latency to Redis
- Monitor Redis CPU usage
- Consider using Redis pipelining for bulk operations

## References

- [Redis Documentation](https://redis.io/documentation)
- [ioredis Client Documentation](https://github.com/luin/ioredis)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [Caching Strategies](https://redis.io/docs/manual/patterns/caching/)
