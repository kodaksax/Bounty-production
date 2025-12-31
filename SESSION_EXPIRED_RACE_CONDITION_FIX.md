# Session Expired Alert - Race Condition Fix

## Problem Summary

Users signing in **without** the "remember me" checkbox checked were experiencing an unexpected "Session Expired" alert immediately after successful login. This was confusing and frustrating because:
- The user had just signed in successfully
- The session hadn't actually expired
- The alert appeared within seconds of login

## Root Cause Analysis

### Initial Issue (Previous Fix)
The original problem was that when `rememberMe` was false, the storage adapter would always return `null` when Supabase tried to read the session, causing Supabase to think the session was gone.

This was fixed by adding an in-memory session cache (`inMemorySessionCache`) that stores the session in memory when `rememberMe` is false.

### New Issue (Race Condition)
Even with the session cache fix, users were still experiencing the alert due to a **timing race condition** in how the `rememberMe` preference itself was stored and retrieved.

**The Race Condition Flow:**

1. User enters credentials and clicks "Sign In" (without checking "remember me")
2. `setRememberMePreference(false)` is called
3. This **asynchronously** writes to SecureStore: `await SecureStore.setItemAsync(...)`
4. Immediately after, `supabase.auth.signInWithPassword()` is called
5. Supabase successfully authenticates and internally calls the storage adapter's `setItem()` to store the session
6. `setItem()` calls `getRememberMePreference()` to check if it should persist to secure storage
7. `getRememberMePreference()` reads from SecureStore: `await SecureStore.getItemAsync(...)`
8. **PROBLEM**: The SecureStore read might complete BEFORE the previous write finishes
9. Result: `getRememberMePreference()` returns the OLD value (or `false` by default)
10. But there's a timing window where it might read stale data or the write might not be visible yet

**Visual Timeline:**

```
Time  →
│
├─ [1] setRememberMePreference(false) called
│    └─ SecureStore.setItemAsync('remember_me', 'false') ← Async write starts
│
├─ [2] signInWithPassword() called (doesn't wait for above to finish)
│    └─ Authentication succeeds
│         └─ storage.setItem() called to save session
│              └─ getRememberMePreference() called
│                   └─ SecureStore.getItemAsync('remember_me') ← Async read
│                        ❌ RACE: Read might complete before write from [1]!
│
└─ Result: Session might not be cached correctly → "Session Expired" alert
```

### Why SecureStore Operations Can Race

SecureStore operations involve:
1. Encryption/decryption
2. Native module bridge calls (JavaScript ↔ Native code)
3. OS-level keychain/keystore operations
4. File system I/O

Even though both operations use `await`, they don't block each other:
- Thread 1: Write operation in progress
- Thread 2: Read operation starts before Thread 1 completes
- Result: Read might not see the most recent write

## Solution

Add an **in-memory cache** for the `rememberMe` preference that is updated **synchronously** before any async SecureStore operations.

### Implementation

```typescript
// In-memory cache for remember me preference
// This avoids race conditions when reading from SecureStore immediately after writing
let inMemoryRememberMeCache: boolean | null = null;

export async function setRememberMePreference(remember: boolean): Promise<void> {
  try {
    // ✅ Update in-memory cache IMMEDIATELY (synchronous, no race condition)
    inMemoryRememberMeCache = remember;
    console.log('[AuthSessionStorage] Remember me preference cached in memory:', remember);
    
    // Then persist to secure storage (asynchronous, but cache already updated)
    await SecureStore.setItemAsync(REMEMBER_ME_KEY, remember ? 'true' : 'false', SECURE_OPTS);
    console.log('[AuthSessionStorage] Remember me preference persisted to secure storage:', remember);
  } catch (e) {
    console.error('[AuthSessionStorage] Error setting remember me preference:', e);
  }
}

export async function getRememberMePreference(): Promise<boolean> {
  try {
    // ✅ Check in-memory cache first (fast path, avoids race conditions)
    if (inMemoryRememberMeCache !== null) {
      return inMemoryRememberMeCache;
    }
    
    // Cache miss: read from secure storage and populate cache
    const value = await SecureStore.getItemAsync(REMEMBER_ME_KEY);
    const preference = value === 'true';
    inMemoryRememberMeCache = preference;
    return preference;
  } catch (e) {
    console.error('[AuthSessionStorage] Error reading remember me preference:', e);
    return false;
  }
}
```

