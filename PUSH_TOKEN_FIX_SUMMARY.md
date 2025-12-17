# Push Token Registration Error Fix

## Problem Statement
The mobile app was experiencing console errors when attempting to register push notification tokens:
- Error 1: "Failed to register push token" with URL `http://192.168.0.59:3001/notifications/register-token` returning status=500
- Error 2: "Error registering push token: Error: Failed to register push token"

## Root Cause Analysis

### Backend Issue
The `registerPushToken` method in `services/api/src/services/notification-service.ts` was attempting to create a placeholder user profile if one didn't exist. This approach had several problems:

1. **Foreign Key Constraint Violation**: The `profiles` table in Supabase has a foreign key constraint where `id` references `auth.users(id)`. Creating a profile without a corresponding auth user violated this constraint.

2. **Wrong Place for User Creation**: User profile creation should happen during the authentication flow (via the `/me` endpoint), not during push token registration.

3. **Poor Error Handling**: The API endpoint was catching all errors and returning a generic 500 status code with minimal detail, making debugging difficult.

### Client Issue
The mobile app's notification service was:
- Logging all errors at the same level, creating noise in development
- Not distinguishing between expected failures (profile not yet created) and actual errors
- Not providing enough context about the failure for debugging

## Solution Implemented

### Backend Changes

#### 1. Removed User Creation Logic
```typescript
// BEFORE: Tried to create users, causing FK violations
const userExists = await db.select({ id: users.id }).from(users)...
if (userExists.length === 0) {
  await db.insert(users).values({ id: userId, handle: fallbackHandle })...
}

// AFTER: Let it fail with a helpful error if user doesn't exist
// User creation now happens via /me endpoint during auth flow
await db.insert(pushTokens).values({ user_id: userId, token, device_id: deviceId });
```

#### 2. Improved Error Detection
```typescript
// Check for Postgres FK violation using error code
const err = error as any;
if (err?.code === '23503' || // Postgres FK violation code
    err?.constraint_name?.includes('user_id') ||
    (error instanceof Error && error.message.includes('foreign key constraint'))) {
  throw new Error(`User profile must be created before registering push tokens...`);
}
```

#### 3. Better Status Codes in Route Handler
```typescript
// Return appropriate HTTP status codes
if (errorMsg.includes('User profile must be created')) {
  return reply.code(404).send({ ... }); // Not Found
}
if (errorMsg.includes('foreign key constraint')) {
  return reply.code(409).send({ ... }); // Conflict
}
return reply.code(500).send({ ... }); // Internal Server Error
```

#### 4. Token Format Validation
```typescript
// Validate Expo push token format using regex
const expoTokenPattern = /^Expo(nent)?PushToken\[.+\]$/;
if (!expoTokenPattern.test(token)) {
  return reply.code(400).send({ error: 'Invalid token format' });
}
```

### Frontend Changes

#### 1. Intelligent Error Logging
```typescript
// Parse status code from error and log appropriately
let statusCode: number | undefined;
if (error instanceof Error) {
  const statusMatch = error.message.match(/\((\d{3})\)/);
  if (statusMatch) {
    statusCode = parseInt(statusMatch[1], 10);
  }
}

const isExpectedError = statusCode === 404 || statusCode === 409;
if (!isExpectedError) {
  console.error('Error registering push token:', error);
}
```

#### 2. Differentiated Logging Levels
```typescript
// Log at different levels based on response status
if (response.status === 404 || response.status === 409) {
  // User profile doesn't exist yet - expected on first launch
  if (__DEV__) {
    console.log(`[NotificationService] User profile not yet created (${response.status})...`);
  }
} else if (response.status >= 500) {
  console.error(`Failed to register push token...`);
} else {
  console.warn(`Failed to register push token...`);
}
```

#### 3. Improved Fallback Mechanisms
The client already had good fallback logic, which we preserved:
1. Try API endpoint
2. If fails, try direct Supabase insert
3. If that fails, cache token for retry on next launch

## Expected Behavior After Fix

### First Launch (New User)
1. User authenticates
2. `/me` endpoint is called, creating the user profile
3. Push token registration is attempted
4. **Success**: Token is registered in database

### Subsequent Launches (Existing User)
1. User session is restored
2. Push token registration is attempted
3. **Success**: Token is registered/updated in database

### Edge Cases Handled

#### Backend Unreachable
1. API call fails/times out
2. Client falls back to direct Supabase insert
3. If that fails, token is cached locally
4. On next successful connection, cached token is registered

#### Profile Not Yet Created (Race Condition)
1. Token registration attempted before `/me` endpoint completes
2. API returns 404 with helpful message
3. Client logs this at info level (not error)
4. Token is cached for retry
5. On next app launch, after profile exists, registration succeeds

#### Invalid Token Format
1. API validates token format using regex
2. Returns 400 Bad Request with clear error message
3. Client logs this as a warning
4. Token is not cached (it's invalid)

## Testing Strategy

### Manual Testing Steps

1. **Fresh Install Test**
   ```
   1. Uninstall app completely
   2. Reinstall and launch
   3. Sign in/sign up
   4. Check console logs
   5. Verify token appears in push_tokens table
   ```

2. **Token Update Test**
   ```
   1. Launch app with existing user
   2. Check console logs
   3. Verify token timestamp updated in database
   ```

3. **Offline Test**
   ```
   1. Disconnect device from network
   2. Launch app
   3. Verify token is cached locally
   4. Reconnect network
   5. Verify token is registered on next launch
   ```

4. **Invalid Token Test**
   ```
   1. Modify code to send invalid token
   2. Launch app
   3. Verify 400 error is returned
   4. Verify clear error message in logs
   ```

### Automated Testing

The fix includes:
- ✅ Security scan (CodeQL) - passed
- ✅ Type checking - no new errors
- ✅ Code review - feedback addressed

### What to Look For in Logs

**Good (Expected) Logs:**
```
✅ Registered new push token for user abc123
[NotificationService] Successfully registered push token with backend
```

**Acceptable (First Launch) Logs:**
```
[NotificationService] User profile not yet created (404). Will retry after profile creation.
[NotificationService] Cached push token for later registration
```

**Bad (Needs Investigation) Logs:**
```
❌ Error registering push token for user abc123: <details>
Failed to register push token. URL=... status=500 body=...
```

## Files Changed

1. **lib/services/notification-service.ts** (Mobile client)
   - Improved error logging
   - Added status code parsing
   - Better fallback handling

2. **services/api/src/services/notification-service.ts** (Backend service)
   - Removed user creation logic
   - Improved error detection using Postgres error codes
   - Added detailed logging

3. **services/api/src/routes/notifications.ts** (Backend route)
   - Added token format validation
   - Improved error handling with specific status codes
   - Better error messages

## Migration Notes

### Database
No database changes required. The fix works with the existing schema.

### Deployment
1. Deploy backend changes first
2. Deploy mobile app update
3. No breaking changes - backward compatible

### Monitoring
After deployment, monitor:
- Push token registration success rate
- 404/409 errors (should be temporary and resolve quickly)
- 500 errors (should decrease significantly)

## Future Improvements

1. **Add Retry Logic**: Implement exponential backoff for token registration retries
2. **Token Cleanup**: Add cron job to remove stale/expired tokens
3. **Metrics**: Track token registration success/failure rates
4. **Testing**: Add integration tests for push token registration flow

## References

- Issue: [Failure to register push token Errors](https://github.com/kodaksax/Bounty-production/issues/...)
- PR: [Fix Push Token Registration Errors](#)
- Related: NOTIFICATIONS_IMPLEMENTATION_SUMMARY.md
