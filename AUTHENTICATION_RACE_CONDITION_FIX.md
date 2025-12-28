# Authentication Race Condition Fix

> **⚠️ SUPERSEDED**: This document describes a previous fix attempt. The final solution is documented in [AUTH_ROLLBACK_GUIDE.md](./AUTH_ROLLBACK_GUIDE.md), which makes the loading state completely independent of profile fetch operations.

## Issue Summary

**Problem**: Users who completed account registration and onboarding were incorrectly redirected to the onboarding flow after app refresh, effectively "erasing" their account progress.

**Impact**: Critical user experience issue causing frustration and preventing users from accessing the app after registration.

**Root Cause**: Race condition between session loading and profile fetching in the authentication initialization flow.

**Current Status**: RESOLVED - See AUTH_ROLLBACK_GUIDE.md for the implemented solution that makes profile loading non-blocking.

---

## Technical Analysis

### The Race Condition

The bug occurred due to timing issues in the authentication initialization sequence:

```
Timeline of the Bug:
┌─────────────────────────────────────────────────────────────┐
│ 1. App starts, AuthProvider mounts                         │
│ 2. fetchSession() loads session from SecureStore           │
│ 3. authProfileService.setSession(session) called           │
│    ├─ This triggers ASYNC profile fetch                    │
│    └─ Returns immediately (Promise)                        │
│ 4. fetchSession finally block executes                     │
│    └─ Sets isLoading = false ❌ TOO EARLY                  │
│ 5. Profile subscription fires immediately with null        │
│    (because fetch hasn't completed yet)                    │
│ 6. index.tsx effect runs (triggered by isLoading = false)  │
│    ├─ Checks profile from authProfileService               │
│    ├─ Gets null (profile still loading)                    │
│    └─ Redirects to /onboarding/username ❌ INCORRECT       │
│ 7. Profile fetch completes (too late)                      │
│    └─ Profile subscription fires again with real profile   │
│ 8. User stuck in onboarding despite having profile         │
└─────────────────────────────────────────────────────────────┘
```

### Why This Happened

1. **Immediate Subscription Callback**: The `authProfileService.subscribe()` method calls the listener immediately with `currentProfile` (which is `null` initially)

2. **Async Profile Fetch**: The `setSession()` method awaits `fetchAndSyncProfile()`, but the subscription fires before this completes

3. **Premature isLoading**: The `finally` block in `fetchSession()` set `isLoading = false` before the profile was loaded

4. **Direct Service Call**: `index.tsx` called `authProfileService.getCurrentProfile()` directly instead of using the context value

---

## Solution Implementation

### 1. Track Profile Fetch Completion

Added a ref to track when the initial profile fetch completes:

```typescript
const profileFetchCompletedRef = useRef<boolean>(false);
```

This flag is:
- Set to `false` on initialization and auth state changes
- Set to `true` after `authProfileService.setSession()` completes
- Used to determine when it's safe to set `isLoading = false`

### 2. Coordinate Loading State

Modified the profile subscription to only set `isLoading = false` when:
- No session exists (user not logged in), OR
- Profile fetch has completed (after `setSession` finishes)

```typescript
useEffect(() => {
  const unsubscribe = authProfileService.subscribe((authProfile) => {
    setProfile(authProfile);
    
    // Only set isLoading to false if fetch completed or no session
    if (!session || profileFetchCompletedRef.current) {
      setIsLoading(false);
    }
  });
  return unsubscribe;
}, [session]);
```

### 3. Use Context Profile

Changed `index.tsx` to use `profile` from the auth context instead of calling the service directly:

```typescript
// Before (Race Condition):
const profileData = authProfileService.getCurrentProfile(); // ❌ May be null

// After (Fixed):
const { session, profile, isLoading } = useAuthContext(); // ✅ Properly synced
const profileData = profile;
```

### 4. Proper Sequencing

The fix ensures this sequence:

