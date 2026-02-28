# Payment Network Issue Resolution Summary

## Issue Overview

Users were experiencing network timeout errors when attempting to load payment methods in the wallet screen and payment methods modal. The errors appeared as:

- "Error loading payment methods: Error: Network request timed out"
- "Failed to reload payment methods on token change: Error: Network request timed out"
- "[StripeService] Error fetching payment methods: TypeError: Network request timed out"

## Root Causes Identified

1. **Insufficient Timeout Duration**: The original timeout was set to 3 seconds, which is too short for:
   - Slower mobile networks (3G, weak LTE)
   - High-latency connections
   - Devices in areas with poor signal strength

2. **Lack of Retry Logic**: Network requests failed permanently on the first timeout without attempting to retry, even for transient network issues.

3. **Poor Error Messaging**: Error messages were technical and didn't guide users on how to resolve the issue.

4. **Aggressive Token Change Reloading**: Token changes triggered payment method reloads with only 300ms debounce, causing unnecessary rapid requests during authentication flows.

5. **No Exponential Backoff**: Retry attempts happened with fixed short delays (600ms), which could overwhelm slow connections.

## Changes Implemented

### 1. Increased Timeout Durations

**File: `lib/utils/withTimeout.ts`**
- Improved error message from generic "timeout" to "Network request timed out"

**File: `lib/services/stripe-service.ts`**
- Added AbortController for proper timeout handling in fetch requests
- Increased timeout to 15 seconds for `listPaymentMethods()`
- Properly handles AbortError and converts it to user-friendly error message

**File: `components/payment-methods-modal.tsx`**
- Increased initial timeout from 3s to 10s
- Exponential timeout increases on retry: 10s, 15s, 20s

### 2. Implemented Exponential Backoff Retry Logic

**File: `components/payment-methods-modal.tsx`**

```typescript
// Before: 2 retries with 600ms fixed delay
const refreshWithRetry = async (retries = 2, timeoutMs = 3000) => {
  // ... 600ms delay between retries
}

// After: 3 retries with exponential backoff
const refreshWithRetry = async (retries = 3, initialTimeoutMs = 10000) => {
  for (let i = 0; i <= retries; i++) {
    // Exponentially increasing timeout: 10s, 15s, 20s
    const timeout = initialTimeoutMs + (i * 5000)
    await withTimeout(loadPaymentMethods(), timeout)
    
    // Exponential backoff: 1s, 2s, 4s
    const backoffMs = Math.min(1000 * Math.pow(2, i), 4000)
    await new Promise(r => setTimeout(r, backoffMs))
  }
}
```

### 3. Enhanced Error Messages

**File: `lib/stripe-context.tsx`**

```typescript
// Before: Generic error message
const errorMessage = err instanceof Error ? err.message : 'Failed to load payment methods';

// After: Contextual, user-friendly messages
if (err.message.includes('timed out') || err.message.includes('timeout')) {
  errorMessage = 'Connection timed out. Please check your internet connection and try again.';
} else if (err.message.includes('Network') || err.message.includes('fetch')) {
  errorMessage = 'Unable to connect. Please check your internet connection.';
} else if (err.type === 'api_error') {
  errorMessage = 'Payment service temporarily unavailable. Please try again.';
}
```

**File: `components/payment-methods-modal.tsx`**

Enhanced the error display UI with:
- Better visual spacing and typography
- Contextual error messages based on error type
- Clearer "Retry" button with better accessibility

### 4. Fixed Token Change Debouncing

**File: `lib/stripe-context.tsx`**

```typescript
// Before: 300ms debounce
setTimeout(() => {
  loadPaymentMethods().catch(err => { ... });
}, 300);

// After: 1000ms debounce (longer to avoid rapid re-fetches)
setTimeout(() => {
  loadPaymentMethods().catch(err => { ... });
}, 1000);
```

### 5. Fixed Code Structure Issue

**File: `lib/stripe-context.tsx`**

Removed malformed code where `useEffect` hooks were mistakenly placed inside the `processPayment` function's error handling block. This was causing the code to be unreachable and duplicated.

### 6. Comprehensive Testing

**New File: `__tests__/unit/utils/withTimeout.test.ts`**
- Tests timeout behavior
- Tests promise resolution and rejection
- Tests edge cases (0ms timeout, async functions, etc.)

**Updated File: `__tests__/unit/services/stripe-service.test.ts`**
- Added tests for `listPaymentMethods` with timeout scenarios
- Tests AbortError handling
- Tests friendly error message generation
- Tests successful fetches within timeout

### 7. User Documentation

**New File: `TROUBLESHOOTING_PAYMENT_NETWORK.md`**

Comprehensive troubleshooting guide covering:
- Common error messages and their meanings
- Solutions for end users
- Developer troubleshooting steps
- Network configuration issues
- Firewall configuration (Windows, Mac, Linux)
- Alternative solutions (Expo Tunnel, ngrok)
- Testing and monitoring tools

## Technical Details

### Timeout Strategy

