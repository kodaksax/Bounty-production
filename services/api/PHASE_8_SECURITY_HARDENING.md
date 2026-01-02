# Phase 8: Security Hardening

## Overview
Comprehensive security measures to protect the consolidated backend service.

## 8.1 Security Audit Checklist

### Authentication & Authorization

#### ✅ Checklist
- [ ] All endpoints require authentication (except public ones)
- [ ] JWT tokens have appropriate expiration (15-60 minutes)
- [ ] Refresh token rotation implemented
- [ ] Password requirements enforced (min length, complexity)
- [ ] Rate limiting on auth endpoints (prevent brute force)
- [ ] Account lockout after failed attempts
- [ ] Multi-factor authentication available
- [ ] Session management secure
- [ ] Token blacklist for logout
- [ ] Admin routes require admin role

#### Verification Commands
```bash
# Test unauthenticated access
curl -X GET http://localhost:3001/api/profile
# Should return 401

# Test with invalid token
curl -X GET http://localhost:3001/api/profile \
  -H "Authorization: Bearer invalid-token"
# Should return 401

# Test rate limiting
for i in {1..10}; do
  curl -X POST http://localhost:3001/auth/sign-in \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}'
done
# Should start returning 429 after threshold
```

### Input Validation

#### ✅ Checklist
- [ ] All user inputs validated
- [ ] SQL injection protection (use parameterized queries)
- [ ] NoSQL injection protection
- [ ] XSS prevention (sanitize outputs)
- [ ] CSRF protection implemented
- [ ] File upload validation (type, size, content)
- [ ] Email validation
- [ ] URL validation
- [ ] JSON schema validation
- [ ] Path traversal prevention

#### Validation Middleware
```typescript
// middleware/input-validation.ts
import { z } from 'zod';

export const validateBody = (schema: z.ZodSchema) => {
  return async (request: any, reply: any) => {
    try {
      request.body = schema.parse(request.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: error.errors
        });
      }
      throw error;
    }
  };
};

// Usage
const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

fastify.post('/auth/sign-in', {
  preHandler: validateBody(signInSchema)
}, async (request, reply) => {
  // Handler code
});
```

### Rate Limiting

#### ✅ Checklist
- [ ] Global rate limit configured
- [ ] Per-endpoint rate limits
- [ ] Per-user rate limits
- [ ] IP-based rate limiting
- [ ] Sliding window implementation
- [ ] Rate limit headers included
- [ ] Whitelist for trusted IPs
- [ ] Different limits for different user tiers

#### Rate Limit Configuration
```typescript
// middleware/rate-limit.ts

const rateLimitConfig = {
  // Global limits
  global: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000 // requests per window
  },
  
  // Auth endpoints (stricter)
  auth: {
    windowMs: 15 * 60 * 1000,
    max: 5 // Only 5 login attempts per 15 min
  },
  
  // API endpoints
  api: {
    windowMs: 60 * 1000, // 1 minute
    max: 60 // 60 requests per minute
  },
  
  // Payment endpoints (very strict)
  payment: {
    windowMs: 60 * 1000,
    max: 10
  }
};
```

### SQL Injection Protection

#### ✅ Checklist
- [ ] Use ORM or query builder (Drizzle, Prisma)
- [ ] Never concatenate user input into SQL
- [ ] Use parameterized queries
- [ ] Escape special characters
- [ ] Validate data types
- [ ] Use least privilege database user

#### Safe Query Examples
```typescript
// ✅ SAFE: Using Drizzle ORM
const user = await db
  .select()
  .from(users)
  .where(eq(users.email, userEmail))
  .limit(1);

// ✅ SAFE: Parameterized query
const result = await pool.query(
  'SELECT * FROM users WHERE email = $1',
  [userEmail]
);

// ❌ UNSAFE: String concatenation
const result = await pool.query(
  `SELECT * FROM users WHERE email = '${userEmail}'`
);
// Vulnerable to: ' OR '1'='1
```

### XSS Protection

#### ✅ Checklist
- [ ] Sanitize all user-generated content
- [ ] Set Content-Security-Policy header
- [ ] Escape HTML in outputs
- [ ] Validate and sanitize rich text
- [ ] Use HTTPOnly cookies
- [ ] Set X-XSS-Protection header
- [ ] Avoid inline scripts

#### XSS Prevention Middleware
```typescript
// middleware/security-headers.ts

fastify.addHook('onRequest', async (request, reply) => {
  reply.header('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self'; " +
    "connect-src 'self';"
  );
  
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});
```

