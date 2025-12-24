# Push Notification Troubleshooting Guide

This guide provides step-by-step instructions for diagnosing and resolving push notification registration errors in the BOUNTYExpo application.

## Common Errors

### Error: "Failed to register push token (500)"

**Symptoms:**
- Console shows: `Failed to register push token. URL=http://192.168.x.x:3001/notifications/register-token status=500`
- Error appears during app startup or after user login
- May show: `"error":"Failed to register push token","details":""`

**Root Cause:**
This error typically occurs when:
1. The app attempts to register a push token before the user profile is fully created in the database
2. There's a timing issue between authentication and profile initialization
3. Foreign key constraint violation: `push_tokens.user_id` references `profiles.id` which doesn't exist yet

**Solution:**
As of the latest fix, the backend automatically creates a minimal user profile if one doesn't exist during push token registration. This should resolve the issue automatically.

**If the error persists:**

1. **Force a profile refresh:**
   - Sign out of the app
   - Clear app data (Settings → Apps → BOUNTYExpo → Clear Data)
   - Sign back in

2. **Check backend logs:**
   ```bash
   # In the services/api directory
   npm run dev
   ```
   Look for these log messages:
   - `✅ Created minimal profile for user {userId}`
   - `✅ Registered new push token for user {userId}`

3. **Verify database state:**
   ```sql
   -- Check if user profile exists
   SELECT id, username FROM profiles WHERE id = 'YOUR_USER_ID';
   
   -- Check if push tokens are registered
   SELECT * FROM push_tokens WHERE user_id = 'YOUR_USER_ID';
   ```

---

## Expected Flow

### Normal Operation (Post-Fix)

1. **User Authentication:**
   - User signs up or logs in via Supabase Auth
   - Supabase creates auth user record
   - Auth session is established

2. **Profile Creation:**
   - Client calls `authProfileService.setSession()`
   - Service checks if profile exists in `profiles` table
   - If profile doesn't exist, creates minimal profile:
     ```typescript
     {
       id: userId,
       handle: "user_12345678", // Property maps to 'username' column
     }
     ```

3. **Push Token Registration:**
   - App requests notification permissions
   - Expo generates push token (e.g., `ExponentPushToken[xxxxxxxxxxxxxx]`)
   - Client calls `/notifications/register-token` endpoint
   - **NEW:** Backend automatically ensures profile exists before registration
   - Backend saves token to `push_tokens` table

4. **Retry Mechanism:**
   - If registration fails, token is cached locally
   - Cached tokens are retried on next app launch
   - Supabase fallback: Direct insert via RLS if API fails

---

## Debugging Steps

### 1. Enable Debug Logging

In development mode, the app provides detailed logging. Check the console for:

```
[NotificationService] No active session - skipping push token registration
[NotificationService] User profile not yet created. Backend will create it on next attempt.
[NotificationService] Successfully registered push token with backend
[NotificationService] Successfully registered push token via Supabase fallback
[NotificationService] Cached push token for later registration
```

### 2. Verify Expo Push Token Format

Valid Expo push tokens follow this pattern:
```
ExponentPushToken[xxxxxxxxxxxxxx]
```

Invalid tokens will be rejected with a 400 error.

### 3. Check Network Connectivity

