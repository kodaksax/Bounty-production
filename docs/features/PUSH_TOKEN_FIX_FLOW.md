# Push Token Registration Flow - Before & After Fix

## BEFORE (Broken Flow)

```
┌─────────────────┐
│   Mobile App    │
│  Starts/Resumes │
└────────┬────────┘
         │
         │ 1. Request push token from Expo
         ▼
┌─────────────────┐
│  Expo Services  │
└────────┬────────┘
         │
         │ 2. Return ExponentPushToken[...]
         ▼
┌─────────────────────────────────────────┐
│     Mobile NotificationService          │
│  registerPushToken(token, deviceId)     │
└────────┬────────────────────────────────┘
         │
         │ 3. POST /notifications/register-token
         ▼
┌─────────────────────────────────────────┐
│     Backend API Route                   │
│  POST /notifications/register-token     │
└────────┬────────────────────────────────┘
         │
         │ 4. Call notificationService.registerPushToken()
         ▼
┌─────────────────────────────────────────┐
│  Backend NotificationService            │
│  registerPushToken(userId, token)       │
└────────┬────────────────────────────────┘
         │
         │ 5. Check if user exists in DB
         ▼
┌─────────────────────────────────────────┐
│  User doesn't exist!                    │
│  ❌ Attempt to create placeholder user  │
│     with only id + handle               │
└────────┬────────────────────────────────┘
         │
         │ 6. INSERT INTO profiles (id, username)
         ▼
┌─────────────────────────────────────────┐
│         PostgreSQL                      │
│  ❌ FK Constraint Violation!            │
│     profiles.id must reference          │
│     auth.users(id)                      │
└────────┬────────────────────────────────┘
         │
         │ 7. Error: foreign key constraint violated
         ▼
┌─────────────────────────────────────────┐
│  Backend catches error                  │
│  ❌ Returns generic 500 error           │
│  {error: "Failed to register...",       │
│   details: ""}                          │
└────────┬────────────────────────────────┘
         │
         │ 8. HTTP 500 response
         ▼
┌─────────────────────────────────────────┐
│  Mobile App catches error               │
│  ❌ Logs: "Failed to register push      │
│     token. status=500"                  │
│  ❌ Logs: "Error registering push       │
│     token: Error: Failed..."            │
└─────────────────────────────────────────┘
```

## AFTER (Fixed Flow)

### Successful Registration (Normal Case)

```
┌─────────────────┐
│   Mobile App    │
│  Starts/Resumes │
└────────┬────────┘
         │
         │ 1. User authenticates
         ▼
┌─────────────────────────────────────────┐
│     Auth Flow                           │
│  Calls /me endpoint                     │
│  ✅ Creates user profile in DB          │
└────────┬────────────────────────────────┘
         │
         │ 2. Request push token from Expo
         ▼
┌─────────────────┐
│  Expo Services  │
└────────┬────────┘
         │
         │ 3. Return ExponentPushToken[...]
         ▼
┌─────────────────────────────────────────┐
│     Mobile NotificationService          │
│  registerPushToken(token, deviceId)     │
└────────┬────────────────────────────────┘
         │
         │ 4. POST /notifications/register-token
         ▼
┌─────────────────────────────────────────┐
│     Backend API Route                   │
│  ✅ Validates token format with regex   │
│     /^Expo(nent)?PushToken\[.+\]$/      │
└────────┬────────────────────────────────┘
         │
         │ 5. Valid token, proceed
         ▼
┌─────────────────────────────────────────┐
│  Backend NotificationService            │
│  registerPushToken(userId, token)       │
│  ✅ No user creation - just insert/     │
│     update push_tokens                  │
└────────┬────────────────────────────────┘
         │
         │ 6. INSERT/UPDATE push_tokens
         ▼
┌─────────────────────────────────────────┐
│         PostgreSQL                      │
│  ✅ Success! Token registered           │
│     (user exists from /me endpoint)     │
└────────┬────────────────────────────────┘
         │
         │ 7. Success
         ▼
┌─────────────────────────────────────────┐
│  Backend API Route                      │
│  ✅ Returns 200 OK                      │
│  {success: true}                        │
└────────┬────────────────────────────────┘
         │
         │ 8. HTTP 200 response
         ▼
┌─────────────────────────────────────────┐
│  Mobile App                             │
│  ✅ [DEV] Logs: "Successfully           │
│     registered push token"              │
└─────────────────────────────────────────┘
```

### Edge Case: Profile Not Yet Created (Race Condition)

```
┌─────────────────┐
│   Mobile App    │
│  First Launch   │
└────────┬────────┘
         │
         │ 1. User authenticates
         │ 2. Token registration starts BEFORE /me completes
         ▼
┌─────────────────────────────────────────┐
│  Mobile NotificationService             │
│  registerPushToken(token, deviceId)     │
└────────┬────────────────────────────────┘
         │
         │ 3. POST /notifications/register-token
         ▼
┌─────────────────────────────────────────┐
│  Backend NotificationService            │
│  ⚠️  User profile doesn't exist yet     │
│     (race condition)                    │
└────────┬────────────────────────────────┘
         │
         │ 4. INSERT fails (FK constraint)
         ▼
┌─────────────────────────────────────────┐
│  Backend catches error                  │
│  ✅ Detects FK violation via err.code   │
│     === '23503'                         │
│  ✅ Returns 404 with helpful message    │
└────────┬────────────────────────────────┘
         │
         │ 5. HTTP 404 response
         ▼
┌─────────────────────────────────────────┐
│  Mobile App                             │
│  ✅ Parses status code (404)            │
│  ✅ Logs at INFO level (expected):      │
│     "User profile not yet created"      │
│  ✅ Tries Supabase direct insert        │
│     (might fail too)                    │
│  ✅ Caches token locally for retry      │
└────────┬────────────────────────────────┘
         │
         │ 6. Next app launch (profile exists now)
         ▼
┌─────────────────────────────────────────┐
│  flushPendingPushTokens()               │
│  ✅ Retries cached tokens               │
│  ✅ Success! Token registered           │
└─────────────────────────────────────────┘
```

