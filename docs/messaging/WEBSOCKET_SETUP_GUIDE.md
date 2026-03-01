# Real-Time Messaging Integration Setup Guide

## Overview

This guide provides step-by-step instructions for setting up the real-time messaging system in BOUNTYExpo, including WebSocket server configuration, database migrations, and push notifications.

## Prerequisites

- Node.js 18+ installed
- PostgreSQL database or Supabase project
- Expo account (for push notifications)
- Access to the repository

## Table of Contents

1. [Database Setup](#database-setup)
2. [Backend WebSocket Server](#backend-websocket-server)
3. [Frontend WebSocket Client](#frontend-websocket-client)
4. [Push Notifications](#push-notifications)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)

---

## 1. Database Setup

### Supabase Setup (Recommended)

If you're using Supabase, the messaging tables are already defined in the SQL schema. Run the migration:

```bash
# Navigate to the project root
cd /path/to/bountyexpo

# Apply the Supabase migration
psql $DATABASE_URL < supabase/schema-messaging.sql
```

Or use the Supabase SQL Editor to run the schema from `supabase/schema-messaging.sql`.

### Drizzle ORM Setup (Alternative)

If you're using the standalone API server with Drizzle ORM:

```bash
# Navigate to the API service
cd services/api

# Generate migration
npm run db:generate

# Run migration
npm run db:migrate
```

The schema includes:
- `conversations` - Stores conversation metadata
- `conversation_participants` - Links users to conversations
- `messages` - Stores individual messages with status tracking

### Verify Database Setup

Run this SQL query to verify all tables exist:

```sql
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('conversations', 'conversation_participants', 'messages', 'push_tokens');
```

You should see all four tables listed.

---

## 2. Backend WebSocket Server

### Environment Variables

Add these variables to your `.env` file in the repository root:

```bash
# API Server Configuration
PORT=3001
HOST=0.0.0.0

# Database (choose one approach)
# Option 1: Direct PostgreSQL connection
DATABASE_URL="postgresql://user:password@localhost:5432/bountyexpo"

# Option 2: Supabase
EXPO_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
EXPO_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# JWT Configuration (for WebSocket authentication)
SUPABASE_JWT_SECRET="your-jwt-secret"
```

### Start the API Server

```bash
# From repository root
cd services/api

# Install dependencies (if not done already)
npm install

# Start in development mode
npm run dev

# Or start in production mode
npm run build && npm start
```

### Verify WebSocket Server

The server should log:

```
🚀 BountyExpo API server listening on 0.0.0.0:3001
📡 WebSocket server available at ws://0.0.0.0:3001/messages/subscribe
📡 WebSocket Messaging Service - Supabase client initialized
```

Test the WebSocket connection:

```bash
# Install wscat if you don't have it
npm install -g wscat

# Test connection (replace TOKEN with a valid JWT)
wscat -c "ws://localhost:3001/messages/subscribe?token=YOUR_JWT_TOKEN"
```

You should receive a connection confirmation message:

```json
{
  "type": "connected",
  "message": "Connected to BountyExpo messaging",
  "userId": "your-user-id",
  "conversationIds": ["conv-id-1", "conv-id-2"],
  "timestamp": "2024-11-19T17:10:00.000Z"
}
```

---

## 3. Frontend WebSocket Client

### Update Mobile App Environment

Add the API URL to your `.env` file:

```bash
# Mobile app configuration
EXPO_PUBLIC_API_URL="http://192.168.1.100:3001"  # Replace with your local IP or server URL
```

**Important for Device Testing:**
- For iOS/Android devices, use your local network IP (e.g., `192.168.1.100`)
- For simulators/emulators, you can use `localhost`
- For production, use your production API URL with HTTPS/WSS

Optional override:

```bash
# If you expose a dedicated WebSocket endpoint, you can override directly
EXPO_PUBLIC_WS_URL="ws://192.168.1.100:3001"
```

Note: The client now auto-resolves `localhost` to your LAN IP during development, but setting `EXPO_PUBLIC_API_URL` (or `EXPO_PUBLIC_WS_URL`) removes ambiguity and avoids connection issues on physical devices.

Verbose / Log Control:

```bash
# Suppress repetitive client info/error console logs (default behavior)
# Set to 1 to see every connect/disconnect/error event
EXPO_PUBLIC_LOG_CLIENT_VERBOSE=0

# Enable very chatty WebSocket adapter logs (each attempt, close, etc.)
EXPO_PUBLIC_WS_VERBOSE=0
```

The adapter now:
- Uses exponential backoff without resetting attempts after very short-lived connections
- Treats a connection as "stable" after 5s and only then resets attempt counter
- Deduplicates identical info/error messages printed within 2 seconds unless verbose flags are enabled

### WebSocket Auto-Connection

The WebSocket client automatically connects when:
1. User is authenticated (logged in)
2. App comes to foreground
3. Network connection is restored

No additional setup is required! The `WebSocketProvider` in `app/_layout.tsx` handles this automatically.

### Verify Client Connection

To verify the WebSocket client is working:

1. Start the API server
2. Start the Expo app: `npm start`
3. Login to the app
4. Check the console logs for:

```
[WebSocket] Connecting to: ws://192.168.1.100:3001/messages/subscribe?token=...
[WebSocket] Connected successfully
✅ Client connected: user-id, conversations: 2, total clients: 1
```

---

## 4. Push Notifications

### Expo Push Notification Setup

#### Step 1: Register for Push Notifications

The app automatically requests push notification permissions when a user logs in. The token is stored in the `push_tokens` table.

#### Step 2: Environment Configuration

No additional configuration is needed! The Expo SDK handles push notification delivery.

For production:
1. Submit your app to the App Store / Play Store
2. Expo will automatically configure push notifications
3. Ensure your `app.json` has the correct configuration:

```json
{
  "expo": {
    "notification": {
      "icon": "./assets/notification-icon.png",
      "color": "#059669"
    },
    "ios": {
      "bundleIdentifier": "com.yourcompany.bountyexpo"
    },
    "android": {
      "package": "com.yourcompany.bountyexpo"
    }
  }
}
```

### Testing Push Notifications

#### Test on Device

1. Install Expo Go app on your device
2. Run `npm start` and scan the QR code
3. Grant notification permissions when prompted
4. Send a test message from another account
5. Put the app in background
6. You should receive a push notification

#### Test with Expo Push Notification Tool

Use the [Expo Push Notification Tool](https://expo.dev/notifications) to send test notifications:

```json
{
  "to": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "sound": "default",
  "title": "Test Message",
  "body": "This is a test notification",
  "data": {
    "conversationId": "test-conv-id",
    "senderId": "test-user-id"
  }
}
```

### Notification Badge Count

Unread message counts are automatically updated in the app. The badge is managed through:
- Local state in the MessengerScreen
- Real-time updates via WebSocket
- Persistent storage for offline access

---

## 5. Testing

### Manual Testing Checklist

#### WebSocket Connection
- [ ] App connects to WebSocket on login
- [ ] App reconnects when network is restored
- [ ] App reconnects when coming from background
- [ ] Connection uses valid JWT token
- [ ] Invalid tokens are rejected

#### Real-Time Messaging
- [ ] Messages appear instantly for online users
- [ ] Messages are delivered when recipient comes online
- [ ] Typing indicators work in both directions
- [ ] Read receipts update correctly
- [ ] Offline messages queue and send when online

#### Presence Tracking
- [ ] User appears online when connected
- [ ] User appears offline when disconnected
- [ ] Presence updates in real-time

#### Push Notifications
- [ ] Notifications sent when recipient is offline
- [ ] Notification opens correct conversation
- [ ] Badge count updates correctly
- [ ] Notification sound plays
- [ ] Multiple notifications stack properly

### Automated Testing

Run the test suite:

```bash
# Unit tests
npm test

# E2E tests (requires API server running)
npm run test:e2e
```

### Load Testing

For load testing the WebSocket server:

```bash
# Install k6 (load testing tool)
brew install k6  # macOS
# or download from https://k6.io

# Run load test
k6 run scripts/load-test-websocket.js
```

---

## 6. Troubleshooting

### WebSocket Connection Fails

**Problem:** Client can't connect to WebSocket server

**Solutions:**
1. Verify API server is running: `curl http://localhost:3001/health`
2. Check firewall allows WebSocket connections
3. Verify token is valid: Check in Network tab of browser/Reactotron
4. For device testing, ensure device and server are on same network
5. Check API_URL uses correct IP/hostname

### Messages Not Appearing in Real-Time

**Problem:** Messages only appear after refresh

**Solutions:**
1. Check WebSocket connection status in app
2. Verify user is subscribed to conversation room
3. Check browser/app console for WebSocket errors
4. Ensure backend is broadcasting messages correctly
5. Test with `wscat` to isolate client vs server issue

### Push Notifications Not Working

**Problem:** No notifications when app is in background

**Solutions:**
1. Verify push token is registered: Check `push_tokens` table
2. Ensure notification permissions are granted
3. Check that user's notification preferences allow messages
4. Test with Expo Push Notification Tool
5. Verify `expo-server-sdk` is correctly configured

### Database Connection Errors

**Problem:** API server can't connect to database

**Solutions:**
1. Verify `DATABASE_URL` is correct in `.env`
2. Check database is running: `psql $DATABASE_URL -c "SELECT 1;"`
3. Ensure migrations have been run
4. Check network connectivity to database
5. Verify database user has correct permissions

### High Memory Usage

**Problem:** Server uses excessive memory with many connections

**Solutions:**
1. Implement connection limits in `websocket-messaging-service.ts`
2. Add message rate limiting
3. Clean up disconnected clients more aggressively
4. Consider using Redis for session storage
5. Monitor with: `node --inspect services/api/src/index.ts`

---

## Architecture Overview

### Backend Components

```
services/api/src/
├── routes/messaging.ts              # REST API endpoints
├── services/
│   ├── websocket-messaging-service.ts  # WebSocket server logic
│   └── notification-service.ts      # Push notification handling
├── db/
│   └── schema.ts                    # Database schema (Drizzle ORM)
└── index.ts                         # Server entry point + WebSocket setup
```

### Frontend Components

```
lib/services/
├── websocket-adapter.ts             # WebSocket client
├── message-service.ts               # Message CRUD operations
└── messaging.ts                     # Local message persistence

hooks/
└── useWebSocket.ts                  # React hooks for WebSocket

providers/
└── websocket-provider.tsx           # React context provider

app/_layout.tsx                      # App-wide WebSocket initialization
```

### Data Flow

```
User A sends message
    ↓
Frontend (websocket-adapter.ts)
    ↓
API POST /api/conversations/:id/messages
    ↓
Database (messages table)
    ↓
WebSocket Service (broadcast)
    ↓
User B receives via WebSocket (real-time)
User C receives via Push Notification (offline)
```

---

## API Endpoints

### REST Endpoints

```
GET    /api/conversations                        # List user's conversations
POST   /api/conversations                        # Create new conversation
GET    /api/conversations/:id/messages           # Get messages (paginated)
POST   /api/conversations/:id/messages           # Send message
POST   /api/conversations/:id/messages/status    # Update message status
POST   /api/conversations/:id/typing             # Send typing indicator
GET    /messages/stats                           # WebSocket stats
```

### WebSocket Endpoints

```
ws://host:port/messages/subscribe?token=JWT     # Main messaging WebSocket
```

### WebSocket Events

**Client → Server:**
- `join` - Join a conversation room
- `leave` - Leave a conversation room
- `typing` - Send typing indicator

**Server → Client:**
- `connected` - Connection established
- `message.new` - New message received
- `message.delivered` - Message delivered confirmation
- `message.read` - Message read confirmation
- `typing.start` - User started typing
- `typing.stop` - User stopped typing
- `presence.update` - User online/offline status change
- `error` - Error message

---

## Security Considerations

1. **Authentication:** All WebSocket connections require valid JWT token
2. **Authorization:** Users can only join conversations they're participants in
3. **Rate Limiting:** API endpoints are rate-limited to prevent abuse
4. **Input Validation:** All message content is validated before storage
5. **SQL Injection:** Using parameterized queries (Drizzle ORM)
6. **XSS Prevention:** Message content is sanitized before display

---

## Performance Optimization

### Backend

- Messages are paginated (50 per page by default)
- Database queries use indexes on `conversation_id` and `created_at`
- WebSocket broadcasts use efficient room-based filtering
- Stale connections are cleaned up automatically

### Frontend

- Messages use virtualized lists (FlatList)
- WebSocket reconnection uses exponential backoff
- Offline messages queue with deduplication
- Optimistic UI updates for better perceived performance

---

## Support and Resources

- [Fastify WebSocket Plugin](https://github.com/fastify/fastify-websocket)
- [Expo Push Notifications](https://docs.expo.dev/push-notifications/overview/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [WebSocket API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)

---

## Production Deployment

### Environment Variables (Production)

```bash
# Use wss:// (secure WebSocket) in production
EXPO_PUBLIC_API_URL="https://api.bountyexpo.com"

# Use production database
DATABASE_URL="postgresql://user:password@prod-db.example.com:5432/bountyexpo"

# Ensure HTTPS/WSS
NODE_ENV=production
```

### Scaling Considerations

For high-traffic production environments:

1. **Load Balancing:**
   - Use sticky sessions for WebSocket connections
   - Consider using Redis for session storage
   - Implement WebSocket horizontal scaling with Redis pub/sub

2. **Database:**
   - Add read replicas for message fetching
   - Use connection pooling
   - Consider partitioning `messages` table by date

3. **Monitoring:**
   - Set up error tracking (Sentry is already configured)
   - Monitor WebSocket connection count
   - Track message delivery latency
   - Alert on high reconnection rates

---

## Next Steps

After completing this setup:

1. Test the complete flow end-to-end
2. Customize notification sounds and icons
3. Add message encryption (if required)
4. Implement message search
5. Add file/image attachment support
6. Configure production environment

For questions or issues, please refer to the repository issues or contact the development team.