### How This Solves the Race Condition

**New Flow with Fix:**

```
Time  →
│
├─ [1] setRememberMePreference(false) called
│    ├─ inMemoryRememberMeCache = false ← ✅ IMMEDIATE (synchronous)
│    └─ SecureStore.setItemAsync('remember_me', 'false') ← Async write (slower)
│
├─ [2] signInWithPassword() called
│    └─ Authentication succeeds
│         └─ storage.setItem() called to save session
│              └─ getRememberMePreference() called
│                   ├─ Check inMemoryRememberMeCache first
│                   └─ ✅ Returns false immediately (from cache)
│
└─ Result: Session correctly stored in memory cache → No false alert!
```

**Key Benefits:**

1. **Synchronous Cache Update**: Memory cache is updated instantly, no async delays
2. **Fast Reads**: Subsequent reads get the value from memory immediately
3. **Persistent Storage**: SecureStore is still updated for persistence across app restarts
4. **No Race Conditions**: Cache is always updated before any async operations complete

## Changes Made

### File: `lib/auth-session-storage.ts`

1. **Added in-memory preference cache**:
```typescript
let inMemoryRememberMeCache: boolean | null = null;
```

2. **Updated `setRememberMePreference()`**:
   - Updates memory cache **immediately** (synchronous)
   - Then persists to SecureStore (asynchronous)
   - Cache is always correct before async write completes

3. **Updated `getRememberMePreference()`**:
   - Checks memory cache **first** (fast path)
   - Only reads from SecureStore on cache miss
   - Populates cache from SecureStore for future reads

4. **Updated `clearRememberMePreference()`**:
   - Clears memory cache immediately
   - Then clears SecureStore

5. **Updated `clearAllSessionData()`**:
   - Clears both session cache and preference cache
   - Ensures clean state on sign out

## Expected User Experience

### Scenario 1: Sign in WITHOUT "remember me" ✅ FIXED
1. User enters credentials and signs in (checkbox unchecked)
2. `setRememberMePreference(false)` updates cache immediately
3. Session is stored in memory cache (not secure storage)
4. **No "Session Expired" alert appears** ✅
5. User can use the app normally
6. On app restart, user must sign in again (expected behavior)

### Scenario 2: Sign in WITH "remember me"
1. User enters credentials and signs in (checkbox checked)
2. `setRememberMePreference(true)` updates cache immediately
3. Session is stored in both memory cache and secure storage
4. No alert appears
5. On app restart, session is restored from secure storage
6. User stays logged in ✅

### Scenario 3: Sign out
1. User clicks "Sign Out"
2. Both caches (session + preference) are cleared
3. SecureStore is cleared
4. User is redirected to sign in screen
5. No "Session Expired" alert (intentional sign out)

## Testing Instructions

### Test 1: Sign in without remember me (CRITICAL - reproduces original bug)

1. If signed in, sign out completely
2. Force quit and restart the app
3. Go to sign in screen
4. Enter valid credentials
5. **UNCHECK** the "remember me" checkbox
6. Click "Sign In"
7. **Expected Result**: 
   - User is signed in successfully ✅
   - NO "Session Expired" alert appears ✅
   - User can navigate and use the app normally ✅

### Test 2: App restart without remember me

1. Continue from Test 1 (signed in without remember me)
2. Force quit the app (swipe up from app switcher)
3. Launch the app again
4. **Expected Result**:
   - User is shown the sign in screen ✅
   - Must re-authenticate (expected behavior) ✅
   - No false alert ✅

### Test 3: Sign in with remember me

