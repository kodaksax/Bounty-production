# Push Notifications Test Procedures

## Architecture Under Test

- **Previous backend pattern:** mixed access (direct DB/Drizzle for notification tables with Supabase used in some trigger paths).
- **Current backend pattern:** `services/api/src/services/notification-service.ts` uses Supabase exclusively for:
  - `notifications` CRUD
  - `push_tokens` registration/deletion/lookup
  - `notification_preferences` read/update/default creation

Push delivery behavior is unchanged: in-app rows are created first, then push delivery is attempted.

## Prerequisites

1. API env has Supabase admin credentials:
   - `SUPABASE_URL` (or `EXPO_PUBLIC_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`)
2. Start API:
   ```bash
   cd services/api
   npm run dev
   ```
3. Use a physical device for push receipt validation.

## Test 1: Push Token Registration Uses Supabase

1. Authenticate in app.
2. Trigger token registration (app startup/login flow).
3. Verify API logs include token registration success.
4. Verify row exists in Supabase:
   ```sql
   select id, user_id, profile_id, token, device_id, created_at, updated_at
   from push_tokens
   where token like 'Expo%';
   ```

## Test 2: Notification Creation + Push Delivery

1. Trigger an event that calls `notificationService.createNotification(...)` (for example, message or bounty-request flows).
2. Verify in-app notification row:
   ```sql
   select id, user_id, type, title, body, read, created_at
   from notifications
   where user_id = '<recipient_user_id>'
   order by created_at desc
   limit 10;
   ```
3. Verify push is delivered to registered device token(s).

## Test 3: Preference Enforcement

1. Disable a notification type via `POST /notifications/preferences`.
2. Trigger that notification type.
3. Verify:
   - No new `notifications` row for that event type.
   - No push delivered for that event type.
4. Re-enable and verify rows/push resume.

## Test 4: Token Deletion on Logout

1. Logout (client calls `DELETE /notifications/token`).
2. Verify token row removal in Supabase:
   ```sql
   select *
   from push_tokens
   where token = '<device_expo_token>';
   ```
3. Trigger a notification for that user and verify no push is delivered to logged-out device.

## API Stability Checks

- Ensure existing endpoints remain unchanged:
  - `GET /notifications`
  - `GET /notifications/unread-count`
  - `POST /notifications/mark-read`
  - `POST /notifications/mark-all-read`
  - `POST /notifications/register-token`
  - `GET /notifications/preferences`
  - `POST /notifications/preferences`
  - `DELETE /notifications/token`
