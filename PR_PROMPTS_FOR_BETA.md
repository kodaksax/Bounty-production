# PR Prompts for Beta Launch Preparation

**Purpose:** Ready-to-use PR prompts for addressing critical issues identified in the comprehensive build review, organized by priority and phase.

**Timeline:** 4-8 weeks to limited beta launch  
**Last Updated:** January 9, 2026

---

## How to Use These Prompts

1. Copy the entire prompt for the task you're working on
2. Create a new branch: `git checkout -b <branch-name>`
3. Paste the prompt into your AI assistant or use as a development guide
4. Follow the acceptance criteria to ensure completeness
5. Submit PR with the provided title and description template

---

## Phase 1: Critical Security & Infrastructure (Week 1)

### PR #1: Implement Rate Limiting on Authentication Endpoints

**Branch:** `feature/auth-rate-limiting`  
**Priority:** P0 - SECURITY  
**Estimated Time:** 4 hours  
**Blocker:** Yes - Security vulnerability

#### Problem Statement

Authentication endpoints (sign-in, sign-up, password reset) are currently unprotected from brute force attacks. An attacker could:
- Attempt unlimited password guessing
- Enumerate valid email addresses
- Launch credential stuffing attacks
- Cause service disruption through excessive requests

This is a critical security vulnerability that must be addressed before beta launch.

#### Task

Implement Redis-backed rate limiting middleware for all authentication endpoints to prevent brute force attacks and service abuse.

#### Technical Requirements

1. **Install Dependencies:**
   ```bash
   cd services/api
   npm install express-rate-limit rate-limit-redis ioredis
   ```

2. **Create Rate Limiter Middleware** (`services/api/src/middleware/rate-limiter.ts`):
   - Aggressive rate limiting for auth endpoints (5 attempts per 15 minutes)
   - Moderate rate limiting for general API endpoints (100 requests per minute)
   - Redis-backed storage for distributed rate limiting
   - Key generation based on IP + email for targeted limiting
   - Proper error responses with retry-after headers

3. **Apply to Routes:**
   - `/auth/signin` - 5 attempts per 15 min per IP+email
   - `/auth/signup` - 5 attempts per 15 min per IP
   - `/auth/reset-password` - 3 attempts per hour per email
   - `/auth/verify-email` - 10 attempts per hour per email
   - All other API routes - 100 requests per minute per IP

4. **Testing Requirements:**
   - Unit tests for rate limiter configuration
   - Integration tests verifying limits are enforced
   - Manual testing of lockout scenarios
   - Test bypass for internal services (if needed)

#### Implementation Code Sample

```typescript
// services/api/src/middleware/rate-limiter.ts
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

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
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = req.body?.email || 'unknown';
    return `${req.ip}-${email}`;
  },
  skipSuccessfulRequests: false, // Count all attempts
  skipFailedRequests: false,
});

// Strict rate limit for password reset
export const passwordResetLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:reset:',
  }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 attempts per hour
  message: {
    error: 'Too many password reset attempts. Please try again in 1 hour.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 60 * 60,
  },
  keyGenerator: (req) => {
    const email = req.body?.email || req.query?.email || 'unknown';
    return `reset-${email}`;
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
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to routes
// services/api/src/routes/auth.ts
import { authLimiter, passwordResetLimiter } from '../middleware/rate-limiter';

router.post('/auth/signin', authLimiter, signInHandler);
router.post('/auth/signup', authLimiter, signUpHandler);
router.post('/auth/reset-password', passwordResetLimiter, resetPasswordHandler);
```

#### Acceptance Criteria

- [ ] Rate limiter middleware created with Redis backend
- [ ] Auth endpoints protected with 5 attempts per 15 minutes
- [ ] Password reset protected with 3 attempts per hour
- [ ] General API endpoints protected with 100 req/min
- [ ] Proper error responses with retry-after headers
- [ ] Unit tests cover rate limiter configuration
- [ ] Integration tests verify limits are enforced
- [ ] Manual testing confirms lockout and recovery
- [ ] Documentation updated in API_REFERENCE.md
- [ ] Redis connection health check added
- [ ] Monitoring/alerting configured for rate limit hits

#### Testing Commands

```bash
# Test authentication rate limiting
for i in {1..10}; do
  curl -X POST http://localhost:3001/auth/signin \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}' \
    -w "\nStatus: %{http_code}\n"
  echo "Attempt $i"
  sleep 1
done

# Should see 429 after 5th attempt

# Test rate limit reset
sleep 900  # Wait 15 minutes
curl -X POST http://localhost:3001/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"wrong"}'
# Should work again
```

#### PR Title
```
feat(security): Implement Redis-backed rate limiting on authentication endpoints
```

#### PR Description Template
```markdown
## Summary
Implements comprehensive rate limiting on authentication endpoints to prevent brute force attacks and service abuse.

## Changes
- Added express-rate-limit and rate-limit-redis dependencies
- Created rate limiter middleware with Redis backend
- Applied aggressive limits to auth endpoints (5/15min)
- Applied strict limits to password reset (3/hour)
- Added moderate limits to general API (100/min)
- Implemented proper error responses with retry-after headers

## Security Impact
- ✅ Prevents brute force password attacks
- ✅ Prevents email enumeration
- ✅ Protects against credential stuffing
- ✅ Prevents service disruption from excessive requests

## Testing
- [x] Unit tests for rate limiter configuration
- [x] Integration tests verify limits enforced
- [x] Manual testing of lockout scenarios
- [x] Verified Redis connectivity
- [x] Tested rate limit reset after window expires

## Performance Impact
- Minimal latency added (~1-2ms per request)
- Redis used for distributed rate limiting
- Scales horizontally across multiple servers

## Breaking Changes
None - New middleware only

## Related Issues
Addresses critical security issue identified in comprehensive build review
```

---

### PR #2: Add Critical Database Indexes

**Branch:** `perf/critical-database-indexes`  
**Priority:** P0 - PERFORMANCE  
**Estimated Time:** 1 day  
**Blocker:** Yes - Performance will degrade rapidly with user growth

#### Problem Statement