```
Correct Flow After Fix:
┌─────────────────────────────────────────────────────────────┐
│ 1. App starts, AuthProvider mounts                         │
│ 2. fetchSession() loads session from SecureStore           │
│ 3. authProfileService.setSession(session) called           │
│    ├─ Awaits fetchAndSyncProfile() to complete            │
│    └─ Sets profileFetchCompletedRef = true ✅              │
│ 4. Profile subscription fires with loaded profile          │
│    ├─ Checks profileFetchCompletedRef === true             │
│    └─ Sets isLoading = false ✅ CORRECT TIMING             │
│ 5. index.tsx effect runs with profile data available       │
│    ├─ Checks profile.username                              │
│    ├─ Finds username exists                                │
│    └─ Redirects to /tabs/bounty-app ✅ CORRECT             │
│ 6. User successfully enters app                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Modified

### `app/index.tsx`
- **Change**: Use `profile` from auth context instead of `authProfileService.getCurrentProfile()`
- **Why**: Ensures we're using the properly synchronized profile value from the provider
- **Impact**: Eliminates the possibility of reading stale or null profile data

### `providers/auth-provider.tsx`
- **Changes**:
  1. Added `profileFetchCompletedRef` to track fetch completion
  2. Mark fetch as completed after `setSession()` completes
  3. Only set `isLoading = false` when profile is available
  4. Reset fetch flag on auth state changes
  5. Added debug logging for troubleshooting

- **Why**: Coordinates the loading state between session and profile
- **Impact**: Prevents premature routing decisions

### `__tests__/integration/auth-persistence.test.tsx`
- **Changes**: Added test suite for "Profile Loading Race Condition"
- **Coverage**:
  - Verifies `isLoading` waits for profile before becoming `false`
  - Tests profile fetch failure handling
  - Validates subscription synchronization

### `AUTH_STATE_PERSISTENCE.md`
- **Changes**: Documented the race condition, fix, and flow diagrams
- **Purpose**: Helps future developers understand the issue and solution

---

## Testing

### Automated Tests
New test suite: "Profile Loading Race Condition"
- ✅ Test: `isLoading` waits for profile to load before becoming `false`
- ✅ Test: Profile fetch failures are handled gracefully
- ✅ Test: Subscription is properly synchronized with session loading

### Manual Testing Checklist
- [ ] **Critical**: Existing user with profile → app refresh → goes to bounty app (not onboarding)
- [ ] New user without profile → goes to onboarding
- [ ] User completes onboarding → goes to bounty app
- [ ] User refreshes after completing onboarding → stays in bounty app
- [ ] Sign out → sign back in → correct routing based on profile
- [ ] No flash of onboarding screen for existing users

### Debug Logging
The fix adds console logs with `[AuthProvider]` prefix to track:
- Profile fetch completion status
- Loading state changes
- Profile data presence

Look for: `"Profile update received, setting isLoading to false"` with profile details

---

## Benefits

1. **Correct User Flow**: Users remain in the app after refresh instead of being sent to onboarding
2. **Data Persistence**: Account progress is preserved across app restarts
3. **Better UX**: No confusing redirects or data loss
4. **Reliability**: Eliminates race condition that could cause authentication issues
5. **Debuggability**: Added logging helps troubleshoot auth issues

---

## Migration Notes

### No Breaking Changes
This fix is backward compatible and doesn't require:
- Database migrations
- API changes
- User data migration
- Environment variable updates

### Deployment
Simply deploy the updated code. The fix takes effect immediately on app restart.

---

## Related Documentation

- [AUTH_STATE_PERSISTENCE.md](./AUTH_STATE_PERSISTENCE.md) - Complete authentication persistence implementation
- [AUTH_ONBOARDING_INTEGRATION.md](./AUTH_ONBOARDING_INTEGRATION.md) - Auth and onboarding integration
- [AUTH_IMPLEMENTATION_SUMMARY.md](./AUTH_IMPLEMENTATION_SUMMARY.md) - Overall auth implementation

---

## Future Improvements

Potential enhancements for consideration:
1. Add timeout for profile loading to handle edge cases
2. Implement retry logic for failed profile fetches
3. Add telemetry to track auth flow timing
4. Consider caching profile data with TTL for faster loads
5. Add visual feedback during profile loading

---

## Conclusion

This fix resolves a critical authentication race condition that prevented users from accessing the app after registration. By properly coordinating the loading state between session and profile data, we ensure users are correctly routed based on their actual account status rather than transient loading states.

The solution is minimal, maintainable, and follows React best practices for state management and effect synchronization.