### HTTPS/TLS

#### ✅ Checklist
- [ ] Force HTTPS in production
- [ ] TLS 1.2 or higher only
- [ ] Strong cipher suites
- [ ] HSTS header enabled
- [ ] Certificate pinning (if applicable)
- [ ] Proper certificate chain
- [ ] Auto-renewal configured

#### HTTPS Configuration
```typescript
// Production server with HTTPS
import fs from 'fs';
import https from 'https';

const server = https.createServer({
  key: fs.readFileSync('/path/to/private-key.pem'),
  cert: fs.readFileSync('/path/to/certificate.pem'),
  ca: fs.readFileSync('/path/to/ca-bundle.pem'),
  
  // Security options
  minVersion: 'TLSv1.2',
  ciphers: [
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384'
  ].join(':')
}, app);

// HSTS header
app.use((req, res, next) => {
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );
  next();
});
```

## 8.2 Penetration Testing

### Automated Security Scanning

#### OWASP ZAP
```bash
# Install OWASP ZAP
docker pull owasp/zap2docker-stable

# Run baseline scan
docker run -t owasp/zap2docker-stable \
  zap-baseline.py -t http://localhost:3001

# Run full scan
docker run -t owasp/zap2docker-stable \
  zap-full-scan.py -t http://localhost:3001

# Generate report
docker run -v $(pwd):/zap/wrk/:rw -t owasp/zap2docker-stable \
  zap-full-scan.py -t http://localhost:3001 -r report.html
```

#### Dependency Vulnerability Scanning
```bash
# NPM audit
npm audit

# Fix vulnerabilities
npm audit fix

# Force fix (may have breaking changes)
npm audit fix --force

# Check for outdated packages
npm outdated

# Update packages
npm update
```

#### Snyk Security Scanner
```bash
# Install Snyk
npm install -g snyk

# Authenticate
snyk auth

# Test for vulnerabilities
snyk test

# Monitor continuously
snyk monitor

# Test Docker images
snyk container test node:18-alpine
```

### Manual Testing

#### Authentication Tests
```bash
# Test 1: Weak password
curl -X POST http://localhost:3001/auth/sign-up \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"123"}'
# Should reject

# Test 2: SQL injection in login
curl -X POST http://localhost:3001/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com'\'' OR '\''1'\''='\''1","password":"anything"}'
# Should return error, not bypass auth

# Test 3: XSS in profile
curl -X POST http://localhost:3001/api/profiles \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"<script>alert(1)</script>"}'
# Should sanitize or reject
```

#### Authorization Tests
```bash
# Test 1: Access other user's data
curl -X GET http://localhost:3001/api/profiles/other-user-id \
  -H "Authorization: Bearer <user-token>"
# Should deny

# Test 2: Admin endpoint with user token
curl -X GET http://localhost:3001/admin/metrics \
  -H "Authorization: Bearer <user-token>"
# Should return 403

# Test 3: Modify other user's bounty
curl -X PATCH http://localhost:3001/api/bounties/other-user-bounty-id \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hacked"}'
# Should deny
```

#### Input Validation Tests
```bash
# Test 1: Extremely long input
curl -X POST http://localhost:3001/api/bounties \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$(python -c 'print("A"*100000)')\"}"
# Should reject

# Test 2: Invalid data types
curl -X POST http://localhost:3001/api/bounties \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":"not-a-number"}'
# Should reject with clear error

# Test 3: Path traversal
curl -X GET http://localhost:3001/api/files/../../etc/passwd
# Should deny
```

### Security Headers Verification
```bash
# Check security headers
curl -I http://localhost:3001/health

# Should include:
# - X-Content-Type-Options: nosniff
# - X-Frame-Options: DENY
# - X-XSS-Protection: 1; mode=block
# - Strict-Transport-Security: max-age=31536000
# - Content-Security-Policy: ...
```

## 8.3 Secrets Management

### Environment Variables

#### ✅ Checklist
- [ ] Never commit secrets to git
- [ ] Use .env files (git-ignored)
- [ ] Different secrets per environment
- [ ] Rotate secrets regularly
- [ ] Use secret management service (AWS Secrets Manager, Vault)
- [ ] Encrypt secrets at rest
- [ ] Limit secret access
- [ ] Audit secret usage

