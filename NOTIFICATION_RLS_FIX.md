# Notification Push Token & RLS Resolution

## Problem Analysis

You were getting 500 errors when trying to:
1. Register push tokens: `ERROR  Failed to register push token`
2. Fetch unread notifications: `ERROR  Failed to fetch unread count`

**Root Cause:** The `notifications`, `push_tokens`, and `notification_preferences` tables did not have Row Level Security (RLS) policies enabled. When using real Supabase authentication, RLS prevents queries from succeeding unless explicit policies allow them. Since your auth setup uses real Supabase credentials (not the dev fallback), RLS was blocking all queries.

## Solution Implemented

### 1. Applied RLS Policies ✅
Created and executed RLS policies for three tables:

**notifications table:**
- Users can SELECT only their own notifications
- Users can INSERT notifications for themselves
- Users can UPDATE only their own notifications

**push_tokens table:**
- Users can SELECT only their own tokens
- Users can INSERT their own tokens
- Users can UPDATE their own tokens
- Users can DELETE their own tokens

**notification_preferences table:**
- Users can SELECT only their own preferences
- Users can INSERT their own preferences
- Users can UPDATE their own preferences

### 2. Enhanced Error Logging
Updated two files to provide better debugging information:
- [services/api/src/routes/notifications.ts](services/api/src/routes/notifications.ts) - Now captures full error messages in API responses
- [services/api/src/services/notification-service.ts](services/api/src/services/notification-service.ts) - Added try/catch blocks with detailed error context

### 3. Created Migration Files
- [services/api/migrations/20251216_add_notifications_rls.sql](services/api/migrations/20251216_add_notifications_rls.sql) - For local/Docker deployments
- [supabase/migrations/20251216_add_notifications_rls.sql](supabase/migrations/20251216_add_notifications_rls.sql) - For Supabase Dashboard

### 4. Created Helper Scripts
- [apply-rls.mjs](apply-rls.mjs) - Node.js script that applied policies (✅ already executed)
- [apply-rls.ps1](apply-rls.ps1) - PowerShell script for manual execution if needed
- [apply-rls.sh](apply-rls.sh) - Bash script for Linux/macOS

## Verification Status

✅ **RLS Policies Applied Successfully** - All 23 SQL statements executed without errors

```
Summary:
  • Enabled RLS on notifications table
  • Enabled RLS on push_tokens table
  • Enabled RLS on notification_preferences table
```

## Next Steps

1. **Restart Your Backend Server**
   ```bash
   # If using npm
   npm run dev
   
   # If using tsx directly
   tsx services/api/src/index.ts
   ```

2. **Test Push Token Registration**
   - Reopen the mobile app
   - You should see the push token registered successfully
   - Check backend logs for:
     ```
     ✅ Notification routes registered
     Error registering push token: [should not appear]
     ```

3. **Test Fetching Notifications**
   - Pull down on notifications or manually trigger a notification request
   - Unread count should display correctly
   - No 500 errors in response

4. **Expected Behavior**
   - Push tokens for your user ID should be inserted into `push_tokens` table
   - Notifications should be inserted/read from `notifications` table
   - Unread counts should query correctly
   - All operations should respect user isolation (users can only see their own data)

## Database Changes Made

The following RLS policies are now active in your Supabase database:

```sql
-- Users can only access their own notifications
- notifications_select_own (SELECT)
- notifications_insert_own (INSERT)
- notifications_update_own (UPDATE)

-- Users can only access their own push tokens
- push_tokens_select_own (SELECT)
- push_tokens_insert_own (INSERT)
- push_tokens_update_own (UPDATE)
- push_tokens_delete_own (DELETE)

-- Users can only access their own notification preferences
- notification_preferences_select_own (SELECT)
- notification_preferences_insert_own (INSERT)
- notification_preferences_update_own (UPDATE)
```

## Configuration Status

✅ **Supabase Configured:**
- SUPABASE_URL: https://xwlwqzzphmmhghiqvkeu.supabase.co
- DATABASE_URL: postgresql://postgres:***@db.xwlwqzzphmmhghiqvkeu.supabase.co:5432/postgres
- Real auth enabled (not dev fallback)

✅ **API Configuration:**
- EXPO_PUBLIC_API_BASE_URL: http://192.168.0.59:3001
- API_PORT: 3001

## Troubleshooting

If you still get 500 errors after restarting:

1. **Check backend logs** for the full error message (now included in response `details` field)
2. **Verify RLS policies exist:**
   ```sql
   -- In Supabase SQL Editor:
   SELECT tablename, policyname FROM pg_policies 
   WHERE schemaname = 'public' AND tablename IN ('notifications', 'push_tokens', 'notification_preferences');
   ```
3. **Verify user exists in profiles:**
   ```sql
   SELECT id, handle FROM profiles LIMIT 5;
   ```
4. **Check if auth.uid() works in policies:**
   ```sql
   SELECT auth.uid();  -- Should return your current user ID
   ```

## Files Modified

1. ✅ [lib/services/notification-service.ts](lib/services/notification-service.ts#L28-L75) - URL handling fix
2. ✅ [services/api/src/services/notification-service.ts](services/api/src/services/notification-service.ts#L127-143) - Error handling improvements
3. ✅ [services/api/src/routes/notifications.ts](services/api/src/routes/notifications.ts#L43-56) - Error message propagation

## Files Created

1. ✅ [services/api/migrations/20251216_add_notifications_rls.sql](services/api/migrations/20251216_add_notifications_rls.sql)
2. ✅ [supabase/migrations/20251216_add_notifications_rls.sql](supabase/migrations/20251216_add_notifications_rls.sql)
3. ✅ [apply-rls.mjs](apply-rls.mjs) - Executed successfully
4. ✅ [apply-rls.ps1](apply-rls.ps1)
5. ✅ [apply-rls.sh](apply-rls.sh)

## Security Notes

- RLS is now enforced at the database level (not just in code)
- Users cannot access other users' notifications or tokens
- All queries go through Supabase auth checks
- Push tokens are isolated per user
- Notification preferences are isolated per user

This is the correct approach for multi-tenant systems where user isolation is critical.
