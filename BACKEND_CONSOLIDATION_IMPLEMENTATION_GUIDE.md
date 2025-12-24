# Backend Consolidation Implementation Guide

## Overview

This guide provides step-by-step instructions for completing the backend consolidation project. It builds on the foundation already created (unified config, auth, error handling, and payment services).

## Progress Summary

### ✅ Completed (Foundation)
1. **Architecture Documentation** - Comprehensive design document created
2. **Unified Configuration** - Centralized environment variable management
3. **Unified Authentication** - Single JWT verification system
4. **Unified Error Handling** - Consistent error responses
5. **Consolidated Payment Service** - Merged payment logic
6. **Consolidated Payment Routes** - Unified payment endpoints

### 🔄 Next Steps (Phases 1-8)

## Phase 1: Core Services Migration (High Priority)

### Goal
Migrate core endpoints (auth, profiles, bounties) to the consolidated Fastify service.

### Tasks

#### 1.1 Create Consolidated Auth Routes
**File**: `services/api/src/routes/consolidated-auth.ts`

Consolidate auth endpoints from:
- `api/server.js` (lines 202-282, 1184-1363)
- `server/index.js` (lines 152-202)

**Endpoints to migrate**:
- `POST /auth/register` - User registration
- `POST /auth/sign-in` - User login  
- `POST /auth/sign-up` - Alternative signup
- `GET /auth/diagnostics` - Auth health check
- `GET /auth/ping` - Supabase connectivity test
- `DELETE /auth/delete-account` - Account deletion

**Key considerations**:
- Use `unified-auth.ts` middleware
- Use `error-handler.ts` for consistent errors
- Implement rate limiting for auth endpoints (5 req/15min)
- Add comprehensive logging

#### 1.2 Create Consolidated Profile Routes
**File**: `services/api/src/routes/consolidated-profiles.ts`

Consolidate profile endpoints from:
- `api/server.js` (lines 348-418)

**Endpoints to migrate**:
- `GET /api/profiles/:id` - Get profile by ID
- `GET /api/profile` - Get current user profile
- `POST /api/profiles` - Create/update profile
- `PATCH /api/profiles/:id` - Update profile
- `DELETE /api/profiles/:id` - Delete profile

#### 1.3 Create Consolidated Bounty Routes
**File**: `services/api/src/routes/consolidated-bounties.ts`

Consolidate bounty endpoints from:
- `api/server.js` (lines 423-933)

**Endpoints to migrate**:
- `GET /api/bounties` - List bounties with filters
- `GET /api/bounties/:id` - Get bounty details
- `POST /api/bounties` - Create bounty
- `PATCH /api/bounties/:id` - Update bounty
- `DELETE /api/bounties/:id` - Delete bounty
- `POST /api/bounties/:id/accept` - Accept bounty
- `POST /api/bounties/:id/complete` - Complete bounty
- `POST /api/bounties/:id/archive` - Archive bounty

#### 1.4 Create Consolidated Bounty Request Routes
**File**: `services/api/src/routes/consolidated-bounty-requests.ts`

Consolidate bounty request endpoints from:
- `api/server.js` (lines 939-1178)

**Endpoints to migrate**:
- `GET /api/bounty-requests` - List requests
- `GET /api/bounty-requests/:id` - Get request details
- `GET /api/bounty-requests/user/:userId` - Get user requests
- `POST /api/bounty-requests` - Create request
- `PATCH /api/bounty-requests/:id` - Update request
- `DELETE /api/bounty-requests/:id` - Delete request

#### 1.5 Update Main Index to Register Routes
**File**: `services/api/src/index.ts`

Add imports and route registration:

```typescript
import { registerConsolidatedAuthRoutes } from './routes/consolidated-auth';
import { registerConsolidatedProfileRoutes } from './routes/consolidated-profiles';
import { registerConsolidatedBountyRoutes } from './routes/consolidated-bounties';
import { registerConsolidatedBountyRequestRoutes } from './routes/consolidated-bounty-requests';
import { registerConsolidatedPaymentRoutes } from './routes/consolidated-payments';

// In startServer function:
await registerConsolidatedAuthRoutes(fastify);
await registerConsolidatedProfileRoutes(fastify);
await registerConsolidatedBountyRoutes(fastify);
await registerConsolidatedBountyRequestRoutes(fastify);
await registerConsolidatedPaymentRoutes(fastify);
```

