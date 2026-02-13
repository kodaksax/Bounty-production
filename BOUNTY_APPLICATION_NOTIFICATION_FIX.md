# Bounty Application Notification Implementation

## Problem
Beta testers reported that bounty posters were not receiving notifications when hunters applied to their posted bounties. Both push notifications and in-app notifications were missing.

## Root Cause
The bounty request creation endpoint (`POST /api/bounty-requests`) in `services/api/src/routes/consolidated-bounty-requests.ts` was creating application records but not triggering the notification service.

## Solution

### Changes Made

#### 1. Import Notification Service
```typescript
// services/api/src/routes/consolidated-bounty-requests.ts (line 26)
import { notificationService } from '../services/notification-service';
```

#### 2. Include Bounty Title in Query
```typescript
// Line 548 - Added 'title' to the select query
const { data: bounty, error: bountyError } = await supabase
  .from('bounties')
  .select('id, user_id, poster_id, status, title')  // Added 'title'
  .eq('id', body.bounty_id)
  .single();
```

#### 3. Send Notification After Successful Application
```typescript
// Lines 629-647 - Added notification sending with error handling
request.log.info(
  { userId, requestId: bountyRequest.id, bountyId: body.bounty_id },
  'Bounty request created successfully'
);

// Send notification to the bounty poster
try {
  await notificationService.notifyBountyApplication(
    userId,           // hunterId - the applicant
    posterId,         // posterId - receives the notification
    body.bounty_id,   // bountyId
    bounty.title      // bountyTitle
  );
  request.log.info(
    { posterId, bountyId: body.bounty_id },
    'Application notification sent to poster'
  );
} catch (notificationError) {
  // Log error but don't fail the request - notification failure shouldn't block application
  request.log.error(
    { error: notificationError, posterId, bountyId: body.bounty_id },
    'Failed to send application notification'
  );
}

reply.code(201);
return bountyRequest;
```

## How It Works

### Flow Diagram
```
Hunter applies to bounty
         ↓
POST /api/bounty-requests
         ↓
Validate bounty & hunter
         ↓
Create bounty_request record
         ↓
✨ NEW: Send notification ✨
         ↓
Create in-app notification (notifications table)
         ↓
Send push notification (if user has push token)
         ↓
Return success response
```

### Notification Details

**Notification Type**: `application`

**Recipients**: Bounty poster (the user who created the bounty)

**Notification Content**:
- **Title**: "New Bounty Application"
- **Body**: "Someone applied to your bounty: [Bounty Title]"
- **Data**: `{ bountyId, hunterId }`

**User Preferences**: The notification respects user notification preferences. If the poster has disabled "application" notifications in their settings, no notification is sent.

### Database Schema

**notifications table**:
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,           -- Poster's user ID
  type VARCHAR NOT NULL,            -- 'application'
  title VARCHAR NOT NULL,           -- 'New Bounty Application'
  body TEXT NOT NULL,               -- 'Someone applied to your bounty: [title]'
  data JSONB,                       -- { bountyId, hunterId }
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**push_tokens table** (for push notifications):
```sql
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  token VARCHAR NOT NULL,           -- Expo push token
  device_id VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Error Handling

The implementation includes defensive error handling:

1. **Non-blocking**: If notification sending fails, the bounty application is still created successfully
2. **Logging**: All notification attempts are logged for debugging
3. **User preferences**: Respects notification preferences to avoid spam

## Testing

### Existing Tests
- `npm run test:bounty-requests` - Tests bounty request creation flow
- `test-notifications.ts` - Tests notification service including `notifyBountyApplication()`

### Manual Testing Steps
1. Start the API server: `cd services/api && npm run dev`
2. Create a bounty as User A
3. Apply to the bounty as User B
4. Check User A's notifications:
   - In-app: GET `/api/notifications` should show new application notification
   - Push: If User A has registered push token, they should receive push notification

### Verification Queries
```sql
-- Check in-app notifications for a user
SELECT * FROM notifications 
WHERE user_id = '[poster_user_id]' 
AND type = 'application'
ORDER BY created_at DESC;

-- Check push tokens for a user
SELECT * FROM push_tokens 
WHERE user_id = '[poster_user_id]';
```

## Code Review & Security

✅ **Code Review**: Passed with no issues  
✅ **CodeQL Security Scan**: No vulnerabilities detected  
✅ **TypeScript**: No new type errors introduced

## Related Files
- `/services/api/src/routes/consolidated-bounty-requests.ts` - Modified (bounty request creation endpoint)
- `/services/api/src/services/notification-service.ts` - Used (notification service)
- `/services/api/src/routes/notifications.ts` - Related (notification API endpoints)
- `/lib/services/notification-service.ts` - Related (client-side notification service)

## Impact

### Before
❌ Poster has no idea when someone applies to their bounty  
❌ Must manually check the app to see applications  
❌ Slow response times to applications

### After
✅ Poster receives instant push notification when hunter applies  
✅ Poster sees notification in in-app notification list  
✅ Faster response times and better user engagement