### Edge Case: Invalid Token Format

```
┌─────────────────┐
│   Mobile App    │
│  (Invalid Token)│
└────────┬────────┘
         │
         │ 1. POST with malformed token
         ▼
┌─────────────────────────────────────────┐
│     Backend API Route                   │
│  ✅ Validates token format               │
│     const pattern = /^Expo(nent)?       │
│                     PushToken\[.+\]$/   │
│  ❌ Token doesn't match pattern         │
└────────┬────────────────────────────────┘
         │
         │ 2. Validation fails
         ▼
┌─────────────────────────────────────────┐
│  Backend API Route                      │
│  ✅ Returns 400 Bad Request             │
│  {error: "Invalid token format",        │
│   details: "Token must be valid Expo    │
│             push token"}                │
└────────┬────────────────────────────────┘
         │
         │ 3. HTTP 400 response
         ▼
┌─────────────────────────────────────────┐
│  Mobile App                             │
│  ✅ Logs warning (not error)            │
│  ✅ Does NOT cache invalid token        │
│  ✅ Does NOT retry                      │
└─────────────────────────────────────────┘
```

### Edge Case: Backend Unreachable

```
┌─────────────────┐
│   Mobile App    │
│  (Offline)      │
└────────┬────────┘
         │
         │ 1. POST request
         ▼
┌─────────────────────────────────────────┐
│     Network                             │
│  ❌ Timeout / Connection refused        │
└────────┬────────────────────────────────┘
         │
         │ 2. Fetch throws error
         ▼
┌─────────────────────────────────────────┐
│  Mobile NotificationService             │
│  catch (error) {                        │
│    // Backend unreachable               │
└────────┬────────────────────────────────┘
         │
         │ 3. Try fallback: Supabase direct
         ▼
┌─────────────────────────────────────────┐
│  Supabase Client                        │
│  ✅ Direct insert to push_tokens        │
│     via RLS-protected endpoint          │
└────────┬────────────────────────────────┘
         │
         │ 4. If Supabase also fails...
         ▼
┌─────────────────────────────────────────┐
│  Mobile NotificationService             │
│  ✅ Cache token in AsyncStorage         │
│     key: 'notifications:pending_tokens' │
│  ✅ Logs: "Cached push token for        │
│     later registration"                 │
└────────┬────────────────────────────────┘
         │
         │ 5. Next launch (network restored)
         ▼
┌─────────────────────────────────────────┐
│  flushPendingPushTokens()               │
│  ✅ Reads cached tokens                 │
│  ✅ Retries registration                │
│  ✅ Success! Token registered           │
│  ✅ Clears cache                        │
└─────────────────────────────────────────┘
```

## Key Improvements

### Error Detection
```typescript
// BEFORE: String matching (fragile)
if (error.message.includes('foreign key')) { ... }

// AFTER: Proper error code checking
if (err?.code === '23503' ||  // Postgres FK violation
    err?.constraint_name?.includes('user_id')) { ... }
```

### Token Validation
```typescript
// BEFORE: No validation
await notificationService.registerPushToken(userId, token, deviceId);

// AFTER: Regex validation
const pattern = /^Expo(nent)?PushToken\[.+\]$/;
if (!pattern.test(token)) {
  return reply.code(400).send({ ... });
}
```

### Error Logging
```typescript
// BEFORE: All errors logged equally
console.error('Error registering push token:', error);

// AFTER: Intelligent logging levels
const statusCode = parseStatusCode(error);
if (statusCode === 404 || statusCode === 409) {
  console.log('[INFO] Expected failure...');
} else if (statusCode >= 500) {
  console.error('Server error...');
} else {
  console.warn('Client error...');
}
```

### Status Codes
```typescript
// BEFORE: Generic 500 for everything
return reply.code(500).send({ ... });

// AFTER: Specific status codes
if (isProfileNotFound) {
  return reply.code(404).send({ ... });  // Not Found
}
if (isFKViolation) {
  return reply.code(409).send({ ... });  // Conflict
}
return reply.code(500).send({ ... });    // Server Error
```

## Testing the Fix

Run the test script:
```bash
./scripts/test-push-token-registration.sh http://localhost:3001 YOUR_AUTH_TOKEN
```

Expected results:
- ✅ Test 1: Valid token → 200 OK (or 404 if profile not created)
- ✅ Test 2: Invalid format → 400 Bad Request
- ✅ Test 3: Missing token → 400 Bad Request
- ✅ Test 4: Empty token → 400 Bad Request
- ✅ Test 5: Alt format → 200 OK (or 404 if profile not created)
