# Stripe Customer Creation Optimization Guide

## Overview

This document outlines the current Stripe customer creation approach and provides a detailed plan for optimizing customer creation timing. The optimization moves customer creation from first payment to signup, improving first payment UX and data consistency.

## Current Implementation

### How It Works Today

**Lazy Creation Pattern** - Customers are created on-demand during first payment:

```typescript
// services/api/src/services/consolidated-payment-service.ts
async function getOrCreateStripeCustomer(userId: string, email?: string) {
  // Step 1: Check if customer exists
  const profile = await getProfile(userId);
  
  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id; // Already exists
  }
  
  // Step 2: Create customer NOW (during payment flow)
  const customer = await stripe.customers.create({
    email: email || profile.email,
    metadata: { user_id: userId }
  });
  
  // Step 3: Save customer ID to profile
  await updateProfile(userId, { 
    stripe_customer_id: customer.id 
  });
  
  return customer.id;
}
```

### Current Flow Diagram

```
User Signs Up
    │
    ├─> Create Auth User (Supabase)
    │
    ├─> Create Profile (Database trigger)
    │
    └─> ✅ Registration Complete
         (No Stripe customer created yet)

Later... User Makes First Payment
    │
    ├─> Call createPaymentIntent()
    │       │
    │       ├─> getOrCreateStripeCustomer()  ← Customer created HERE
    │       │   └─> 200-300ms latency added
    │       │
    │       ├─> stripe.paymentIntents.create()
    │       │
    │       └─> Return client secret
    │
    └─> ✅ Payment initiated (with extra delay)
```

### Current Performance

| Metric | Value | Notes |
|--------|-------|-------|
| **Signup Time** | ~800ms | No Stripe calls |
| **First Payment** | ~1200ms | Includes customer creation (200-300ms) |
| **Subsequent Payments** | ~900ms | Customer already exists |
| **Extra Latency** | 200-300ms | One-time cost on first payment |

## Proposed Optimization

### Eager Creation Pattern

Create Stripe customer immediately during signup:

```typescript
// services/api/src/routes/consolidated-auth.ts
async function handleUserRegistration(body: RegisterBody) {
  // Step 1: Create auth user
  const { user } = await supabase.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { username }
  });
  
  // Step 2: Profile auto-created by trigger
  await waitForProfile(user.id, 3000); // Max 3 second wait
  
  // Step 3: Create Stripe customer immediately (NEW)
  try {
    const customerId = await createStripeCustomerForNewUser(
      user.id, 
      body.email
    );
    
    logger.info({ 
      userId: user.id, 
      customerId 
    }, 'Stripe customer created at signup');
  } catch (error) {
    // Don't fail signup if Stripe customer creation fails
    logger.error({ 
      userId: user.id, 
      error 
    }, 'Failed to create Stripe customer at signup');
  }
  
  return { userId: user.id, username };
}
```

### Optimized Flow Diagram

```
User Signs Up
    │
    ├─> Create Auth User (Supabase)
    │
    ├─> Create Profile (Database trigger)
    │
    ├─> Create Stripe Customer ← NEW: Created during signup
    │   └─> +200ms to signup time
    │
    └─> ✅ Registration Complete
         (Stripe customer ready for payments)

Later... User Makes First Payment
    │
    ├─> Call createPaymentIntent()
    │       │
    │       ├─> getOrCreateStripeCustomer()
    │       │   └─> Returns existing customer ID ✅ No API call
    │       │
    │       ├─> stripe.paymentIntents.create()
    │       │
    │       └─> Return client secret
    │
    └─> ✅ Payment initiated (FASTER - no customer creation)
```

### Optimized Performance

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| **Signup Time** | ~800ms | ~1000ms | +200ms |
| **First Payment** | ~1200ms | ~900ms | -300ms ✅ |
| **Subsequent Payments** | ~900ms | ~900ms | No change |
| **Net UX Impact** | - | - | **Positive** - Payment is more critical path |

## Benefits

### 1. Faster First Payment ✅

**Impact:** Saves 200-300ms on first payment

Users are more likely to abandon during payment than signup. Making payment faster improves conversion.

```typescript
// Before
signup:  ████████░░ 800ms
payment: ████████████ 1200ms  ← Critical path

// After  
signup:  ██████████ 1000ms
payment: █████████░ 900ms  ← Faster critical path ✅
```

### 2. Better Data Consistency ✅

**Before:** Gap between user creation and Stripe customer

```
User created → ... (days/weeks) ... → First payment → Customer created
```

