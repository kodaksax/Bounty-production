# Auth Rate Limiting Implementation Guide

## Overview
This document describes the rate limiting implementation on authentication endpoints to protect against brute force attacks and account enumeration attempts.

## Security Requirements Met
✅ **Brute Force Protection**: All auth endpoints limited to prevent credential stuffing  
✅ **Account Enumeration Mitigation**: Reduced ability to probe for valid accounts  
✅ **DoS Prevention**: Prevents authentication endpoint abuse  
✅ **Per-IP Tracking**: Each IP address is tracked independently  
✅ **Standard Headers**: Clients can implement proper retry logic using standard headers

## Implementation Details

### Rate Limit Configuration

**Legacy API (api/server.js)**
- **Window**: 15 minutes (900,000 ms)
- **Max Requests**: 5 per window per IP
- **Response**: HTTP 429 with retry information
- **Headers**: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After

**Consolidated API (services/api/src/routes/consolidated-auth.ts)**
- **Window**: 15 minutes (configurable via `AUTH_RATE_LIMIT_WINDOW_MS`)
- **Max Requests**: 5 (configurable via `AUTH_RATE_LIMIT_MAX`)
- **Response**: HTTP 429 with structured error
- **Implementation**: Custom in-memory rate limiter with cleanup

### Protected Endpoints

#### Legacy API (api/server.js)
1. `POST /app/auth/sign-up-form` - Sign up with form data
2. `POST /app/auth/sign-in-form` - Sign in with form data  
3. `POST /auth/register` - Register new account
4. `POST /auth/sign-in` - Sign in to existing account
5. `POST /auth/identifier-sign-up` - Sign up with identifier

#### Consolidated API (services/api/src)
1. `POST /auth/register` - Register new account
2. `POST /auth/sign-in` - Sign in to existing account
3. `POST /auth/sign-up` - Sign up (alternative endpoint)

## Configuration

### Environment Variables (Consolidated API)
```bash
# Auth rate limiting (optional, defaults shown)
AUTH_RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
AUTH_RATE_LIMIT_MAX=5              # 5 requests per window
```

### Code Configuration (Legacy API)
Located in `api/server.js`:

```javascript
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 authentication requests per window
  message: {
    error: 'Too Many Requests',
    message: 'Too many authentication attempts. Please try again in 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[RateLimit] Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many authentication attempts. Please try again in 15 minutes.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});
```

## Response Format

### Success Response (Before Limit)
```json
{
  "success": true,
  "userId": "user-id",
  "email": "user@example.com"
}
```

**Headers:**
```
RateLimit-Limit: 5
RateLimit-Remaining: 4
RateLimit-Reset: <timestamp>
```

### Rate Limit Exceeded Response
```json
{
  "error": "Too Many Requests",
  "message": "Too many authentication attempts. Please try again in 15 minutes.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 900
}
```

**Status Code:** `429 Too Many Requests`

**Headers:**
```
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: <timestamp>
Retry-After: 900
```

## Client Integration

### Handling Rate Limits

#### JavaScript/TypeScript Example
```typescript
async function signIn(email: string, password: string) {
  try {
    const response = await fetch('/auth/sign-in', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    // Check rate limit headers
    const remaining = response.headers.get('RateLimit-Remaining');
    if (remaining && parseInt(remaining) < 2) {
      console.warn(`Only ${remaining} attempts remaining`);
    }

    if (response.status === 429) {
      const data = await response.json();
      const retryAfter = response.headers.get('Retry-After');
      throw new Error(
        `Too many attempts. Please try again in ${Math.ceil(retryAfter / 60)} minutes`
      );
    }

    if (!response.ok) {
      throw new Error('Sign in failed');
    }

    return await response.json();
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  }
}
```

#### React Native Example
```typescript
import { useState } from 'react';

function useAuthWithRateLimit() {
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);

  async function signIn(email: string, password: string) {
    // Check if currently locked out
    if (lockedUntil && new Date() < lockedUntil) {
      const secondsRemaining = Math.ceil(
        (lockedUntil.getTime() - Date.now()) / 1000
      );
      throw new Error(
        `Account locked. Try again in ${Math.ceil(secondsRemaining / 60)} minutes`
      );
    }

    const response = await fetch('/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    // Update remaining attempts
    const remaining = response.headers.get('RateLimit-Remaining');
    if (remaining) {
      setRemainingAttempts(parseInt(remaining));
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        const lockoutTime = new Date(Date.now() + parseInt(retryAfter) * 1000);
        setLockedUntil(lockoutTime);
      }
      throw new Error('Too many login attempts');
    }

    return await response.json();
  }

  return { signIn, remainingAttempts, lockedUntil };
}
```

## Testing

### Test Files
1. **`tests/auth-security.test.js`** - Unit tests for auth validation logic
2. **`tests/auth-rate-limiting-validation.test.js`** - Code validation tests
3. **`tests/auth-rate-limiting.test.js`** - Integration tests (requires running server)