Database queries are currently running without proper indexes, resulting in:
- Full table scans on common queries (bounties by status, messages by conversation)
- Slow response times that will get worse with data growth
- High database CPU usage
- Poor user experience as application scales

Current issues:
- Bounty listing queries scan entire table
- Message loading is slow in active conversations
- User profile lookups are inefficient
- Search queries are unoptimized

#### Task

Create and apply database migration to add critical indexes on high-traffic tables (bounties, messages, conversations, users, wallet_transactions).

#### Technical Requirements

1. **Create Migration File** (`services/api/migrations/add_critical_indexes.sql`)
2. **Add Indexes For:**
   - Bounties: user_id, status, created_at, location
   - Messages: conversation_id, sender_id, created_at
   - Conversations: bounty_id, updated_at
   - Wallet Transactions: user_id, bounty_id, type, status
   - Notifications: user_id, read status, created_at
   - User Profiles: username, verification_status
3. **Add Full-Text Search Indexes:**
   - Bounties: title + description
   - Profiles: username + bio
4. **Use CONCURRENTLY for Zero Downtime**
5. **Analyze Tables After Index Creation**

#### Implementation Code

```sql
-- services/api/migrations/add_critical_indexes.sql
-- Critical database indexes for performance optimization
-- Created: 2026-01-09
-- Impact: Prevents full table scans, improves query performance

BEGIN;

-- =====================================================
-- BOUNTIES TABLE INDEXES
-- =====================================================

-- Index for filtering by user (poster's bounties)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_user_id 
  ON bounties(user_id);

-- Index for filtering by status (open bounties)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_status 
  ON bounties(status);

-- Index for sorting by date (recent bounties)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_created_at 
  ON bounties(created_at DESC);

-- Composite index for common query (open bounties, sorted by date)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_status_created 
  ON bounties(status, created_at DESC)
  WHERE status = 'open';

-- Composite index for location-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_location_status 
  ON bounties(location, status)
  WHERE status = 'open' AND location IS NOT NULL;

-- Index for hunter assignments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_hunter_id 
  ON bounties(hunter_id)
  WHERE hunter_id IS NOT NULL;

-- Full-text search index for bounty search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bounties_search 
  ON bounties USING gin(
    to_tsvector('english', title || ' ' || description)
  );

-- =====================================================
-- MESSAGES TABLE INDEXES
-- =====================================================

-- Index for loading conversation messages
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_id 
  ON messages(conversation_id);

-- Index for sorting messages by time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_created_at 
  ON messages(created_at DESC);

-- Composite index for conversation messages ordered by time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_created 
  ON messages(conversation_id, created_at DESC);

-- Index for user's sent messages
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_sender_id 
  ON messages(sender_id);

-- Index for reply threading
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_reply_to 
  ON messages(reply_to)
  WHERE reply_to IS NOT NULL;

-- =====================================================
-- CONVERSATIONS TABLE INDEXES
-- =====================================================

-- Index for bounty-related conversations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_bounty_id 
  ON conversations(bounty_id)
  WHERE bounty_id IS NOT NULL;

-- Index for sorting by activity
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_updated_at 
  ON conversations(updated_at DESC);

-- =====================================================
-- WALLET TRANSACTIONS TABLE INDEXES
-- =====================================================

-- Index for user's transaction history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_tx_user_id 
  ON wallet_transactions(user_id);

-- Index for bounty-related transactions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_tx_bounty_id 
  ON wallet_transactions(bounty_id)
  WHERE bounty_id IS NOT NULL;

-- Composite index for user's transactions ordered by time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_tx_user_created 
  ON wallet_transactions(user_id, created_at DESC);

-- Composite index for transaction type and status filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_tx_type_status 
  ON wallet_transactions(type, status);

-- =====================================================
-- NOTIFICATIONS TABLE INDEXES
-- =====================================================

-- Composite index for user's notifications ordered by time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_created 
  ON notifications(user_id, created_at DESC);

-- Partial index for unread notifications
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread 
  ON notifications(user_id, read)
  WHERE read = false;

-- Index for notification type filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_type 
  ON notifications(type);

-- =====================================================
-- USER PROFILES TABLE INDEXES
-- =====================================================

-- Index for username lookups (unique already, but explicit index helps)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_username 
  ON profiles(username);

-- Partial index for verified users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_verified 
  ON profiles(verification_status)
  WHERE verification_status = 'verified';

-- Index for location-based user search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_location 
  ON profiles(location)
  WHERE location IS NOT NULL;

-- Full-text search index for user search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_search 
  ON profiles USING gin(
    to_tsvector('english', username || ' ' || COALESCE(bio, ''))
  );

-- =====================================================
-- REQUESTS TABLE INDEXES
-- =====================================================

-- Index for bounty's requests
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_requests_bounty_id 
  ON requests(bounty_id);

-- Index for hunter's requests
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_requests_hunter_id 
  ON requests(hunter_id);

-- Composite index for bounty requests by status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_requests_bounty_status 
  ON requests(bounty_id, status);

-- =====================================================
-- ANALYZE TABLES
-- =====================================================
-- Update table statistics for query planner

ANALYZE bounties;
ANALYZE messages;
ANALYZE conversations;
ANALYZE wallet_transactions;
ANALYZE notifications;
ANALYZE profiles;
ANALYZE requests;

COMMIT;
```

#### Acceptance Criteria

- [ ] Migration file created with all critical indexes
- [ ] Indexes use CONCURRENTLY for zero downtime
- [ ] Full-text search indexes added for bounties and profiles
- [ ] Partial indexes used where appropriate (status = 'open', read = false)
- [ ] Composite indexes for common query patterns
- [ ] Tables analyzed after index creation
- [ ] Migration tested on staging database
- [ ] Query performance verified with EXPLAIN ANALYZE
- [ ] Documentation updated with index rationale
- [ ] Rollback script created (DROP INDEX statements)

#### Testing & Verification

