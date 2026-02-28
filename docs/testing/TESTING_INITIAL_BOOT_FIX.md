# Testing Guide: Initial Boot Auth Issue Fix

## Overview
This fix addresses the issue where the app briefly shows the bounty app screen on initial boot before checking authentication. The fix ensures proper auth gating and prevents access to protected screens without authentication.

## Changes Summary
1. **app/index.tsx**: Enhanced auth gate with navigation guards and logging
2. **app/tabs/bounty-app.tsx**: Added auth guard to redirect unauthenticated users

## Testing Scenarios

### Scenario 1: Cold Start (First Time User)
**Purpose**: Verify app shows sign-in screen on very first launch

**Steps**:
1. Completely uninstall app from device (if previously installed)
2. Start development server: `npx expo start --clear`
3. Install and launch app on device
4. Observe the screens shown during initialization

**Expected Result**:
- Branded splash screen shows for ~1.5 seconds
- Loading spinner briefly appears
- Sign-in form is displayed
- NO flash of bounty app content

**Console Logs to Check**:
```
[index] Component mounted, auth state: { isLoading: true, hasSession: false, ... }
[index] Auth still loading, waiting...
[index] Rendering loading state
[index] No session found, showing sign-in form
[index] Rendering sign-in form
```

---

### Scenario 2: Sign In Without Remember Me
**Purpose**: Verify session is not persisted when remember me is unchecked

**Steps**:
1. Start from sign-in screen
2. Enter valid credentials
3. **DO NOT** check "Remember me" checkbox
4. Click "Sign In"
5. Verify you're logged in and can navigate the app
6. Close app completely (force quit / swipe away from app switcher)
7. Reopen app

**Expected Result**:
- On reopen, app shows sign-in screen again
- Previous session is NOT restored
- User must sign in again

**Console Logs to Check**:
```
[AuthSessionStorage] Remember me is false, no in-memory session, returning null
[index] No session found, showing sign-in form
```

---

### Scenario 3: Sign In With Remember Me
**Purpose**: Verify session persists when remember me is checked

**Steps**:
1. Start from sign-in screen
2. Enter valid credentials
3. **CHECK** "Remember me" checkbox
4. Click "Sign In"
5. Navigate around the app
6. Close app completely (force quit)
7. Reopen app

**Expected Result**:
- On reopen, app automatically logs in
- Shows bounty app directly (no sign-in screen)
- Previous session is restored

**Console Logs to Check**:
```
[AuthSessionStorage] Remember me is true, reading from secure storage
[index] Authenticated with complete profile, redirecting to main app
```

---

### Scenario 4: Metro Cache Clear (Issue Reproduction)
**Purpose**: Verify the original issue is fixed

**Steps**:
1. Have an active session (logged in with or without remember me)
2. Stop Expo dev server
3. Start with cleared cache: `npx expo start --clear`
4. Reload app (shake device → Reload)
5. Observe initial screen

**Expected Result**:
- If remember me was checked: stays logged in
- If remember me was NOT checked: shows sign-in screen
- NO flash of bounty app without authentication

**Note**: `--clear` only clears Metro bundler cache, not app data. To test "no remember me" scenario, you need to actually sign out or clear app data.

---

### Scenario 5: Direct Protected Route Access
**Purpose**: Verify auth guard prevents unauthorized access

**Steps**:
1. Ensure user is NOT authenticated (sign out if needed)
2. Try to navigate directly to a protected route
   - Via deep link (if configured)
   - Via programmatic navigation
   - Via URL manipulation (on web)

**Expected Result**:
- User is immediately redirected to index/sign-in screen
- Protected content is NOT shown

**Console Logs to Check**:
```
[bounty-app] Not authenticated, redirecting to index
```

---

## Debugging Tips

### Enable Verbose Logging
The fix includes comprehensive logging. Check the console for:
- `[index]` - Auth gate decisions
- `[bounty-app]` - Protected route access attempts
- `[AuthSessionStorage]` - Storage adapter behavior
- `[AuthProvider]` - Session management

### Common Issues

**Issue**: App still flashes bounty screen
- **Check**: Are console logs showing auth state properly?
- **Check**: Is `isLoading` false before navigation happens?
- **Action**: Review log sequence, may need to adjust timing

**Issue**: Can't sign in after clearing cache
- **Check**: Is Supabase properly configured?
- **Check**: Are credentials valid?
- **Action**: Check network requests, Supabase connection

**Issue**: Remember me not working
- **Check**: Console logs for "Remember me preference set to: true"
- **Check**: SecureStore permissions on device
- **Action**: Try on different device/simulator

---

## Manual Testing Checklist

- [ ] Scenario 1: Cold start shows sign-in (not bounty app)
- [ ] Scenario 2: Without remember me, session clears on app restart
- [ ] Scenario 3: With remember me, session persists on app restart  
- [ ] Scenario 4: Metro cache clear doesn't cause auth issues
- [ ] Scenario 5: Protected routes redirect to sign-in when not authenticated
- [ ] Console logs show expected flow in all scenarios
- [ ] No visual glitches or content flashes
- [ ] Sign out properly clears session

---

## Expected Console Log Flow (Cold Start, No Session)

```
[Splash] preparation...
[Mixpanel] init...
[AppEntry] expo-router entry imported
[AuthProvider] mounted
[AuthProvider] Session loaded: not authenticated
[index] Component mounted, auth state: { isLoading: true, hasSession: false, ... }
[index] Auth still loading, waiting...
[index] Rendering loading state
[AuthProvider] Profile update received, setting isLoading to false
[index] No session found, showing sign-in form
[index] Rendering sign-in form
```

---

## Rollback Plan

If issues persist or new problems arise:

1. Revert changes to `app/index.tsx` and `app/tabs/bounty-app.tsx`
2. Previous behavior will be restored
3. Report specific scenarios where issues occur with full console logs
4. Consider alternative approaches (e.g., layout-level auth guard)

---

## Success Criteria

✅ App never shows bounty screen without authentication
✅ Sign-in screen is first screen on cold start
✅ Remember me checkbox works as expected  
✅ No race conditions or visual glitches
✅ Console logs show proper initialization sequence