#### 1.6 Testing Phase 1
Create test files:
- `services/api/src/__tests__/auth.test.ts`
- `services/api/src/__tests__/profiles.test.ts`
- `services/api/src/__tests__/bounties.test.ts`
- `services/api/src/__tests__/payment.test.ts`

Run tests:
```bash
cd services/api
npm test
```

### Success Criteria for Phase 1
- [ ] All core endpoints respond correctly
- [ ] Authentication works consistently
- [ ] Database queries execute properly
- [ ] All tests pass
- [ ] Response times < 100ms for core endpoints
- [ ] Zero authentication failures

## Phase 2: Payment & Wallet Consolidation (High Priority)

### Goal
Fully consolidate all payment and wallet functionality.

### Tasks

#### 2.1 Consolidate Wallet Service
**File**: `services/api/src/services/consolidated-wallet-service.ts`

Merge wallet logic from:
- `services/api/src/services/wallet-service.ts`
- `server/index.js` (lines 1206-1273)

**Functions needed**:
- `getBalance(userId)` - Get wallet balance
- `getTransactions(userId, filters)` - List transactions
- `createDeposit(userId, amount, paymentIntentId)` - Record deposit
- `createWithdrawal(userId, amount, destination)` - Process withdrawal
- `createEscrow(bountyId, posterId, amount)` - Escrow funds for bounty
- `releaseEscrow(bountyId, hunterId)` - Release funds to hunter
- `refundEscrow(bountyId, posterId, reason)` - Refund escrowed funds
- `updateBalance(userId, amount)` - Atomic balance update

#### 2.2 Consolidate Stripe Connect Service
**File**: `services/api/src/services/consolidated-stripe-connect-service.ts`

Merge Stripe Connect logic from:
- `services/api/src/services/stripe-connect-service.ts`
- `server/index.js` (lines 1012-1421)

**Functions needed**:
- `createConnectAccount(userId, email)` - Create Express account
- `createAccountLink(userId, returnUrl, refreshUrl)` - Onboarding link
- `verifyOnboarding(userId)` - Check onboarding status
- `createTransfer(userId, amount, destination)` - Transfer to connected account
- `retryTransfer(transactionId)` - Retry failed transfer
- `getAccountStatus(userId)` - Get Connect account status

#### 2.3 Consolidate Apple Pay Routes
**File**: `services/api/src/routes/consolidated-apple-pay.ts`

Merge Apple Pay endpoints from:
- `services/api/src/routes/apple-pay.ts`
- `server/index.js` (lines 318-381)

**Endpoints**:
- `POST /apple-pay/payment-intent` - Create payment intent
- `POST /apple-pay/confirm` - Confirm Apple Pay payment

#### 2.4 Consolidate Wallet Routes
**File**: `services/api/src/routes/consolidated-wallet.ts`

Merge wallet endpoints from:
- `services/api/src/routes/wallet.ts`
- `server/index.js` (lines 1206-1273)

**Endpoints**:
- `GET /wallet/balance` - Get balance
- `GET /wallet/transactions` - List transactions
- `POST /wallet/deposit` - Create deposit
- `POST /wallet/withdraw` - Create withdrawal
- `POST /wallet/escrow` - Escrow for bounty
- `POST /wallet/release` - Release escrow
- `POST /wallet/refund` - Refund escrow

#### 2.5 Consolidate Webhook Handler
**File**: `services/api/src/routes/consolidated-webhooks.ts`

Merge webhook handling from:
- `server/index.js` (lines 633-1008)