Problems:
- Analytics incomplete until first payment
- Customer lifetime data starts late
- Can't track users who sign up but never pay

**After:** Immediate customer record

```
User created → Customer created → ... → First payment
```

Benefits:
- Complete user records from day 1
- Better cohort analysis
- Track non-paying users

### 3. Clearer Audit Trail ✅

**Before:** Customer creation mixed with payment flow

```
[Payment Log]
- Payment intent created
- Customer created  ← Hidden in payment logic
- Payment confirmed
```

**After:** Customer creation at signup

```
[Signup Log]
- User created
- Profile created
- Stripe customer created  ← Clear lifecycle event

[Payment Log]
- Payment intent created (with existing customer)
- Payment confirmed
```

### 4. Simplified Payment Code ✅

**Before:** Payment code must handle customer creation

```typescript
async function createPaymentIntent(options) {
  // Complex: Must handle customer creation + payment
  const customerId = await getOrCreateStripeCustomer(userId, email);
  const intent = await stripe.paymentIntents.create({ customer: customerId });
  return intent;
}
```

**After:** Payment code assumes customer exists

```typescript
async function createPaymentIntent(options) {
  // Simple: Customer already exists
  const profile = await getProfile(userId);
  const intent = await stripe.paymentIntents.create({ 
    customer: profile.stripe_customer_id 
  });
  return intent;
}
```

## Implementation Plan

### Phase 1: Preparation (2 hours)

#### 1.1 Create Helper Function

```typescript
// services/api/src/services/consolidated-payment-service.ts

/**
 * Create Stripe customer for new user at signup
 * @param userId - User ID
 * @param email - User email
 * @returns Customer ID or null if failed
 */
export async function createStripeCustomerForNewUser(
  userId: string,
  email: string
): Promise<string | null> {
  try {
    // Create customer with idempotency key
    const customer = await stripe.customers.create(
      {
        email,
        metadata: { 
          user_id: userId,
          created_at_signup: 'true',
          created_at: new Date().toISOString(),
        },
      },
      {
        // Prevent duplicates if signup retries
        idempotencyKey: `customer_signup_${userId}`,
      }
    );
    
    // Save to profile
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('profiles')
      .update({ stripe_customer_id: customer.id })
      .eq('id', userId);
    
    if (error) {
      logger.error({ 
        userId, 
        customerId: customer.id, 
        error 
      }, 'Failed to save customer ID to profile');
      // Customer created but not saved - will be handled by getOrCreate
    }
    
    logger.info({ 
      userId, 
      customerId: customer.id 
    }, 'Stripe customer created at signup');
    
    return customer.id;
  } catch (error) {
    logger.error({ userId, error }, 'Failed to create Stripe customer at signup');
    // Return null - customer will be created on first payment (fallback)
    return null;
  }
}
```

#### 1.2 Add Profile Wait Helper

```typescript
// services/api/src/utils/wait-for-profile.ts

/**
 * Wait for profile to be created by database trigger
 * @param userId - User ID
 * @param maxWaitMs - Maximum time to wait (default: 3000ms)
 * @returns Profile or null if timeout
 */
export async function waitForProfile(
  userId: string,
  maxWaitMs: number = 3000
): Promise<any | null> {
  const admin = getSupabaseAdmin();
  const startTime = Date.now();
  const pollInterval = 100; // Check every 100ms
  
  while (Date.now() - startTime < maxWaitMs) {
    const { data: profile } = await admin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (profile) {
      return profile;
    }
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  logger.warn({ userId, maxWaitMs }, 'Profile creation timeout');
  return null;
}
```

### Phase 2: Integration (2 hours)

#### 2.1 Update Registration Handler

```typescript
// services/api/src/routes/consolidated-auth.ts
import { createStripeCustomerForNewUser } from '../services/consolidated-payment-service';
import { waitForProfile } from '../utils/wait-for-profile';

async function handleUserRegistration(
  request: FastifyRequest,
  reply: FastifyReply,
  body: RegisterBody,
  logPrefix: string
) {
  try {
    // Step 1: Create auth user
    const { data, error } = await supabase.auth.admin.createUser({
      email: body.email.trim(),
      password: body.password,
      email_confirm: true,
      user_metadata: { username },
    });
    
    if (error || !data?.user?.id) {
      throw new ExternalServiceError('Supabase', error.message);
    }
    
    const userId = data.user.id;
    
    // Step 2: Wait for profile to be created by trigger
    const profile = await waitForProfile(userId, 3000);
    
    if (!profile) {
      logger.warn({ userId }, 'Profile creation timeout - customer will be created on first payment');
    } else {
      // Step 3: Create Stripe customer (non-blocking)
      // Don't await - run in background
      createStripeCustomerForNewUser(userId, body.email)
        .then(customerId => {
          if (customerId) {
            logger.info({ userId, customerId }, 'Stripe customer created at signup');
          }
        })
        .catch(error => {
          logger.error({ userId, error }, 'Failed to create Stripe customer at signup');
          // Not critical - will be created on first payment
        });
    }
    
    return reply.code(201).send({
      success: true,
      userId,
      email: body.email,
      username,
      message: 'Account created successfully',
    });
  } catch (error) {
    throw error;
  }
}
```

