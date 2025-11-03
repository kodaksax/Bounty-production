# Notifications System Integration Guide

## Overview
The notifications system is now implemented in BOUNTYExpo with support for both in-app and push notifications. This guide explains how to trigger notifications from various parts of the application.

## Architecture

### Backend Components
- **Database Tables**: `notifications` and `push_tokens` tables (see migration: `services/api/migrations/20251103_add_notifications_tables.sql`)
- **Notification Service**: `services/api/src/services/notification-service.ts`
- **API Routes**: `services/api/src/routes/notifications.ts`

### Frontend Components
- **Notification Service**: `lib/services/notification-service.ts`
- **Notification Context**: `lib/context/notification-context.tsx`
- **NotificationsBell Component**: `components/notifications-bell.tsx`
- **Types**: `lib/types.ts` (Notification and NotificationType)

## Notification Types

The system supports six notification types:
1. `application` - When someone applies to a bounty
2. `acceptance` - When a bounty request is accepted
3. `completion` - When a bounty is marked as complete
4. `payment` - When payment is received
5. `message` - When a new message is received
6. `follow` - When someone follows you

## How to Trigger Notifications

### 1. Bounty Acceptance
**Already implemented in**: `services/api/src/services/bounty-service.ts`

```typescript
import { notificationService } from './notification-service';

// After accepting a bounty
await notificationService.notifyBountyAcceptance(hunterId, bountyId, bounty.title);
```

### 2. Bounty Completion
**Already implemented in**: `services/api/src/services/bounty-service.ts`

```typescript
// Notify poster that bounty is complete
await notificationService.notifyBountyCompletion(posterId, bountyId, bounty.title);

// Notify hunter about payment
if (bounty.amount_cents > 0) {
  await notificationService.notifyPayment(hunterId, bounty.amount_cents, bountyId, bounty.title);
}
```

### 3. Bounty Application
**To be implemented** in the bounty application handler:

```typescript
// When a hunter applies to a bounty
await notificationService.notifyBountyApplication(
  hunterId,
  posterId,
  bountyId,
  bountyTitle
);
```

### 4. New Message
**To be implemented** in the message service:

```typescript
// When sending a message
await notificationService.notifyMessage(
  recipientId,
  senderId,
  senderName,
  messagePreview
);
```

### 5. New Follower
**To be implemented** in the follow service:

```typescript
// When user follows another user
await notificationService.notifyFollow(
  followedUserId,
  followerId,
  followerName
);
```

## Custom Notifications

For custom notification needs, use the generic `createNotification` method:

```typescript
import { notificationService } from './notification-service';

await notificationService.createNotification({
  userId: 'recipient-user-id',
  type: 'application', // or any valid NotificationType
  title: 'Custom Title',
  body: 'Custom message body',
  data: {
    bountyId: 'bounty-123',
    customField: 'custom-value',
  },
}, true); // second parameter controls whether to send push notification
```

## Frontend Usage

### Accessing Notifications in Components

```typescript
import { useNotifications } from '../lib/context/notification-context';

function MyComponent() {
  const {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotifications();
  
  // Use notifications in your component
}
```

### Manual Notification Fetch

```typescript
import { notificationService } from '../lib/services/notification-service';

// Fetch notifications
const notifications = await notificationService.fetchNotifications(50, 0);

// Get unread count
const count = await notificationService.getUnreadCount();

// Mark as read
await notificationService.markAsRead(['notif-id-1', 'notif-id-2']);

// Mark all as read
await notificationService.markAllAsRead();
```

## Push Notifications

### Registering for Push Notifications

The app automatically requests permissions and registers push tokens on startup via the `NotificationProvider`. To manually register:

```typescript
import { notificationService } from '../lib/services/notification-service';

const token = await notificationService.requestPermissionsAndRegisterToken();
```

### Handling Notification Taps

Navigation is automatically handled by the `NotificationProvider` based on the notification's data payload:
- `bountyId` → Navigate to bounty detail screen
- `senderId` → Navigate to messenger
- `followerId` → Navigate to user profile

## Database Migration

To apply the database schema changes, run the migration:

```bash
# Navigate to the API service
cd services/api

# Run migration using your database tool
psql $DATABASE_URL < migrations/20251103_add_notifications_tables.sql
```

## Testing Notifications

### Backend Testing

```typescript
// In your test file or API route
import { notificationService } from '../services/notification-service';

// Create a test notification
const notification = await notificationService.createNotification({
  userId: 'test-user-id',
  type: 'completion',
  title: 'Test Notification',
  body: 'This is a test',
  data: { bountyId: 'test-bounty-123' },
}, false); // false = don't send push notification

console.log('Created notification:', notification);
```

### Frontend Testing

The notifications bell appears in the header of the bounty-app screen. You can:
1. Tap the bell icon to see all notifications
2. Tap a notification to navigate to relevant content
3. Use "Mark all read" to clear unread count
4. Pull to refresh to fetch latest notifications

## Configuration

### Environment Variables

Make sure your environment has:
- `EXPO_PUBLIC_API_URL` - URL for the backend API
- `DATABASE_URL` - PostgreSQL connection string (backend)

### App Configuration

The expo-notifications plugin is configured in `app.json`:
```json
{
  "expo": {
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/images/icon.png",
          "color": "#10b981",
          "sounds": ["./assets/sounds/notification.wav"]
        }
      ]
    ]
  }
}
```

## Best Practices

1. **Always wrap in try-catch**: Notification sending should never break the main flow
   ```typescript
   try {
     await notificationService.notifyBountyAcceptance(...);
   } catch (error) {
     console.error('Failed to send notification:', error);
   }
   ```

2. **Check permissions**: Before showing notification-related UI, check if user has granted permissions

3. **Batching**: For multiple notifications, consider batching them or using a queue to avoid overwhelming users

4. **Data payload**: Always include relevant IDs in the `data` field for proper navigation

5. **Testing**: Test both in-app and push notifications on physical devices, as emulators have limitations

## Troubleshooting

### Push notifications not working
- Check that the device has granted notification permissions
- Verify the Expo push token is registered with the backend
- Check the backend logs for push notification sending errors
- Ensure `expo-notifications` is properly configured in `app.json`

### In-app notifications not updating
- Verify the NotificationProvider is wrapping your app in `_layout.tsx`
- Check that the API endpoints are accessible
- Look for errors in the console related to notification fetching

### Navigation not working from notifications
- Ensure the `data` payload includes the necessary IDs
- Check that the routes exist in your app structure
- Verify the NotificationProvider's tap handler is configured correctly

## Future Enhancements

Potential improvements to consider:
- Notification preferences per type (already in settings, needs backend integration)
- Notification grouping (e.g., "3 new bounty applications")
- Real-time notification updates via WebSocket
- Rich notifications with images/actions
- Sound and vibration customization
- Notification history pruning/archiving
