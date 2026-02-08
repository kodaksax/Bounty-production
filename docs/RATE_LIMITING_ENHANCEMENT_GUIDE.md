# Rate Limiting Enhancement Guide

## Overview

This document outlines the current rate limiting implementation in BOUNTYExpo and provides recommendations for future enhancements including backend-coordinated rate limiting and CAPTCHA integration for defense in depth.

## Current Implementation

### ✅ What We Have Today

BOUNTYExpo currently implements multiple layers of rate limiting protection:

1. **Client-Side Rate Limiting** - Basic throttling in the mobile app
2. **API-Level Rate Limiting** - In-memory rate limiting for API endpoints  
3. **Auth-Specific Rate Limiting** - Stricter limits for authentication endpoints
4. **Supabase Built-in Protection** - Database-level rate limiting and DDoS protection

### Current Rate Limit Configuration

#### General API Endpoints
**Location:** `services/api/src/middleware/rate-limit.ts`

```typescript
// Current settings
const MAX_TOKENS = 100;      // Maximum requests per window
const REFILL_RATE = 100;     // Tokens to add per window  
const WINDOW_MS = 60 * 1000; // 1 minute window

// Per user/IP: 100 requests per minute
```

**Implementation:** Token bucket algorithm with in-memory storage

#### Authentication Endpoints
**Location:** `services/api/src/routes/consolidated-auth.ts`

```typescript
// Current settings (from config)
config.rateLimit.auth = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5                      // 5 attempts per window
}

// Per IP: 5 auth attempts per 15 minutes
```

**Implementation:** Custom rate limit middleware with IP-based tracking

### Protection Layers

```
┌─────────────────────────────────────────────────────────┐
│                     Client App                          │
│  • Basic request throttling                             │
│  • UI-level retry delays                                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  API Server (Fastify)                   │
│  Layer 1: General Rate Limiting                         │
│    • 100 req/min per user/IP                            │
│    • Token bucket algorithm                             │
│    • In-memory store (Map)                              │
│                                                          │
│  Layer 2: Auth Rate Limiting                            │
│    • 5 attempts per 15 min                              │
│    • IP-based tracking                                  │
│    • Custom middleware                                  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Supabase (Database Layer)                  │
│  • Built-in connection pooling                          │
│  • DDoS protection                                      │
│  • Row-level security                                   │
│  • Query rate limiting                                  │
└─────────────────────────────────────────────────────────┘
```

## Current State Assessment

### ✅ Strengths

1. **Multi-layered defense** - Multiple checkpoints before database
2. **Automatic cleanup** - In-memory stores self-clean every 5 minutes
3. **Proper headers** - Returns `Retry-After`, `X-RateLimit-*` headers
4. **Idempotency** - Stripe operations use idempotency keys
5. **Graceful degradation** - Rate limit failures don't block requests

### ⚠️ Current Limitations

1. **No Redis coordination** - Each API instance has separate limits
2. **No CAPTCHA** - Brute force attacks can retry across IPs
3. **No progressive penalties** - Same limit regardless of behavior
4. **Limited visibility** - No centralized rate limit metrics
5. **IP-only for auth** - Can't ban specific user accounts

## Future Enhancements (Low Priority)

### When to Implement These

Implement these enhancements **only if**:

- ❌ Seeing actual credential stuffing attacks in logs
- ❌ User complaints about brute force attempts
- ❌ Multi-instance deployment without shared state
- ❌ Monitoring shows rate limiting ineffective

**Current Priority:** ⏳ **LOW** - Current protection is adequate

### Enhancement 1: Backend-Coordinated Rate Limiting with Redis

**Value:** Consistent rate limits across multiple API instances  
**ROI:** Low unless deploying multiple instances  
**Effort:** Medium (2-3 days)

#### Architecture

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  API Server  │      │  API Server  │      │  API Server  │
│  Instance 1  │      │  Instance 2  │      │  Instance 3  │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                     │
       └──────────────┬──────┴──────────┬──────────┘
                      │                 │
                      ▼                 ▼
              ┌─────────────────────────────┐
              │      Redis (Shared)         │
              │  • Centralized counters     │
              │  • Atomic operations        │
              │  • TTL-based expiry         │
              │  • Lua scripts for atomic   │
              │    check-and-increment      │
              └─────────────────────────────┘