1. If signed in, sign out
2. Go to sign in screen
3. Enter valid credentials
4. **CHECK** the "remember me" checkbox
5. Click "Sign In"
6. **Expected Result**:
   - User is signed in successfully ✅
   - No alert appears ✅
7. Force quit the app
8. Launch the app again
9. **Expected Result**:
   - User is still logged in ✅
   - Session restored from secure storage ✅

### Test 4: Sign out clears everything

1. Continue from Test 3 (logged in with remember me)
2. Go to Settings/Profile
3. Click "Sign Out"
4. **Expected Result**:
   - User is signed out ✅
   - Redirected to sign in screen ✅
   - No false alert (intentional action) ✅
5. Force quit and restart app
6. **Expected Result**:
   - User must sign in again ✅
   - All preferences cleared ✅

## Technical Details

### Memory Cache Characteristics

**JavaScript variable in module scope:**
```typescript
let inMemoryRememberMeCache: boolean | null = null;
```

- **Lifetime**: Exists for the duration of the app process
- **Scope**: Module-level (accessible to all functions in the module)
- **Persistence**: Cleared when app is force quit or restarted
- **Thread-safety**: JavaScript is single-threaded, no race conditions within JS
- **Performance**: Instant access (no async operations)

### Cache Lifecycle

1. **Initial State**: `inMemoryRememberMeCache = null` (no preference set)
2. **On Sign In**: Cache updated immediately when `setRememberMePreference()` called
3. **During Session**: All reads hit the cache (fast)
4. **On Sign Out**: Cache cleared immediately
5. **On App Restart**: Cache reset to `null`, reads from SecureStore to repopulate

### Why This Works

**Synchronous vs Asynchronous Operations:**

```typescript
// ❌ PROBLEM (Old Code):
await SecureStore.setItemAsync('key', 'value'); // Async - takes time
// ... other code runs ...
const value = await SecureStore.getItemAsync('key'); // Might not see write yet!

// ✅ SOLUTION (New Code):
inMemoryCache = 'value'; // Synchronous - instant!
await SecureStore.setItemAsync('key', 'value'); // Async - takes time
// ... other code runs ...
const value = inMemoryCache; // Always correct!
```

**JavaScript Execution Model:**
- JavaScript is single-threaded
- Synchronous operations complete immediately
- `inMemoryRememberMeCache = remember` is atomic
- No other code can run between assignment and next read
- Result: No race conditions possible

### Edge Cases Handled

1. **First App Launch**: Cache is `null`, reads from SecureStore
2. **SecureStore Write Fails**: Cache is already updated, app still works for current session
3. **SecureStore Read Fails**: Returns `false` by default (safe fallback)
4. **Multiple Sign Ins**: Each `setRememberMePreference()` call updates cache immediately
5. **Rapid Sign In/Out**: Cache is always consistent with latest action

## Compatibility

- ✅ Backward compatible with existing users
- ✅ No database changes required
- ✅ No API changes required
- ✅ Existing sessions continue to work
- ✅ No migration needed

## Related Files

- `lib/auth-session-storage.ts` - Main fix (preference caching)
- `app/auth/sign-in-form.tsx` - Calls `setRememberMePreference()` before sign in
- `hooks/useSessionMonitor.ts` - Displays session expired alert
- `lib/utils/session-handler.ts` - Session monitoring logic
- `providers/auth-provider.tsx` - Auth state management

## Performance Impact

- ✅ **Improved**: Memory reads are instant (no async overhead)
- ✅ **No Degradation**: SecureStore still used for persistence
- ✅ **Cache Hit Rate**: Nearly 100% after initial population
- ✅ **Memory Footprint**: Negligible (single boolean value)

## Future Improvements

1. **Preference Migration**: Migrate other preferences to use same pattern
2. **Cache Validation**: Add checksum validation between memory and SecureStore
3. **Analytics**: Track cache hit/miss rates
4. **Testing**: Add unit tests for race condition scenarios
