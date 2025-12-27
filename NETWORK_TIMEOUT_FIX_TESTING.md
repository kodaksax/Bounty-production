# Network Timeout Fix Testing Guide

## Changes Made

### Files Modified
1. `lib/services/auth-profile-service.ts` - Removed `withTimeout` wrapper
2. `lib/services/stripe-service.ts` - Removed manual `AbortController` timeout

### What Was Fixed
The custom timeout wrappers were prematurely canceling SDK requests that were still processing, conflicting with Supabase and Stripe SDK's built-in network handling, retry logic, and timeouts.

## Testing Checklist

### 1. Profile Loading Tests

#### Test Scenario 1: Normal Profile Load
- **Steps:**
  1. Sign in to the app
  2. Navigate to Profile screen
  3. Observe profile loads successfully
- **Expected:** Profile data appears without timeout errors
- **Previous Behavior:** "Profile fetch timed out" errors on slow connections

#### Test Scenario 2: Slow Network Profile Load
- **Steps:**
  1. Enable network throttling (3G or slower)
  2. Sign in to the app
  3. Wait for profile to load
- **Expected:** Profile loads successfully, taking longer but not timing out
- **Previous Behavior:** Timeout error after 5-10 seconds

#### Test Scenario 3: Profile Refresh
- **Steps:**
  1. Open app while signed in
  2. Pull to refresh on profile screen
  3. Observe profile reloads
- **Expected:** Profile refreshes successfully
- **Previous Behavior:** Timeout errors on refresh

### 2. Payment Methods Loading Tests

#### Test Scenario 1: Normal Payment Methods Load
- **Steps:**
  1. Sign in to the app
  2. Navigate to Wallet > Payment Methods
  3. Observe payment methods list loads
- **Expected:** Payment methods appear without timeout errors
- **Previous Behavior:** "Network request timed out" errors

#### Test Scenario 2: Slow Network Payment Methods Load
- **Steps:**
  1. Enable network throttling
  2. Navigate to Wallet > Payment Methods
  3. Wait for payment methods to load
- **Expected:** Payment methods load successfully, taking longer but not timing out
- **Previous Behavior:** Timeout error after 15 seconds

#### Test Scenario 3: Token Change Payment Methods Reload
- **Steps:**
  1. Sign in to the app
  2. Wait for token refresh (automatic after ~60 minutes)
  3. Observe payment methods reload automatically
- **Expected:** Payment methods reload successfully without timeout
- **Previous Behavior:** "Failed to reload payment methods on token change" errors

### 3. Error Handling Tests

#### Test Scenario 1: Actual Network Failure
- **Steps:**
  1. Disable network connection completely
  2. Try to load profile or payment methods
- **Expected:** Clear error message about network connectivity
- **Should NOT:** Show timeout errors for SDK operations that never started

#### Test Scenario 2: Backend API Error
- **Steps:**
  1. Sign in with valid credentials
  2. Cause backend API to return 500 error (if test environment available)
  3. Try to load payment methods
- **Expected:** User-friendly error message about service unavailability
- **Should NOT:** Timeout error when backend responds quickly with error

### 4. Performance Tests

#### Test Scenario 1: Multiple Rapid Requests
- **Steps:**
  1. Navigate quickly between screens that trigger profile/payment loads
  2. Observe behavior
- **Expected:** No timeout errors, requests complete naturally
- **Previous Behavior:** Timeouts due to race conditions with custom timeout wrappers

## Unit Tests to Run

Once dependencies are installed:

```bash
npm run test:unit -- __tests__/unit/services/stripe-service.test.ts
```

The existing unit tests should pass without modification since they mock the network layer.

## Expected Improvements

1. **Profile Loading:** Should work reliably on slow networks (3G, edge cases)
2. **Payment Methods:** Should load successfully without premature timeouts
3. **Token Refresh:** Payment methods should reload smoothly on token changes
4. **Error Messages:** Should be more accurate (actual network errors vs premature timeouts)
5. **SDK Reliability:** Supabase and Stripe SDKs can use their built-in retry logic

## Rollback Plan

If issues arise, the commit can be reverted to restore the timeout wrappers:
```bash
git revert e61b4ed
```

However, this would bring back the timeout issues. A better approach would be to:
1. Investigate the specific SDK timeout that's too long
2. Configure SDK-level timeouts if available
3. Only add application-level timeouts as a last resort with proper cancellation
