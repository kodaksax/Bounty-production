# Rate Limiting Implementation

## Overview

Redis-backed rate limiting has been implemented on authentication endpoints to protect against brute force attacks and abuse. This implementation uses `@fastify/rate-limit` with a custom Redis store for distributed rate limiting across multiple server instances.

## Security Features

### Authentication Rate Limiting
- **Limit**: 5 attempts per 15 minutes
- **Keying**: IP address + email for targeted protection
- **Endpoints**:
  - `POST /auth/sign-in`
  - `POST /auth/sign-up`
  - `POST /auth/register`

### API Rate Limiting
- **Limit**: 100 requests per minute
- **Keying**: IP address
- **Applied to**: General API endpoints (configurable)

## Architecture

### Redis Store Implementation

The custom `RedisRateLimitStore` class implements the store interface required by `@fastify/rate-limit`:

```typescript
class RedisRateLimitStore {
  async incr(key: string, callback: Function): Promise<void>
  child(routeOptions: object): RedisRateLimitStore
}
```

### Key Features

1. **Distributed**: Works across multiple server instances via Redis
2. **Atomic Operations**: Uses Redis MULTI/EXEC for race-condition-free counting
3. **TTL Management**: Automatically expires keys after the time window
4. **Standard Headers**: Returns RFC-compliant rate limit headers
5. **Graceful Degradation**: Continues to work if Redis is temporarily unavailable

## Configuration

### Environment Variables

```bash
# Redis Connection (option 1: individual settings)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_ENABLED=true

# Redis Connection (option 2: connection string)
REDIS_URL=redis://[:password@]host:port/db

# Rate Limit Settings
AUTH_RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
AUTH_RATE_LIMIT_MAX=5             # 5 attempts
RATE_LIMIT_WINDOW_MS=60000        # 1 minute
RATE_LIMIT_MAX_REQUESTS=100       # 100 requests
```

### Code Configuration

Located in `src/middleware/rate-limiter.ts`:

```typescript
export const authLimiterConfig = {
  max: 5,                    // Maximum attempts
  timeWindow: 900000,        // 15 minutes
  redis: new RedisRateLimitStore('rl:auth:'),
  keyGenerator: (req) => `${req.ip}-${req.body.email}`,
  // ... error handling and headers
};
```

## Response Format

### Success (Within Limit)

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 3
X-RateLimit-Reset: 1640000000
```

### Rate Limit Exceeded

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1640000000
Retry-After: 600

{
  "error": "Too many authentication attempts. Please try again in 15 minutes.",
  "code": "RATE_LIMIT_EXCEEDED",
  "statusCode": 429,
  "retryAfter": 600
}
```

## Testing

### Automated Testing

Run the test script to verify rate limiting:

```bash
# Start the API server
npm run dev

# In another terminal, run the rate limiting tests
npm run test:rate-limiting
```

### Manual Testing with curl

Test rate limiting by making multiple requests:

```bash
# Test with curl (should fail after 5 attempts)
for i in {1..10}; do
  echo "Attempt $i"
  curl -X POST http://localhost:3001/auth/sign-in \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}' \
    -i
  echo ""
  sleep 1
done
```

### Verify in Redis

Check Redis keys to verify rate limiting is working:

```bash
# Connect to Redis
redis-cli

# List rate limit keys
KEYS "bountyexpo:rl:auth:*"

# Check specific key
GET "bountyexpo:rl:auth:127.0.0.1-test@example.com"
TTL "bountyexpo:rl:auth:127.0.0.1-test@example.com"
```

## Monitoring

### Logging

Rate limit events are logged:

```javascript
// Approaching limit
request.log.warn({ ip, key }, 'Authentication rate limit approaching');

// Exceeded limit
request.log.warn({ ip, key }, 'Authentication rate limit exceeded');
```

### Redis Monitoring

Monitor rate limit performance:

```bash
# Redis stats
redis-cli INFO stats

# Watch commands in real-time
redis-cli MONITOR

# Count rate limit keys
redis-cli KEYS "bountyexpo:rl:*" | wc -l
```

## Production Considerations

### Redis High Availability

For production, use Redis in a high-availability setup:

1. **Redis Sentinel**: Automatic failover
2. **Redis Cluster**: Horizontal scaling
3. **AWS ElastiCache**: Managed Redis service
4. **Azure Cache for Redis**: Managed Redis service

### Scaling

The implementation scales horizontally:

- Each API instance connects to the same Redis
- Rate limits are shared across all instances
- No single point of failure (except Redis)

### Performance

- **Redis operations**: ~1ms per request
- **Memory usage**: ~100 bytes per unique IP+email combination
- **Automatic cleanup**: Keys expire after 15 minutes

### Security Best Practices

1. **IP Spoofing**: Consider using `X-Forwarded-For` with caution
2. **Email Enumeration**: Use consistent error messages
3. **DDoS Protection**: Combine with infrastructure-level rate limiting
4. **Monitoring**: Alert on high rate limit violations

## Troubleshooting

### Redis Connection Issues

If Redis is unavailable:

```
[RateLimit] Redis error: connect ECONNREFUSED
```

**Solution**: Check Redis connection settings and ensure Redis is running.

### Rate Limiting Not Working

1. Verify Redis is running: `redis-cli ping`
2. Check environment variables are set correctly
3. Verify the plugin is registered in routes
4. Check logs for errors

### Keys Not Expiring

If keys aren't expiring automatically:

```bash
# Manually set TTL
redis-cli EXPIRE "bountyexpo:rl:auth:key" 900
```

Check Redis `maxmemory-policy` configuration.

## Migration from In-Memory

The old in-memory rate limiting has been replaced. Key differences:

| Feature | Old (In-Memory) | New (Redis) |
|---------|----------------|-------------|
| Distribution | Single instance only | Multi-instance |
| Persistence | Lost on restart | Persists in Redis |
| Scalability | Limited | Horizontal scaling |
| Performance | Faster (~0.1ms) | Fast (~1ms) |
| Maintenance | Manual cleanup | Automatic via TTL |

## References

- [@fastify/rate-limit Documentation](https://github.com/fastify/fastify-rate-limit)
- [Redis Documentation](https://redis.io/docs/)
- [RFC 6585 - Additional HTTP Status Codes](https://tools.ietf.org/html/rfc6585)
- [IETF Draft - RateLimit Headers](https://datatracker.ietf.org/doc/html/draft-polli-ratelimit-headers)