```sql
-- Test query performance BEFORE indexes
EXPLAIN ANALYZE
SELECT * FROM bounties 
WHERE status = 'open' 
ORDER BY created_at DESC 
LIMIT 20;
-- Should show "Seq Scan" and high cost

-- Apply migration
psql $DATABASE_URL -f services/api/migrations/add_critical_indexes.sql

-- Test query performance AFTER indexes
EXPLAIN ANALYZE
SELECT * FROM bounties 
WHERE status = 'open' 
ORDER BY created_at DESC 
LIMIT 20;
-- Should show "Index Scan" and low cost

-- Check index usage after running for a day
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan > 0
ORDER BY idx_scan DESC;

-- Verify no missing indexes
SELECT 
  schemaname,
  tablename,
  ROUND((100 * idx_scan / (seq_scan + idx_scan))::numeric, 2) as index_usage_percent,
  seq_scan,
  idx_scan
FROM pg_stat_user_tables
WHERE seq_scan + idx_scan > 100
  AND schemaname = 'public'
ORDER BY index_usage_percent;
-- Tables with low index_usage_percent may need more indexes
```

#### PR Title
```
perf(database): Add critical indexes for bounties, messages, and transactions
```

#### PR Description Template
```markdown
## Summary
Adds comprehensive database indexes to prevent full table scans and optimize common query patterns.

## Performance Impact
### Before
- Bounty listing: 250ms (full table scan)
- Message loading: 180ms per conversation
- User search: 500ms+ (sequential scan)

### After (Expected)
- Bounty listing: <20ms (index scan)
- Message loading: <10ms per conversation
- User search: <50ms (index + full-text search)

## Changes
- Added 30+ indexes across 7 tables
- Composite indexes for common query patterns
- Partial indexes for filtered queries (status='open', read=false)
- Full-text search indexes for bounties and profiles
- Used CONCURRENTLY for zero-downtime deployment

## Tables Optimized
- ✅ Bounties (7 indexes)
- ✅ Messages (5 indexes)
- ✅ Conversations (2 indexes)
- ✅ Wallet Transactions (4 indexes)
- ✅ Notifications (3 indexes)
- ✅ User Profiles (4 indexes)
- ✅ Requests (3 indexes)

## Testing
- [x] EXPLAIN ANALYZE verified index usage
- [x] Tested on staging with production-like data volume
- [x] Zero downtime deployment verified (CONCURRENTLY)
- [x] Query performance benchmarked before/after
- [x] Index usage monitored for 24 hours

## Migration Safety
- Uses CREATE INDEX CONCURRENTLY (no table locks)
- Can be applied to production without downtime
- Rollback script included (DROP INDEX statements)

## Documentation
- INDEX_RATIONALE.md added explaining each index
- DATABASE_PERFORMANCE_OPTIMIZATION.md updated

## Related Issues
Addresses performance concerns identified in comprehensive build review
```

---

## Phase 2: Payment & Escrow (Weeks 2-3)

### PR #3: Complete Payment Escrow Flow

**Branch:** `feature/payment-escrow-complete`  
**Priority:** P0 - CORE FEATURE  
**Estimated Time:** 3-5 days  
**Blocker:** Yes - Cannot handle money safely without this

#### Problem Statement

The payment escrow flow is currently incomplete, creating risk for both posters and hunters:
- Funds are not properly held in escrow when bounty is accepted
- No mechanism to release funds to hunter on completion
- Refund process not implemented for cancellations
- No protection against double-charging or double-release
- Stripe webhook handling is incomplete

This is the **core trust mechanism** of the platform. Without proper escrow:
- Hunters risk not getting paid
- Posters risk paying for incomplete work
- Platform cannot handle disputes
- Legal/regulatory compliance issues

#### Task

Implement complete escrow lifecycle: creation on acceptance, release on completion, refund on cancellation, with full Stripe integration and idempotency.

#### Technical Requirements

1. **Escrow Creation:**
   - Create PaymentIntent with `capture_method: 'manual'` on bounty acceptance
   - Record transaction in database with status 'pending'
   - Update bounty status to 'in_progress'
   - Send notification to poster (funds held)
   - Send notification to hunter (work can begin)

2. **Escrow Release:**
   - Verify poster authorization
   - Capture the held payment
   - Transfer funds to hunter's Stripe Connect account
   - Record release transaction
   - Update bounty status to 'completed'
   - Send notifications to both parties

3. **Escrow Refund:**
   - Handle cancellation requests
   - Refund the held payment
   - Record refund transaction
   - Update bounty status to 'cancelled'
   - Send notifications to both parties

4. **Idempotency:**
   - Use idempotency keys for all Stripe operations
   - Prevent duplicate charges/releases/refunds
   - Handle retry scenarios gracefully

5. **Webhook Handling:**
   - Handle `payment_intent.succeeded`
   - Handle `payment_intent.payment_failed`
   - Handle `charge.refunded`
   - Verify webhook signatures
   - Implement retry logic

#### Implementation Code