```

#### Implementation Sketch

```typescript
// services/api/src/middleware/redis-rate-limit.ts
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export async function redisRateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const identifier = request.userId || request.ip;
  const key = `rate_limit:${identifier}`;
  
  // Lua script for atomic check-and-increment
  const script = `
    local current = redis.call('incr', KEYS[1])
    if current == 1 then
      redis.call('expire', KEYS[1], ARGV[1])
    end
    return current
  `;
  
  const current = await redis.eval(
    script,
    1,
    key,
    60 // 60 second TTL
  ) as number;
  
  const limit = 100;
  
  reply.header('X-RateLimit-Limit', limit.toString());
  reply.header('X-RateLimit-Remaining', Math.max(0, limit - current).toString());
  
  if (current > limit) {
    return reply.code(429).send({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded',
    });
  }
}
```

**Configuration Required:**
```bash
# .env additions
REDIS_URL=redis://localhost:6379
REDIS_RATE_LIMIT_ENABLED=true
```

**Migration Path:**
1. Add Redis as optional dependency
2. Feature flag: use Redis if available, fallback to in-memory
3. Test with single instance first
4. Roll out to multiple instances
5. Monitor performance impact

### Enhancement 2: CAPTCHA Integration After Failed Attempts

**Value:** Prevents automated brute force attacks  
**ROI:** Low unless seeing bot attacks  
**Effort:** Medium (2-3 days)

#### When CAPTCHA is Triggered

```
┌─────────────────────────────────────────────────────────┐
│              Login Attempt Progression                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Attempts 1-3:  Normal login (no CAPTCHA)              │
│  Attempt 4:     CAPTCHA required                        │
│  Attempts 5+:   CAPTCHA + progressive delay              │
│  Attempt 10:    Account temporarily locked (15 min)     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

#### Integration Points

**Option A: reCAPTCHA v3 (Invisible)**

```typescript
// lib/services/captcha-service.ts
import axios from 'axios';

export async function verifyCaptcha(token: string, ip: string): Promise<boolean> {
  const response = await axios.post(
    'https://www.google.com/recaptcha/api/siteverify',
    null,
    {
      params: {
        secret: process.env.RECAPTCHA_SECRET_KEY,
        response: token,
        remoteip: ip,
      }
    }
  );
  
  const { success, score } = response.data;
  
  // Require score > 0.5 (likely human)
  return success && score > 0.5;
}
```

**Option B: hCaptcha (Privacy-focused alternative)**

```typescript
// lib/services/captcha-service.ts
import axios from 'axios';

export async function verifyHCaptcha(token: string): Promise<boolean> {
  const response = await axios.post(
    'https://hcaptcha.com/siteverify',
    `response=${token}&secret=${process.env.HCAPTCHA_SECRET}`,
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );
  
  return response.data.success;
}
```

#### Client Integration

```typescript
// app/auth/sign-in-form.tsx
import { useEffect, useState } from 'react';

function SignInForm() {
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>();
  
  async function handleSignIn() {
    const payload = {
      email,
      password,
      captchaToken: captchaRequired ? captchaToken : undefined,
    };
    
    try {
      await authService.signIn(payload);
    } catch (error) {
      if (error.code === 'CAPTCHA_REQUIRED') {
        setCaptchaRequired(true);
        // Show CAPTCHA widget
      }
    }
  }
  
  return (
    <View>
      {/* Login form */}
      
      {captchaRequired && (
        <HCaptcha
          siteKey={HCAPTCHA_SITE_KEY}
          onVerify={setCaptchaToken}
        />
      )}
    </View>
  );
}
```

#### Backend Enforcement

