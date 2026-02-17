# Manual Testing Guide for "Remember Me" Fix

## Issue
Beta tester reported being prompted to sign in despite checking "Remember Me" on previous session.

## Root Cause
Race condition in `getRememberMePreference()` during app cold start where multiple concurrent calls could lead to inconsistent results.

## Fix
Implemented promise-based mutex to ensure only one SecureStore read happens at a time, with all concurrent callers waiting for the same result.

## Test Scenarios

### Scenario 1: Happy Path - Remember Me Checked
**Steps:**
1. Launch app (cold start)
2. Navigate to sign-in screen
3. Enter valid email and password
4. **Check "Remember me"** checkbox
5. Tap "Sign In"
6. Verify successful login → redirected to main app
7. **Force quit the app** (swipe away from recent apps)
8. **Relaunch the app** (cold start)

**Expected Result:**
- User should be automatically signed in WITHOUT seeing the login screen
- User should land directly on the main app screen

**CRITICAL**: Step 8 is where the bug occurred. User should NOT see login screen.

---

### Scenario 2: Remember Me Unchecked
**Steps:**
1. Launch app (cold start)
2. Navigate to sign-in screen
3. Enter valid email and password
4. **Leave "Remember me" checkbox unchecked**
5. Tap "Sign In"
6. Verify successful login → redirected to main app
7. **Force quit the app** (swipe away from recent apps)
8. **Relaunch the app** (cold start)

**Expected Result:**
- User should see the login screen
- User should need to enter credentials again

---

### Scenario 3: Remember Me → Logout → Sign In Again
**Steps:**
1. Sign in with "Remember me" checked (as in Scenario 1)
2. Navigate to Settings/Profile
3. Tap "Sign Out" / "Logout"
4. Verify redirected to login screen
5. **Force quit the app**
6. **Relaunch the app**
7. Observe login screen (expected)
8. Sign in again with "Remember me" checked
9. **Force quit the app**
10. **Relaunch the app**

**Expected Result:**
- Step 6: User should see login screen (preference was cleared on logout)
- Step 10: User should be auto-signed in (preference was set again on step 8)

---

### Scenario 4: Social Auth (Google/Apple) - Auto Remember Me
**Steps:**
1. Launch app
2. Tap "Continue with Google" (or "Continue with Apple" on iOS)
3. Complete OAuth flow
4. Verify successful login
5. **Force quit the app**
6. **Relaunch the app**

**Expected Result:**
- User should be automatically signed in (social auth defaults to Remember Me = true)

---

### Scenario 5: Slow Network / SecureStore Errors
**Steps:**
1. Enable airplane mode or use network throttling
2. Launch app (cold start)
3. Wait 5-10 seconds
4. Disable airplane mode
5. Wait for app to initialize

**Expected Result:**
- If previously signed in with Remember Me, should eventually restore session
- Should not show login screen prematurely due to race condition
- May show loading indicator while network recovers

---

### Scenario 6: Multiple Rapid Cold Starts (Race Condition Test)
**Steps:**
1. Sign in with "Remember me" checked
2. Force quit app
3. Relaunch app **immediately**
4. **Before app fully loads**, force quit again
5. Relaunch app
6. Repeat steps 3-5 three more times

**Expected Result:**
- User should eventually be auto-signed in
- Should NOT get stuck in a state where login is always required

---

## Test Devices
- [ ] iOS (iPhone) - physical device
- [ ] iOS (iPhone) - simulator
- [ ] Android (phone) - physical device
- [ ] Android (phone) - emulator

## Test Conditions
- [ ] Good network connection
- [ ] Slow network (throttled)
- [ ] No network → then network restored
- [ ] Immediately after device restart
- [ ] After device has been running for hours

## Logging
Watch for these console logs during testing:

**Sign in with Remember Me = true:**
```
[sign-in] Setting remember me preference: true
[AuthSessionStorage] Remember me preference set to: true (cached in memory and persisted to secure storage)
[AuthSessionStorage] Remember me is true, persisting session to secure storage
```

**App cold start with Remember Me = true:**
```
[AuthSessionStorage] Starting new preference read from SecureStore
[AuthSessionStorage] Preference read from SecureStore: true
[AuthSessionStorage] Remember me is true, reading from secure storage
[AuthProvider] Session loaded: authenticated
```

**Race condition (multiple concurrent reads):**
```
[AuthSessionStorage] Starting new preference read from SecureStore
[AuthSessionStorage] Waiting for in-flight preference read to complete
[AuthSessionStorage] Waiting for in-flight preference read to complete
[AuthSessionStorage] Preference read from SecureStore: true
```

## Success Criteria
- ✅ User with "Remember Me" checked is auto-signed in on every app restart
- ✅ User with "Remember Me" unchecked sees login screen on every app restart
- ✅ No race condition errors in logs
- ✅ Consistent behavior across multiple rapid cold starts
- ✅ Works on both iOS and Android
- ✅ Works with email/password and social auth

## Failure Indicators
- ❌ User with "Remember Me" checked sees login screen after restart
- ❌ Inconsistent behavior (sometimes works, sometimes doesn't)
- ❌ Errors in logs about SecureStore failures
- ❌ Multiple "Starting new preference read" logs in rapid succession