### Running Tests

#### Validation Test (No Server Required)
```bash
node tests/auth-rate-limiting-validation.test.js
```

#### Security Tests (No Server Required)
```bash
node tests/auth-security.test.js
```

#### Integration Test (Requires Running Server)
```bash
# Start the API server
npm run api

# In another terminal
node tests/auth-rate-limiting.test.js
```

### Expected Test Results
All tests should pass with output similar to:
```
✅ express-rate-limit is properly imported
✅ authRateLimiter middleware is properly defined
✅ /app/auth/sign-up-form is protected
✅ /app/auth/sign-in-form is protected
✅ /auth/register is protected
✅ /auth/sign-in is protected
✅ /auth/identifier-sign-up is protected
✅ Rate limit configuration is secure
✅ Proper HTTP 429 response configured
```

## Monitoring and Logging

### Rate Limit Violations
All rate limit violations are logged with IP address:

```javascript
console.warn(`[RateLimit] Auth rate limit exceeded for IP: ${req.ip}`);
```

### Recommended Monitoring
1. **Track 429 responses** - Monitor frequency of rate limit hits
2. **Log IP addresses** - Identify potential attackers
3. **Alert on patterns** - Multiple IPs hitting limits may indicate distributed attack
4. **Geographic analysis** - Unexpected geographic patterns may indicate bot activity

### Example Log Entry
```
[RateLimit] Auth rate limit exceeded for IP: 192.168.1.100
```

## Security Best Practices

### Additional Recommendations
1. **Use CAPTCHA** - Add CAPTCHA after 2-3 failed attempts
2. **Account Lockout** - Lock accounts after 10 failed attempts (separate from IP rate limiting)
3. **Email Notifications** - Notify users of failed login attempts
4. **Two-Factor Authentication** - Implement 2FA for enhanced security
5. **IP Allowlisting** - Allow trusted IPs to bypass rate limits
6. **Progressive Delays** - Increase delays exponentially after each failure

### Adjusting Rate Limits
To adjust rate limits, modify the configuration:

**Legacy API (api/server.js):**
```javascript
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Change window duration
  max: 5, // Change max requests
  // ... rest of config
});
```

**Consolidated API (.env):**
```bash
AUTH_RATE_LIMIT_WINDOW_MS=900000  # Change window
AUTH_RATE_LIMIT_MAX=5              # Change max
```

### Warning: More Restrictive Settings
- **Lower max requests**: More secure but may frustrate legitimate users with typos
- **Shorter window**: More aggressive protection but less user-friendly
- **Longer window**: More user-friendly but less protective

**Recommended Balance**: 5 requests per 15 minutes provides good security while allowing legitimate retry attempts.

## Troubleshooting

### Issue: Legitimate Users Being Blocked
**Solution**: 
- Verify user is not behind a shared IP (corporate NAT, VPN)
- Consider implementing account-based tracking in addition to IP-based
- Add mechanism for users to request unlock via email verification

### Issue: Distributed Attacks Bypassing Limits
**Solution**:
- Implement account-based rate limiting in addition to IP-based
- Use CAPTCHA after first failed attempt
- Implement temporary account locks
- Consider using external services like Cloudflare for DDoS protection

### Issue: Rate Limit Not Working
**Solution**:
- Verify `express-rate-limit` is installed: `npm ls express-rate-limit`
- Check that middleware is applied to routes: Search for `authRateLimiter` in route handlers
- Verify IP detection is working: Check `req.ip` in logs
- Ensure server is not behind proxy without proper configuration

## Migration Notes

### From No Rate Limiting
If previously no rate limiting was in place:
1. ✅ Rate limiting is now active on all auth endpoints
2. ✅ No client changes required (rate limits are permissive for normal use)
3. ✅ Monitor logs for rate limit hits in first week
4. ⚠️  Inform users if CAPTCHA or stricter measures are planned

### From Different Rate Limit
If changing rate limit parameters:
1. Update configuration values
2. Restart API server
3. Clear rate limit cache if using persistent storage
4. Monitor for increased 429 responses
5. Adjust as needed based on user feedback

## References

- [OWASP: Blocking Brute Force Attacks](https://owasp.org/www-community/controls/Blocking_Brute_Force_Attacks)
- [express-rate-limit Documentation](https://express-rate-limit.mintlify.app/)
- [RFC 6585: 429 Too Many Requests](https://datatracker.ietf.org/doc/html/rfc6585#section-4)
- [HTTP RateLimit Headers Draft](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers)

## Support

For questions or issues related to rate limiting:
1. Check logs for rate limit violations
2. Review this documentation
3. Check test files for implementation examples
4. Review code in `api/server.js` and `services/api/src/routes/consolidated-auth.ts`

---

**Last Updated**: 2026-01-09  
**Implementation Version**: 1.0  
**Status**: ✅ Active and Tested
