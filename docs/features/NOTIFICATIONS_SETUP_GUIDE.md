# Notifications System Setup Guide

## Quick Start

This guide will help you set up and deploy the notifications system that has been implemented.

## Prerequisites

- PostgreSQL database running and accessible
- Node.js and npm installed
- Expo CLI installed (`npm install -g expo-cli`)
- Access to backend API server
- Physical device for testing push notifications (optional, but recommended)

## Step 1: Database Migration

Run the migration to create the notifications tables:

```bash
# Option 1: Using psql
psql $DATABASE_URL < services/api/migrations/20251103_add_notifications_tables.sql

# Option 2: Using node-postgres
cd services/api
npm run db:migrate  # If you have a migration script setup

# Option 3: Manual execution
# Copy the contents of services/api/migrations/20251103_add_notifications_tables.sql
# and run it in your PostgreSQL client (pgAdmin, DBeaver, etc.)
```

Verify the migration succeeded:
```sql
-- Check that tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('notifications', 'push_tokens');

-- Check indexes
SELECT indexname FROM pg_indexes 
WHERE tablename IN ('notifications', 'push_tokens');
```

## Step 2: Install Dependencies

### Frontend (Root)
```bash
cd /path/to/bountyexpo
npm install
```

Dependencies already added:
- `expo-notifications` - Notification framework
- `date-fns` - Date formatting (already present)

### Backend (API Service)
```bash
cd services/api
npm install
```

Dependencies already added:
- `expo-server-sdk` - Push notification service

## Step 3: Configuration

### Backend Environment Variables

Ensure your `.env` file in `services/api` has:
```bash
DATABASE_URL=postgresql://user:password@host:port/database
```

### Frontend Environment Variables

Add to your root `.env` or `app.json`:
```bash
EXPO_PUBLIC_API_URL=https://your-api-url.com
# or
EXPO_PUBLIC_API_URL=http://localhost:3000  # for local development
```

## Step 4: Backend Deployment

1. Build the API service:
```bash
cd services/api
npm run build  # if you have a build script
```

2. Deploy to your server

3. Verify the API is running:
```bash
curl https://your-api-url.com/health
```

4. Test the notification endpoints:
```bash
# Get notifications (requires auth token)
curl -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  https://your-api-url.com/notifications

# Get unread count
curl -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  https://your-api-url.com/notifications/unread-count
```

## Step 5: Test Backend Notifications

Run the test script to verify backend functionality:

```bash
cd services/api
npx tsx src/test-notifications.ts
```

Expected output:
```
🧪 Testing Notifications System

1. Setting up test user...
   ✓ Test user created: test-user

2. Creating test notifications...
   ✓ Created completion notification: abc-123-def
   ✓ Created message notification: xyz-456-uvw
   ✓ Created follow notification: pqr-789-stu

3. Fetching notifications...
   ✓ Retrieved 3 notifications
     1. [completion] Bounty Completed (read: false)
     2. [message] New Message (read: false)
     3. [follow] New Follower (read: false)

...

✅ All tests passed!
```

## Step 6: Frontend Setup

The frontend is already configured with:
- ✅ NotificationProvider in `app/_layout.tsx`
- ✅ NotificationsBell component in `app/tabs/bounty-app.tsx`
- ✅ expo-notifications plugin in `app.json`

### Rebuild the App

After adding the expo-notifications plugin, you need to rebuild:

```bash
# For iOS
npx expo run:ios

# For Android
npx expo run:android

# For development build
eas build --profile development --platform ios
eas build --profile development --platform android
```

> **Note**: You cannot test push notifications in Expo Go. You must create a development build or production build.

## Step 7: Test Push Notifications

### Testing on Physical Device

1. Install your app on a physical device

2. Grant notification permissions when prompted

3. Check that the push token is registered:
   - Open the app
   - Check console logs for: "Push token registered successfully"
   - Verify in database:
   ```sql
   SELECT * FROM push_tokens WHERE user_id = 'YOUR_USER_ID';
   ```

4. Send a test push notification:
   ```bash
   # Use the test script or create a notification via API
   curl -X POST https://your-api-url.com/notifications/test \
     -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "userId": "YOUR_USER_ID",
       "title": "Test Notification",
       "body": "This is a test push notification"
     }'
   ```

5. Verify notification arrives on device

## Step 8: Verify In-App Notifications

1. Open the app
2. Look for the bell icon in the header
3. Tap the bell icon
4. Verify:
   - Notifications list appears
   - Unread count displays correctly
   - Can mark notifications as read
   - Can tap notifications to navigate

## Step 9: Integration with Existing Features

### Add Notification Triggers

See `NOTIFICATIONS_INTEGRATION_GUIDE.md` for detailed examples of how to add notification triggers to:
- Bounty applications
- Message sending
- Follow actions
- Custom events