#### 2.2 Update Payment Service (Fallback)

Keep existing `getOrCreateStripeCustomer` as fallback:

```typescript
// services/api/src/services/consolidated-payment-service.ts

async function getOrCreateStripeCustomer(userId: string, email?: string) {
  // Check if customer exists
  const profile = await getProfile(userId);
  
  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }
  
  // Fallback: Create if missing (shouldn't happen often with eager creation)
  logger.warn({ userId }, 'Creating Stripe customer during payment (should have been created at signup)');
  
  return await createStripeCustomerForNewUser(userId, email || profile.email);
}
```

### Phase 3: Feature Flag (1 hour)

Add configuration to enable/disable:

```typescript
// services/api/src/config/index.ts
export const config = {
  // ... existing config
  
  stripe: {
    // ... existing stripe config
    
    // New flag
    createCustomerAtSignup: process.env.STRIPE_CREATE_CUSTOMER_AT_SIGNUP === 'true',
  },
};
```

```typescript
// Update registration handler
if (config.stripe.createCustomerAtSignup && profile) {
  // Create customer at signup
  createStripeCustomerForNewUser(userId, body.email)
    .catch(error => {
      logger.error({ userId, error }, 'Failed to create Stripe customer at signup');
    });
}
```

### Phase 4: Testing (2 hours)

#### 4.1 Unit Tests

```typescript
// services/api/src/services/__tests__/payment-service.test.ts

describe('createStripeCustomerForNewUser', () => {
  it('should create customer with correct metadata', async () => {
    const userId = 'user_123';
    const email = 'test@example.com';
    
    const customerId = await createStripeCustomerForNewUser(userId, email);
    
    expect(customerId).toBeTruthy();
    
    // Verify customer in Stripe
    const customer = await stripe.customers.retrieve(customerId);
    expect(customer.email).toBe(email);
    expect(customer.metadata.user_id).toBe(userId);
    expect(customer.metadata.created_at_signup).toBe('true');
  });
  
  it('should save customer ID to profile', async () => {
    const userId = 'user_456';
    const email = 'test2@example.com';
    
    await createStripeCustomerForNewUser(userId, email);
    
    const profile = await getProfile(userId);
    expect(profile.stripe_customer_id).toBeTruthy();
  });
  
  it('should handle idempotency on retry', async () => {
    const userId = 'user_789';
    const email = 'test3@example.com';
    
    // Call twice with same idempotency key
    const customerId1 = await createStripeCustomerForNewUser(userId, email);
    const customerId2 = await createStripeCustomerForNewUser(userId, email);
    
    // Should return same customer ID
    expect(customerId1).toBe(customerId2);
  });
});
```

#### 4.2 Integration Tests

```typescript
// services/api/src/__tests__/auth-flow.test.ts

describe('User Registration with Stripe Customer', () => {
  it('should create Stripe customer during signup', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        username: 'newuser',
      });
    
    expect(response.status).toBe(201);
    const { userId } = response.body;
    
    // Wait a bit for async customer creation
    await sleep(500);
    
    // Verify customer was created
    const profile = await getProfile(userId);
    expect(profile.stripe_customer_id).toBeTruthy();
  });
  
  it('should work without customer if creation fails', async () => {
    // Mock Stripe failure
    jest.spyOn(stripe.customers, 'create').mockRejectedValue(
      new Error('Stripe API error')
    );
    
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: 'failtest@example.com',
        password: 'SecurePass123!',
        username: 'failtest',
      });
    
    // Signup should still succeed
    expect(response.status).toBe(201);
  });
});
```

### Phase 5: Monitoring (1 hour)

#### 5.1 Add Metrics

```typescript
// Track customer creation success/failure
analyticsService.trackEvent('stripe_customer_created', {
  user_id: userId,
  created_at: 'signup',  // or 'first_payment'
  duration_ms: elapsed,
});

analyticsService.trackEvent('stripe_customer_creation_failed', {
  user_id: userId,
  error_code: error.code,
  error_message: error.message,
  attempted_at: 'signup',
});
```

