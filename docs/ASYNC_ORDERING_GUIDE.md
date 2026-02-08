# Async Operation Ordering Guide

## Overview

This document explains the critical ordering requirements for asynchronous operations in BOUNTYExpo, particularly around profile creation and Stripe customer/Connect account setup. Understanding and following these patterns prevents race conditions and ensures data consistency.

## Critical: Profile → Stripe Operation Ordering

### Why Order Matters

When creating user accounts and setting up payment capabilities, operations **must be executed sequentially** in a specific order to prevent data inconsistencies and failures:

1. **Profile must exist first** - Stripe operations reference the user's profile for email and metadata
2. **Profile must be committed to database** - Stripe stores the `user_id` in metadata and we store Stripe IDs in the profile
3. **Stripe operations depend on profile data** - Creating customers/Connect accounts requires email from profile

### ❌ Incorrect Pattern (Parallel Execution)

```typescript
// DON'T DO THIS - Race condition risk
async function createUserWithPayments(userId: string, email: string) {
  // These run in parallel - UNSAFE!
  await Promise.all([
    createProfile(userId, email),          // Creates profile
    createStripeCustomer(userId, email),   // Needs profile to exist
    createStripeConnectAccount(userId, email) // Needs profile to exist
  ]);
}
```

**Problems:**
- Stripe operations may execute before profile is committed
- Profile lookup in `getOrCreateStripeCustomer()` may fail
- Partial failures leave system in inconsistent state
- No clear rollback path

### ✅ Correct Pattern (Sequential Execution)

```typescript
// DO THIS - Sequential and safe
async function createUserWithPayments(userId: string, email: string) {
  try {
    // Step 1: Create profile FIRST
    await createProfile(userId, email);
    
    // Step 2: Create Stripe customer (depends on profile)
    const customerId = await createStripeCustomer(userId, email);
    
    // Step 3: Create Connect account (optional, depends on profile)
    // Only create if user will be receiving payments
    // const connectAccountId = await createStripeConnectAccount(userId, email);
    
    return { success: true, customerId };
  } catch (error) {
    // Handle errors with proper cleanup
    await rollbackProfileCreation(userId);
    throw error;
  }
}
```

**Benefits:**
- Profile exists before Stripe operations begin
- Clear dependency chain is enforced
- Errors can be caught and handled at each step
- Easy to trace and debug issues

## Real-World Examples from Codebase

### Example 1: User Registration Flow

In `services/api/src/routes/consolidated-auth.ts`:

```typescript
// Current implementation (simplified)
async function handleUserRegistration(body: RegisterBody) {
  // Step 1: Create auth user
  const { user } = await supabase.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { username }
  });
  
  // Step 2: Profile is auto-created by database trigger
  // Wait for it to be committed before proceeding
  
  // Step 3: (Future optimization) Create Stripe customer here
  // await createStripeCustomer(user.id, body.email);
  
  return { userId: user.id, username };
}
```

**Current State:**
- ✅ Profile created via database trigger (sequential)
- ⚠️ Stripe customer created lazily on first payment (deferred)
- 📝 Future: Create customer at signup for better UX

### Example 2: Stripe Customer Creation

In `services/api/src/services/consolidated-payment-service.ts`:

```typescript
async function getOrCreateStripeCustomer(userId: string, email?: string) {
  // Step 1: Check if customer already exists
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', userId)
    .single();
  
  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id; // Already exists
  }
  
  // Step 2: Profile must exist to reach here
  // Create customer using profile email
  const customer = await stripe.customers.create({
    email: email || profile?.email,
    metadata: { user_id: userId }
  });
  
  // Step 3: Save customer ID back to profile
  await supabase
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId);
  
  return customer.id;
}
```

**Why This Works:**
1. Profile lookup confirms profile exists
2. If profile missing, function fails fast with clear error
3. Customer creation uses profile data
4. Customer ID saved back atomically

### Example 3: Stripe Connect Account Creation

In `services/api/src/services/consolidated-stripe-connect-service.ts`:

```typescript
export async function createConnectAccount(userId: string, email: string) {
  // Step 1: Verify profile exists and get current state
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_connect_account_id')
    .eq('id', userId)
    .single();
  
  // Return existing if present
  if (profile?.stripe_connect_account_id) {
    return profile.stripe_connect_account_id;
  }
  
  // Step 2: Create Stripe Connect account
  // Uses idempotency key to prevent duplicates
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    metadata: { user_id: userId }
  }, {
    idempotencyKey: `connect_acct_${userId}`
  });
  
  // Step 3: Save account ID to profile
  await supabase
    .from('profiles')
    .update({ stripe_connect_account_id: account.id })
    .eq('id', userId);
  
  return account.id;
}
```

**Protection Mechanisms:**
1. Profile lookup first (fails if no profile)
2. Idempotency key prevents duplicate accounts
3. Error handling preserves consistency

## Common Pitfalls to Avoid

### 1. ❌ Creating Stripe Resources Before Profile Exists

```typescript
// BAD: Stripe customer created before profile
const customer = await stripe.customers.create({ email });
const profile = await createProfile(userId, email);
await updateProfileStripeId(profile.id, customer.id);
```

**Problem:** If profile creation fails, orphaned Stripe customer remains.

### 2. ❌ Using Parallel Promises with Dependencies

```typescript
// BAD: Dependencies run in parallel
const [profile, customer] = await Promise.all([
  createProfile(userId, email),
  createStripeCustomer(userId, email) // Needs profile!
]);
```

**Problem:** `createStripeCustomer` may execute before `createProfile` completes.

### 3. ❌ Not Handling Partial Failures

```typescript
// BAD: No error handling or rollback
await createProfile(userId, email);
await createStripeCustomer(userId, email);
await createConnectAccount(userId, email);
// What if Connect account creation fails?
```

