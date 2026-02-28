# Session Storage Flow Diagrams

## Before Fix (Problem)

```
┌─────────────────────────────────────────────────────────────────┐
│ User signs in WITHOUT "remember me" checkbox                    │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ rememberMe preference set to FALSE                              │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Supabase auth creates session                                   │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Storage adapter setItem() called                                │
│ - rememberMe is FALSE                                           │
│ - ❌ Does NOT persist to secure storage                         │
│ - ❌ Does NOT cache anywhere                                    │
└─────────────────────────────────────────────────────────────────┘
                          ↓
        [User uses app normally for a few seconds]
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Supabase SDK tries to refresh/validate token                    │
│ Calls storage adapter getItem()                                 │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Storage adapter getItem():                                      │
│ - rememberMe is FALSE                                           │
│ - ❌ Returns NULL (no session found!)                           │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Supabase interprets NULL as "session is gone"                   │
│ Triggers SIGNED_OUT event                                       │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Session monitor detects SIGNED_OUT event                        │
│ ❌ Shows "Session Expired" alert                                │
└─────────────────────────────────────────────────────────────────┘
```

## After Fix (Solution)

```
┌─────────────────────────────────────────────────────────────────┐
│ User signs in WITHOUT "remember me" checkbox                    │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ rememberMe preference set to FALSE                              │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Supabase auth creates session                                   │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Storage adapter setItem() called                                │
│ - rememberMe is FALSE                                           │
│ - ✅ Stores session in IN-MEMORY CACHE                          │
│ - Does NOT persist to secure storage                            │
└─────────────────────────────────────────────────────────────────┘
                          ↓
        [User uses app normally for hours]
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Supabase SDK tries to refresh/validate token                    │
│ Calls storage adapter getItem()                                 │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Storage adapter getItem():                                      │
│ - rememberMe is FALSE                                           │
│ - ✅ Checks in-memory cache                                     │
│ - ✅ Returns session from cache                                 │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Supabase receives valid session                                 │
│ ✅ No SIGNED_OUT event                                          │
│ ✅ Token refresh succeeds                                       │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ ✅ User continues using app without interruption                │
│ ✅ No "Session Expired" alert                                   │
└─────────────────────────────────────────────────────────────────┘
```

## App Restart Scenario (Remember Me = FALSE)

```
┌─────────────────────────────────────────────────────────────────┐
│ User force quits app / app restarts                             │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ ✅ In-memory cache is CLEARED (app process terminated)          │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ App restarts, AuthProvider tries to restore session             │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Storage adapter getItem() called                                │
│ - rememberMe is FALSE                                           │
│ - In-memory cache is EMPTY (new app process)                    │
│ - ✅ Returns NULL (expected behavior)                           │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ AuthProvider detects no session                                 │
│ ✅ Redirects to sign in screen (expected)                       │
│ ✅ No "Session Expired" alert (no active session)               │
└─────────────────────────────────────────────────────────────────┘
```

## App Restart Scenario (Remember Me = TRUE)

```
┌─────────────────────────────────────────────────────────────────┐
│ User force quits app / app restarts                             │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ In-memory cache is cleared (app process terminated)             │
│ ✅ BUT session is in SECURE STORAGE                             │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ App restarts, AuthProvider tries to restore session             │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Storage adapter getItem() called                                │
│ - rememberMe is TRUE                                            │
│ - ✅ Reads from SECURE STORAGE                                  │
│ - ✅ Returns persisted session                                  │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ AuthProvider restores session                                   │
│ ✅ User stays logged in (expected)                              │
└─────────────────────────────────────────────────────────────────┘
```

## Storage Comparison Table

| Scenario | Remember Me | During Session | After Restart |
|----------|-------------|----------------|---------------|
| **Before Fix** | ❌ FALSE | ❌ No storage → Session Expired alert | N/A (already signed out) |
| **After Fix** | ❌ FALSE | ✅ In-memory cache → No alert | ❌ Cache cleared → Must re-login |
| **Both** | ✅ TRUE | ✅ Secure storage → No alert | ✅ Secure storage → Stays logged in |

## Key Insights

### 1. In-Memory Cache Lifetime
```
App Launch → In-memory cache created (empty Map)
            ↓
User signs in → Session stored in cache
            ↓
User uses app → Cache persists in RAM
            ↓
App terminated → Cache destroyed (RAM cleared)
            ↓
App relaunch → New empty cache created
```

### 2. Why This Works

**JavaScript Map Object:**
- Exists in app's memory (RAM)
- Persists for lifetime of app process
- Automatically cleared when process terminates
- Fast access (O(1) lookups)
- Perfect for temporary session storage

**No Race Conditions:**
- All storage operations are synchronous once preference is loaded
- Map operations are atomic in JavaScript single-threaded model
- No concurrent access issues

**Security:**
- In-memory data never written to disk
- Cleared on app termination
- Can't be extracted from terminated app
- Secure storage used for persistent sessions

### 3. Implementation Benefits

✅ **Fixes the bug**: No more false "Session Expired" alerts
✅ **Maintains security**: Non-persistent sessions don't touch storage
✅ **Simple logic**: Easy to understand and maintain
✅ **Backward compatible**: Existing users unaffected
✅ **No performance impact**: In-memory lookups are instant
✅ **No external dependencies**: Uses built-in JavaScript Map
