# Authentication State Persistence Implementation

## Overview
This document describes the implementation of authentication state persistence in BOUNTYExpo, ensuring users remain logged in across app restarts and handling token refresh automatically.

## Problem Statement
Previously, the app would always show the login screen (`SignInForm`) regardless of whether a valid session existed in SecureStore. Users had to log in every time they opened the app, even though Supabase was configured to persist sessions.

## Solution Components

### 1. App Entry Point (`app/index.tsx`)

**Changes:**
- Added authentication state checking before rendering the login form
- Implemented loading state while checking authentication
- Added automatic redirection based on auth state and profile completion
- Shows loading spinner during authentication check and redirection

**Flow:**
1. Check if authentication is loading (`isLoading`)
2. If still loading, show loading spinner
3. If authenticated (`session` exists):
   - Check if user has completed profile/onboarding
   - Redirect to onboarding if profile incomplete
   - Redirect to main app if profile complete
4. If not authenticated, show `SignInForm`

### 2. Auth Provider (`providers/auth-provider.tsx`)

**Changes:**
- Added proactive token refresh mechanism
- Implemented scheduled refresh timer (5 minutes before expiration)
- Enhanced session restoration on app startup
- Added better error handling for refresh failures

**Key Features:**

#### Automatic Token Refresh
```typescript
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
```

- Schedules refresh 5 minutes before token expiration
- Refreshes immediately if token is already expired
- Clears and reschedules timer on new session events

#### Session Restoration
- Loads session from SecureStore on app startup via `supabase.auth.getSession()`
- Handles errors gracefully, setting session to `null` on failure
- Schedules token refresh immediately if valid session found

#### Event Handling
- `SIGNED_IN`: Schedules token refresh, tracks analytics
- `TOKEN_REFRESHED`: Reschedules next refresh
- `SIGNED_OUT`: Clears refresh timer, resets analytics
- `USER_UPDATED`: Tracks email verification events

### 3. Auth Context Hook (`hooks/use-auth-context.tsx`)

**Status:** No changes required. The existing hook already provides:
- `session`: Current session object or null
- `isLoading`: Boolean indicating auth state is being determined
- `profile`: User profile data
- `isLoggedIn`: Boolean shorthand for session existence
- `isEmailVerified`: Boolean for email verification status

## Technical Details

### Session Storage
- Uses `expo-secure-store` (already configured in `lib/supabase.ts`)
- iOS: Stored with `AFTER_FIRST_UNLOCK` accessibility for background refresh
- Supabase client configured with:
  - `autoRefreshToken: true`
  - `persistSession: true`
  - `detectSessionInUrl: false`

### Token Refresh Strategy
1. **Proactive Refresh:** Token refreshed 5 minutes before expiration
2. **Immediate Refresh:** If token already expired on load
3. **Automatic Retry:** Supabase client also has built-in auto-refresh
4. **Failure Handling:** On refresh failure, session cleared and user shown login

### Navigation Flow
```
App Start
  ↓
Check Auth State (isLoading = true)
  ↓
├─ Session Found
│   ↓
│   Check Profile Complete
│   ├─ Yes → Navigate to /tabs/bounty-app
│   └─ No → Navigate to /onboarding/username
│
└─ No Session → Show SignInForm
```

## Testing

### Integration Tests (`__tests__/integration/auth-persistence.test.tsx`)

Test coverage includes:
1. **Session Restoration:**
   - Valid session restoration from storage
   - Missing session handling
   - Corrupted session data handling

2. **Automatic Token Refresh:**
   - Scheduled refresh before expiration
   - Immediate refresh for expired tokens
   - Refresh failure handling

3. **Session Expiration:**
   - Session clearing on refresh failure
   - SIGNED_OUT event triggering

4. **Auth State Events:**
   - SIGNED_IN event handling
   - TOKEN_REFRESHED event handling
   - Proper timer management

### Manual Testing Checklist
- [ ] User remains logged in after app restart
- [ ] Token refresh happens automatically (check console logs)
- [ ] Session expiration shows appropriate alert
- [ ] Navigation to correct screen based on profile completion
- [ ] Loading states display correctly during auth check
- [ ] Sign out clears session and shows login form
- [ ] New sign in works and navigates appropriately

## Benefits

1. **Better User Experience:** Users stay logged in across app restarts
2. **Seamless Token Management:** Automatic refresh prevents session interruptions
3. **Graceful Degradation:** Clear error handling and user feedback
4. **Security:** Tokens refresh proactively, minimizing expired token exposure
5. **Performance:** Avoids unnecessary re-authentication requests

## Configuration

No additional configuration required. The implementation uses existing Supabase configuration from environment variables:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Debugging

### Console Logs
The implementation includes detailed console logs (prefixed with `[AuthProvider]`):
- Session loading status
- Token refresh scheduling
- Refresh attempts and results
- Auth state change events

### Common Issues

**Issue:** User still sees login screen after restart
- Check: Is Supabase properly configured?
- Check: Are environment variables set?
- Check: Console logs for session loading errors

**Issue:** Token refresh not happening
- Check: Session has valid `expires_at` timestamp
- Check: Console logs for refresh scheduling
- Check: Timer not being cleared prematurely

## Future Enhancements

Potential improvements for future iterations:
1. Retry logic with exponential backoff for failed refreshes
2. Offline token caching with timestamp validation
3. Biometric re-authentication for sensitive actions
4. Session health monitoring and reporting
5. Multi-device session management

## Related Files

- `app/index.tsx` - Entry point with auth gate
- `providers/auth-provider.tsx` - Auth provider with token refresh
- `hooks/use-auth-context.tsx` - Auth context hook
- `lib/supabase.ts` - Supabase client configuration
- `hooks/useSessionMonitor.ts` - Session expiration monitoring
- `lib/utils/session-handler.ts` - Session utilities
- `__tests__/integration/auth-persistence.test.tsx` - Integration tests

## References

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Expo SecureStore Documentation](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [React Context Documentation](https://react.dev/reference/react/useContext)
