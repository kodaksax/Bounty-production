# Authentication State Persistence Implementation

## Overview
This document describes the implementation of authentication state persistence in BOUNTYExpo, ensuring users remain logged in across app restarts and handling token refresh automatically.

## Problem Statement
Previously, the app had two critical issues:
1. Users would always see the login screen (`SignInForm`) regardless of whether a valid session existed in SecureStore
2. **Race condition bug**: Users who completed onboarding were incorrectly routed to the onboarding flow on app refresh due to profile loading race condition

### The Race Condition
The race condition occurred because:
1. Session loaded and `isLoading` became `false`
2. Profile subscription fired immediately with `null` (before async profile fetch completed)
3. `index.tsx` checked auth state, saw `profile = null`, and incorrectly redirected to onboarding
4. This caused users to lose their account progress on every app refresh

## Solution Components

### 1. App Entry Point (`app/index.tsx`)

**Changes:**
- Added authentication state checking before rendering the login form
- Implemented loading state while checking authentication
- Added automatic redirection based on auth state and profile completion
- Shows loading spinner during authentication check and redirection
- **Fixed race condition**: Now uses `profile` from auth context instead of direct `authProfileService.getCurrentProfile()` call

**Flow:**
1. Check if authentication is loading (`isLoading`)
2. If still loading, show loading spinner
3. If authenticated (`session` exists):
   - Check if user has completed profile/onboarding using `profile` from context
   - Redirect to onboarding if profile incomplete or missing username
   - Redirect to main app if profile complete
4. If not authenticated, show `SignInForm`

### 2. Auth Provider (`providers/auth-provider.tsx`)

**Changes:**
- Added proactive token refresh mechanism
- Implemented scheduled refresh timer (5 minutes before expiration)
- Enhanced session restoration on app startup
- Added better error handling for refresh failures
- **NEW: Profile fetch synchronization** - Added `profileFetchCompletedRef` to track when profile loading completes
- **NEW: Loading state coordination** - Ensures `isLoading` stays `true` until BOTH session and profile are loaded

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
- **NEW: Waits for profile to load before setting `isLoading = false`**

#### Profile Loading Synchronization
```typescript
const profileFetchCompletedRef = useRef<boolean>(false);
```

- Tracks whether the initial profile fetch has completed
- Profile subscription only sets `isLoading = false` after fetch completes
- Prevents race condition where profile is null during initial load
- Resets on authentication state changes (SIGNED_IN, SIGNED_OUT)

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
Load Session from SecureStore
  ↓
├─ Session Found
│   ↓
│   Fetch User Profile (await)
│   ↓
│   Profile Loaded → isLoading = false
│   ↓
│   Check Profile Complete
│   ├─ Has username → Navigate to /tabs/bounty-app
│   └─ No username → Navigate to /onboarding/username
│
└─ No Session
    ↓
    isLoading = false
    ↓
    Show SignInForm
```

### Race Condition Prevention
The fix ensures proper sequencing:
1. **Session loads** via `supabase.auth.getSession()`
2. **Profile fetch starts** via `authProfileService.setSession(session)` (awaited)
3. **`profileFetchCompletedRef.current` set to `true`** after fetch completes
4. **Profile subscription fires** with loaded profile data
5. **`isLoading` set to `false`** only after profile is available
6. **`index.tsx` effect runs** with correct profile data
7. **User routed correctly** based on profile completion

Without this fix:
1. Session loads
2. `isLoading` becomes `false` immediately
3. Profile subscription fires with `null` (before fetch)
4. `index.tsx` sees `profile = null`, routes to onboarding
5. Profile fetch completes (too late)
6. User stuck in onboarding despite having completed it

## Testing

### Integration Tests (`__tests__/integration/auth-persistence.test.tsx`)

Test coverage includes:
1. **Session Restoration:**
   - Valid session restoration from storage
   - Missing session handling
   - Corrupted session data handling

2. **Profile Loading Race Condition:**
   - Verification that `isLoading` waits for profile load
   - Handling of profile fetch failures
   - Proper synchronization of session and profile loading

3. **Automatic Token Refresh:**
   - Scheduled refresh before expiration
   - Immediate refresh for expired tokens
   - Refresh failure handling

4. **Session Expiration:**
   - Session clearing on refresh failure
   - SIGNED_OUT event triggering

5. **Auth State Events:**
   - SIGNED_IN event handling
   - TOKEN_REFRESHED event handling
   - Proper timer management

### Manual Testing Checklist
- [ ] **Existing User Flow**: User with completed profile remains logged in after app restart and goes directly to bounty app screen
- [ ] **Race Condition Fix**: No momentary flash of onboarding screen for existing users on refresh
- [ ] **New User Flow**: New user without profile is directed to onboarding flow
- [ ] **Profile Completion**: User completing onboarding is correctly routed to bounty app
- [ ] Token refresh happens automatically (check console logs)
- [ ] Session expiration shows appropriate alert
- [ ] Navigation to correct screen based on profile completion
- [ ] Loading states display correctly during auth check
- [ ] Sign out clears session and shows login form
- [ ] New sign in works and navigates appropriately
- [ ] **Profile Loading**: Console logs show "Profile update received, setting isLoading to false" with correct profile data

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
