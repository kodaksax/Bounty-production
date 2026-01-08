# Critical Fixes Action Plan

**Purpose:** Immediate actions to address blocking issues identified in the comprehensive build review.

**Target Timeline:** 1-2 weeks for critical items

---

## 🔴 CRITICAL - Fix Immediately (This Sprint)

### 1. TypeScript Build Errors [BLOCKING] ⏱️ 2-4 hours

**Problem:** Application doesn't compile, CI/CD pipeline broken

**Root Causes:**
- Missing Expo 54+ tsconfig base reference
- JSX configuration not set
- Missing type definitions (@types/node, @types/jest)
- Workspace package dependency issues

**Fix Steps:**

```bash
# 1. Install missing type definitions
npm install --save-dev @types/node @types/jest

# 2. Fix workspace packages
npm install --workspace=@bountyexpo/domain-types zod
npm install --workspace=@bountyexpo/api-client react @types/react

# 3. Update tsconfig.json (see below)
```

**tsconfig.json Updates:**
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "types": ["node", "jest"],
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
  "exclude": ["node_modules"]
}
```

**Verification:**
```bash
npm run type-check  # Should pass without errors
npx tsc --noEmit    # Should compile cleanly
```

**Owner:** DevOps/Build Engineer  
**Priority:** P0 - BLOCKING  
**Status:** ❌ Not Started

---

### 2. Security Vulnerabilities [SECURITY] ⏱️ 1 hour

**Problem:** 4 moderate CVEs, including esbuild vulnerability

**Vulnerabilities:**
- esbuild ≤0.24.2 (GHSA-67mh-4wv8-2f99, CVE Score: 5.3)
- @esbuild-kit/core-utils, @esbuild-kit/esm-loader, drizzle-kit (transitive)

**Fix Steps:**
```bash
# Run automated fix
npm audit fix --force

# Or manual upgrade
npm install --save-dev esbuild@latest

# Verify fixes
npm audit
```

**Verification:**
```bash
npm audit  # Should show 0 vulnerabilities
```

**Owner:** Security Team  
**Priority:** P0 - SECURITY  
**Status:** ❌ Not Started

---

### 3. CI/CD Configuration [BLOCKING] ⏱️ 1 hour

**Problem:** CI allows failing tests to pass with `continue-on-error: true`

**Fix:** Update `.github/workflows/ci.yml`

**Changes:**
```yaml
# Remove from these steps:
- name: Run linter
  run: npm run lint
  # REMOVE: continue-on-error: true

- name: Run type check
  run: npm run type-check
  # REMOVE: continue-on-error: true

# Keep for backward compatibility during transition:
- name: Run npm audit
  run: npm audit --audit-level=moderate
  continue-on-error: true  # OK - This is for visibility only

- name: Run dependency check
  run: npm run audit:deps
  continue-on-error: true  # OK - This is for visibility only
```

**Verification:**
- Push a PR with intentional lint error - should fail CI
- Push a PR with type error - should fail CI

**Owner:** DevOps  
**Priority:** P0 - BLOCKING  
**Status:** ❌ Not Started

---

### 4. Rate Limiting on Auth Endpoints [SECURITY] ⏱️ 4 hours

**Problem:** No rate limiting on sign-in/sign-up endpoints, vulnerable to brute force

**Implementation:**

**services/api/src/middleware/rate-limiter.ts:**
```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Aggressive rate limit for authentication
export const authLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:auth:',
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: 'Too many authentication attempts. Please try again in 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Key by IP + email for more targeted limiting
  keyGenerator: (req) => {
    const email = req.body?.email || 'unknown';
    return `${req.ip}-${email}`;
  },
});

// Moderate rate limit for API endpoints
export const apiLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:api:',
  }),
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    error: 'Too many requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});
```

**Apply to routes:**
```typescript
// services/api/src/routes/auth.ts
import { authLimiter } from '../middleware/rate-limiter';

router.post('/auth/signin', authLimiter, signInHandler);
router.post('/auth/signup', authLimiter, signUpHandler);
router.post('/auth/reset-password', authLimiter, resetPasswordHandler);
```

**Dependencies:**
```bash
cd services/api
npm install express-rate-limit rate-limit-redis
```

**Testing:**
```bash
# Test rate limiting (should fail after 5 attempts)
for i in {1..10}; do
  curl -X POST http://localhost:3001/auth/signin \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}'
  echo "\nAttempt $i"
  sleep 1
