# Sign-In Timeout Fix - Testing Guide

> **⚠️ DOCUMENTATION NOTE:** Test expectations below reference initial timeout values (20s).
> **ACTUAL IMPLEMENTATION:** AUTH_TIMEOUT = 30s, adjust test expectations accordingly.
> **Updated expectations:** First timeout ~30s, Total max time ~62s with retries.

## Overview
This guide provides test scenarios to verify the sign-in timeout fixes work correctly across different network conditions and edge cases.

## Test Environment Setup

### Prerequisites
- Expo app installed on physical device or simulator
- Access to network throttling tools:
  - iOS: Settings > Developer > Network Link Conditioner
  - Android: Chrome DevTools > Network > Throttling
  - Charles Proxy / Network Link Conditioner app

### Test Users
- Valid user: `test@example.com` / `password123`
- Invalid user: `wrong@example.com` / `wrongpass`
- New user: Use sign-up flow

## Test Scenarios

### 1. Normal Network Conditions (Good Connection)

**Objective**: Verify sign-in works smoothly on good network

**Steps**:
1. Open app on sign-in screen
2. Enter valid credentials
3. Tap "Sign In"

**Expected Results**:
- ✅ Sign-in completes in 1-3 seconds
- ✅ No error messages
- ✅ Redirects to app home screen or onboarding (if new user)
- ✅ Console logs show:
  ```
  [sign-in] Starting sign-in process
  [sign-in] Attempting to sign in with email: test@example.com
  [sign-in] Auth attempt 1/2
  [sign-in] Authentication successful
  [sign-in] Checking user profile for: <user-id>
  [sign-in] Profile complete, redirecting to app
  ```

**Pass/Fail**: ___

---

### 2. Slow Network (5-10 seconds response time)

**Objective**: Verify timeout handling on slow but functional network

**Setup**: Enable network throttling (Slow 3G or custom 5-10s latency)

**Steps**:
1. Open app on sign-in screen
2. Enter valid credentials
3. Tap "Sign In"
4. Observe loading indicator and wait

**Expected Results**:
- ✅ Loading indicator shows continuously
- ✅ First attempt completes or times out at ~20 seconds
- ✅ If timeout, retry happens automatically
- ✅ Sign-in succeeds within total ~41 seconds maximum
- ✅ Console logs show:
  ```
  [sign-in] Auth attempt 1/2
  [sign-in] Attempt 1 failed: Network request timed out
  [sign-in] Retrying in 1000ms...
  [sign-in] Auth attempt 2/2
  [sign-in] Authentication successful
  ```

**Pass/Fail**: ___

---

### 3. Very Slow Network (15-20 seconds response time)

**Objective**: Verify graceful timeout after retries

**Setup**: Enable very slow network throttling (offline → online with 20s delay)

**Steps**:
1. Open app on sign-in screen
2. Enter valid credentials
3. Tap "Sign In"
4. Wait for full timeout period

**Expected Results**:
- ✅ First attempt times out at ~20 seconds
- ✅ Retry happens after 1 second
- ✅ Second attempt times out at ~20 seconds
- ✅ Error message displayed: 
  ```
  "Sign-in is taking longer than expected. This might be due to slow network or server issues. Please try again."
  ```
- ✅ "Try Again" button is available
- ✅ Total time: ~41 seconds before error
- ✅ User can retry manually

**Pass/Fail**: ___

---

### 4. No Network Connection (Offline)

**Objective**: Verify immediate offline error detection

**Setup**: Enable Airplane mode or disable all network connections

**Steps**:
1. Open app on sign-in screen
2. Enter valid credentials
3. Tap "Sign In"
4. Observe behavior

**Expected Results**:
- ✅ First attempt times out at ~20 seconds
- ✅ Network check detects no connection
- ✅ Error message displayed immediately:
  ```
  "No internet connection. Please check your network and try again."
  ```
