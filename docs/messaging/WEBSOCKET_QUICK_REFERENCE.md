# WebSocket Services - Quick Reference Guide

Quick reference for developers working with BOUNTYExpo WebSocket services.

## 🚀 Quick Start

### Starting the Server

```bash
cd services/api
npm install
npm run dev
```

Server will start on `http://localhost:3001` with WebSocket support at `ws://localhost:3001`.

### Running Tests

```bash
# Run WebSocket integration tests
npm run test:websocket

# Run all tests
npm test
```

---

## 📡 Real-time Events Service

### Endpoint
```
ws://localhost:3001/events/subscribe
```

### Authentication
**Not required** - Public endpoint for receiving real-time updates.

### Connection Example

**JavaScript/Browser:**
```javascript
const ws = new WebSocket('ws://localhost:3001/events/subscribe');

ws.onopen = () => {
  console.log('Connected to real-time events');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received event:', data);
  
  // Handle different event types
  switch (data.type) {
    case 'connection':
      console.log('Connection confirmed');
      break;
    case 'bounty.status':
      console.log(`Bounty ${data.id} status changed to ${data.status}`);
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from real-time events');
};
```

**React Hook:**
```typescript
import { useEffect, useState } from 'react';

function useRealtimeEvents() {
  const [events, setEvents] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001/events/subscribe');

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setEvents(prev => [...prev, data]);
    };

    return () => ws.close();
  }, []);

  return { events, isConnected };
}
```