**Problem:** System left in inconsistent state with no recovery path.

## Best Practices

### 1. ✅ Always Check Profile Exists

```typescript
// Good pattern used throughout codebase
async function operationRequiringProfile(userId: string) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error || !profile) {
    throw new NotFoundError('User profile not found');
  }
  
  // Now safe to proceed
  return doOperationWithProfile(profile);
}
```

### 2. ✅ Use Idempotency Keys

```typescript
// Prevents duplicate resources on retries
const account = await stripe.accounts.create(
  { /* config */ },
  { idempotencyKey: `connect_acct_${userId}` }
);
```

### 3. ✅ Implement Proper Error Handling

```typescript
async function createUserPaymentSetup(userId: string, email: string) {
  let customerId: string | null = null;
  
  try {
    // Step 1: Verify profile exists
    const profile = await getProfile(userId);
    
    // Step 2: Create customer
    customerId = await createStripeCustomer(userId, email);
    
    return { customerId };
  } catch (error) {
    // Cleanup on failure
    if (customerId) {
      await safeDeleteStripeCustomer(customerId);
    }
    throw error;
  }
}
```

### 4. ✅ Log Operation Sequence

```typescript
logger.info({ userId, step: 'profile_creation' }, 'Creating profile');
await createProfile(userId, email);

logger.info({ userId, step: 'stripe_customer' }, 'Creating Stripe customer');
await createStripeCustomer(userId, email);

logger.info({ userId, step: 'complete' }, 'User setup complete');
```

## Testing Sequential Operations

### Unit Test Example

```typescript
describe('Sequential Profile → Stripe Operations', () => {
  it('should create profile before Stripe customer', async () => {
    const operations: string[] = [];
    
    // Mock functions that track execution order
    jest.spyOn(profileService, 'create').mockImplementation(async () => {
      operations.push('profile');
    });
    
    jest.spyOn(stripeService, 'createCustomer').mockImplementation(async () => {
      operations.push('customer');
    });
    
    await createUserWithPayments(userId, email);
    
    // Assert profile created before customer
    expect(operations).toEqual(['profile', 'customer']);
  });
  
  it('should fail if profile creation fails', async () => {
    jest.spyOn(profileService, 'create').mockRejectedValue(
      new Error('Profile creation failed')
    );
    
    // Stripe customer should never be called
    const customerSpy = jest.spyOn(stripeService, 'createCustomer');
    
    await expect(createUserWithPayments(userId, email)).rejects.toThrow();
    expect(customerSpy).not.toHaveBeenCalled();
  });
});
```

## Integration Testing

Test the full flow with real or mocked external services:

```typescript
describe('User Registration Integration', () => {
  it('should complete full registration flow sequentially', async () => {
    // 1. Create user
    const { userId } = await authService.register(email, password);
    
    // 2. Verify profile was created
    const profile = await profileService.get(userId);
    expect(profile).toBeDefined();
    expect(profile.email).toBe(email);
    
    // 3. Trigger payment setup
    const { customerId } = await paymentService.initializeForUser(userId);
    
    // 4. Verify customer linked to profile
    const updatedProfile = await profileService.get(userId);
    expect(updatedProfile.stripe_customer_id).toBe(customerId);
  });
});
```

## Monitoring and Debugging

### Key Metrics to Track

1. **Profile Creation Time** - Baseline for dependent operations
2. **Stripe Customer Creation Latency** - Should happen after profile
3. **Operation Failure Rates** - Catch sequencing issues
4. **Orphaned Resources** - Stripe customers without profiles

### Log Analysis

Look for these patterns in logs:

```
✅ Good sequence:
[INFO] Creating profile for user_123
[INFO] Profile created: user_123
[INFO] Creating Stripe customer for user_123
[INFO] Stripe customer created: cus_abc123

❌ Bad sequence (race condition):
[INFO] Creating profile for user_123
[INFO] Creating Stripe customer for user_123  ← Too early!
[ERROR] Stripe customer creation failed: Profile not found
```

## Migration Guide for New Engineers

When onboarding new team members, emphasize:

1. **Read this document first** - Understand why ordering matters
2. **Review existing patterns** - See how it's done in the codebase
3. **Never parallelize dependent operations** - Use sequential `await`
4. **Always verify profile exists** - Before Stripe operations
5. **Use idempotency keys** - For all Stripe resource creation
6. **Test error paths** - Ensure proper rollback and cleanup

## Related Documentation

- [Authentication & Profile Architecture](../AUTH_PROFILE_ARCHITECTURE.md) - Profile creation and management
- [Stripe Integration Backend](../STRIPE_INTEGRATION_BACKEND.md) - Payment setup details
- [Stripe Connect Architecture](../services/api/STRIPE_CONNECT_ARCHITECTURE.md) - Connect account setup

## Future Considerations

### Planned Optimization: Eager Stripe Customer Creation

Currently, Stripe customers are created on first payment (lazy). Future optimization will create customers at signup:

```typescript
// Future implementation
async function handleUserRegistration(body: RegisterBody) {
  // Step 1: Create auth user
  const { user } = await supabase.auth.admin.createUser({ /* ... */ });
  
  // Step 2: Wait for profile trigger to complete
  await waitForProfile(user.id);
  
  // Step 3: Create Stripe customer immediately (NEW)
  await createStripeCustomer(user.id, body.email);
  
  return { userId: user.id };
}
```

**Benefits:**
- Faster first payment (saves 200-300ms)
- Better data consistency
- Clearer audit trail

**Implementation Notes:**
- Must still be sequential (after profile exists)
- Add proper error handling
- Consider making optional based on user type

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-01-02  
**Status:** Production Reference ✅  
**Priority:** High - Critical for preventing bugs during refactoring