```typescript
// services/api/src/routes/consolidated-auth.ts
async function handleSignIn(request, reply) {
  const { email, password, captchaToken } = request.body;
  const ip = request.ip;
  
  // Check if user has failed attempts
  const failedAttempts = await getFailedAttempts(ip, email);
  
  // Require CAPTCHA after 3 failed attempts
  if (failedAttempts >= 3) {
    if (!captchaToken) {
      return reply.code(403).send({
        error: 'CAPTCHA_REQUIRED',
        message: 'Please complete CAPTCHA verification',
      });
    }
    
    const captchaValid = await verifyCaptcha(captchaToken, ip);
    if (!captchaValid) {
      return reply.code(403).send({
        error: 'CAPTCHA_INVALID',
        message: 'CAPTCHA verification failed',
      });
    }
  }
  
  // Proceed with normal auth...
}
```

### Enhancement 3: Progressive Rate Limiting

**Value:** Adaptive limits based on user behavior  
**ROI:** Low - nice to have  
**Effort:** Low (1-2 days)

#### Concept

```typescript
interface RateLimitProfile {
  // Trusted users get higher limits
  trusted: { limit: 200, window: 60_000 },
  
  // Normal users
  normal: { limit: 100, window: 60_000 },
  
  // Users with recent violations
  suspicious: { limit: 50, window: 60_000 },
  
  // Users who triggered CAPTCHA
  restricted: { limit: 20, window: 60_000 },
}

function getRateLimitForUser(userId: string): RateLimitConfig {
  const trustScore = calculateTrustScore(userId);
  
  if (trustScore > 0.8) return RateLimitProfile.trusted;
  if (trustScore < 0.3) return RateLimitProfile.restricted;
  if (trustScore < 0.5) return RateLimitProfile.suspicious;
  return RateLimitProfile.normal;
}

function calculateTrustScore(userId: string): number {
  // Factors:
  // + Account age
  // + Successful transactions
  // + Email verified
  // + Payment method added
  // - Failed login attempts
  // - Bounties flagged
  // - Rate limit violations
  
  return 0.75; // Example
}
```

### Enhancement 4: Account-Level Blocking

**Value:** Ban specific bad actors  
**ROI:** Low unless seeing repeat offenders  
**Effort:** Low (1 day)

#### Implementation

```typescript
// services/api/src/middleware/account-block.ts
export async function checkAccountBlocked(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = (request as AuthenticatedRequest).userId;
  if (!userId) return; // Skip for unauthenticated requests
  
  const blocked = await redis.get(`blocked:${userId}`);
  
  if (blocked) {
    return reply.code(403).send({
      error: 'ACCOUNT_BLOCKED',
      message: 'Your account has been temporarily blocked. Please contact support.',
    });
  }
}

// Block account for suspicious activity
export async function blockAccount(
  userId: string, 
  durationSeconds: number,
  reason: string
) {
  await redis.setex(
    `blocked:${userId}`,
    durationSeconds,
    JSON.stringify({ reason, blockedAt: Date.now() })
  );
  
  logger.warn({ userId, reason, durationSeconds }, 'Account blocked');
}
```

## Monitoring and Metrics

### Key Metrics to Track

```typescript
// Recommended metrics to add
interface RateLimitMetrics {
  // Request metrics
  totalRequests: number;
  rateLimitedRequests: number;
  rateLimitHitRate: number; // percentage
  
  // User metrics
  uniqueUsersRateLimited: number;
  repeatOffenders: number;
  
  // Auth metrics
  failedLoginAttempts: number;
  captchaRequested: number;
  captchaFailed: number;
  
  // Timing metrics
  avgResponseTime: number;
  p95ResponseTime: number;
  
  // Attack detection
  suspiciousPatterns: number;
  blockedIPs: number;
  blockedAccounts: number;
}
```

### Logging Best Practices

```typescript
// Good logging for rate limit events
logger.warn({
  event: 'rate_limit_exceeded',
  identifier: userId || ip,
  endpoint: request.url,
  method: request.method,
  current: bucket.count,
  limit: MAX_LIMIT,
  retryAfter,
}, 'Rate limit exceeded');

// Log suspicious patterns
logger.warn({
  event: 'suspicious_activity',
  userId,
  ip,
  pattern: 'rapid_failed_logins',
  attempts: failedCount,
  timeWindow: '5 minutes',
}, 'Suspicious activity detected');
```

## Testing Strategy

### Load Testing