Example for bounty application:
```typescript
// In your bounty application handler
import { notificationService } from '../services/notification-service';

try {
  await notificationService.notifyBountyApplication(
    hunterId,
    posterId,
    bountyId,
    bountyTitle
  );
} catch (error) {
  console.error('Failed to send notification:', error);
}
```

## Troubleshooting

### Push Notifications Not Working

**Problem**: Push notifications don't arrive on device

**Solutions**:
1. Verify you're not using Expo Go (must be development/production build)
2. Check notification permissions: Settings > Your App > Notifications
3. Verify push token is registered:
   ```sql
   SELECT * FROM push_tokens WHERE user_id = 'YOUR_USER_ID';
   ```
4. Check backend logs for push notification errors
5. Verify Expo push token format: `ExponentPushToken[...]`

### Database Connection Errors

**Problem**: Cannot connect to database

**Solutions**:
1. Verify DATABASE_URL is correct
2. Check database is running
3. Verify network connectivity
4. Check database credentials and permissions

### API Endpoints Return 401

**Problem**: Notification endpoints return Unauthorized

**Solutions**:
1. Verify auth token is valid
2. Check authMiddleware is configured correctly
3. Ensure user is logged in
4. Check token hasn't expired

### Notifications Don't Appear in UI

**Problem**: Bell icon shows but no notifications

**Solutions**:
1. Check API URL is correct in environment variables
2. Verify backend is running and accessible
3. Check browser/app console for errors
4. Verify NotificationProvider is wrapping the app
5. Try manual refresh (pull down in notifications list)

### Build Errors After Adding expo-notifications

**Problem**: App won't build after adding plugin

**Solutions**:
1. Clear cache: `npx expo start --clear`
2. Reinstall dependencies: `rm -rf node_modules && npm install`
3. Clear build cache: `rm -rf ios/build android/build`
4. Rebuild: `npx expo prebuild --clean`

## Testing Checklist

Use this checklist to verify the notifications system:

### Backend
- [ ] Database migration completed successfully
- [ ] API endpoints accessible
- [ ] Test script runs without errors
- [ ] Can create notifications via API
- [ ] Can fetch notifications via API
- [ ] Can mark notifications as read
- [ ] Push tokens can be registered

### Frontend
- [ ] Bell icon appears in header
- [ ] Unread count badge displays
- [ ] Tapping bell opens notification list
- [ ] Notifications display correctly
- [ ] Can mark individual notifications as read
- [ ] Can mark all notifications as read
- [ ] Pull-to-refresh works
- [ ] Tapping notification navigates correctly

### Push Notifications
- [ ] App requests notification permissions
- [ ] Push token is registered on app start
- [ ] Push notifications arrive on device
- [ ] Notification tap opens correct screen
- [ ] Sound/vibration works (if configured)

### Integration
- [ ] Bounty acceptance creates notification
- [ ] Bounty completion creates notifications
- [ ] Payment notifications are sent
- [ ] Custom notifications work

## Monitoring

After deployment, monitor:

1. **Database Performance**
   ```sql
   -- Check notification table size
   SELECT pg_size_pretty(pg_total_relation_size('notifications'));
   
   -- Check index usage
   SELECT * FROM pg_stat_user_indexes WHERE tablename = 'notifications';
   ```

2. **API Performance**
   - Monitor notification endpoint response times
   - Track notification creation rate
   - Monitor push notification delivery rate

3. **User Engagement**
   - Notification read rate
   - Time to read notifications
   - Most common notification types

## Maintenance

### Regular Tasks

1. **Database Cleanup** (recommended: monthly)
   ```typescript
   // Delete notifications older than 90 days
   await notificationService.deleteOldNotifications(90);
   ```

2. **Token Cleanup** (recommended: quarterly)
   ```sql
   -- Remove tokens not updated in 6 months
   DELETE FROM push_tokens 
   WHERE updated_at < NOW() - INTERVAL '6 months';
   ```

3. **Monitoring** (recommended: weekly)
   - Check error logs
   - Review notification delivery rates
   - Verify database performance

## Next Steps

1. **Production Deployment**
   - Deploy database migration
   - Deploy backend API
   - Build and deploy mobile app

2. **Add More Triggers**
   - Implement message notifications
   - Implement follow notifications
   - Add custom business logic notifications

3. **Optimization**
   - Implement WebSocket for real-time updates
   - Add notification grouping
   - Optimize polling strategy

4. **Enhancement**
   - Add notification preferences backend
   - Implement rich notifications
   - Add notification scheduling

## Support

For issues or questions:
- Check `NOTIFICATIONS_INTEGRATION_GUIDE.md` for detailed integration instructions
- Check `NOTIFICATIONS_IMPLEMENTATION_SUMMARY.md` for architecture details
- Review code comments in the implementation files

## Resources

- [Expo Notifications Documentation](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo Push Notifications Guide](https://docs.expo.dev/push-notifications/overview/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- Project documentation in `/docs` folder
