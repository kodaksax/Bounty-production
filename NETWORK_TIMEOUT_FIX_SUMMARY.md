# Network and Timeout Error Resolution - Summary

## Issue Overview

The app was experiencing timeout errors shown in the error screenshots:
1. **Profile fetch timed out** - "Check network connection and Supabase configuration"
2. **StripeService error fetching payment methods** - `{"type":"network_error","code":"timeout","message":"Network request timed out"}`
3. **Error loading payment methods** - "Network request timed out"
4. **Failed to reload payment methods on token change** - "Network request timed out"

## Root Cause Analysis

### The Problem
Custom timeout wrappers were prematurely canceling SDK requests that were still processing:

1. **`withTimeout` utility** in `lib/utils/withTimeout.ts`:
   ```typescript
   export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
     // Creates a race between the promise and a timeout
     // On timeout, rejects but DOESN'T actually cancel the underlying operation
     return await Promise.race([promise, timeoutPromise]);
   }
   ```

2. **Manual `AbortController` in stripe-service.ts**:
   ```typescript
   const controller = new AbortController();
   setTimeout(() => controller.abort(), 15000);
   // Aborts fetch but may conflict with SDK's own handling
   ```

### Why This Was Bad
- **Doesn't cancel underlying operations**: Promise rejection doesn't stop SDK network requests
- **Conflicts with SDK retry logic**: SDKs like Supabase have built-in retry mechanisms
- **Premature failures**: Slow connections that could succeed were failing at 5-15 seconds
- **Race conditions**: Multiple timeout mechanisms competing (app-level + SDK-level + browser-level)

### Similar to Auth Issue Fix
The issue description mentioned: *"Auth issues were fixed when it was discovered the Custom withTimeout wrapper (15s limit) prematurely canceled Supabase auth requests that are still processing. The wrapper conflicted with Supabase SDK's built-in network handling, retry logic, and timeouts."*

This is exactly the same pattern we found in profile fetching and payment methods loading.

## Solution Implemented

### Changes to `lib/services/auth-profile-service.ts`

**Removed `withTimeout` wrapper from:**
1. `getProfileById()` - profiles query (was 5 second timeout)
2. `getProfileById()` - public_profiles fallback (was 10 second timeout)
3. `fetchAndSyncProfile()` - profile fetch (was 5 second timeout)
4. `createMinimalProfile()` - profile insert (was 10 second timeout)
5. `updateProfile()` - profile update (was 10 second timeout)

**Before:**
```typescript
const { data, error } = await withTimeout(
  supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single(),
  5000 // 5 second timeout
);
```

**After:**
```typescript
// Use Supabase SDK without custom timeout wrapper
// Allows SDK to use its internal network handling and retry logic
const { data, error } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', userId)
  .single();
```

### Changes to `lib/services/stripe-service.ts`

**Removed manual timeout from `listPaymentMethods()`:**

**Before:**
```typescript
const controller = new AbortController();
let didTimeout = false;
const timeoutId = setTimeout(() => {
  didTimeout = true;
  controller.abort();
}, 15000);

const response = await fetch(`${API_BASE_URL}/payments/methods`, {
  signal: controller.signal,
});

if (didTimeout) {
  throw { type: 'network_error', code: 'timeout', message: 'Network request timed out' };
}
```

**After:**
```typescript
// Use fetch API without custom timeout wrapper
// Relies on network stack's TCP timeouts and browser defaults
// Allows requests to complete naturally without premature cancellation
const response = await fetch(`${API_BASE_URL}/payments/methods`, {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  },
});
```

## Benefits

1. **No more premature timeouts**: Requests can complete on slow networks
2. **SDK retry logic works**: Supabase and Stripe SDKs can retry transient failures
3. **Better error messages**: Actual network errors instead of artificial timeouts
4. **Improved reliability**: Especially on mobile networks (3G, edge cases)
5. **Reduced complexity**: Let network stack handle timeouts naturally

## What About Hanging Requests?

### Network Stack Handles This
- **TCP timeouts**: Network stack has built-in TCP connection timeouts
- **Browser timeouts**: Browsers enforce their own fetch timeouts
- **Mobile platform timeouts**: iOS/Android have system-level network timeouts

### SDK Protections
- **Supabase**: Has connection pooling and request management built-in
- **Stripe**: Backend services have their own timeout configurations

### When Custom Timeouts Make Sense
Custom timeouts are still appropriate for:
- User-facing UI interactions (e.g., "search as you type" should cancel old searches)
- Background tasks with known time limits
- Operations where you want to fail fast for UX reasons

But they should:
1. **Actually cancel the operation** (not just reject the promise)
2. **Not conflict with SDK handling**
3. **Be longer than typical network latency** (not 5-15 seconds)

## Testing Requirements

See `NETWORK_TIMEOUT_FIX_TESTING.md` for detailed testing scenarios.

**Critical tests:**
1. Profile loading on slow network (3G simulation)
2. Payment methods loading with token refresh
3. Multiple rapid profile loads (stress test)
4. Actual network disconnection (verify error messages)

## Monitoring

Watch for these metrics after deployment:
- Profile fetch success rate
- Payment methods loading success rate
- Average request duration (may increase slightly but should succeed)
- Error logs for "timed out" messages (should decrease significantly)

## Related Files

- `lib/services/auth-profile-service.ts` - Profile fetching service
- `lib/services/stripe-service.ts` - Payment methods service
- `lib/utils/withTimeout.ts` - Timeout utility (still exists, just not used in these services)
- `NETWORK_TIMEOUT_FIX_TESTING.md` - Comprehensive testing guide

## Rollback Plan

If issues arise:
```bash
git revert <commit-hash>
```

But consider investigating:
1. Is there a specific SDK timeout that's too long?
2. Can we configure SDK-level timeouts instead?
3. Are there actual network infrastructure issues?

The root cause was premature cancellation, not missing timeouts.

## Lessons Learned

1. **Trust SDK implementations**: Well-maintained SDKs have proper timeout handling
2. **Promise races don't cancel**: `Promise.race()` doesn't stop losing promises
3. **Fail fast vs fail eventually**: Sometimes waiting longer gives better UX
4. **Layer interaction**: Multiple timeout layers can conflict and cause worse behavior
5. **Follow SDK patterns**: If SDK solves auth timeouts by removing wrapper, same pattern applies elsewhere

## Security Considerations

No security impact from this change:
- Still using same authentication tokens
- Still validating responses
- Still handling errors appropriately
- Only removed artificial time limits

## Performance Impact

**Expected:**
- Slightly longer response times on slow networks (but successful instead of failing)
- Reduced error rate significantly
- Better success rate on marginal network conditions
- No impact on fast networks

**Metrics to monitor:**
- P50, P95, P99 latencies for profile/payment loads
- Success rate improvements
- User-reported "connection issues" (should decrease)