**Events to handle**:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.requires_action`
- `charge.refunded`
- `transfer.created`
- `transfer.paid`
- `transfer.failed`
- `account.updated`
- `payout.paid`
- `payout.failed`

**Key considerations**:
- Idempotency (check `stripe_events` table)
- Signature verification
- Atomic database updates
- Error handling and retries

### Success Criteria for Phase 2
- [ ] All payment endpoints consolidated
- [ ] Wallet operations work correctly
- [ ] Stripe Connect onboarding works
- [ ] Webhooks process correctly
- [ ] No payment logic duplication
- [ ] All financial transactions atomic
- [ ] Response times < 500ms (p95)

## Phase 3: Real-time & Messaging (Medium Priority)

### Goal
Ensure WebSocket services are properly integrated.

### Tasks

#### 3.1 Verify WebSocket Integration
**File**: `services/api/src/index.ts`

Endpoints already exist:
- `/events/subscribe` - Real-time events WebSocket
- `/messages/subscribe` - Messaging WebSocket

**Verification steps**:
1. Test WebSocket connections
2. Verify authentication works
3. Test message delivery
4. Verify presence tracking
5. Load test with multiple connections

#### 3.2 Add Connection Monitoring
**File**: `services/api/src/services/websocket-monitor.ts`

Create monitoring service:
- Track active connections
- Monitor message delivery rate
- Track connection errors
- Alert on anomalies

#### 3.3 Optimize Message Queue
**File**: `services/api/src/services/message-queue.ts`

Implement message queuing:
- Queue messages for offline users
- Implement retry logic
- Add delivery confirmation
- Track message status

### Success Criteria for Phase 3
- [ ] WebSocket connections stable
- [ ] Message delivery < 100ms (p95)
- [ ] >99.9% delivery success
- [ ] Support 10,000+ concurrent connections
- [ ] Connection monitoring active

## Phase 4: Advanced Features (Medium Priority)

### Goal
Ensure all advanced features work in consolidated service.

### Tasks

#### 4.1 Verify Analytics Integration
**Existing**: `services/api/src/routes/analytics.ts`

Verify:
- Event tracking works
- Aggregation jobs run
- Reporting endpoints functional

#### 4.2 Verify Notifications
**Existing**: `services/api/src/routes/notifications.ts`

Verify:
- Push notifications work
- Email notifications work
- In-app notifications display

#### 4.3 Verify Admin Features
**Existing**: `services/api/src/routes/admin.ts`

Verify:
- Content moderation works
- User management functional
- System configuration accessible

#### 4.4 Verify Risk Management
**Existing**: `services/api/src/routes/risk-management.ts`

Verify:
- Risk scoring works
- Fraud detection active
- Remediation service functional

### Success Criteria for Phase 4
- [ ] All analytics tracking
- [ ] Notifications delivering
- [ ] Admin features working
- [ ] Risk management active

## Phase 5: Client Configuration Updates (Lower Priority)

### Goal
Update client applications to use consolidated backend.

### Tasks

#### 5.1 Update Environment Variables
Update `.env` files to point to consolidated service:

```env
# Before: Multiple endpoints
API_BASE_URL=http://localhost:3001  # api/server.js
FASTIFY_API_URL=http://localhost:3001  # services/api
PAYMENT_API_URL=http://localhost:3001  # server/index.js

# After: Single endpoint
API_BASE_URL=http://localhost:3001
```

#### 5.2 Update API Client Configuration
**File**: `lib/api-client.ts` (or similar)

Update base URLs to single endpoint.

#### 5.3 Test All Client Flows
- Sign up / Sign in
- Profile management
- Bounty creation
- Bounty application
- Payment flow
- Messaging
- Notifications

### Success Criteria for Phase 5
- [ ] All client flows work
- [ ] No broken endpoints
- [ ] Performance unchanged or better

## Phase 6: Monitoring & Observability (Lower Priority)

### Goal
Add comprehensive monitoring.

### Tasks

#### 6.1 Add Prometheus Metrics
**File**: `services/api/src/monitoring/metrics.ts`

Metrics to track:
- Request rate by endpoint
- Response time histograms
- Error rate by category
- Database query performance
- WebSocket connections
- Payment success rate

#### 6.2 Add Health Check Enhancements
**File**: `services/api/src/routes/health.ts`

Enhanced health check:
- Database connectivity
- Supabase connectivity
- Stripe API reachability
- WebSocket server status
- Background worker status

#### 6.3 Add Distributed Tracing
**File**: `services/api/src/monitoring/tracing.ts`

Implement:
- Request ID propagation
- Span creation for operations
- External API call tracking

#### 6.4 Add Alerting
**File**: `services/api/src/monitoring/alerts.ts`

Alert conditions:
- Error rate > 1%
- Response time p95 > 500ms
- Database connection failures
- Webhook processing failures

### Success Criteria for Phase 6
- [ ] All metrics tracked
- [ ] Health checks comprehensive
- [ ] Tracing functional
- [ ] Alerts configured

## Phase 7: Performance Testing (Lower Priority)

### Goal
Validate performance under load.

### Tasks

#### 7.1 Load Testing
Use tools like Artillery or k6:

```yaml
# artillery-config.yml
config:
  target: 'http://localhost:3001'
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 120
      arrivalRate: 50
      name: "Sustained load"
    - duration: 60
      arrivalRate: 100
      name: "Peak load"