#### 5.2 Add Alerts

```typescript
// Alert if customer creation failures exceed threshold
if (failureRate > 0.05) { // 5%
  await alertOps({
    severity: 'warning',
    title: 'High Stripe customer creation failure rate',
    rate: failureRate,
  });
}
```

### Phase 6: Rollout (1 day)

#### 6.1 Enable in Staging

```bash
# .env.staging
STRIPE_CREATE_CUSTOMER_AT_SIGNUP=true
```

Test thoroughly:
- Sign up new users
- Make first payments
- Verify performance
- Check error rates

#### 6.2 Gradual Production Rollout

**Day 1:** Enable for 10% of signups
```typescript
if (config.stripe.createCustomerAtSignup && Math.random() < 0.1) {
  // Create customer at signup
}
```

**Day 3:** Enable for 50% if metrics look good

**Day 7:** Enable for 100% if no issues

#### 6.3 Monitor Key Metrics

- Customer creation success rate
- Signup latency (p50, p95, p99)
- First payment latency
- Error rates
- User complaints

## Rollback Plan

If issues arise:

### Quick Rollback

```bash
# Disable feature flag
STRIPE_CREATE_CUSTOMER_AT_SIGNUP=false
```

Restart API servers. Customers will be created on first payment (current behavior).

### Data Cleanup

If needed, identify and handle users without customers:

```sql
-- Find users without Stripe customers
SELECT id, email, created_at
FROM profiles
WHERE stripe_customer_id IS NULL
  AND created_at > '2026-01-02'
ORDER BY created_at DESC;
```

## Considerations

### When NOT to Implement

❌ Don't implement if:
- First payment latency is not a user complaint
- Signup latency is already concerning
- Team bandwidth is limited
- More critical optimizations exist

### Trade-offs

| Aspect | Before | After | Assessment |
|--------|--------|-------|------------|
| **Signup Speed** | 800ms | 1000ms | ⚠️ Slightly slower |
| **First Payment** | 1200ms | 900ms | ✅ Significantly faster |
| **Code Complexity** | Medium | Medium | ➡️ Similar |
| **Stripe API Calls** | On-demand | At signup | ⚠️ More upfront calls |
| **Data Consistency** | Delayed | Immediate | ✅ Better |
| **Error Handling** | Simple | More complex | ⚠️ Need fallback |

### Alternative Approaches

#### Option B: Background Job

Create customer in background job instead of inline:

```typescript
// Queue customer creation
await queue.add('create-stripe-customer', {
  userId,
  email,
});

// Process in background
queue.process('create-stripe-customer', async (job) => {
  await createStripeCustomerForNewUser(job.data.userId, job.data.email);
});
```

**Pros:** No impact on signup latency  
**Cons:** More infrastructure, delayed customer creation

#### Option C: Lazy with Cache Warming

Keep lazy creation but pre-warm cache:

```typescript
// After signup, warm cache (don't await)
warmStripeCustomerCache(userId, email)
  .catch(error => logger.error({ error }));
```

**Pros:** Minimal change  
**Cons:** Still adds latency to first payment

## Success Metrics

Track these to measure success:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Customer Creation Success Rate** | >99% | Count successes vs failures |
| **Signup Latency (p95)** | <1500ms | Monitor API response times |
| **First Payment Latency (p95)** | <1000ms | Track payment intent creation time |
| **Users Without Customers** | <1% | Query profiles table |
| **Payment Errors** | <2% | Track payment failures |

## Related Documentation

- [Async Operation Ordering Guide](./ASYNC_ORDERING_GUIDE.md) - Proper sequencing
- [Stripe Integration Backend](../STRIPE_INTEGRATION_BACKEND.md) - Overall Stripe setup
- [Payment Service](../services/api/src/services/consolidated-payment-service.ts) - Implementation

## Conclusion

**Current State:** ✅ Working - lazy customer creation  
**Optimized State:** 🎯 Better UX - eager customer creation  
**ROI:** ⏳ Low - minor improvement (200-300ms)  
**Priority:** Low - implement only if first payment latency becomes a user complaint

This optimization provides a small but measurable improvement to first payment UX. Implement when team has bandwidth and first payment latency is identified as a pain point in user feedback or analytics.

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-01-02  
**Status:** Implementation Ready 📝  
**Priority:** Low - Implement when first-payment latency becomes a concern