| Scenario | Timeout | Retry Attempts | Backoff Pattern |
|----------|---------|----------------|-----------------|
| Payment Method Load (Initial) | 10s | 3 | 1s, 2s, 4s |
| Payment Method Load (Retry 1) | 15s | - | - |
| Payment Method Load (Retry 2) | 20s | - | - |
| Stripe API listPaymentMethods | 15s | 0 | N/A (handled by modal) |
| Token Change Debounce | 1s | - | - |

### Error Handling Flow

```
User Action (Open Payment Modal)
    ↓
refreshWithRetry() called
    ↓
Attempt 1: withTimeout(loadPaymentMethods(), 10s)
    ↓ (if fails)
Wait 1 second
    ↓
Attempt 2: withTimeout(loadPaymentMethods(), 15s)
    ↓ (if fails)
Wait 2 seconds
    ↓
Attempt 3: withTimeout(loadPaymentMethods(), 20s)
    ↓ (if fails)
Wait 4 seconds
    ↓
Attempt 4: withTimeout(loadPaymentMethods(), 25s)
    ↓ (if fails)
Display user-friendly error with Retry button
```

### Network Request Implementation

The `listPaymentMethods` function now uses AbortController:

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 15000);

const response = await fetch(url, {
  signal: controller.signal,
  // ... other options
});

clearTimeout(timeoutId);
```

This ensures:
- Proper cleanup of timeout handlers
- Browser/runtime-native request cancellation
- Prevents memory leaks from hanging requests

## Impact Assessment

### Positive Impacts

1. **Improved User Experience**
   - Users on slower connections can now successfully load payment methods
   - Clear, actionable error messages guide users to solutions
   - Automatic retry reduces friction

2. **Better Network Resilience**
   - Handles transient network issues automatically
   - Exponential backoff prevents server overload
   - Longer timeouts accommodate varied network conditions

3. **Reduced Support Load**
   - Comprehensive troubleshooting guide for common issues
   - Self-service error resolution through better messaging
   - Developer-friendly debugging information

### Potential Risks & Mitigations

1. **Longer Wait Times for Users**
   - **Risk**: Users may wait up to 70 seconds (10+15+20+25s) before seeing an error
   - **Mitigation**: Loading indicators are displayed throughout; users can close modal at any time

2. **Increased Server Load**
   - **Risk**: Retry logic increases request volume
   - **Mitigation**: Exponential backoff and debouncing reduce burst traffic; retries only occur on failure

3. **Battery Consumption**
   - **Risk**: Longer timeouts and retries may drain battery faster
   - **Mitigation**: AbortController ensures requests are properly cancelled; retries are limited to 3 attempts

## Metrics to Monitor

### Client-Side Metrics
- Payment method load success rate
- Average time to successful load
- Retry attempt distribution
- Error type frequency

### Server-Side Metrics
- `/payments/methods` endpoint response time (p50, p95, p99)
- Error rate for payment methods endpoint
- Request volume patterns

### User Impact Metrics
- Wallet screen engagement rate
- Payment method addition completion rate
- User feedback on network errors

## Testing Recommendations

### Automated Testing
- Run `npm test` to verify unit tests pass
- Tests cover timeout behavior, error handling, and retry logic

### Manual Testing Scenarios

1. **Normal Network Conditions**
   - ✓ Payment methods load quickly
   - ✓ No unnecessary retries

2. **Slow Network (Simulated)**
   - Use Chrome DevTools to throttle to "Slow 3G"
   - ✓ Payment methods eventually load
   - ✓ Loading indicator visible throughout

3. **Intermittent Network**
   - Toggle airplane mode during load
   - ✓ Retry succeeds when connection restored
   - ✓ Error message is clear

4. **No Network Connection**
   - Disable all network connections
   - ✓ User sees friendly error message
   - ✓ Retry button functions correctly

5. **Token Refresh During Load**
   - Trigger auth token refresh while loading
   - ✓ No duplicate requests
   - ✓ Debounce prevents rapid reloads

## Rollback Plan

If issues arise, revert these commits:
1. `a797651` - Tests
2. `0ef1384` - Core changes

```bash
git revert a797651 0ef1384
git push origin copilot/resolve-network-issues-payments-modal
```

## Future Improvements

1. **Network Status Detection**
   - Detect offline status before attempting request
   - Show different message for offline vs. slow connection

2. **Request Caching**
   - Cache payment methods locally
   - Show cached data while refreshing

3. **Progressive Loading**
   - Show partial data as it arrives
   - Stream payment methods instead of waiting for all

4. **Advanced Retry Strategies**
   - Circuit breaker pattern for repeated failures
   - Adaptive timeout based on historical performance

5. **Analytics Integration**
   - Track timeout rates by network type
   - Alert on abnormal failure rates

## References

- Original Issue: [ISSUE_PAYMENT_NETWORK.md](./ISSUE_PAYMENT_NETWORK.md)
- Troubleshooting Guide: [TROUBLESHOOTING_PAYMENT_NETWORK.md](./TROUBLESHOOTING_PAYMENT_NETWORK.md)
- Stripe Integration: [STRIPE_INTEGRATION.md](./STRIPE_INTEGRATION.md)

## Contact

For questions or issues related to this fix:
- Review the troubleshooting guide first
- Check server logs for backend issues
- Verify network configuration for local development