**useBounties Hook (Recommended):**
```typescript
import { useBounties } from '../hooks/useBounties';

function MyComponent() {
  const { 
    bounties, 
    loading, 
    error, 
    updateBountyStatus,
    refreshBounties 
  } = useBounties({
    status: 'open',
    optimisticUpdates: true, // Enable optimistic UI updates
    autoRefresh: true // Auto-refresh on reconnection
  });

  const handleAcceptBounty = async (bountyId: number) => {
    try {
      // Optimistically updates UI, then syncs with API
      await updateBountyStatus(bountyId, 'in_progress');
      // All connected clients will receive the update via WebSocket
    } catch (error) {
      // Automatically rolls back on failure
      console.error('Failed to update bounty:', error);
    }
  };

  return (
    <div>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}
      {bounties.map(bounty => (
        <div key={bounty.id}>
          <h3>{bounty.title}</h3>
          <p>Status: {bounty.status}</p>
          {bounty.status === 'open' && (
            <button onClick={() => handleAcceptBounty(bounty.id)}>
              Accept Bounty
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

### Event Types

#### Connection Confirmation
```json
{
  "type": "connection",
  "message": "Connected to BountyExpo realtime events",
  "timestamp": "2026-01-02T12:00:00.000Z"
}
```

#### Bounty Status Change
```json
{
  "type": "bounty.status",
  "id": "bounty-uuid-123",
  "status": "in_progress",
  "timestamp": "2026-01-02T12:00:00.000Z"
}
```

### Monitoring

```bash
# Get real-time service stats
curl http://localhost:3001/events/stats
```

Response:
```json
{
  "events": {
    "supabaseEnabled": true,
    "wsClientCount": 5
  },
  "messaging": {
    "totalClients": 3,
    "totalRooms": 2,
    "onlineUsers": 3,
    "supabaseEnabled": true
  },
  "timestamp": "2026-01-02T12:00:00.000Z"
}
```

---

## 💬 Messaging Service

### Endpoint
```
ws://localhost:3001/messages/subscribe
```

### Authentication
**Required** - JWT token must be provided via query string or Authorization header.

### Connection Example

**With Query String:**
```javascript
const token = 'your-jwt-token-here';
const ws = new WebSocket(`ws://localhost:3001/messages/subscribe?token=${token}`);
```

**With Authorization Header:**
```javascript
const ws = new WebSocket('ws://localhost:3001/messages/subscribe', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

**React Native (Expo):**
```typescript
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

function useMessaging() {
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    let ws: WebSocket;

    async function connect() {
      // Get JWT token from Supabase
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const token = session.access_token;
      ws = new WebSocket(
        `ws://your-api-url/messages/subscribe?token=${token}`
      );

      ws.onopen = () => {
        console.log('Connected to messaging');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'connected':
            console.log('Messaging connected:', data.userId);
            break;
          case 'message.new':
            setMessages(prev => [...prev, data]);
            break;
          case 'typing.start':
            console.log(`User ${data.senderId} is typing...`);
            break;
          case 'presence.update':
            console.log(`User ${data.userId} is ${data.isOnline ? 'online' : 'offline'}`);
            break;
        }
      };

      ws.onerror = (error) => {
        console.error('Messaging error:', error);
      };

      ws.onclose = () => {
        console.log('Messaging disconnected');
        setIsConnected(false);
      };
    }

    connect();

    return () => {
      if (ws) ws.close();
    };
  }, []);

  const sendTyping = (conversationId: string, isTyping: boolean) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'typing',
        conversationId,
        isTyping
      }));
    }
  };

  const joinConversation = (conversationId: string) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'join',
        conversationId
      }));
    }
  };

  return { isConnected, messages, sendTyping, joinConversation };
}
```

### Event Types

#### Connection Confirmation
```json
{
  "type": "connected",
  "message": "Connected to BountyExpo messaging",
  "userId": "user-uuid-123",
  "conversationIds": ["conv-uuid-1", "conv-uuid-2"],
  "timestamp": "2026-01-02T12:00:00.000Z"
}
```

#### New Message
```json
{
  "type": "message.new",
  "conversationId": "conv-uuid-123",
  "messageId": "msg-uuid-456",
  "senderId": "user-uuid-789",
  "text": "Hello, world!",
  "timestamp": "2026-01-02T12:00:00.000Z",
  "status": "sent"
}
```

#### Typing Indicator
```json
{
  "type": "typing.start",
  "conversationId": "conv-uuid-123",
  "senderId": "user-uuid-789",
  "timestamp": "2026-01-02T12:00:00.000Z"
}
```

#### Presence Update
```json
{
  "type": "presence.update",
  "conversationId": "conv-uuid-123",
  "userId": "user-uuid-789",
  "senderId": "user-uuid-789",
  "isOnline": true,
  "timestamp": "2026-01-02T12:00:00.000Z"
}
```

#### Message Delivered
```json
{
  "type": "message.delivered",
  "conversationId": "conv-uuid-123",
  "messageId": "msg-uuid-456",
  "senderId": "user-uuid-789",
  "timestamp": "2026-01-02T12:00:00.000Z",
  "status": "delivered"
}
```

#### Message Read
```json
{
  "type": "message.read",
  "conversationId": "conv-uuid-123",
  "messageId": "msg-uuid-456",
  "senderId": "user-uuid-789",
  "timestamp": "2026-01-02T12:00:00.000Z",
  "status": "read"
}
```

#### Error
```json
{
  "type": "error",
  "message": "Authentication required. Provide token in query string or Authorization header.",
  "timestamp": "2026-01-02T12:00:00.000Z"
}
```

### Client Actions

Send these messages from the client to the server:

#### Join Conversation
```javascript
ws.send(JSON.stringify({
  type: 'join',
  conversationId: 'conv-uuid-123'
}));
```

#### Leave Conversation
```javascript
ws.send(JSON.stringify({
  type: 'leave',
  conversationId: 'conv-uuid-123'
}));
```

#### Send Typing Indicator
```javascript
ws.send(JSON.stringify({
  type: 'typing',
  conversationId: 'conv-uuid-123',
  isTyping: true  // or false when stopped typing
}));
```

---

## 🔌 REST Endpoints

### Conversations

#### Get All Conversations
```bash
GET /api/conversations
Authorization: Bearer <token>
```

Response:
```json
{
  "conversations": [
    {
      "id": "conv-uuid-123",
      "isGroup": false,
      "bountyId": "bounty-uuid-456",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-02T12:00:00.000Z",
      "participants": [
        { "id": "user-uuid-1", "handle": "@alice" },
        { "id": "user-uuid-2", "handle": "@bob" }
      ],
      "lastMessage": {
        "id": "msg-uuid-789",
        "text": "Last message text",
        "senderId": "user-uuid-1",
        "createdAt": "2026-01-02T12:00:00.000Z"
      },
      "unreadCount": 3
    }
  ]
}
```

#### Create Conversation
```bash
POST /api/conversations
Authorization: Bearer <token>
Content-Type: application/json

{
  "participantIds": ["user-uuid-1", "user-uuid-2"],
  "bountyId": "bounty-uuid-123",  # optional
  "isGroup": false  # optional
}
```

#### Get Messages
```bash
GET /api/conversations/:conversationId/messages?page=1&limit=50
Authorization: Bearer <token>
```

#### Send Message
```bash
POST /api/conversations/:conversationId/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "text": "Hello, world!",
  "replyTo": "msg-uuid-123",  # optional
  "mediaUrl": "https://..."    # optional
}
```

#### Update Message Status
```bash
POST /api/conversations/:conversationId/messages/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "messageIds": ["msg-uuid-1", "msg-uuid-2"],
  "status": "read"  # or "delivered"
}
```

#### Send Typing Indicator (REST)
```bash
POST /api/conversations/:conversationId/typing
Authorization: Bearer <token>
Content-Type: application/json