- ✅ No unnecessary retry attempt (since network is down)
- ✅ Clear indication of the problem
- ✅ Console shows:
  ```
  [sign-in] Auth attempt 1/2
  [sign-in] Attempt 1 failed: Network request timed out
  [sign-in] No internet connection detected
  ```

**Pass/Fail**: ___

---

### 5. Intermittent Network (Drops during request)

**Objective**: Verify handling of network that drops mid-request

**Setup**: 
1. Start with good network
2. Initiate sign-in
3. Disable network after ~5 seconds

**Steps**:
1. Open app on sign-in screen
2. Enter valid credentials
3. Tap "Sign In"
4. After 5 seconds, enable airplane mode
5. Observe behavior

**Expected Results**:
- ✅ Request times out (no response received)
- ✅ Network check detects connection is now down
- ✅ Error message: "No internet connection. Please check your network and try again."
- ✅ No automatic retry (network is down)

**Pass/Fail**: ___

---

### 6. Invalid Credentials

**Objective**: Verify auth errors are handled separately from timeout errors

**Steps**:
1. Open app on sign-in screen
2. Enter invalid credentials (wrong@example.com / wrongpass)
3. Tap "Sign In"

**Expected Results**:
- ✅ Sign-in attempt completes quickly (< 5 seconds)
- ✅ Error message: "Invalid email or password. Please try again."
- ✅ No timeout error
- ✅ User can try again immediately
- ✅ After 5 failed attempts within short time:
  ```
  "Too many failed attempts. Please try again in 5 minutes."
  ```

**Pass/Fail**: ___

---

### 7. Google Sign-In (Normal Network)

**Objective**: Verify social auth also has timeout handling

**Steps**:
1. Open app on sign-in screen
2. Tap "Continue with Google"
3. Complete Google authentication
4. Wait for redirect

**Expected Results**:
- ✅ Google OAuth flow completes normally
- ✅ Token exchange with Supabase succeeds (< 15s)
- ✅ Profile check succeeds (< 8s)
- ✅ Redirects to app or onboarding
- ✅ No timeout errors

**Pass/Fail**: ___

---

### 8. Google Sign-In (Slow Network)

**Objective**: Verify social auth timeout handling

**Setup**: Enable network throttling

**Steps**:
1. Open app on sign-in screen
2. Tap "Continue with Google"
3. Complete Google authentication
4. Wait during slow token exchange

**Expected Results**:
- ✅ Google OAuth completes
- ✅ Token exchange times out if > 15s
- ✅ Error message: "Google sign-in timed out. Please try again."
- ✅ User can retry
- ✅ If profile check times out, proceeds to app anyway (graceful fallback)

**Pass/Fail**: ___

---

### 9. Apple Sign-In (iOS only)

**Objective**: Verify Apple auth timeout handling

**Steps**:
1. Open app on sign-in screen (iOS device)
2. Tap "Sign in with Apple"
3. Complete Apple authentication
4. Wait for redirect

**Expected Results**:
- ✅ Apple OAuth flow completes normally
- ✅ Token exchange with Supabase succeeds (< 15s)
- ✅ Profile check succeeds (< 8s)
- ✅ Redirects to app or onboarding
- ✅ Timeout handling same as Google if network is slow

**Pass/Fail**: ___

---

### 10. Sign-Up Flow (Normal Network)

**Objective**: Verify sign-up also has timeout handling

**Steps**:
1. Open app on sign-in screen
2. Tap "Create an account"
3. Enter valid email, password, confirm password
4. Check age verification and terms boxes
5. Tap "Sign Up"

**Expected Results**:
- ✅ Sign-up completes in < 5 seconds
- ✅ Redirects to email confirmation screen
- ✅ No timeout errors
- ✅ Confirmation email sent

**Pass/Fail**: ___

---

### 11. Sign-Up Flow (Slow Network)

**Objective**: Verify sign-up timeout handling

**Setup**: Enable network throttling

**Steps**:
1. Open app on sign-in screen
2. Tap "Create an account"
3. Enter valid credentials
4. Tap "Sign Up"
5. Wait during slow request