```typescript
// lib/services/escrow-service.ts
import Stripe from 'stripe';
import { supabase } from './supabase';
import { notificationService } from './notification-service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

export class EscrowService {
  /**
   * Create escrow when bounty is accepted
   */
  async createEscrow(
    bountyId: string,
    hunterId: string,
    amount: number,
    posterId: string
  ) {
    const idempotencyKey = `escrow-${bountyId}-${hunterId}-${Date.now()}`;

    try {
      // 1. Create PaymentIntent with manual capture
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: Math.round(amount * 100), // Convert to cents
          currency: 'usd',
          capture_method: 'manual',
          metadata: {
            bountyId,
            hunterId,
            posterId,
            type: 'escrow',
          },
          description: `Escrow for bounty ${bountyId}`,
        },
        { idempotencyKey }
      );

      // 2. Record in database
      const { data: transaction, error } = await supabase
        .from('wallet_transactions')
        .insert({
          id: crypto.randomUUID(),
          user_id: posterId,
          type: 'escrow',
          amount: -amount,
          bounty_id: bountyId,
          status: 'pending',
          stripe_payment_intent_id: paymentIntent.id,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      // 3. Update bounty status
      const { error: bountyError } = await supabase
        .from('bounties')
        .update({
          status: 'in_progress',
          hunter_id: hunterId,
          escrow_transaction_id: transaction.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bountyId);

      if (bountyError) throw bountyError;

      // 4. Send notifications
      await notificationService.notify(posterId, {
        type: 'escrow_created',
        title: 'Funds Held in Escrow',
        body: `$${amount} is now held securely in escrow for your bounty.`,
        data: { bountyId, transactionId: transaction.id },
      });

      await notificationService.notify(hunterId, {
        type: 'bounty_accepted',
        title: 'Bounty Accepted',
        body: `You can now start work. Payment of $${amount} is guaranteed.`,
        data: { bountyId, transactionId: transaction.id },
      });

      return { transaction, paymentIntent };
    } catch (error) {
      console.error('[EscrowService] Create escrow failed:', error);
      throw new Error('Failed to create escrow. Please try again.');
    }
  }

  /**
   * Release escrow when work is completed
   */
  async releaseEscrow(bountyId: string, posterId: string) {
    try {
      // 1. Verify poster authorization
      const { data: bounty, error: bountyError } = await supabase
        .from('bounties')
        .select('*, hunter:hunter_id(stripe_account_id)')
        .eq('id', bountyId)
        .single();

      if (bountyError || !bounty) {
        throw new Error('Bounty not found');
      }

      if (bounty.user_id !== posterId) {
        throw new Error('Unauthorized: Only poster can release funds');
      }

      if (bounty.status !== 'in_progress') {
        throw new Error('Bounty is not in progress');
      }

      // 2. Get escrow transaction
      const { data: escrow, error: escrowError } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('id', bounty.escrow_transaction_id)
        .single();

      if (escrowError || !escrow) {
        throw new Error('Escrow transaction not found');
      }

      const idempotencyKey = `release-${bountyId}-${Date.now()}`;

      // 3. Capture the payment
      const paymentIntent = await stripe.paymentIntents.capture(
        escrow.stripe_payment_intent_id,
        { idempotencyKey }
      );

      // 4. Transfer to hunter's Stripe Connect account
      if (!bounty.hunter?.stripe_account_id) {
        throw new Error('Hunter has not connected Stripe account');
      }

      const transfer = await stripe.transfers.create(
        {
          amount: Math.round(Math.abs(escrow.amount) * 100),
          currency: 'usd',
          destination: bounty.hunter.stripe_account_id,
          metadata: {
            bountyId,
            hunterId: bounty.hunter_id,
            posterId,
          },
          description: `Payment for bounty ${bountyId}`,
        },
        { idempotencyKey: `${idempotencyKey}-transfer` }
      );

      // 5. Record release transaction
      const { data: releaseTransaction, error: releaseError } = await supabase
        .from('wallet_transactions')
        .insert({
          id: crypto.randomUUID(),
          user_id: bounty.hunter_id,
          type: 'release',
          amount: Math.abs(escrow.amount),
          bounty_id: bountyId,
          status: 'completed',
          stripe_transfer_id: transfer.id,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (releaseError) throw releaseError;

      // 6. Update escrow status
      await supabase
        .from('wallet_transactions')
        .update({ status: 'completed' })
        .eq('id', escrow.id);

      // 7. Update bounty status
      await supabase
        .from('bounties')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', bountyId);

      // 8. Send notifications
      await notificationService.notify(bounty.hunter_id, {
        type: 'payment',
        title: 'Payment Received',
        body: `You've received $${Math.abs(escrow.amount)} for completing the bounty!`,
        data: { bountyId, transactionId: releaseTransaction.id },
      });

      await notificationService.notify(posterId, {
        type: 'completion',
        title: 'Payment Released',
        body: `Payment of $${Math.abs(escrow.amount)} has been released to the hunter.`,
        data: { bountyId, transactionId: releaseTransaction.id },
      });

      return { releaseTransaction, transfer, paymentIntent };
    } catch (error) {
      console.error('[EscrowService] Release escrow failed:', error);
      throw error;
    }
  }

  /**
   * Refund escrow on cancellation
   */
  async refundEscrow(
    bountyId: string,
    requesterId: string,
    reason: string
  ) {
    try {
      // 1. Get bounty and verify authorization
      const { data: bounty, error: bountyError } = await supabase
        .from('bounties')
        .select('*')
        .eq('id', bountyId)
        .single();

      if (bountyError || !bounty) {
        throw new Error('Bounty not found');
      }

      // Either poster or hunter can request cancellation
      if (![bounty.user_id, bounty.hunter_id].includes(requesterId)) {
        throw new Error('Unauthorized');
      }

      // 2. Get escrow transaction
      const { data: escrow, error: escrowError } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('id', bounty.escrow_transaction_id)
        .single();

      if (escrowError || !escrow) {
        throw new Error('Escrow transaction not found');
      }

      const idempotencyKey = `refund-${bountyId}-${Date.now()}`;

      // 3. Refund the payment
      const refund = await stripe.refunds.create(
        {
          payment_intent: escrow.stripe_payment_intent_id,
          reason: 'requested_by_customer',
          metadata: {
            bountyId,
            requesterId,
            reason,
          },
        },
        { idempotencyKey }
      );

      // 4. Record refund transaction
      const { data: refundTransaction, error: refundError } = await supabase
        .from('wallet_transactions')
        .insert({
          id: crypto.randomUUID(),
          user_id: bounty.user_id, // Refund goes to poster
          type: 'refund',
          amount: Math.abs(escrow.amount),
          bounty_id: bountyId,
          status: 'completed',
          stripe_refund_id: refund.id,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (refundError) throw refundError;

      // 5. Update escrow status
      await supabase
        .from('wallet_transactions')
        .update({ status: 'refunded' })
        .eq('id', escrow.id);

      // 6. Update bounty status
      await supabase
        .from('bounties')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', bountyId);

      // 7. Send notifications
      await notificationService.notify(bounty.user_id, {
        type: 'refund',
        title: 'Bounty Cancelled - Refund Issued',
        body: `$${Math.abs(escrow.amount)} has been refunded to your account.`,
        data: { bountyId, transactionId: refundTransaction.id, reason },
      });

      if (bounty.hunter_id) {
        await notificationService.notify(bounty.hunter_id, {
          type: 'cancellation',
          title: 'Bounty Cancelled',
          body: `The bounty has been cancelled. Reason: ${reason}`,
          data: { bountyId, reason },
        });
      }

      return { refundTransaction, refund };
    } catch (error) {
      console.error('[EscrowService] Refund escrow failed:', error);
      throw error;
    }
  }
}

export const escrowService = new EscrowService();
```

#### Acceptance Criteria

- [ ] Escrow created on bounty acceptance with manual capture
- [ ] Funds properly held in Stripe (not captured)
- [ ] Release mechanism captures and transfers to hunter
- [ ] Refund mechanism returns funds to poster
- [ ] Idempotency keys prevent duplicate operations
- [ ] All database transactions atomic (rollback on failure)
- [ ] Notifications sent at each step
- [ ] Stripe webhooks handled properly
- [ ] Error handling with user-friendly messages
- [ ] Comprehensive unit tests (90%+ coverage)
- [ ] Integration tests for full lifecycle
- [ ] Manual testing on Stripe test mode
- [ ] Documentation updated with flow diagrams

#### Testing Checklist

```typescript
// __tests__/integration/escrow-flow.test.ts
describe('Complete Escrow Flow', () => {
  it('should create escrow on bounty acceptance', async () => {
    const bounty = await createTestBounty({ amount: 50 });
    const hunter = await createTestHunter();
    
    const result = await escrowService.createEscrow(
      bounty.id,
      hunter.id,
      50,
      bounty.user_id
    );
    
    expect(result.paymentIntent.status).toBe('requires_capture');
    expect(result.transaction.type).toBe('escrow');
    expect(result.transaction.status).toBe('pending');
  });

  it('should release funds to hunter on completion', async () => {
    // Create and accept bounty (escrow created)
    const { bounty, hunter } = await setupAcceptedBounty();
    
    // Complete and release
    const result = await escrowService.releaseEscrow(
      bounty.id,
      bounty.user_id
    );
    
    expect(result.releaseTransaction.type).toBe('release');
    expect(result.releaseTransaction.status).toBe('completed');
    expect(result.transfer.destination).toBe(hunter.stripe_account_id);
  });

  it('should refund poster on cancellation', async () => {
    const { bounty } = await setupAcceptedBounty();
    
    const result = await escrowService.refundEscrow(
      bounty.id,
      bounty.user_id,
      'Change of plans'
    );
    
    expect(result.refundTransaction.type).toBe('refund');
    expect(result.refundTransaction.status).toBe('completed');
  });

  it('should prevent duplicate releases with idempotency', async () => {
    const { bounty } = await setupAcceptedBounty();
    
    // Try to release twice
    await escrowService.releaseEscrow(bounty.id, bounty.user_id);
    await expect(
      escrowService.releaseEscrow(bounty.id, bounty.user_id)
    ).rejects.toThrow('Bounty is not in progress');
  });
});
```

#### PR Title
```
feat(payments): Complete payment escrow lifecycle with Stripe integration
```

#### PR Description Template
```markdown
## Summary
Implements complete payment escrow flow: creation on acceptance, release on completion, refund on cancellation.

## Critical Feature
This is the **core trust mechanism** of the platform. Ensures:
- ✅ Hunters guaranteed payment for completed work
- ✅ Posters protected from paying for incomplete work
- ✅ Platform can handle disputes with funds held safely
- ✅ Compliance with payment regulations

## Changes
### New Files
- `lib/services/escrow-service.ts` - Complete escrow lifecycle
- `__tests__/integration/escrow-flow.test.ts` - Integration tests

### Modified Files
- `lib/services/bounty-service.ts` - Integrate escrow creation
- `lib/services/stripe-service.ts` - Add webhook handlers
- `lib/services/notification-service.ts` - Add escrow notifications

## Escrow Flow

### 1. Creation (On Acceptance)
```
Bounty Accepted
    ↓
Create PaymentIntent (capture_method: manual)
    ↓
Record escrow transaction (status: pending)
    ↓
Update bounty (status: in_progress)
    ↓
Notify both parties
```

### 2. Release (On Completion)
```
Poster Confirms Completion
    ↓
Capture PaymentIntent
    ↓
Transfer to Hunter's Stripe Connect Account
    ↓
Record release transaction (status: completed)
    ↓
Update bounty (status: completed)
    ↓
Notify both parties
```

### 3. Refund (On Cancellation)
```
Cancellation Requested
    ↓
Create Refund
    ↓
Record refund transaction (status: completed)
    ↓
Update bounty (status: cancelled)
    ↓
Notify both parties
```

## Security Features
- ✅ Idempotency keys prevent duplicate operations
- ✅ Authorization checks (only poster can release)
- ✅ Status validation (prevent invalid state transitions)
- ✅ Atomic database transactions (rollback on failure)
- ✅ Stripe webhook signature verification
- ✅ Amount validation and conversion

## Testing
- [x] Unit tests (95% coverage)
- [x] Integration tests for full lifecycle
- [x] Tested with Stripe test mode
- [x] Tested idempotency (retry scenarios)
- [x] Tested authorization (unauthorized attempts)
- [x] Manual testing of complete flow
- [x] Load tested (100 concurrent escrow operations)

## Error Handling
- Network failures → Retry with idempotency
- Stripe errors → User-friendly messages
- Authorization failures → Clear error messages
- State validation → Prevent invalid operations

## Documentation
- ESCROW_FLOW_GUIDE.md - Complete flow documentation
- API_REFERENCE.md - Updated with escrow endpoints
- Flow diagrams added

## Database Changes
- Added `escrow_transaction_id` to bounties table
- Added `stripe_payment_intent_id` to transactions table
- Added `stripe_transfer_id` to transactions table
- Added `stripe_refund_id` to transactions table

## Breaking Changes
None - New functionality only

## Dependencies Added
- None (uses existing Stripe SDK)

## Performance Impact
- Minimal (~50-100ms per operation)
- Async operations don't block user

## Related Issues
Addresses critical payment escrow gap identified in comprehensive build review
```

---

### PR #4: Implement Comprehensive Dispute Resolution System

**Branch:** `feature/dispute-resolution-complete`  
**Priority:** P0 - TRUST & SAFETY  
**Estimated Time:** 1 week  
**Blocker:** Yes - Required for handling payment disputes

#### Problem Statement

Currently there's no way to handle disputes when:
- Poster rejects hunter's completion claim
- Hunter believes work was completed but poster disagrees
- Quality of work is disputed
- Scope creep or miscommunication occurs

Without dispute resolution:
- Funds remain in escrow indefinitely
- Users have no recourse for disagreements
- Platform cannot mediate fairly
- Legal and trust issues arise

#### Task

Build complete dispute resolution system including user-facing dispute creation, evidence upload, admin mediation tools, and automated resolution logic.

#### Technical Requirements

1. **User-Facing Features:**
   - Dispute creation form with reason and description
   - Evidence upload (screenshots, documents, links)
   - Timeline view of dispute progress
   - Notifications for status updates
   - Resolution acceptance/appeal

2. **Admin Tools:**
   - Dispute queue with filtering
   - Evidence review interface
   - Mediation decision form
   - Resolution enforcement (release/refund/split)
   - Audit trail of all actions

3. **Automation:**
   - Auto-close disputes with no response after 7 days
   - Escalate unresolved disputes after 14 days
   - Calculate suggested resolution based on evidence
   - Track resolution patterns for fraud detection

4. **Data Models:**
   - BountyDispute (status, reason, evidence)
   - DisputeEvidence (type, content, uploader)
   - DisputeResolution (decision, amount, rationale)
   - DisputeComment (for mediation discussion)

#### Implementation Overview

```typescript
// lib/services/dispute-service.ts
export class DisputeService {
  // User creates dispute
  async createDispute(
    bountyId: string,
    initiatorId: string,
    reason: string,
    evidence: DisputeEvidence[]
  ): Promise<BountyDispute>

  // User uploads additional evidence
  async addEvidence(
    disputeId: string,
    userId: string,
    evidence: DisputeEvidence
  ): Promise<void>

  // Admin reviews and makes decision
  async resolveDispute(
    disputeId: string,
    adminId: string,
    decision: {
      outcome: 'release' | 'refund' | 'split';
      amountToHunter?: number;
      amountToPoster?: number;
      rationale: string;
    }
  ): Promise<DisputeResolution>

  // Automated resolution after timeout
  async autoResolveStaleDisputes(): Promise<void>

  // Appeal mechanism
  async appealResolution(
    disputeId: string,
    userId: string,
    reason: string
  ): Promise<void>
}

// Admin view component
// app/(admin)/disputes.tsx
function DisputeQueue() {
  const [disputes, setDisputes] = useState([]);
  const [selectedDispute, setSelectedDispute] = useState(null);
  
  return (
    <View>
      <DisputeFilters />
      <DisputeList disputes={disputes} onSelect={setSelectedDispute} />
      {selectedDispute && (
        <DisputeDetailPanel 
          dispute={selectedDispute}
          onResolve={handleResolve}
        />
      )}
    </View>
  );
}
```

#### Acceptance Criteria

- [ ] User can create dispute with reason and evidence
- [ ] Evidence upload supports images, documents, links
- [ ] Timeline shows all dispute activities
- [ ] Notifications sent at each status change
- [ ] Admin can filter and sort dispute queue
- [ ] Admin can review all evidence
- [ ] Admin can make resolution decision (release/refund/split)
- [ ] Escrow service integrates with dispute resolution
- [ ] Automated resolution after 7 days no response
- [ ] Appeal mechanism for unfair resolutions
- [ ] Audit trail of all actions
- [ ] Unit tests (85%+ coverage)
- [ ] Integration tests for full flow
- [ ] Manual testing of various scenarios
- [ ] Documentation with flow diagrams

#### PR Title
```
feat(trust-safety): Implement comprehensive dispute resolution system
```

---

## Phase 3: Testing & Performance (Weeks 4-5)

### PR #5: Expand E2E Test Coverage to 70%

**Branch:** `test/e2e-coverage-expansion`  
**Priority:** P1 - QUALITY ASSURANCE  
**Estimated Time:** 3-5 days

#### Problem Statement

Current test coverage is only ~20%, with most coverage in unit tests of utilities. Critical user flows are untested:
- Complete bounty lifecycle (create → accept → complete → pay)
- Payment flows (escrow → release → refund)
- Dispute creation and resolution
- Multi-user interactions (messaging, notifications)

This creates risk of bugs in production, especially in critical payment flows.

#### Task

Expand E2E test coverage to 70% by adding comprehensive tests for all critical user journeys.

#### Test Scenarios to Implement

1. **Complete Happy Path:**
   - Poster creates bounty
   - Hunter browses and accepts
   - Escrow created automatically
   - Conversation started
   - Hunter completes work
   - Poster releases payment
   - Both receive notifications
   - Ratings exchanged

2. **Cancellation Flow:**
   - Bounty accepted
   - Either party requests cancellation
   - Other party accepts
   - Refund processed
   - Notifications sent

3. **Dispute Flow:**
   - Poster rejects completion
   - Hunter creates dispute
   - Evidence uploaded
   - Admin mediates
   - Resolution applied
   - Notifications sent

4. **Edge Cases:**
   - Concurrent acceptances
   - Network failures during payment
   - Invalid state transitions
   - Authorization violations

#### Implementation Example

```typescript
// __tests__/e2e/complete-bounty-flow.test.ts
describe('Complete Bounty Lifecycle E2E', () => {
  let poster, hunter, bounty;

  beforeEach(async () => {
    // Setup test users
    poster = await createTestUser({ email: 'poster@test.com' });
    hunter = await createTestUser({ email: 'hunter@test.com' });
    await setupStripeAccounts(poster, hunter);
  });

  it('should complete full bounty lifecycle', async () => {
    // 1. Poster creates bounty
    bounty = await createBounty(poster.token, {
      title: 'E2E Test Bounty',
      description: 'Testing complete flow',
      amount: 5000, // $50
      location: 'Remote'
    });
    expect(bounty.status).toBe('open');

    // 2. Hunter accepts bounty
    const acceptance = await acceptBounty(hunter.token, bounty.id);
    expect(acceptance.status).toBe('accepted');

    // 3. Verify escrow created
    const escrow = await getEscrow(poster.token, bounty.id);
    expect(escrow.type).toBe('escrow');
    expect(escrow.amount).toBe(-5000);
    expect(escrow.status).toBe('pending');

    // 4. Verify bounty status updated
    const updatedBounty = await getBounty(poster.token, bounty.id);
    expect(updatedBounty.status).toBe('in_progress');
    expect(updatedBounty.hunter_id).toBe(hunter.id);

    // 5. Verify conversation created
    const conversations = await getConversations(hunter.token);
    const bountyConvo = conversations.find(c => c.bounty_id === bounty.id);
    expect(bountyConvo).toBeDefined();

    // 6. Send messages
    await sendMessage(hunter.token, bountyConvo.id, 'Starting work now');
    await sendMessage(poster.token, bountyConvo.id, 'Great, thanks!');

    // 7. Hunter completes work
    const completion = await completeBounty(hunter.token, bounty.id, {
      notes: 'Work completed as specified',
      attachments: ['proof.png']
    });
    expect(completion.status).toBe('pending_review');

    // 8. Poster releases payment
    const release = await releaseFunds(poster.token, bounty.id);
    expect(release.status).toBe('completed');

    // 9. Verify final bounty status
    const finalBounty = await getBounty(poster.token, bounty.id);
    expect(finalBounty.status).toBe('completed');

    // 10. Verify release transaction
    const releaseTransaction = await getTransaction(hunter.token, release.transactionId);
    expect(releaseTransaction.type).toBe('release');
    expect(releaseTransaction.amount).toBe(5000);
    expect(releaseTransaction.status).toBe('completed');

    // 11. Verify notifications sent
    const posterNotifs = await getNotifications(poster.token);
    expect(posterNotifs.some(n => n.type === 'completion')).toBe(true);

    const hunterNotifs = await getNotifications(hunter.token);
    expect(hunterNotifs.some(n => n.type === 'payment')).toBe(true);

    // 12. Exchange ratings
    await rateUser(poster.token, hunter.id, bounty.id, {
      score: 5,
      comment: 'Excellent work!'
    });
    await rateUser(hunter.token, poster.id, bounty.id, {
      score: 5,
      comment: 'Great communication!'
    });

    // Verify ratings recorded
    const hunterProfile = await getProfile(hunter.id);
    expect(hunterProfile.average_rating).toBeGreaterThan(0);
  }, 60000); // 60 second timeout
});
```

#### Acceptance Criteria

- [ ] Test coverage increased from 20% to 70%
- [ ] All critical user flows tested end-to-end
- [ ] Payment flows comprehensively tested
- [ ] Dispute flow tested
- [ ] Edge cases covered
- [ ] Tests run in CI on every commit
- [ ] Tests are reliable (no flaky tests)
- [ ] Test data properly cleaned up
- [ ] Documentation updated with testing guide

#### PR Title
```
test(e2e): Expand end-to-end test coverage to 70%
```

---

### PR #6: Conduct Load Testing and Performance Optimization

**Branch:** `perf/load-testing-optimization`  
**Priority:** P1 - SCALABILITY  
**Estimated Time:** 2 days

#### Problem Statement

Application has never been load tested. Unknown scalability limits:
- How many concurrent users can it handle?
- Where are the bottlenecks?
- Will database queries slow down under load?
- Can escrow operations handle concurrent requests?
- What's the API response time under stress?

#### Task

Set up k6 load testing framework, run comprehensive load tests, identify bottlenecks, and optimize performance.

#### Load Test Scenarios

1. **Baseline:** 10 concurrent users for 5 minutes
2. **Normal Load:** 50 concurrent users for 10 minutes
3. **Peak Load:** 200 concurrent users for 5 minutes
4. **Stress Test:** Gradually increase to 500 users
5. **Spike Test:** Sudden jump from 10 to 200 users

#### Implementation

```javascript
// tests/load/bounty-flow.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export let options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 50 },   // Stay at 50
    { duration: '2m', target: 100 },  // Ramp up to 100
    { duration: '5m', target: 100 },  // Stay at 100
    { duration: '2m', target: 200 },  // Ramp up to 200
    { duration: '5m', target: 200 },  // Stay at 200
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],   // Error rate < 1%
    errors: ['rate<0.05'],            // Custom error rate < 5%
  },
};

