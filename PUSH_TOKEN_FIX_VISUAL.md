# Push Token Registration Fix - Visual Flow Diagram

## Problem: Original Flow (Before Fix)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User Signs Up/Logs In                                        │
│    - Supabase Auth creates auth.users record                    │
│    - JWT token issued                                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. App Requests Notification Permissions                        │
│    - User grants permissions                                     │
│    - Expo generates push token                                   │
│    - Token: ExponentPushToken[xxxxxxxxxxxxxx]                   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. Client Calls /notifications/register-token                   │
│    POST /notifications/register-token                            │
│    Headers: { Authorization: "Bearer <jwt>" }                   │
│    Body: { token: "ExponentPushToken[...]", deviceId: "..." }  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Backend Attempts Token Registration                          │
│    INSERT INTO push_tokens (user_id, token, device_id)          │
│    VALUES ('user-uuid', 'ExponentPushToken[...]', 'device')     │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ ❌ ERROR: Foreign Key Constraint Violation                       │
│                                                                  │
│ push_tokens.user_id references profiles.id                      │
│ BUT profiles.id doesn't exist yet!                              │
│                                                                  │
│ Result: 500 Internal Server Error                               │
│ {"error":"Failed to register push token","details":""}          │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. Client Shows Error                                            │
│    Console: "Failed to register push token (500)"               │
│    User sees: Red LogBox error screen                            │
└─────────────────────────────────────────────────────────────────┘
```

## Root Cause

**Timing Issue:**
- Profile creation in `profiles` table happens asynchronously
- Push token registration happens immediately after auth
- Race condition: Token registration often wins the race

**Database Constraint:**
```sql
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id), ← Foreign Key!
  token TEXT NOT NULL,
  device_id TEXT,
  ...
);
```

## Solution: Fixed Flow (After Fix)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User Signs Up/Logs In                                        │
│    - Supabase Auth creates auth.users record                    │
│    - JWT token issued                                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. App Requests Notification Permissions                        │
│    - User grants permissions                                     │
│    - Expo generates push token                                   │
│    - Token: ExponentPushToken[xxxxxxxxxxxxxx]                   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. Client Calls /notifications/register-token                   │
│    POST /notifications/register-token                            │
│    Headers: { Authorization: "Bearer <jwt>" }                   │
│    Body: { token: "ExponentPushToken[...]", deviceId: "..." }  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Backend: Ensure Profile Exists                               │
│    ┌──────────────────────────────────────────────────────────┐│
│    │ NEW: ensureUserProfile(userId)                           ││
│    │                                                           ││
│    │ 4a. Check if profile exists:                             ││
│    │     SELECT * FROM profiles WHERE id = 'user-uuid'        ││
│    │                                                           ││
│    │ 4b. If profile exists:                                   ││
│    │     ✅ Return true, proceed to step 5                    ││
│    │                                                           ││
│    │ 4c. If profile missing:                                  ││
│    │     📝 Create minimal profile:                           ││
│    │     INSERT INTO profiles (id, username)                  ││
│    │     VALUES ('user-uuid', 'user_1234567890abcdef...')    ││
│    │     ✅ Return true, proceed to step 5                    ││
│    └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. Backend: Register Push Token                                 │
│    Now safe to insert:                                           │
│    INSERT INTO push_tokens (user_id, token, device_id)          │
│    VALUES ('user-uuid', 'ExponentPushToken[...]', 'device')     │
│                                                                  │
│    ✅ Success! Foreign key constraint satisfied                  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. Backend Returns Success                                       │
│    Status: 200 OK                                                │
│    Body: { "success": true }                                     │
│    Console: "✅ Registered new push token for user {userId}"    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. Client Confirms Registration                                 │
│    Console: "[NotificationService] Successfully registered       │
│             push token with backend"                             │
│    No error shown to user ✅                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Key Changes

### Backend: `services/api/src/services/notification-service.ts`

**New Method:**
```typescript
private async ensureUserProfile(userId: string): Promise<boolean> {
  try {
    // 1. Check if profile exists
    const existingProfile = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existingProfile.length > 0) {
      return true; // Profile exists, good to go
    }

    // 2. Create minimal profile
    console.log(`📝 Creating minimal profile for user ${userId}`);
    const handle = `user_${userId.replace(/-/g, '')}`;
    
    await db.insert(users).values({
      id: userId,
      handle: handle,
    });
    
    console.log(`✅ Created minimal profile for user ${userId}`);
    return true;
    
  } catch (error) {
    // Handle race condition: profile created by another process
    if (error?.code === '23505') { // Duplicate key
      console.log(`ℹ️  Profile already exists (concurrent creation)`);
      return true;
    }
    
    console.error(`❌ Error ensuring profile:`, error);
    return false;
  }
}
```

**Updated Method:**
```typescript
async registerPushToken(userId: string, token: string, deviceId?: string) {
  try {
    // NEW: Ensure profile exists first
    const profileExists = await this.ensureUserProfile(userId);
    if (!profileExists) {
      throw new Error(`Failed to ensure user profile exists`);
    }

    // Now safe to register token...
    // (rest of method unchanged)
  } catch (error) {
    // Improved error handling
  }
}
```

### Client: `lib/services/notification-service.ts`

**Improved Error Handling:**
```typescript
if (!response.ok) {
  const text = await safeReadResponseText(response);
  
  if (response.status === 404) {
    // Profile doesn't exist - backend will create it
    console.log(`[NotificationService] User profile not yet created. 
                 Backend will create it on next attempt.`);
  } else if (response.status === 409) {
    // Token already registered - this is fine!
    console.log(`[NotificationService] Push token already registered`);
    return; // Don't throw error for 409
  } else if (response.status >= 500) {
    console.error(`Failed to register push token: ${text}`);
  }
  
  throw new Error(`Failed to register push token (${response.status})`);
}
```

## Race Condition Handling

The fix handles concurrent profile creation gracefully:

```
Time: t0                t1                  t2                  t3
      │                 │                   │                   │