scenarios:
  - name: "Core API"
    flow:
      - post:
          url: "/auth/sign-in"
          json:
            email: "test@example.com"
            password: "test123"
      - get:
          url: "/api/profile"
          headers:
            Authorization: "Bearer {{ token }}"
```

#### 7.2 Stress Testing
Push system to limits:
- Find breaking point
- Identify bottlenecks
- Optimize slow queries
- Tune connection pools

#### 7.3 Benchmark Key Operations
Measure and optimize:
- Payment intent creation
- Wallet balance queries
- Bounty list queries
- Message delivery
- WebSocket connections

### Success Criteria for Phase 7
- [ ] Handles 100 req/s sustained
- [ ] <200ms p95 response time
- [ ] <1% error rate under load
- [ ] No memory leaks
- [ ] Graceful degradation

## Phase 8: Security Hardening (Ongoing)

### Goal
Ensure comprehensive security.

### Tasks

#### 8.1 Security Audit
- Review all endpoints for auth
- Check input validation
- Verify rate limiting
- Test SQL injection protection
- Test XSS protection

#### 8.2 Penetration Testing
- Automated scanning (OWASP ZAP)
- Manual testing
- Dependency vulnerability scan
- Security headers verification

#### 8.3 Secrets Management
- Rotate all secrets
- Use proper key management
- Implement secret rotation
- Audit secret access

### Success Criteria for Phase 8
- [ ] Zero critical vulnerabilities
- [ ] All endpoints authenticated
- [ ] All inputs validated
- [ ] All endpoints rate-limited
- [ ] Security headers present

## Rollout Strategy

### Stage 1: Internal Testing (Week 1)
- Deploy consolidated service to staging
- Run all automated tests
- Manual testing of critical flows
- Performance benchmarks

### Stage 2: Beta Testing (Week 2)
- Deploy to small percentage of users (5%)
- Monitor metrics closely
- Gather feedback
- Fix any issues

### Stage 3: Gradual Rollout (Weeks 3-4)
- Increase to 25% of users
- Continue monitoring
- Increase to 50%
- Increase to 100%

### Stage 4: Decommission Old Services (Week 5)
- Stop api/server.js
- Stop server/index.js
- Keep services/api running
- Monitor for any issues
- Remove old code after 1 week of stability

## Maintenance Plan

### Daily
- Check error logs
- Monitor key metrics
- Verify webhook processing

### Weekly
- Review performance trends
- Check for security updates
- Update dependencies
- Review user feedback

### Monthly
- Capacity planning review
- Security audit
- Performance optimization
- Cost optimization

## Rollback Plan

If issues occur:

1. **Immediate**: Route traffic back to old services
2. **Investigation**: Identify root cause
3. **Fix**: Apply fix to consolidated service
4. **Retest**: Verify fix in staging
5. **Retry**: Gradual rollout again

## Success Metrics

### Technical
- Single backend process serving all requests
- <200ms p95 response time
- <1% error rate
- >99.9% uptime
- ~30% code reduction

### Business
- No user-facing disruptions
- Faster feature development
- Reduced infrastructure costs
- Improved developer productivity

## Conclusion

This implementation guide provides a clear path to complete the backend consolidation. By following these phases systematically and validating each step, we can achieve a reliable, performant, and maintainable unified backend service.