{
  "isTyping": true
}
```

---

## 🔧 Development Tips

### Error Handling

Always handle these scenarios:

```javascript
const ws = new WebSocket(url);

// Connection timeout
const timeout = setTimeout(() => {
  if (ws.readyState !== WebSocket.OPEN) {
    ws.close();
    console.error('Connection timeout');
  }
}, 5000);

ws.onopen = () => {
  clearTimeout(timeout);
};

// Reconnection logic
ws.onclose = (event) => {
  if (!event.wasClean) {
    console.log('Connection lost, reconnecting in 3s...');
    setTimeout(() => connectWebSocket(), 3000);
  }
};

// Handle errors
ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};
```

### Testing Authentication

```javascript
// Test with invalid token
const ws = new WebSocket('ws://localhost:3001/messages/subscribe?token=invalid');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'error') {
    console.log('Expected error:', data.message);
    // Handle authentication failure
  }
};
```

### Monitoring Connection Health

```javascript
let pingInterval;

ws.onopen = () => {
  // Send periodic pings to keep connection alive
  pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000); // Every 30 seconds
};

ws.onclose = () => {
  clearInterval(pingInterval);
};
```

### Debugging

Enable verbose logging:

```javascript
const DEBUG = true;

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (DEBUG) {
    console.log('📩 Received:', data);
  }
  // Handle message
};

if (DEBUG) {
  ws.onerror = (error) => console.error('❌ Error:', error);
  ws.onopen = () => console.log('✅ Connected');
  ws.onclose = () => console.log('🔌 Disconnected');
}
```

---

## 📊 Monitoring & Stats

### Get Service Stats

```bash
# Combined stats
curl http://localhost:3001/events/stats

# Messaging-only stats
curl http://localhost:3001/messages/stats
```

### Metrics to Track

- **Active Connections**: Number of open WebSocket connections
- **Online Users**: Number of authenticated users with active connections
- **Conversation Rooms**: Number of active conversation rooms
- **Message Latency**: Time from send to delivery
- **Connection Errors**: Failed connection attempts
- **Disconnection Rate**: Connections closed per minute

### Health Check

```bash
curl http://localhost:3001/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-01-02T12:00:00.000Z",
  "version": "1.0.0",
  "service": "bountyexpo-api",
  "database": "connected",
  "idempotency": {
    "backend": "redis",
    "connected": true
  }
}
```

---

## 🐛 Troubleshooting

### Connection Fails Immediately

**Problem:** WebSocket closes right after opening.

**Solution:**
1. Check if server is running: `curl http://localhost:3001/health`
2. For messaging endpoint, ensure token is valid
3. Check console for error messages
4. Verify endpoint URL is correct

### Messages Not Received

**Problem:** Connected but not receiving events.

**Solution:**
1. Verify you're listening to the correct conversation
2. For messaging, ensure you've joined the conversation room
3. Check if user is authenticated
4. Verify message is being sent via REST endpoint first

### Authentication Errors

**Problem:** "Authentication required" or "Invalid token" errors.

**Solution:**
1. Get fresh token from Supabase: `supabase.auth.getSession()`
2. Verify token is not expired
3. Check token format: should be JWT string
4. Ensure token is passed correctly (query string or header)

### Connection Keeps Dropping

**Problem:** Connection closes repeatedly.

**Solution:**
1. Implement heartbeat/ping mechanism
2. Add exponential backoff for reconnection
3. Check network stability
4. Monitor server logs for errors

---

## 📚 Related Documentation

- **Full Verification Report**: `WEBSOCKET_VERIFICATION_REPORT.md`
- **Messaging Implementation**: `MESSAGING_IMPLEMENTATION.md`
- **Real-time Features**: `REALTIME_MESSAGING_IMPLEMENTATION.md`
- **Backend Consolidation**: `BACKEND_CONSOLIDATION_README.md`
- **API Documentation**: `services/api/README.md`

---

## 🤝 Need Help?

1. Check the verification report for detailed implementation info
2. Run the integration tests: `npm run test:websocket`
3. Review server logs for errors
4. Check GitHub issues for known problems

---

**Last Updated:** January 2, 2026  
**Version:** 1.0  
**Status:** Production Ready ✅