User A│ Login          │ Check profile     │ Create profile    │ ✅
      │                 │ (not found)       │ INSERT            │
      │                 │                   │                   │
User A│ (same device)  │                   │ Check profile     │ ✅
Tab 2 │ Login          │ Check profile     │ (already exists)  │
      │                 │ (not found)       │                   │
      │                 │                   │ Try CREATE        │
      │                 │                   │ (duplicate key)   │
      │                 │                   │ Handle 23505      │ ✅
```

**Result:** Both attempts succeed, no errors thrown

## Fallback Mechanisms

The client has multiple fallback layers:

```
┌────────────────────────────────────────────────┐
│ Layer 1: Primary API Call                      │
│ POST /notifications/register-token             │
│ ✅ Success → Done                               │
│ ❌ Failure → Layer 2                            │
└────────────────────────────────────────────────┘
                   ↓
┌────────────────────────────────────────────────┐
│ Layer 2: Direct Supabase Insert                │
│ supabase.from('push_tokens').upsert(...)       │
│ ✅ Success → Done                               │
│ ❌ Failure → Layer 3                            │
└────────────────────────────────────────────────┘
                   ↓
┌────────────────────────────────────────────────┐
│ Layer 3: Cache Token for Retry                 │
│ AsyncStorage.setItem('pending_tokens', ...)    │
│ Will retry on next app launch                  │
│ ✅ Cached → User not blocked                    │
└────────────────────────────────────────────────┘
```

## Testing Scenarios

### Scenario 1: New User Signup ✅
```
1. User signs up with email/password
2. Auth user created
3. Profile doesn't exist yet
4. Push token registration triggered
5. Backend auto-creates profile
6. Token registered successfully
```

### Scenario 2: Existing User Login ✅
```
1. User logs in
2. Profile already exists
3. Push token registration triggered
4. Profile check passes immediately
5. Token registered or updated
```

### Scenario 3: Network Failure ✅
```
1. User logs in
2. Push token registration attempted
3. Network timeout or API unreachable
4. Token cached to AsyncStorage
5. Retry on next app launch
6. Success on retry
```

### Scenario 4: Concurrent Requests ✅
```
1. Multiple tabs/devices login simultaneously
2. All attempt profile creation
3. First one succeeds
4. Others get duplicate key error (23505)
5. All handle gracefully
6. All tokens registered successfully
```

## Monitoring & Observability

### Backend Logs to Watch For

**Success:**
```
📝 Creating minimal profile for user abc123...
✅ Created minimal profile for user abc123
✅ Registered new push token for user abc123
```

**Race Condition (Handled):**
```
📝 Creating minimal profile for user abc123...
ℹ️  Profile for user abc123 already exists (concurrent creation)
✅ Registered new push token for user abc123
```

**Error (Needs Investigation):**
```
❌ Error ensuring user profile exists for abc123: <error details>
❌ Error registering push token for user abc123: <error details>
```

### Client Logs to Watch For

**Success:**
```
[NotificationService] Successfully registered push token with backend
```

**Expected During Signup:**
```
[NotificationService] User profile not yet created. Backend will create it on next attempt.
[NotificationService] Successfully registered push token with backend
```

**Fallback Used:**
```
[NotificationService] Successfully registered push token via Supabase fallback
```

**Deferred (Will Retry):**
```
[NotificationService] Cached push token for later registration
```

## Benefits of This Fix

1. **✅ Zero User-Facing Errors:** No more scary red error screens
2. **✅ Automatic Recovery:** Profile created automatically when needed
3. **✅ Race Condition Safe:** Handles concurrent creation gracefully
4. **✅ Multiple Fallbacks:** Three layers of resilience
5. **✅ Better Observability:** Clear emoji-tagged logs for debugging
6. **✅ Backwards Compatible:** Existing users unaffected

## Related Files

- `services/api/src/services/notification-service.ts` - Backend service
- `services/api/src/routes/notifications.ts` - API routes
- `lib/services/notification-service.ts` - Client service
- `PUSH_NOTIFICATION_TROUBLESHOOTING.md` - Detailed troubleshooting guide

---

**Last Updated:** 2025-01-XX  
**Fix Version:** 1.0  
**Status:** ✅ Implemented & Tested