done
```

**Owner:** Backend Team  
**Priority:** P0 - SECURITY  
**Status:** ❌ Not Started

---

## 🟠 HIGH PRIORITY - Fix Within 1 Week

### 5. Complete Payment Escrow Flow [CORE FEATURE] ⏱️ 3-5 days

**Problem:** Escrow mechanism incomplete, critical for platform trust

**Implementation Plan:**

**Phase 1: Escrow Creation (Day 1-2)**
```typescript
// lib/services/escrow-service.ts
export class EscrowService {
  async createEscrow(bountyId: string, hunterId: string, amount: number) {
    // 1. Create PaymentIntent with manual capture
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      capture_method: 'manual',
      metadata: {
        bountyId,
        hunterId,
        type: 'escrow'
      }
    });

    // 2. Record in database
    const transaction = await db.walletTransactions.create({
      type: 'escrow',
      amount: -amount,
      bountyId,
      status: 'pending',
      stripePaymentIntentId: paymentIntent.id
    });

    // 3. Update bounty status
    await db.bounties.update(bountyId, {
      status: 'in_progress',
      escrowTransactionId: transaction.id
    });

    return { transaction, paymentIntent };
  }
}
```

**Phase 2: Release Mechanism (Day 3-4)**
```typescript
async releaseEscrow(bountyId: string, posterId: string) {
  // 1. Verify poster is authorized
  const bounty = await db.bounties.findById(bountyId);
  if (bounty.user_id !== posterId) {
    throw new Error('Unauthorized');
  }

  // 2. Get escrow transaction
  const escrow = await db.walletTransactions.findOne({
    bountyId,
    type: 'escrow',
    status: 'pending'
  });

  // 3. Capture the payment
  await stripe.paymentIntents.capture(escrow.stripePaymentIntentId);

  // 4. Transfer to hunter
  const transfer = await stripe.transfers.create({
    amount: Math.round(escrow.amount * 100),
    currency: 'usd',
    destination: bounty.hunter.stripeAccountId,
    metadata: { bountyId }
  });

  // 5. Record release
  await db.walletTransactions.create({
    type: 'release',
    amount: Math.abs(escrow.amount),
    bountyId,
    status: 'completed',
    stripeTransferId: transfer.id
  });

  // 6. Update bounty
  await db.bounties.update(bountyId, {
    status: 'completed'
  });

  // 7. Send notifications
  await notificationService.notify(bounty.hunterId, {
    type: 'payment',
    title: 'Payment Released',
    body: `You've received $${escrow.amount} for "${bounty.title}"`
  });
}
```

**Phase 3: Refund Handling (Day 5)**
```typescript
async refundEscrow(bountyId: string, reason: string) {
  const escrow = await db.walletTransactions.findOne({
    bountyId,
    type: 'escrow'
  });

  // Refund the payment
  const refund = await stripe.refunds.create({
    payment_intent: escrow.stripePaymentIntentId,
    reason: 'requested_by_customer',
    metadata: { bountyId, reason }
  });

  // Record refund
  await db.walletTransactions.create({
    type: 'refund',
    amount: Math.abs(escrow.amount),
    bountyId,
    status: 'completed',
    stripeRefundId: refund.id
  });

  // Update bounty
  await db.bounties.update(bountyId, {
    status: 'cancelled'
  });
}
```

**Testing Checklist:**
- [ ] Create escrow on bounty acceptance
- [ ] Verify funds are held (not captured)
- [ ] Release escrow on completion
- [ ] Verify hunter receives funds
- [ ] Test refund on cancellation
- [ ] Verify poster receives refund
- [ ] Test webhook handling for all events
- [ ] Test idempotency (retry scenarios)
- [ ] Load test escrow flow

**Owner:** Payments Team  
**Priority:** P1 - HIGH  
**Status:** ❌ Not Started

---

### 6. Database Performance - Add Critical Indexes ⏱️ 1 day

**Problem:** Missing indexes causing slow queries as data grows

**Migration File: `services/api/migrations/add_performance_indexes.sql`**
```sql
-- Bounties table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_user_id 
  ON bounties(user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_status 
  ON bounties(status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_created_at 
  ON bounties(created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_status_created 
  ON bounties(status, created_at DESC)
  WHERE status = 'open';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_location_status 
  ON bounties(location, status)
  WHERE status = 'open' AND location IS NOT NULL;

-- Messages table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_id 
  ON messages(conversation_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_created_at 
  ON messages(created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_sender_id 
  ON messages(sender_id);

-- Conversations table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_bounty_id 
  ON conversations(bounty_id)
  WHERE bounty_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_updated_at 
  ON conversations(updated_at DESC);

-- Wallet transactions indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_tx_bounty_id 
  ON wallet_transactions(bounty_id)
  WHERE bounty_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_tx_user_created 
  ON wallet_transactions(user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_tx_type_status 
  ON wallet_transactions(type, status);

-- Notifications indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_created 
  ON notifications(user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_read 
  ON notifications(user_id, read)
  WHERE read = false;

-- User profiles indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_username 
  ON profiles(username);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_verification 
  ON profiles(verification_status)
  WHERE verification_status = 'verified';

-- Full-text search indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_search 
  ON bounties USING gin(to_tsvector('english', title || ' ' || description));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_search 
  ON profiles USING gin(to_tsvector('english', username || ' ' || COALESCE(bio, '')));

-- Analyze tables after index creation
ANALYZE bounties;
ANALYZE messages;
ANALYZE conversations;
ANALYZE wallet_transactions;
ANALYZE notifications;
ANALYZE profiles;
```

**Run Migration:**
```bash
cd services/api
npx drizzle-kit push:pg
# Or manually:
psql $DATABASE_URL -f migrations/add_performance_indexes.sql
```

**Verification:**
```sql
-- Check index usage after a day
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Check for missing indexes (should return nothing after this migration)
SELECT 
  schemaname,
  tablename,
  round((100 * idx_scan / (seq_scan + idx_scan))::numeric, 2) as index_usage_percent
FROM pg_stat_user_tables
WHERE seq_scan + idx_scan > 0
  AND schemaname = 'public'
ORDER BY index_usage_percent;
```

**Owner:** Database Team  
**Priority:** P1 - HIGH  
**Status:** ❌ Not Started

---

### 7. Comprehensive E2E Tests ⏱️ 3-5 days

**Problem:** No full user journey tests, risk of broken critical paths

**Test Suite: `__tests__/e2e/complete-bounty-flow.test.ts`**
```typescript
import { test, expect } from '@jest/globals';
import { signup, signin, createBounty, acceptBounty, completeBounty, releaseFunds } from '../helpers';

describe('Complete Bounty Lifecycle E2E', () => {
  let poster, hunter, bounty;

  beforeAll(async () => {
    // Create test users
    poster = await signup({ email: 'poster@test.com', password: 'Test1234!' });
    hunter = await signup({ email: 'hunter@test.com', password: 'Test1234!' });
  });

  test('Full bounty flow: create → accept → complete → payment', async () => {
    // Step 1: Poster creates bounty
    bounty = await createBounty(poster.token, {
      title: 'E2E Test Bounty',
      description: 'Testing the complete flow',
      amount: 5000, // $50
      location: 'Remote'
    });
    expect(bounty.id).toBeDefined();
    expect(bounty.status).toBe('open');

    // Step 2: Hunter accepts bounty
    const acceptance = await acceptBounty(hunter.token, bounty.id);
    expect(acceptance.status).toBe('accepted');

    // Verify bounty status changed
    const updatedBounty = await getBounty(poster.token, bounty.id);
    expect(updatedBounty.status).toBe('in_progress');
    expect(updatedBounty.hunter_id).toBe(hunter.id);

    // Step 3: Verify escrow created
    const escrow = await getEscrowTransaction(poster.token, bounty.id);
    expect(escrow.type).toBe('escrow');
    expect(escrow.amount).toBe(-5000);
    expect(escrow.status).toBe('pending');

    // Step 4: Hunter completes work
    const completion = await completeBounty(hunter.token, bounty.id, {
      notes: 'Work completed successfully'
    });
    expect(completion.status).toBe('pending_review');

    // Step 5: Poster releases payment
    const release = await releaseFunds(poster.token, bounty.id);
    expect(release.status).toBe('completed');

    // Step 6: Verify funds released
    const releaseTransaction = await getTransaction(hunter.token, release.transactionId);
    expect(releaseTransaction.type).toBe('release');
    expect(releaseTransaction.amount).toBe(5000);
    expect(releaseTransaction.status).toBe('completed');

    // Step 7: Verify final bounty status
    const finalBounty = await getBounty(poster.token, bounty.id);
    expect(finalBounty.status).toBe('completed');

    // Step 8: Verify notifications sent
    const posterNotifs = await getNotifications(poster.token);
    expect(posterNotifs.some(n => n.type === 'completion')).toBe(true);

    const hunterNotifs = await getNotifications(hunter.token);
    expect(hunterNotifs.some(n => n.type === 'payment')).toBe(true);
  }, 60000); // 60 second timeout

  test('Cancellation and refund flow', async () => {
    // Create and accept bounty
    const bounty = await createBounty(poster.token, {
      title: 'Cancellation Test',
      description: 'Testing cancellation',
      amount: 3000
    });
    await acceptBounty(hunter.token, bounty.id);

    // Request cancellation
    const cancellation = await requestCancellation(poster.token, bounty.id, {
      reason: 'Change of plans'
    });
    expect(cancellation.status).toBe('pending');

    // Hunter accepts cancellation
    await acceptCancellation(hunter.token, cancellation.id);

    // Verify refund processed
    const refund = await getRefundTransaction(poster.token, bounty.id);
    expect(refund.type).toBe('refund');
    expect(refund.amount).toBe(3000);
    expect(refund.status).toBe('completed');
  }, 60000);

  test('Dispute creation flow', async () => {
    // Create, accept, and complete bounty
    const bounty = await createBounty(poster.token, {
      title: 'Dispute Test',
      description: 'Testing disputes',
      amount: 4000
    });
    await acceptBounty(hunter.token, bounty.id);
    await completeBounty(hunter.token, bounty.id);

    // Poster rejects completion
    await rejectCompletion(poster.token, bounty.id, {
      reason: 'Work not satisfactory'
    });

    // Hunter creates dispute
    const dispute = await createDispute(hunter.token, bounty.id, {
      reason: 'Work was completed as specified',
      evidence: ['screenshot1.png', 'screenshot2.png']
    });
    expect(dispute.status).toBe('open');
    expect(dispute.evidence.length).toBe(2);

    // Verify admin can see dispute
    const adminDisputes = await getAdminDisputes(adminToken);
    expect(adminDisputes.some(d => d.id === dispute.id)).toBe(true);
  }, 60000);
});
```

**Run E2E Tests:**
```bash
# Start test environment
npm run dev  # Start services

# Run E2E suite
npm run test:e2e

# With coverage
npm run test:e2e -- --coverage
```

**Owner:** QA Team  
**Priority:** P1 - HIGH  
**Status:** ❌ Not Started

---

## 📊 Progress Tracking

| Item | Priority | Est. Time | Status | Owner | Due Date |
|------|----------|-----------|--------|-------|----------|
| 1. TypeScript Build | P0 | 2-4h | ❌ | DevOps | Day 1 |
| 2. Security Vulns | P0 | 1h | ❌ | Security | Day 1 |
| 3. CI/CD Config | P0 | 1h | ❌ | DevOps | Day 1 |
| 4. Rate Limiting | P0 | 4h | ❌ | Backend | Day 2 |
| 5. Escrow Flow | P1 | 3-5d | ❌ | Payments | Week 1 |
| 6. DB Indexes | P1 | 1d | ❌ | Database | Week 1 |
| 7. E2E Tests | P1 | 3-5d | ❌ | QA | Week 2 |

---

## Definition of Done

Each item is considered complete when:

✅ **Code Complete:** Implementation finished and reviewed  
✅ **Tests Pass:** Unit and integration tests passing  
✅ **Documented:** Changes documented in relevant files  
✅ **Deployed:** Changes merged to main and deployed to staging  
✅ **Verified:** Functionality verified in staging environment  

---

## Next Steps After Critical Fixes

Once these critical items are complete:

1. **Week 2-3:** Complete dispute resolution, notification preferences
2. **Week 3-4:** Load testing, APM setup, performance optimization
3. **Week 4-5:** Increase test coverage to 70%, bundle optimization
4. **Week 5-6:** Security audit, user documentation, polish
5. **Week 6-7:** Beta launch preparation
6. **Week 8:** Limited beta rollout

---

## Communication Plan

- **Daily standups:** Review progress on critical items
- **Weekly status report:** Progress dashboard shared with stakeholders
- **Blockers:** Escalate immediately in #critical-fixes Slack channel
- **Code reviews:** Required for all critical fixes (2 approvers)

---

**Last Updated:** January 8, 2026  
**Next Review:** Daily until all P0 items complete
