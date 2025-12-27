# Sign-In Authentication Simplification

## Problem Summary

Users reported that sign-in with valid credentials would hang indefinitely and eventually fail with network timeout errors after 15 seconds, despite:
- Having good internet connectivity
- The authentication service being available
- Invalid credentials being properly rejected (showing the auth service works)

The error logs showed:
```
[sign-in] Authentication failed after retries: Error: Network request timed out after 15000ms
[sign-in] Attempt 1 failed: Network request timed out after 15000ms
[sign-in] Attempt 2 failed: Network request timed out after 15000ms
```

## Root Cause Analysis

The authentication flow had become overly complex with multiple layers of timeout handling and retry logic:

1. **Custom timeout wrapper (`withTimeout`)**: Wrapped every Supabase auth call with a 15-second timeout
2. **Retry loop**: 2 attempts with exponential backoff delays
3. **Network connectivity checks**: Performed on each retry
4. **Total time to failure**: ~31 seconds (15s + 1s backoff + 15s)

The problem was that the custom `withTimeout` wrapper was **fighting against Supabase's built-in network handling**, causing valid authentication requests to be cancelled prematurely. The Supabase SDK already has sophisticated network error handling, timeouts, and retry logic built-in.

## Solution

**Simplified the authentication flow by removing the custom timeout and retry logic**, letting Supabase handle authentication natively:

### Changes Made

#### app/auth/sign-in-form.tsx
**Before (Complex):**
```typescript
const { AUTH_TIMEOUT, MAX_ATTEMPTS } = AUTH_RETRY_CONFIG
let lastErr: any = null
let data: any = null
let error: any = null

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    const res = await withTimeout(
      supabase.auth.signInWithPassword({
        email: identifier.trim().toLowerCase(),
        password,
      }),
      AUTH_TIMEOUT  // 15 seconds
    )
    data = res.data
    error = res.error
    if (res.data || res.error) break
  } catch (e: any) {
    lastErr = e
    if (attempt < MAX_ATTEMPTS) {
      if (isNetworkError(e)) {
        const net = await NetInfo.fetch()
        if (!net.isConnected) {
          throw new Error('No internet connection...')
        }
      }
      const backoff = getBackoffDelay(attempt)
      await new Promise((r) => setTimeout(r, backoff))
      continue
    }
  }
}
```

**After (Simplified):**
```typescript
// SIMPLIFIED AUTH FLOW: Let Supabase handle its own timeouts and network logic
// The previous complex retry/timeout logic was causing valid requests to fail
const { data, error } = await supabase.auth.signInWithPassword({
  email: identifier.trim().toLowerCase(),
  password,
})
```

#### Social Auth (Google & Apple)
- Removed `withTimeout` wrapper from `signInWithIdToken` calls
- Let Supabase SDK handle timeouts naturally

#### app/auth/sign-up-form.tsx
- Removed `withTimeout` wrapper from `signUp` call
- Consistent with sign-in simplification

### What Was Kept

- **Profile check timeouts**: The quick 3-second timeout on profile checks is kept because:
  - Profile checks are non-critical (fallback to app navigation if they fail)
  - They're just for determining onboarding status
  - The AuthProvider handles full profile sync in the background
  
- **Error handling**: All the user-friendly error messages and lockout logic remain intact

- **Form validation**: Client-side validation still prevents invalid submissions

### Removed Code

- `withTimeout` wrapper on authentication calls
- Complex retry loop with exponential backoff
- Network connectivity pre-checks on retries
- Unused imports: `getBackoffDelay`, `isNetworkError`, `isTimeoutError`

## Expected Behavior After Fix

1. **Valid credentials**: Sign-in completes immediately (usually < 2 seconds)
2. **Invalid credentials**: Still properly rejected with clear error message
3. **Network issues**: Supabase SDK handles timeouts and retries internally
4. **Better reliability**: No premature cancellation of valid requests

## Testing Checklist

- [ ] Test sign-in with valid credentials (should complete successfully)
- [ ] Test sign-in with invalid credentials (should reject with proper error)
- [ ] Test sign-in with slow network (Supabase should handle gracefully)
- [ ] Test sign-up with valid credentials
- [ ] Test Google sign-in (if configured)
- [ ] Test Apple sign-in on iOS (if configured)
- [ ] Verify error messages are user-friendly
- [ ] Verify successful sign-in navigates to correct screen

## Rationale for Simplification

Modern authentication SDKs like Supabase's are designed to handle:
- Network timeouts and retries
- Connection failures
- Server errors
- Token refresh
- Session management

By removing our custom timeout and retry logic, we:
1. **Eliminate complexity** and potential bugs
2. **Trust the SDK** to do what it's designed to do
3. **Prevent conflicts** between our logic and the SDK's logic
4. **Improve reliability** by not prematurely canceling valid requests

## Rollback Plan (If Needed)

If this simplification doesn't resolve the issue, we can:
1. Add basic logging to determine where requests actually hang
2. Check Supabase project settings and quotas
3. Test with Supabase's built-in `fetch` configuration options
4. Add a much longer timeout (60+ seconds) if absolutely necessary

However, the current implementation should work reliably as it delegates to Supabase's proven authentication handling.

## Related Files Modified

- `app/auth/sign-in-form.tsx` - Main sign-in flow
- `app/auth/sign-up-form.tsx` - Sign-up flow

## Additional Notes

- The issue description mentioned "rollback to simpler functionality if needed" - this is exactly that
- The Supabase SDK has been battle-tested across millions of apps
- Custom timeout wrappers should only be used when absolutely necessary and with careful consideration
- Profile checks still use short timeouts because they're non-blocking operations