**Expected Results**:
- ✅ Request times out after ~20 seconds if too slow
- ✅ Error message: "Sign-up is taking longer than expected. Please check your internet connection and try again."
- ✅ User can retry
- ✅ Form data is preserved (doesn't clear on error)

**Pass/Fail**: ___

---

### 12. Profile Check Timeout Fallback

**Objective**: Verify graceful handling when profile check times out

**Setup**: 
1. Sign in with valid credentials
2. Artificially slow down profile check (if possible) or use very slow network

**Steps**:
1. Sign in with valid user
2. Wait as profile check proceeds
3. Observe if profile check times out

**Expected Results**:
- ✅ If profile check times out (> 8s), still proceeds to app
- ✅ No blocking error
- ✅ Console shows:
  ```
  [sign-in] Profile check timeout or error
  [sign-in] Proceeding to app despite profile check error
  ```
- ✅ AuthProvider will sync profile in background
- ✅ User can use app normally

**Pass/Fail**: ___

---

### 13. Global Supabase Timeout

**Objective**: Verify global fetch timeout prevents hanging

**Setup**: 
1. Simulate very slow or non-responsive backend (> 30s)
2. Requires network proxy or API mocking

**Steps**:
1. Configure network to delay responses by 35+ seconds
2. Attempt any Supabase operation (sign-in, database query, etc.)
3. Observe behavior

**Expected Results**:
- ✅ Request automatically aborts after 30 seconds (global timeout)
- ✅ No indefinite hanging
- ✅ Error is caught and handled
- ✅ User sees appropriate error message

**Pass/Fail**: ___

---

## Console Log Verification

During all tests, monitor console logs for proper logging:

### Good Logs (Example)
```
[sign-in] Starting sign-in process
[sign-in] Attempting to sign in with email: user@example.com
[sign-in] Auth attempt 1/2
[sign-in] Authentication successful
[sign-in] Checking user profile for: abc-123-def
[sign-in] Profile complete, redirecting to app
```

### Retry Logs (Example)
```
[sign-in] Auth attempt 1/2
[sign-in] Attempt 1 failed: Network request timed out
[sign-in] Retrying in 1000ms...
[sign-in] Auth attempt 2/2
[sign-in] Authentication successful
```

### Error Logs (Example)
```
[sign-in] Auth attempt 1/2
[sign-in] Attempt 1 failed: Network request timed out
[sign-in] Retrying in 1000ms...
[sign-in] Auth attempt 2/2
[sign-in] Attempt 2 failed: Network request timed out
[sign-in] Sign-in error: Error: Sign-in is taking longer than expected...
```

## Performance Benchmarks

Record actual times for comparison:

| Scenario | Expected Time | Actual Time | Pass/Fail |
|----------|--------------|-------------|-----------|
| Normal sign-in | 1-3s | ___s | ___ |
| Slow network (first timeout) | ~20s | ___s | ___ |
| Slow network (with retry) | ~41s max | ___s | ___ |
| No network (error) | ~21s | ___s | ___ |
| Profile check | < 8s | ___s | ___ |
| Google sign-in | < 15s | ___s | ___ |
| Sign-up | < 20s | ___s | ___ |

## Known Issues / Limitations

- [ ] Global Supabase timeout cannot be easily tested without backend control
- [ ] Intermittent network testing requires manual network toggling
- [ ] Some timing values may vary by device/OS
- [ ] Supabase backend response times vary

## Test Sign-Off

**Tester Name**: _______________

**Date**: _______________

**Environment**: 
- Device: _______________
- OS: _______________
- App Version: _______________

**Overall Result**: ☐ Pass ☐ Fail ☐ Partial

**Notes**:
_______________________________________________
_______________________________________________
_______________________________________________

**Critical Issues Found**:
_______________________________________________
_______________________________________________
_______________________________________________

**Recommendations**:
_______________________________________________
_______________________________________________
_______________________________________________