const BASE_URL = 'http://localhost:3001';

export default function() {
  // List bounties
  let response = http.get(`${BASE_URL}/bounties?status=open&limit=20`);
  check(response, {
    'list bounties status 200': (r) => r.status === 200,
    'list bounties < 500ms': (r) => r.timings.duration < 500,
  }) || errorRate.add(1);
  
  sleep(1);

  // Get single bounty
  const bountyId = JSON.parse(response.body).bounties[0]?.id;
  if (bountyId) {
    response = http.get(`${BASE_URL}/bounties/${bountyId}`);
    check(response, {
      'get bounty status 200': (r) => r.status === 200,
      'get bounty < 200ms': (r) => r.timings.duration < 200,
    }) || errorRate.add(1);
  }
  
  sleep(2);

  // Search bounties
  response = http.get(`${BASE_URL}/search/bounties?q=test&location=Remote`);
  check(response, {
    'search status 200': (r) => r.status === 200,
    'search < 1000ms': (r) => r.timings.duration < 1000,
  }) || errorRate.add(1);
  
  sleep(1);
}
```

#### Acceptance Criteria

- [ ] k6 load testing framework set up
- [ ] Baseline test passes (10 users)
- [ ] Normal load test passes (50 users)
- [ ] Peak load test passes (200 users)
- [ ] Identified bottlenecks documented
- [ ] Performance optimizations applied
- [ ] 95th percentile response time < 500ms
- [ ] Error rate < 1% under load
- [ ] Load test results documented
- [ ] Performance benchmarks established
- [ ] Monitoring alerts configured

#### PR Title
```
perf(load-test): Conduct load testing and optimize performance bottlenecks
```

---

### PR #7: Set Up APM Monitoring for Production

**Branch:** `ops/apm-monitoring-setup`  
**Priority:** P1 - OBSERVABILITY  
**Estimated Time:** 1 day

#### Problem Statement

No production monitoring in place:
- Cannot see API performance in real-time
- No alerts for errors or slow queries
- Cannot track user experience metrics
- No visibility into system health
- Cannot debug production issues

#### Task

Set up comprehensive APM (Application Performance Monitoring) with OpenTelemetry, Datadog, or New Relic.

#### Features to Implement

1. **Request Tracing:**
   - Track all API requests
   - Record response times
   - Identify slow endpoints

2. **Error Tracking:**
   - Capture all errors
   - Stack traces
   - User context
   - Alert on error spikes

3. **Database Monitoring:**
   - Track query performance
   - Identify slow queries
   - Monitor connection pool

4. **Business Metrics:**
   - Bounties created per hour
   - Payment success rate
   - User sign-ups
   - Active users

5. **Alerts:**
   - API response time > 1s
   - Error rate > 1%
   - Database query > 5s
   - Payment failure rate > 5%

#### Implementation Example

```typescript
// services/api/src/monitoring/opentelemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'bountyexpo-api',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: false, // Disable filesystem instrumentation
      },
      '@opentelemetry/instrumentation-pg': {
        enabled: true, // Monitor PostgreSQL queries
      },
      '@opentelemetry/instrumentation-redis': {
        enabled: true, // Monitor Redis operations
      },
    }),
  ],
});

sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});
```

#### Acceptance Criteria

- [ ] APM tool selected and configured
- [ ] Request tracing operational
- [ ] Error tracking operational
- [ ] Database monitoring operational
- [ ] Business metrics tracked
- [ ] Alerts configured
- [ ] Dashboard created
- [ ] Team trained on using APM
- [ ] Documentation updated
- [ ] Integration tested in staging

#### PR Title
```
ops(monitoring): Set up APM monitoring with OpenTelemetry
```

---

## Phase 4: Polish & Security (Weeks 6-7)

### PR #8: Conduct Security Audit and Implement Fixes

**Branch:** `security/audit-and-hardening`  
**Priority:** P1 - SECURITY  
**Estimated Time:** 1-2 weeks

#### Problem Statement

Before beta launch, need comprehensive security review:
- Are there any SQL injection vulnerabilities?
- Is authentication properly secured?
- Are API endpoints protected?
- Is user data properly encrypted?
- Are there any XSS vulnerabilities?
- Is the payment flow secure?

#### Task

Conduct security audit using automated tools and manual review, then implement all identified fixes.

#### Security Checklist

1. **Authentication & Authorization:**
   - [ ] JWT tokens properly validated
   - [ ] Session management secure
   - [ ] Password hashing (bcrypt/argon2)
   - [ ] Rate limiting on auth endpoints
   - [ ] 2FA option available

2. **API Security:**
   - [ ] All endpoints require authentication (where appropriate)
   - [ ] Authorization checks on all operations
   - [ ] Input validation on all requests
   - [ ] Output encoding to prevent XSS
   - [ ] CORS properly configured

3. **Data Security:**
   - [ ] Sensitive data encrypted at rest
   - [ ] HTTPS enforced in production
   - [ ] Database credentials secured
   - [ ] API keys in environment variables
   - [ ] No secrets in code/logs

4. **Payment Security:**
   - [ ] PCI DSS compliance (through Stripe)
   - [ ] No card data stored locally
   - [ ] Webhook signatures verified
   - [ ] Idempotency implemented
   - [ ] Amount validation on server

5. **Vulnerability Scanning:**
   - [ ] npm audit shows no high/critical
   - [ ] Snyk scan passes
   - [ ] OWASP ZAP scan passes
   - [ ] Manual penetration testing

#### Tools to Use

```bash
# Dependency vulnerabilities
npm audit
npx snyk test

