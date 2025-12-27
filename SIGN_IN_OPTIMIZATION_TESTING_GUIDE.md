# Sign-In Speed Optimization - Testing Guide

## Overview
This guide provides detailed testing procedures to verify the sign-in speed optimizations and timeout fixes.

## Prerequisites

### Setup
1. Install dependencies: `npm install`
2. Ensure Supabase is configured with valid credentials
3. Have a test account ready (email + password)
4. Have an invalid password ready for testing

### Testing Devices
- iOS device or simulator
- Android device or emulator
- Both physical devices and simulators recommended

### Network Throttling Tools

#### iOS
**Network Link Conditioner:**
1. Download Additional Tools from Xcode preferences
2. Install Network Link Conditioner from `/Applications/Xcode.app/Contents/Applications/`
3. Profiles available:
   - 100% Loss (simulates no network)
   - 3G (slow network)
   - LTE (normal network)
   - WiFi (fast network)

#### Android
**Chrome DevTools Network Throttling:**
1. Enable Developer Options
2. Use ADB to set network conditions:
   ```bash
   adb shell settings put global airplane_mode_on 1
   adb shell am broadcast -a android.intent.action.AIRPLANE_MODE
   ```

#### Cross-Platform
**Charles Proxy:**
- Throttle bandwidth: 1 KB/s for slow, 10 KB/s for medium
- Simulate latency: 500ms-2000ms

## Test Scenarios

### Scenario 1: Normal Sign-In (Good Network)

**Setup:**
- Good WiFi or LTE connection
- No network throttling

**Steps:**
1. Open app to sign-in screen
2. Enter valid email and password
3. Tap "Sign In"

**Expected Results:**
- ✅ Sign-in completes in 2-4 seconds
- ✅ No loading spinner for more than 4 seconds
- ✅ User redirected to app immediately
- ✅ Console logs show: `[sign-in] Profile complete, redirecting to app`

**Metrics to Check:**
- Total time from tap to navigation: < 5 seconds
- Auth response time: < 2 seconds
- Profile check time: < 1 second

### Scenario 2: Invalid Credentials (Fast Fail)

**Setup:**
- Good network connection
- Invalid password or email

**Steps:**
1. Open app to sign-in screen
2. Enter valid email but WRONG password
3. Tap "Sign In"

**Expected Results:**
- ✅ Error appears in 1-2 seconds (NOT 15+ seconds)
- ✅ Error message: "Invalid email or password. Please try again."
- ✅ No retry attempt visible
- ✅ Console logs show auth attempt fails immediately

**Metrics to Check:**
- Time to error message: < 3 seconds
- No retry logged in console
- User can immediately retry

### Scenario 3: Slow Network

**Setup:**
- Throttle network to 3G speeds
- Add 500ms latency if possible

**Steps:**
1. Open app to sign-in screen
2. Enter valid credentials
3. Tap "Sign In"

**Expected Results:**
- ✅ Sign-in completes or times out within 18 seconds
- ✅ If timeout occurs, clear error message shown
- ✅ Loading indicator visible throughout
- ✅ No app freeze or unresponsive UI

**Metrics to Check:**
- Maximum wait time: < 18 seconds
- Clear timeout error if it occurs
- App remains responsive

### Scenario 4: Profile Check Timeout

**Setup:**
- Good network for auth
- Simulate slow database query (if possible) or use slow network

**Steps:**
1. Sign in with valid credentials
2. Let profile check timeout

