# Session Expired Alert Fix

## Problem Summary

Users were experiencing an unexpected "Session Expired" alert immediately after signing in when they did NOT check the "remember me" checkbox. This was confusing because the session hadn't actually expired - the user had just signed in.

## Root Cause

The issue was in the `lib/auth-session-storage.ts` file. The storage adapter was designed to:

1. When `rememberMe` is **false**: Don't persist session to secure storage
2. When `rememberMe` is **true**: Persist session to secure storage

However, the implementation had a critical flaw:

```typescript
// OLD BEHAVIOR
getItem: async (key: string): Promise<string | null> => {
  const rememberMe = await getRememberMePreference();
  
  if (!rememberMe) {
    // PROBLEM: Always return null when rememberMe is false
    // This causes Supabase to think session is gone!
    return null;
  }
  
  // Read from secure storage...
}
```

When Supabase's SDK tried to read the session (for token refresh, validation, etc.), the storage adapter would return `null` because `rememberMe` was false. Supabase interpreted this as "the session is gone" and triggered a `SIGNED_OUT` event, which caused the session monitor to show the alert.

## Solution

We added an **in-memory session cache** that persists for the current app session but is cleared on app restart:

```typescript
// In-memory cache that exists only for current app session
const inMemorySessionCache: Map<string, string> = new Map();
```

### Updated Behavior

**When `rememberMe` is false:**
1. `setItem()`: Store session in memory cache only (not secure storage)
2. `getItem()`: Return session from memory cache if it exists
3. After app restart: Memory cache is empty, so `getItem()` returns null → user must re-login

**When `rememberMe` is true:**
1. `setItem()`: Store session in secure storage, then cache in memory (for performance)
2. `getItem()`: Check memory cache first (fast), fallback to secure storage if cache miss
3. After app restart: Session is restored from secure storage and cached → user stays logged in
4. Cache consistency: If secure storage write fails, cache is cleared to prevent stale data

## Changes Made

### File: `lib/auth-session-storage.ts`

1. **Added in-memory cache**:
```typescript
const inMemorySessionCache: Map<string, string> = new Map();
```

2. **Updated `getItem()`**:
```typescript
getItem: async (key: string): Promise<string | null> => {
  const rememberMe = await getRememberMePreference();
  
  if (!rememberMe) {
    // Check in-memory cache for current session
    const cached = inMemorySessionCache.get(key);
    if (cached) {
      return cached; // Session exists in current app session
    }
    return null; // No session after app restart
  }
  
  // Remember me is true: check cache first for performance
  const cached = inMemorySessionCache.get(key);
  if (cached) {
    return cached; // Fast path: return from cache
  }
  
  // Cache miss: read from secure storage and populate cache
  const val = await SecureStore.getItemAsync(key);
  if (val) {
    inMemorySessionCache.set(key, val);
  }
  return val;
}
```

3. **Updated `setItem()`**:
```typescript
setItem: async (key: string, value: string): Promise<void> => {
  const rememberMe = await getRememberMePreference();
  
  if (!rememberMe) {
    // Store in memory cache only (current session only)
    inMemorySessionCache.set(key, value);
    return;
  }
  
  try {
    // Write to secure storage first
    await SecureStore.setItemAsync(key, value);
    
    // Only cache after successful write (maintains consistency)
    inMemorySessionCache.set(key, value);
  } catch (error) {
    // If storage fails, clear cache to prevent stale data
    inMemorySessionCache.delete(key);
    throw error;
  }
}
```

4. **Updated `removeItem()` and `clearAllSessionData()`**:
```typescript
removeItem: async (key: string): Promise<void> => {
  // Clear from in-memory cache
  inMemorySessionCache.delete(key);
  
  // Also clear from secure storage if exists
  await SecureStore.deleteItemAsync(key);
}
```

## Expected User Experience

### Scenario 1: Sign in WITHOUT "remember me"

1. User enters credentials and signs in (checkbox unchecked)
2. Session works normally during the app session
3. **No "Session Expired" alert appears** ✅
4. User can browse, create bounties, chat, etc.
5. When user force quits or restarts the app, they must sign in again

### Scenario 2: Sign in WITH "remember me"

1. User enters credentials and signs in (checkbox checked)
2. Session works normally during the app session
3. When user force quits or restarts the app, they stay logged in
4. Session is restored from secure storage

### Scenario 3: Manual sign out

1. User clicks "Sign Out" button
2. Both in-memory cache and secure storage are cleared
3. User is redirected to sign in screen
4. No "Session Expired" alert (intentional sign out)

## Testing Instructions

### Test 1: Sign in without remember me (main fix)

1. Launch the app
2. Go to sign in screen
3. Enter valid credentials
4. **Uncheck** the "remember me" checkbox
5. Sign in
6. **Expected**: User is signed in successfully
7. Use the app for 2-3 minutes (browse, navigate, etc.)
8. **Expected**: No "Session Expired" alert appears ✅

### Test 2: Restart app without remember me

1. Continue from Test 1
2. Force quit the app (swipe up from app switcher)
3. Launch the app again
4. **Expected**: User is shown the sign in screen (must re-authenticate)

### Test 3: Sign in with remember me

1. Launch the app
2. Go to sign in screen
3. Enter valid credentials
4. **Check** the "remember me" checkbox
5. Sign in
6. **Expected**: User is signed in successfully
7. Force quit the app
8. Launch the app again
9. **Expected**: User is still logged in (session restored) ✅

### Test 4: Sign out

1. Continue from Test 3 (logged in with remember me)
2. Go to Settings/Profile
3. Click "Sign Out"
4. **Expected**: User is signed out and returned to sign in screen
5. **Expected**: No "Session Expired" alert (intentional sign out)
6. Launch the app again
7. **Expected**: User must sign in again (session was cleared)

## Technical Notes

### Why in-memory storage works

JavaScript `Map` objects exist in the app's memory space:
- Created when app starts
- Persists for the lifetime of the app process
- Automatically cleared when app is terminated (force quit, restart, etc.)

This gives us exactly the behavior we need:
- Session works during app session (no false "expired" alerts)
- Session doesn't persist across app restarts when `rememberMe` is false

### Supabase storage adapter contract

Supabase's auth client uses a storage adapter interface:
```typescript
interface StorageAdapter {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}
```

Our adapter now properly implements this contract:
- Returns session data when it exists (from cache or secure storage)
- Stores session data appropriately based on persistence preference
- Clears session data completely on sign out

## Related Files

- `lib/auth-session-storage.ts` - Main fix
- `app/auth/sign-in-form.tsx` - Sets remember me preference before sign in
- `hooks/useSessionMonitor.ts` - Displays session expired alert
- `lib/utils/session-handler.ts` - Session monitoring and expiration logic
- `providers/auth-provider.tsx` - Auth state management

## Compatibility

This fix is **backward compatible**:
- Existing users with remember me enabled will continue to work
- No changes to sign in/sign out flows
- No database migrations required
- No API changes required

## Future Improvements

Consider these enhancements in future iterations:

1. **Session duration setting**: Allow users to choose session duration (1 day, 7 days, 30 days)
2. **Biometric authentication**: Add Face ID/Touch ID for quick re-authentication
3. **Background session refresh**: Refresh tokens in background to extend session
4. **Session analytics**: Track session duration and expiration patterns