Push token registration requires:
- Active internet connection
- Reachable backend API (default: http://192.168.x.x:3001 in dev)
- Supabase connectivity

Test with:
```bash
curl -X GET http://YOUR_API_URL/health
```

### 4. Inspect Auth State

In React Native Debugger or Chrome DevTools:

```javascript
// Check if user is authenticated
const { data: { session } } = await supabase.auth.getSession();
console.log('Session:', session?.user?.id);

// Check if profile exists
const { data: profile } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', session?.user?.id)
  .single();
console.log('Profile:', profile);
```

### 5. Verify Backend Health

Check if the notification service is running:

```bash
cd services/api
npm run dev
```

Expected output:
```
✅ Supabase auth client initialized
✅ Notification routes registered
Server listening on http://localhost:3001
```

---

## Known Issues & Workarounds

### Issue: "User profile must be created before registering push tokens"

**Status:** FIXED (auto-creates profile now)

**Workaround (if using older version):**
Ensure profile creation happens before push token registration:

```typescript
// In auth-provider.tsx or similar
await authProfileService.setSession(session);
// Wait for profile to be created
await new Promise(resolve => setTimeout(resolve, 1000));
// Now safe to register push token
await notificationService.requestPermissionsAndRegisterToken();
```

### Issue: Tokens not registering on first launch

**Cause:** Network timeout or profile creation delay

**Solution:** 
- Tokens are automatically cached and retried
- On next app launch, cached tokens will be registered
- No user action required

### Issue: Multiple failed registration attempts

**Symptoms:** Console spam with repeated 500 errors

**Solution:**
1. Clear cached tokens:
   ```typescript
   import AsyncStorage from '@react-native-async-storage/async-storage';
   await AsyncStorage.removeItem('notifications:pending_tokens');
   ```

2. Force sign out and back in

3. Verify backend is reachable

---

## Testing Push Notifications

### End-to-End Test

1. **Setup:**
   - Start backend: `cd services/api && npm run dev`
   - Start Expo: `npx expo start`
   - Open app on physical device (simulators don't support push notifications)

2. **Register:**
   - Sign up with new account
   - Grant notification permissions when prompted
   - Check console for: `✅ Registered new push token for user {userId}`

3. **Verify:**
   ```sql
   SELECT * FROM push_tokens WHERE user_id = 'YOUR_USER_ID';
   ```

4. **Send Test Notification:**
   ```typescript
   // In services/api
   import { notificationService } from './services/notification-service';
   
   await notificationService.sendPushNotification(
     'USER_ID',
     'Test Notification',
     'This is a test push notification',
     { test: true }
   );
   ```

5. **Confirm Receipt:**
   - Notification should appear on device
   - Check Expo push receipt logs

---

## Environment Variables

Ensure these are set correctly:

### Client (.env)
```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3001 # Dev only
```

### Backend (services/api/.env)
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
DATABASE_URL=postgresql://user:pass@host:5432/db
```

---

## Database Schema Reference

### profiles table
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT,
  balance INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### push_tokens table
```sql
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  token TEXT NOT NULL,
  device_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Support Escalation

If you've followed all troubleshooting steps and still encounter issues:

1. **Collect Logs:**
   - Client console output (full session)
   - Backend logs (services/api/logs)
   - Database query results

2. **System Information:**
   - Device OS and version
   - App version (from package.json)
   - Expo SDK version
   - Network environment (WiFi, LTE, VPN)

3. **Reproduction Steps:**
   - Clear sequence of actions that trigger the error
   - Screenshots of error messages
   - Relevant code changes (if any)

4. **Create Issue:**
   - Open GitHub issue with template
   - Include all collected information
   - Tag with `bug` and `notifications` labels

---

## Prevention Best Practices

### For Developers

1. **Always ensure auth before notifications:**
   ```typescript
   const session = await supabase.auth.getSession();
   if (!session?.user) {
     console.log('Skipping push token - no session');
     return;
   }
   ```

2. **Handle errors gracefully:**
   ```typescript
   try {
     await notificationService.registerPushToken(token);
   } catch (error) {
     // Don't block user experience for notification failures
     console.log('Push token registration deferred');
   }
   ```

3. **Test profile creation flow:**
   - New user signup
   - Existing user login
   - Profile migration scenarios

4. **Monitor backend health:**
   - Set up alerts for 500 errors
   - Track push token registration success rate
   - Monitor foreign key constraint violations

### For Users

1. **Grant permissions promptly:** Allow notifications when first prompted
2. **Keep app updated:** Latest version has best error handling
3. **Stable network:** Register tokens on good WiFi/LTE connection
4. **Complete onboarding:** Finish profile setup to ensure data consistency

---

## Changelog

### Version 1.0 (2025-01-XX)
- **FIXED:** Automatic profile creation during push token registration
- **IMPROVED:** Error messages and logging
- **ADDED:** Retry mechanism with local caching
- **ADDED:** Supabase fallback for API failures

### Version 0.9 (Previous)
- Initial implementation
- Foreign key constraint errors possible
- Manual profile creation required

---

## Related Documentation

- [NOTIFICATIONS_IMPLEMENTATION_SUMMARY.md](./NOTIFICATIONS_IMPLEMENTATION_SUMMARY.md) - Full notification system architecture
- [NOTIFICATIONS_SETUP_GUIDE.md](./NOTIFICATIONS_SETUP_GUIDE.md) - Initial setup instructions
- [COPILOT_AGENT.md](./COPILOT_AGENT.md) - Project conventions and patterns

---

## Quick Reference

### Common Commands

```bash
# View backend logs
cd services/api && npm run dev

# Clear app data (dev)
npx expo start --clear

# Check database
psql $DATABASE_URL -c "SELECT * FROM push_tokens LIMIT 10;"

# Test push notification
curl -X POST http://localhost:3001/notifications/register-token \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"token":"ExponentPushToken[xxx]"}'
```

### Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Invalid token format | Check token pattern |
| 401 | Unauthorized | Verify auth session |
| 404 | Profile not found | Auto-created now (post-fix) |
| 409 | Token already exists | Safe to ignore |
| 500 | Server error | Check backend logs |

---

**Last Updated:** 2025-01-XX  
**Maintained By:** BOUNTYExpo Development Team  
**Questions?** Open a GitHub issue or contact support