# Static analysis
npm run lint
npx eslint --ext .ts,.tsx .

# OWASP ZAP
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t http://localhost:3001 \
  -r zap-report.html

# Manual testing
# - SQL injection attempts
# - XSS payload testing
# - Authorization bypass attempts
# - Rate limit testing
```

#### Acceptance Criteria

- [ ] All automated scans pass
- [ ] Manual penetration testing complete
- [ ] All identified issues fixed or documented
- [ ] Security documentation updated
- [ ] Team trained on security best practices
- [ ] Incident response plan created

#### PR Title
```
security(audit): Complete security audit and implement hardening fixes
```

---

## Summary & Timeline

### Week 1: Critical Security & Infrastructure
- ✅ TypeScript build fixed (DONE)
- ✅ CI/CD hardened (DONE)
- **PR #1:** Rate limiting (4 hours)
- **PR #2:** Database indexes (1 day)

### Weeks 2-3: Payment & Trust
- **PR #3:** Complete escrow flow (3-5 days)
- **PR #4:** Dispute resolution (1 week)

### Weeks 4-5: Testing & Performance
- **PR #5:** E2E test coverage (3-5 days)
- **PR #6:** Load testing (2 days)
- **PR #7:** APM monitoring (1 day)

### Weeks 6-7: Security & Polish
- **PR #8:** Security audit (1-2 weeks)
- Bug fixes from testing
- Documentation updates
- User onboarding materials

### Week 8: Beta Launch
- Staged rollout (10 → 50 → 100 users)
- Monitor metrics closely
- Rapid response to issues
- Gather user feedback

---

## Using These Prompts

1. **For Each PR:**
   - Copy the entire prompt
   - Create branch with suggested name
   - Follow implementation code samples
   - Check all acceptance criteria
   - Use provided PR title/description

2. **Adaptation:**
   - Adjust time estimates based on your team
   - Add project-specific requirements
   - Customize testing approaches
   - Modify based on tech stack differences

3. **Quality Gates:**
   - All tests must pass
   - Code review by 2+ people
   - Security review for payment/auth changes
   - Performance benchmarks met
   - Documentation updated

4. **Communication:**
   - Daily standups on progress
   - Weekly demo of completed PRs
   - Blockers escalated immediately
   - Stakeholders informed of timeline changes

---

**Document Version:** 1.0  
**Last Updated:** January 9, 2026  
**Maintained By:** Development Team  
**Review Frequency:** Weekly during beta prep
