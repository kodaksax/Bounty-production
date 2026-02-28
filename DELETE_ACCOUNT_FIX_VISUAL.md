# Delete Account Button Fix - Visual Guide

## Before the Fix ❌

```
┌─────────────────────────────────────────┐
│  User taps "Delete Account" button     │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│  account-deletion-service.ts            │
│  tries: supabase.auth.admin.deleteUser()│
└───────────────┬─────────────────────────┘
                ↓
         ❌ FAILS ❌
         (No admin permissions)
                ↓
         Fallback: Delete profile only
                ↓
┌─────────────────────────────────────────┐
│  supabase.from('profiles').delete()     │
│  ✅ Profile deleted                     │
│  ❌ auth.users NOT deleted              │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│  User logged out                        │
│  User tries to log in again             │
│  ✅ SUCCESS - User can log in!         │
│  (auth.users record still exists)      │
└─────────────────────────────────────────┘

PROBLEM: User not actually deleted!
```

## After the Fix ✅

```
┌─────────────────────────────────────────┐
│  User taps "Delete Account" button     │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│  account-deletion-service.ts            │
│  Gets JWT token from session            │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│  Calls Backend API:                     │
│  DELETE /auth/delete-account            │
│  Authorization: Bearer <jwt-token>      │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│  Backend API (api/server.js)            │
│  1. Validates JWT token                 │
│  2. Verifies user identity              │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│  Backend uses supabaseAdmin:            │
│  (has service role key)                 │
│  supabaseAdmin.auth.admin.deleteUser()  │
└───────────────┬─────────────────────────┘
                ↓
         ✅ SUCCESS ✅
                ↓
┌─────────────────────────────────────────┐
│  Supabase Auth deletes auth.users       │
│  ✅ auth.users record deleted           │
└───────────────┬─────────────────────────┘
                ↓
         CASCADE DELETE
                ↓
┌─────────────────────────────────────────┐
│  profiles table deletion                │
│  (due to ON DELETE CASCADE)             │
└───────────────┬─────────────────────────┘
                ↓
    TRIGGER: handle_user_deletion_cleanup()
                ↓
┌─────────────────────────────────────────┐
│  Automatic Cleanup:                     │
│  ✅ Archive active bounties             │
│  ✅ Refund escrowed funds               │
│  ✅ Release hunter assignments          │
│  ✅ Reject pending applications         │
│  ✅ Clean up notifications              │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│  User logged out                        │
│  User tries to log in again             │
│  ❌ FAILS - "Invalid credentials"      │
│  (auth.users record is gone)           │
└─────────────────────────────────────────┘

SUCCESS: User fully deleted!
```

## Architecture Comparison

### BEFORE (Broken) 🔴
```
┌──────────────┐
│  Mobile App  │ (No admin permissions)
│   (Client)   │
└──────┬───────┘
       │ Try admin API ❌
       │ (Fails)
       ↓
┌──────────────┐
│   Supabase   │
│   Database   │
└──────────────┘
  Only deletes profile
  auth.users remains
```

### AFTER (Fixed) 🟢
```
┌──────────────┐
│  Mobile App  │
│   (Client)   │ Sends JWT token
└──────┬───────┘
       │
       ↓ DELETE /auth/delete-account
┌──────────────┐
│  Backend API │ Has admin permissions
│ (api/server) │ (service role key)
└──────┬───────┘
       │
       ↓ supabaseAdmin.auth.admin.deleteUser()
┌──────────────┐
│   Supabase   │
│     Auth     │ Deletes auth.users
└──────┬───────┘
       │ CASCADE
       ↓
┌──────────────┐
│   Database   │ Trigger cleanup
│   (Profile)  │ Deletes everything
└──────────────┘
  User fully deleted!
```

## Request Flow Detail

### Client Request
```
DELETE http://localhost:3000/auth/delete-account
Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
  Content-Type: application/json
```

### Backend Processing
```javascript
// 1. Extract token
const token = req.headers.authorization.substring(7)

// 2. Verify user
const { data: { user } } = await supabaseAdmin.auth.getUser(token)

// 3. Delete user
const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)

// 4. Return success
res.json({ success: true, message: "Account successfully deleted" })
```

### Database Cascade
```sql
-- 1. auth.users deleted by backend
DELETE FROM auth.users WHERE id = 'user-id';

-- 2. CASCADE to profiles (automatic)
-- ON DELETE CASCADE triggers

-- 3. Trigger runs (automatic)
-- handle_user_deletion_cleanup() executes

-- 4. Cleanup actions:
UPDATE bounties SET status = 'archived' WHERE user_id = 'user-id';
INSERT INTO wallet_transactions (type, amount) VALUES ('refund', 50.00);
UPDATE bounties SET accepted_by = NULL WHERE accepted_by = 'user-id';
-- etc...

-- 5. Final profile deletion
-- After trigger completes
```

## Why This Fix Works

### Permission Model
```
┌─────────────────────────────────────────┐
│  CLIENT (Mobile App)                    │
│  ────────────────────                   │
│  Has: Anon key                          │
│  Can: Read/write own data               │
│  Cannot: Delete auth users ❌           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  BACKEND (api/server.js)                │
│  ────────────────────                   │
│  Has: Service role key                  │
│  Can: Read/write any data               │
│  Can: Delete auth users ✅              │
└─────────────────────────────────────────┘
```

### Security Flow
```
1. Client authenticates user
   ↓
2. Client gets JWT token
   ↓
3. Client sends token to backend
   ↓
4. Backend verifies token (ensures user is who they claim)
   ↓
5. Backend uses admin permissions (service role)
   ↓
6. Backend deletes authenticated user
   ↓
7. Database trigger handles cleanup
```

## Environment Setup

### Required Files

**Backend `.env`**
```bash
# Required for admin API
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...  # CRITICAL!
SUPABASE_ANON_KEY=eyJhbGc...
```

**App `.env`**
```bash
# Required to reach backend
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000

# For physical devices:
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.5:3000
```

## Testing Checklist

- [ ] Backend API running (`npm run api`)
- [ ] Backend logs show: `[SupabaseAdmin] initialized`
- [ ] Backend logs show: `[SupabaseAdmin] connectivity OK`
- [ ] App can reach backend (check `EXPO_PUBLIC_API_BASE_URL`)
- [ ] Create test user
- [ ] Log in successfully
- [ ] Navigate to Settings
- [ ] Tap "Delete Account"
- [ ] Confirm deletion
- [ ] User is logged out
- [ ] Try to log in again → Should FAIL
- [ ] Check Supabase Dashboard → User should be GONE

## Common Errors and Solutions

### Error: "Service Unavailable"
```
Cause: Backend missing SUPABASE_SERVICE_ROLE_KEY
Fix: Add to backend .env file
```

### Error: Network request failed
```
Cause: Backend not running or wrong URL
Fix: Start backend (npm run api) and check EXPO_PUBLIC_API_BASE_URL
```

### Error: "Unauthorized"
```
Cause: Invalid or expired JWT token
Fix: Log out and log back in to get fresh token
```

### User still can log in
```
Cause: Backend wasn't running during deletion attempt
Fix: Start backend, delete account again
Manual: Delete user from Supabase Dashboard
```

## Summary

The fix adds a backend API layer that has the necessary permissions (service role key) to delete users from Supabase Auth. The client sends authenticated requests to this backend endpoint, which properly deletes the user from both auth.users and the application database, triggering automatic cleanup.

**Key insight**: Client-side code cannot have service role key (security risk), so deletion must go through a trusted backend server.
