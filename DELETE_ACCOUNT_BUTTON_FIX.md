# Delete Account Button Fix - Summary

## Issue Reported
The delete account button in Settings was failing to successfully delete the logged-in account. Users could still log in after the account was supposedly deleted, and the account remained in the Supabase auth user database.

## Root Cause
The client-side `account-deletion-service.ts` was attempting to use `supabase.auth.admin.deleteUser()`, which requires admin privileges (service role key). Client-side code doesn't have access to the service role key for security reasons, so the deletion was only removing the profile record, not the auth.users record.

## Solution
Created a backend API endpoint that has the necessary permissions to delete from Supabase Auth.

### Changes Made

#### 1. Backend API Endpoint (`api/server.js`)
```javascript
// New endpoint: DELETE /auth/delete-account
- Authenticates user via JWT token in Authorization header
- Uses supabaseAdmin (with service role key) to delete from auth.users
- Returns success/error response
- Logs deletion attempts for debugging
```

#### 2. Client Service Update (`lib/services/account-deletion-service.ts`)
```typescript
// Updated deleteUserAccount() function
- Calls backend API endpoint instead of client-side admin API
- Uses getApiBaseUrl() for proper device URL resolution
- Includes JWT token in Authorization header
- Has fallback to profile deletion if backend unavailable
- Provides clear error messages about backend requirements
```

#### 3. Documentation (`USER_DELETION_FIX.md`)
- Added backend setup instructions
- Documented environment variable requirements
- Added comprehensive troubleshooting section
- Explained backend API connectivity for mobile devices

## How It Works Now

```
User clicks "Delete Account"
          ↓
App calls account-deletion-service.deleteUserAccount()
          ↓
Service gets user session and JWT token
          ↓
Service calls: DELETE /auth/delete-account (backend)
          ↓
Backend authenticates user via JWT token
          ↓
Backend uses supabaseAdmin.auth.admin.deleteUser(userId)
          ↓
Supabase Auth deletes from auth.users
          ↓
CASCADE triggers profile deletion
          ↓
Database trigger (handle_user_deletion_cleanup) runs
          ↓
- Archives active bounties
- Refunds escrowed funds
- Releases hunter assignments
- Rejects pending applications
- Cleans up notifications
          ↓
User is signed out automatically
          ↓
User CANNOT log back in (fully deleted!)
```

## Setup Requirements

### Backend API Server
```bash
# Start the API server (REQUIRED)
npm run api

# Should see these logs:
[SupabaseAdmin] initialized for URL: https://your-project.supabase.co
[SupabaseAdmin] connectivity OK (listUsers)
Server running on port 3000
```

### Environment Variables

**Backend `.env`**:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # REQUIRED!
```

**App `.env`**:
```bash
# For emulator/localhost:
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000

# For physical devices (use your computer's LAN IP):
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.xxx:3000
```

## Testing

1. **Start the backend API**: `npm run api`
2. **Start the app**: `npm start`
3. **Create a test user** and log in
4. **Navigate to Settings** → Scroll to bottom
5. **Tap "Delete Account"** → Confirm
6. **Observe**: User is logged out
7. **Try to log in again** → Should fail with "Invalid credentials"
8. **Check Supabase Dashboard** → User should be gone from Authentication

## Troubleshooting

### "Failed to delete account" error
- Check if backend API is running: `curl http://localhost:3000/health`
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set in backend `.env`
- Check backend logs for error messages

### Network errors on physical device
- Change `localhost` to your computer's LAN IP
- Example: `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.5:3000`
- Make sure firewall allows connections on port 3000

### "Service Unavailable" error
- Backend missing `SUPABASE_SERVICE_ROLE_KEY`
- Check backend startup logs for Supabase admin initialization

### User can still log in after deletion
- Backend API wasn't running during deletion
- Only profile was deleted, not auth.users record
- Delete user manually from Supabase Dashboard
- Ensure backend is running for future deletions

## Verification

After deletion, verify:
- ✅ User cannot log in (should get "Invalid credentials")
- ✅ User is gone from Supabase Auth dashboard
- ✅ Profile record is deleted
- ✅ Active bounties are archived (check `bounties` table)
- ✅ Escrow was refunded (check `wallet_transactions` table)

## Related Commits

- `75fb6ac` - Add backend endpoint and update client service
- `84ca7de` - Update documentation with setup and troubleshooting

## Summary

The delete account button now properly deletes users by calling a backend API endpoint that has the necessary permissions. Users are fully deleted from both the application database and Supabase Auth, and cannot log back in. The backend API server must be running for this to work.