**Expected Results:**
- ✅ User still gets redirected to app (doesn't get stuck)
- ✅ Console shows: `[sign-in] Profile check timeout/error, proceeding to app`
- ✅ AuthProvider syncs profile in background
- ✅ App is usable even if profile data loads slowly

**Metrics to Check:**
- User not blocked from accessing app
- Profile eventually loads in background
- No errors shown to user

### Scenario 5: Google Sign-In

**Setup:**
- Google Sign-In configured
- Good network

**Steps:**
1. Tap "Continue with Google"
2. Complete Google OAuth flow
3. Return to app

**Expected Results:**
- ✅ Total flow completes in < 15 seconds
- ✅ Profile check doesn't block user
- ✅ User redirected to app or onboarding
- ✅ No timeout errors

**Metrics to Check:**
- Profile check: < 3 seconds
- Total flow: < 15 seconds
- Graceful fallback on profile check timeout

### Scenario 6: Apple Sign-In (iOS only)

**Setup:**
- Apple Sign-In configured
- iOS device
- Good network

**Steps:**
1. Tap "Sign in with Apple"
2. Complete Apple authentication
3. Return to app

**Expected Results:**
- ✅ Similar to Google sign-in
- ✅ Fast profile check (< 3 seconds)
- ✅ No blocking on profile fetch
- ✅ User can access app

**Metrics to Check:**
- Same as Google sign-in
- Total time < 15 seconds

### Scenario 7: Sign-Out (Normal)

**Setup:**
- User is signed in
- Good network

**Steps:**
1. Navigate to Settings
2. Tap "Logout" or sign-out button
3. Observe behavior

**Expected Results:**
- ✅ Sign-out completes in < 2 seconds
- ✅ User redirected to auth screen
- ✅ No hanging or freezing
- ✅ Session cleared

**Metrics to Check:**
- Sign-out time: < 2 seconds
- No timeout errors
- Clean session cleanup

### Scenario 8: Sign-Out Timeout

**Setup:**
- Throttle network to very slow speeds
- Or disconnect network entirely

**Steps:**
1. Navigate to Settings
2. Tap "Logout"
3. Wait for timeout

**Expected Results:**
- ✅ Sign-out completes via local logout after 10 seconds
- ✅ User still gets signed out (not stuck)
- ✅ Console shows: `[Logout] Supabase signout timeout, forcing local logout`
- ✅ User redirected to auth screen

**Metrics to Check:**
- Maximum wait: 10 seconds
- Local logout fallback works
- User successfully signed out

### Scenario 9: Intermittent Network

**Setup:**
- Toggle airplane mode on/off during sign-in
- Or use Charles Proxy to drop packets

**Steps:**
1. Start sign-in process
2. Toggle network off during auth
3. Toggle back on

**Expected Results:**
- ✅ Either completes successfully or shows clear error
- ✅ No indefinite hanging
- ✅ User can retry
- ✅ Proper error message about network

**Metrics to Check:**
- Clear error messaging
- Retry ability maintained
- No app crash

### Scenario 10: First-Time User (Onboarding)

**Setup:**
- New account without profile
- Good network

**Steps:**
1. Sign up or sign in with new account
2. Complete auth flow

**Expected Results:**
- ✅ User redirected to onboarding/username screen
- ✅ Quick decision (< 5 seconds)
- ✅ Profile check detects missing profile
- ✅ Smooth transition to onboarding

**Metrics to Check:**
- Profile check: < 3 seconds
- Correct routing to onboarding
- No timeout errors

## Console Log Analysis

### Expected Log Pattern (Successful Sign-In)

```
[sign-in] Starting sign-in process
[sign-in] Supabase configured: { hasUrl: true, hasKey: true, ... }
[sign-in] Attempting to sign in (email redacted for production)
[sign-in] Auth attempt 1/2 with timeout 15000ms
[sign-in] Calling supabase.auth.signInWithPassword...
[sign-in] Auth response received: { hasData: true, hasError: false, ... }
[sign-in] Authentication successful
[sign-in] Performing quick profile check for: <user-id>
[sign-in] Profile complete, redirecting to app
```

**Key Metrics:**
- Auth attempt to response: < 2 seconds
- Profile check: < 1 second
- Total: < 4 seconds

### Expected Log Pattern (Invalid Credentials)

```
[sign-in] Starting sign-in process
[sign-in] Auth attempt 1/2 with timeout 15000ms
[sign-in] Auth response received: { hasData: false, hasError: true, errorMessage: 'Invalid login credentials' }
[sign-in] Authentication error: { message: 'Invalid login credentials' }
```

**Key Metrics:**
- Error appears immediately (< 2 seconds)
- No retry attempt
- Clear error message

### Expected Log Pattern (Timeout)

```
[sign-in] Auth attempt 1/2 with timeout 15000ms
[sign-in] Attempt 1 failed: Network request timed out after 15000ms
[sign-in] Retrying in 1000ms...
[sign-in] Auth attempt 2/2 with timeout 15000ms
[sign-in] Attempt 2 failed: Network request timed out after 15000ms
[sign-in] Sign-in error: Request is taking longer than expected...
```

**Key Metrics:**
- First timeout at 15 seconds
- Retry after 1 second
- Second timeout at 15 seconds
- Total: ~31 seconds (significantly better than 60+ seconds before)

## Performance Benchmarks

### Target Metrics

| Scenario | Previous | Target | Status |
|----------|----------|--------|--------|
| Normal sign-in | 40-50s | < 5s | Test needed |
| Invalid credentials | 30-60s | < 2s | Test needed |
| Sign-out | No timeout | < 2s | Test needed |
| Sign-out timeout | Hangs | < 10s | Test needed |
| Profile check | 10s | < 3s | Test needed |
| Google/Apple auth | 20-30s | < 15s | Test needed |

### Success Criteria

✅ **Must Pass:**
- Normal sign-in < 5 seconds on good network
- Invalid credentials fail in < 3 seconds
- Sign-out never hangs (< 10 seconds worst case)
- No app crashes or freezes

✅ **Should Pass:**
- 95% of sign-ins complete in < 5 seconds
- Timeout errors reduced by 80%
- User can always retry after error
- Profile check doesn't block app access

## Regression Testing

Ensure these existing features still work:

1. ✅ Remember me checkbox functionality
2. ✅ Forgot password link
3. ✅ Email verification flow
4. ✅ Age verification on signup
5. ✅ Social auth (Google, Apple)
6. ✅ Profile creation on first sign-in
7. ✅ Session persistence across app restarts
8. ✅ Mixpanel/analytics tracking

## Known Issues to Verify

1. **Issue from video:** Timeouts occurring despite correct credentials
   - ✅ Should be fixed with reduced timeouts and optimized profile check

2. **Issue mentioned:** Sign-out hanging
   - ✅ Should be fixed with timeout protection and local fallback

## Reporting Results

### Template for Test Results

```markdown
## Test Results - [Date]

**Tester:** [Name]
**Device:** [iOS 17.5 / Android 14]
**Network:** [WiFi / LTE / 3G]

### Scenario 1: Normal Sign-In
- Result: ✅ Pass / ❌ Fail
- Time: X seconds
- Notes: [Any observations]

### Scenario 2: Invalid Credentials
- Result: ✅ Pass / ❌ Fail
- Time: X seconds
- Notes: [Any observations]

[Continue for all scenarios...]

### Summary
- Overall: ✅ All tests pass / ❌ X tests failed
- Performance: Improved / Same / Worse
- Recommendation: Ship / More work needed
```

## Troubleshooting

### If sign-in is still slow:
1. Check console logs for actual timings
2. Verify network connection is actually good
3. Check Supabase service status
4. Look for other network-heavy operations

### If tests fail:
1. Verify dependencies are installed (`npm install`)
2. Check Supabase configuration
3. Ensure test account exists
4. Review console logs for errors

### If timeouts still occur:
1. Check if it's a Supabase service issue
2. Verify network conditions
3. Look for database query performance issues
4. Consider further timeout reduction

## Next Steps

After completing testing:

1. ✅ Document all test results
2. ✅ Create GitHub issue for any failures
3. ✅ Update performance metrics
4. ✅ Deploy to production if all tests pass
5. ✅ Monitor real-world performance
6. ✅ Gather user feedback

## Additional Notes

- Focus on the scenarios that match the reported issue
- Invalid credentials test is critical (proves auth is fast)
- Sign-out timeout test ensures the fix works
- Document any edge cases discovered

## Contact

For questions or issues during testing:
- Create an issue on GitHub
- Tag @copilot for AI assistance
- Document all findings for future reference
