Push Notifications (Expo) — Quick Integration

Overview
- This document describes a minimal, non-breaking implementation to enable push notifications in the mobile app (Expo).
 - The implementation added includes a client hook `app/hooks/usePushNotifications.tsx` and server endpoints to register/unregister tokens and to send notifications. Tokens are persisted in Supabase in a `push_tokens` table (upsert).

Client (app)
- File: `app/hooks/usePushNotifications.tsx`
- Purpose: Request permissions and obtain an Expo push token. It sets Android notification channel settings where applicable.
- Use: call the hook from screens or app root, then send the token to your backend or include it when instructing the server to send a notification.

Server
- Endpoints:
  - `POST /api/push/register` (auth required) — body `{ token, platform? }` to upsert token for the authenticated user in Supabase
  - `POST /api/push/unregister` (auth required) — body `{ token }` to remove the token
  - `POST /api/push/send` (auth required) — body can include `tokens: string[]`, `profileIds: string[]`, or `sendToAll: true` (broadcast requires admin)

- `POST /api/push/send` Payload example (direct tokens):

```
{
  "tokens": ["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"],
  "title": "New message",
  "body": "You have a new message",
  "data": { "bountyId": "123" }
}
```

- The server will batch messages (Expo limit ~100 per request) and forward them to `https://exp.host/--/api/v2/push/send`.

Security & Notes
- Tokens are persisted in Supabase via the `push_tokens` table. The register/unregister endpoints require authentication.
- Broadcasts (`sendToAll`) are disabled unless `ALLOW_PUSH_BROADCAST=true` in env or the calling user's `user_metadata.is_admin` is truthy.
- For production we recommend:
  - Indexing `token` and `profile_id` in `push_tokens` and adding an `enabled` boolean.
  - Rate-limiting or restricting who can send messages.
  - Using Expo notifications receipts for delivery tracking.

How to test locally
1. Run the app on a physical device (push tokens don't work on simulators/emulators reliably).
2. Use the hook to obtain the token and POST the example payload to your local API:

```bash
curl -X POST http://localhost:3001/api/push/send \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <ACCESS_TOKEN>' \
  -d '{"tokens":["ExponentPushToken[xxxx]"],"title":"Test","body":"Hello"}'
```

Next steps
- Optional: wire sending notifications on bounty transitions (accept, complete) inside existing endpoints.
- Optional: add automatic cleanup of expired or invalid tokens using Expo receipts.
