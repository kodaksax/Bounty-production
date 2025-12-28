# Auth Rollback Implementation Guide

## Overview
This document describes the auth implementation rollback that restores stable auth behavior by using direct Supabase client-side authentication without backend intermediaries.

## Key Changes

### 1. Direct Client-Side Authentication
The sign-in flow uses direct Supabase client authentication:

```typescript
// app/auth/sign-in-form.tsx
const { data, error } = await supabase.auth.signInWithPassword({
  email: identifier.trim().toLowerCase(),
  password,
})
```

**Why:** This approach is simpler, more reliable, and follows Supabase best practices. It eliminates the backend `/app/auth/sign-in-form` endpoint that was adding unnecessary complexity.

### 2. Independent Loading State
The AuthProvider's `isLoading` state is now independent of profile fetch operations:

```typescript
// providers/auth-provider.tsx
// isLoading is cleared immediately after session retrieval
// Profile fetch happens async in the background
setIsLoading(false) // Always set, regardless of profile status
```

**Why:** Profile fetch failures should not block the app from rendering the main UI. Users can access the app while profiles load in the background.

### 3. Fire-and-Forget Profile Sync
Profile synchronization happens asynchronously without blocking auth state:

```typescript
// Fire-and-forget pattern
authProfileService.setSession(session).catch((e) => {
  console.error('[AuthProvider] Error setting session in profile service:', e)
})
```

**Why:** Profile fetch errors are logged but don't prevent the app from functioning. This prevents infinite skeleton loaders.

## Environment Configuration

### Client-Side Environment Variables
The client MUST use the public environment variables with `EXPO_PUBLIC_` prefix:

```bash
# .env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

**⚠️ CRITICAL SECURITY NOTES:**
- **NEVER** use the service role key on the client
- **NEVER** expose `SUPABASE_SERVICE_ROLE_KEY` to the client
- Only `EXPO_PUBLIC_*` variables are accessible in client code
- Service role key belongs ONLY on the backend (api/server.js)

### Backend Environment Variables
The backend uses different variables:

```bash
# Backend .env (for api/server.js)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

## Supabase Client Configuration

The client uses Supabase SDK defaults without custom wrappers:

```typescript
// lib/supabase.ts
supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: {
    storage: ExpoSecureStoreAdapter,  // Expo SecureStore for persistence
    autoRefreshToken: true,            // Automatic token refresh
    persistSession: true,              // Session persistence
    detectSessionInUrl: false,         // Mobile app, no URL-based auth
  },
})
```

**Key Points:**
- ✅ Uses Supabase SDK defaults for network requests
- ✅ No custom fetch wrappers or timeouts
- ✅ Expo SecureStore adapter for secure session storage
- ✅ Automatic token refresh enabled
- ✅ Session persistence enabled

## API Configuration

### Development
```bash
# Local development
EXPO_PUBLIC_API_BASE_URL=http://localhost:3001
```

### Production
```bash
# Production API endpoint
EXPO_PUBLIC_API_BASE_URL=https://your-api-domain.com
```

**Note:** The API port defaults to 3001 but can be configured via `API_PORT` or `PORT` environment variables.

## Authentication Flow

### Sign-In Process
1. User enters credentials in `app/auth/sign-in-form.tsx`
2. Form calls `supabase.auth.signInWithPassword()` directly
3. Supabase SDK handles network request and session storage
4. AuthProvider receives auth state change via `onAuthStateChange`
5. AuthProvider immediately clears `isLoading` state
6. Profile fetch happens asynchronously in background
7. App renders main UI while profile loads

### Session Management
- Sessions are stored securely in Expo SecureStore
- Token refresh happens automatically before expiration
- Profile data is cached and synced in the background
- Auth state changes trigger profile re-sync

## Migration from Previous Implementation

### What Changed
1. **Removed blocking profile fetch**: Auth loading no longer waits for profile
2. **Removed profileFetchCompletedRef**: No longer needed for loading state
3. **Changed to fire-and-forget**: Profile sync doesn't block auth flow

### What Stayed the Same
- Direct client-side Supabase authentication (was already in place)
- Supabase client configuration (was already correct)
- Session persistence with SecureStore (was already in place)
- Token refresh mechanism (unchanged)

## Testing

### Manual Testing Checklist
- [ ] Sign in with valid credentials completes successfully
- [ ] App renders main UI immediately after authentication
- [ ] Profile data loads in background after sign-in
- [ ] Session persists across app restarts
- [ ] Token refresh works automatically
- [ ] Sign out clears session properly
- [ ] Network errors don't prevent app from loading
- [ ] Profile fetch errors are logged but don't block UI

### Error Scenarios
- **Profile fetch fails**: App still renders, error logged to console
- **Network timeout**: Supabase SDK handles retries, app doesn't block
- **Invalid credentials**: Error displayed, no hanging state
- **Session expired**: Auto-refresh triggered, or user prompted to re-auth

## Troubleshooting

### Issue: App stuck on loading screen
**Cause:** Old implementation was blocking on profile fetch
**Solution:** Update to latest AuthProvider implementation

### Issue: "Supabase not configured" error
**Cause:** Missing `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_ANON_KEY`
**Solution:** Check `.env` file has both variables with `EXPO_PUBLIC_` prefix

### Issue: Service role key exposed in client
**Cause:** Using wrong environment variable name
**Solution:** Use `EXPO_PUBLIC_SUPABASE_ANON_KEY` (NOT service role key)

### Issue: Profile data not loading
**Cause:** Profile fetch error (non-blocking)
**Solution:** Check console logs for profile service errors, verify database RLS policies

## References

- [Supabase Authentication](https://supabase.com/docs/guides/auth)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo Environment Variables](https://docs.expo.dev/guides/environment-variables/)

## Rollback Safety

This implementation maintains backward compatibility:
- Existing sessions continue to work
- Database schema unchanged
- API endpoints unchanged
- Only client-side behavior improved

If issues arise, previous behavior can be restored by reverting AuthProvider changes while keeping the direct Supabase client auth (which was already in place).