```bash
# Test rate limits with Apache Bench
ab -n 200 -c 10 http://localhost:3001/api/bounties

# Expected result: Some 429 responses after hitting limit
```

### Integration Tests

```typescript
describe('Rate Limiting', () => {
  it('should allow requests under limit', async () => {
    for (let i = 0; i < 100; i++) {
      const res = await request(app).get('/api/bounties');
      expect(res.status).toBe(200);
    }
  });
  
  it('should block requests over limit', async () => {
    // Make 100 requests (at limit)
    for (let i = 0; i < 100; i++) {
      await request(app).get('/api/bounties');
    }
    
    // 101st request should be rate limited
    const res = await request(app).get('/api/bounties');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
  
  it('should reset after window expires', async () => {
    // Hit rate limit
    for (let i = 0; i < 101; i++) {
      await request(app).get('/api/bounties');
    }
    
    // Wait for window to expire
    await sleep(60_000);
    
    // Should allow requests again
    const res = await request(app).get('/api/bounties');
    expect(res.status).toBe(200);
  });
});
```

## Security Best Practices

### 1. ✅ Always Use HTTPS

Rate limiting is less effective without HTTPS:
- Attackers can see and replay tokens
- Headers can be modified in transit

### 2. ✅ Rate Limit by Multiple Factors

```typescript
// Good: Combine user + IP + endpoint
const key = `rate:${userId}:${ip}:${endpoint}`;

// Better: Add device fingerprint
const key = `rate:${userId}:${ip}:${deviceId}:${endpoint}`;
```

### 3. ✅ Log Everything

```typescript
// Log all rate limit violations
if (rateLimited) {
  logger.warn({
    userId,
    ip,
    userAgent: request.headers['user-agent'],
    endpoint: request.url,
    attempts: bucket.count,
  }, 'Rate limit violation');
  
  // Alert on sustained violations
  if (bucket.count > limit * 2) {
    await alertSecurityTeam({ userId, ip });
  }
}
```

### 4. ✅ Implement Fail-Open

```typescript
// If rate limiting fails, allow request but log error
try {
  await rateLimitMiddleware(request, reply);
} catch (error) {
  logger.error({ error }, 'Rate limiting error - allowing request');
  // Don't block the request
}
```

## Configuration Recommendations

### Development Environment

```bash
# .env.development
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=1000      # Higher limits for testing
RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=50   # More permissive
CAPTCHA_ENABLED=false    # Disable for easier testing
```

### Production Environment

```bash
# .env.production
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=5
AUTH_RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
CAPTCHA_ENABLED=false   # Enable only when needed
REDIS_RATE_LIMIT_ENABLED=false  # Enable with multi-instance
```

## Decision Tree: When to Implement

```
Do you have multiple API instances?
├─ Yes → Implement Redis coordination (Enhancement 1)
└─ No → Continue with in-memory

Are you seeing credential stuffing attacks?
├─ Yes → Implement CAPTCHA (Enhancement 2)
└─ No → Continue monitoring

Do you have repeat offenders?
├─ Yes → Implement account blocking (Enhancement 4)
└─ No → Current limits sufficient

Is rate limiting causing false positives?
├─ Yes → Implement progressive limits (Enhancement 3)
└─ No → Current limits appropriate
```

## Related Documentation

- [Security Features Implementation](../SECURITY_FEATURES_IMPLEMENTATION.md) - Overall security architecture
- [Authentication Testing Guide](../AUTHENTICATION_TESTING_GUIDE.md) - Testing auth flows
- [Backend Consolidation Architecture](../BACKEND_CONSOLIDATION_ARCHITECTURE.md) - API structure

## Conclusion

**Current State:** ✅ Adequate protection with multi-layered rate limiting  
**Next Steps:** Monitor for attacks before implementing enhancements  
**Priority:** ⏳ Low - Only implement if seeing actual threats

The current rate limiting implementation provides solid defense-in-depth protection for BOUNTYExpo. The suggested enhancements should only be implemented when there is clear signal from production metrics indicating they are needed.

**Focus instead on:** Redis idempotency for multi-instance deployment (higher ROI)

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-01-02  
**Status:** Planning Reference 📝  
**Priority:** Low - Implement only when needed