#### .env.example Template
```bash
# .env.example - Safe to commit
# Copy to .env and fill in real values

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/bountyexpo

# Supabase
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Stripe
STRIPE_SECRET_KEY=sk_test_your-secret-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret

# JWT
JWT_SECRET=your-jwt-secret-at-least-32-chars

# Email (Optional)
SENDGRID_API_KEY=your-sendgrid-api-key

# Analytics (Optional)
MIXPANEL_TOKEN=your-mixpanel-token

# Monitoring (Optional)
SENTRY_DSN=your-sentry-dsn
```

### Secret Rotation

#### Rotation Schedule
- Database passwords: Every 90 days
- API keys: Every 90 days
- JWT secrets: Every 180 days
- Webhook secrets: Every 90 days
- Admin passwords: Every 60 days

#### Rotation Process
```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -base64 32)

# 2. Update in secrets manager
aws secretsmanager update-secret \
  --secret-id bountyexpo/jwt-secret \
  --secret-string "$NEW_SECRET"

# 3. Deploy with new secret (zero-downtime)
# Keep old and new secret active during rollout

# 4. Remove old secret after full deployment
```

### Key Management

#### Encryption Keys
```typescript
// services/encryption.ts
import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const keyLength = 32;
const ivLength = 16;
const tagLength = 16;

export function encrypt(text: string, key: Buffer): string {
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag();
  
  // Return iv + encrypted + tag
  return iv.toString('hex') + ':' + encrypted + ':' + tag.toString('hex');
}

export function decrypt(encryptedData: string, key: Buffer): string {
  const parts = encryptedData.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const tag = Buffer.from(parts[2], 'hex');
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

### Audit Logging

#### Security Event Logging
```typescript
// services/security-logger.ts

export const securityLogger = {
  logAuthSuccess(userId: string, ip: string) {
    logger.info({
      event: 'auth_success',
      userId,
      ip,
      timestamp: new Date()
    }, 'User authenticated successfully');
  },
  
  logAuthFailure(email: string, ip: string, reason: string) {
    logger.warn({
      event: 'auth_failure',
      email,
      ip,
      reason,
      timestamp: new Date()
    }, 'Authentication failed');
  },
  
  logAdminAction(userId: string, action: string, target: string) {
    logger.info({
      event: 'admin_action',
      userId,
      action,
      target,
      timestamp: new Date()
    }, 'Admin action performed');
  },
  
  logSuspiciousActivity(details: any) {
    logger.warn({
      event: 'suspicious_activity',
      ...details,
      timestamp: new Date()
    }, 'Suspicious activity detected');
  }
};
```

## Success Criteria

### Security Audit
- ✅ Zero critical vulnerabilities
- ✅ All high vulnerabilities addressed or accepted
- ✅ All endpoints authenticated (except public)
- ✅ All inputs validated
- ✅ All endpoints rate-limited

### Penetration Testing
- ✅ OWASP ZAP scan passes
- ✅ No SQL injection vulnerabilities
- ✅ No XSS vulnerabilities
- ✅ No authentication bypasses
- ✅ No authorization bypasses

### Secrets Management
- ✅ No secrets in git
- ✅ All secrets encrypted
- ✅ Secret rotation schedule
- ✅ Access audit trail
- ✅ Principle of least privilege

## Security Monitoring

### Real-time Monitoring
```bash
# Watch for failed auth attempts
tail -f logs/security.log | grep auth_failure

# Watch for suspicious activity
tail -f logs/security.log | grep suspicious_activity

# Count failed attempts by IP
cat logs/security.log | grep auth_failure | \
  jq -r '.ip' | sort | uniq -c | sort -rn
```

### Automated Alerts
Set up alerts for:
- Multiple failed auth attempts from same IP
- Admin actions outside business hours
- Unusual data access patterns
- High error rates
- Slow query performance
- Certificate expiration warnings

## Incident Response Plan

### Detection
1. Automated monitoring detects anomaly
2. Alert sent to security team
3. Initial assessment within 15 minutes

### Containment
1. Identify affected systems
2. Isolate compromised accounts/IPs
3. Revoke compromised credentials
4. Scale up logging/monitoring

### Eradication
1. Identify root cause
2. Remove malicious code/access
3. Patch vulnerabilities
4. Update security controls

### Recovery
1. Restore from backups if needed
2. Reset all potentially compromised secrets
3. Gradual service restoration
4. Enhanced monitoring during recovery

### Post-Incident
1. Full incident report
2. Root cause analysis
3. Lessons learned
4. Process improvements
5. Update runbooks

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Fastify Security](https://www.fastify.io/docs/latest/Guides/Security/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
