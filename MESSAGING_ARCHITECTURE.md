# Messaging System Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI Components                            │
├─────────────────────────────────────────────────────────────────┤
│  MessengerScreen  │  ChatDetailScreen  │  BountyDetailModal    │
│  PostingsScreen   │  ConversationItem  │  BountyListItem       │
└───────────────┬─────────────────────┬──────────────────────────┘
                │                     │
                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                         React Hooks                              │
├─────────────────────────────────────────────────────────────────┤
│         useConversations()          │      useMessages()        │
│   • Fetches conversation list       │  • Fetches messages       │
│   • Listens for updates             │  • Listens for updates    │
│   • Handles mark as read            │  • Handles send/retry     │
└───────────────┬─────────────────────┬──────────────────────────┘
                │                     │
                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Service Layer (Adapter)                       │
├─────────────────────────────────────────────────────────────────┤
│                  message-service.ts                              │
│   • Wraps messaging.ts with user context                        │
│   • Handles offline queueing                                     │
│   • Maintains backward compatibility                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Core Messaging Service                         │
├─────────────────────────────────────────────────────────────────┤
│                    messaging.ts                                  │
│   • Persistent storage (AsyncStorage)                           │
│   • Event emitter for real-time updates                         │
│   • CRUD operations for conversations/messages                  │
│   • Duplicate prevention logic                                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Storage                                │
├─────────────────────────────────────────────────────────────────┤
│                   AsyncStorage                                   │
│   @bountyexpo:conversations → Conversation[]                    │
│   @bountyexpo:messages      → Message[]                         │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow: Creating a Conversation from Bounty Detail

```
User clicks "Message {username}" button
          │
          ▼
┌─────────────────────────────────────┐
│   BountyDetailModal                 │
│   handleMessagePoster()             │
└────────────┬────────────────────────┘
             │
             │ messageService.getOrCreateConversation([user_id], name, bountyId)
             ▼
┌─────────────────────────────────────┐
│   message-service.ts                │
│   • Adds current user to list       │
│   • Calls messaging service         │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   messaging.ts                      │
│   getOrCreateConversation()         │
│   1. Load existing conversations    │
│   2. Check for duplicate            │
│   3. Return existing OR create new  │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   AsyncStorage                      │
│   • Read conversations              │
│   • Write new conversation (if new) │
└────────────┬────────────────────────┘
             │
             │ Emit 'conversationsUpdated' event
             ▼
┌─────────────────────────────────────┐
│   useConversations hook             │
│   • Receives event                  │
│   • Refetches conversation list     │
│   • Updates UI                      │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   MessengerScreen                   │
│   • Shows new conversation in list  │
│   • User can click to open chat     │
└─────────────────────────────────────┘
```

## Data Flow: Sending a Message

```
User types message and clicks send
          │
          ▼
┌─────────────────────────────────────┐
│   ChatDetailScreen                  │
│   handleSendMessage(text)           │
└────────────┬────────────────────────┘
             │
             │ sendMessage(text)
             ▼
┌─────────────────────────────────────┐
│   useMessages hook                  │
│   • Optimistic update (add temp msg)│
│   • Calls message service           │
└────────────┬────────────────────────┘
             │
             │ messageService.sendMessage(convId, text, userId)
             ▼
┌─────────────────────────────────────┐
│   message-service.ts                │
│   • Checks network status           │
│   • If offline: queue message       │
│   • If online: send via messaging   │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   messaging.ts                      │
│   sendMessage()                     │
│   1. Create message object          │
│   2. Add to messages array          │
│   3. Update conversation lastMsg    │
│   4. Save to AsyncStorage           │
└────────────┬────────────────────────┘
             │
             │ Emit 'messageSent' event
             ▼
┌─────────────────────────────────────┐
│   useMessages hook                  │
│   • Receives event                  │
│   • Refetches messages              │
│   • Replaces temp with real message │
│   • Updates UI                      │
└─────────────────────────────────────┘
```

## Data Flow: Profile Navigation from Chat

```
User clicks avatar/name in chat header
          │
          ▼
┌─────────────────────────────────────┐
│   ChatDetailScreen                  │
│   • Gets otherUserId from           │
│     conversation.participantIds     │
│   • Filters out currentUserId       │
└────────────┬────────────────────────┘
             │
             │ router.push(`/profile/${otherUserId}`)
             ▼
┌─────────────────────────────────────┐
│   Expo Router                       │
│   • Navigates to profile route      │
│   • Passes userId as param          │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   app/profile/[userId].tsx          │
│   • Loads user profile data         │
│   • Displays public profile         │
└─────────────────────────────────────┘
```

## Event System

```
┌─────────────────────────────────────────────────────────────┐
│                      Event Emitter                           │
│                      (Node.js events)                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
         ▼                ▼                ▼
  'conversationsUpdated'  'messagesUpdated'  'messageSent'
         │                │                │
         ▼                ▼                ▼
  useConversations()  useMessages()   useMessages()
                                      useConversations()
```

### Event Lifecycle

1. **Event Emission** (messaging.ts)
   ```typescript
   await saveConversations(conversations);
   emitter.emit('conversationsUpdated', conversations);
   ```

2. **Event Subscription** (React hooks)
   ```typescript
   useEffect(() => {
     messagingService.on('conversationsUpdated', handler);
     return () => messagingService.off('conversationsUpdated', handler);
   }, []);
   ```

3. **Event Handling** (React hooks)
   ```typescript
   const handler = () => {
     fetchConversations(); // Re-fetch data
   };
   ```

## Storage Schema

### Conversations Storage

**Key:** `@bountyexpo:conversations`

**Value:** JSON array of Conversation objects

```json
[
  {
    "id": "conv-1234567890-abc123",
    "bountyId": "42",
    "isGroup": false,
    "name": "John Doe",
    "avatar": "https://...",
    "lastMessage": "Thanks!",
    "updatedAt": "2024-01-15T10:30:00Z",
    "participantIds": ["user-123", "user-456"],
    "unread": 2
  }
]
```

### Messages Storage

**Key:** `@bountyexpo:messages`

**Value:** JSON array of Message objects

```json
[
  {
    "id": "msg-1234567890-xyz789",
    "conversationId": "conv-1234567890-abc123",
    "senderId": "user-123",
    "text": "Hello, when can you start?",
    "createdAt": "2024-01-15T10:25:00Z",
    "status": "sent"
  }
]
```

## Component Hierarchy

```
BountyApp
├── MessengerScreen
│   ├── ConversationItem (for each conversation)
│   │   └── Avatar (clickable → profile)
│   └── ChatDetailScreen (when conversation selected)
│       ├── Header
│       │   ├── Avatar (clickable → profile)
│       │   └── Name (clickable → profile)
│       ├── MessageBubble (for each message)
│       └── Input (send new messages)
│
├── Dashboard
│   └── BountyListItem (for each bounty)
│       └── BountyDetailModal (on click)
│           ├── User Info (clickable → profile)
│           └── "Message {username}" Button
│
└── PostingsScreen
    └── Requests Tab
        └── Accept Request → Auto-creates conversation
```

## Integration Points

### 1. Bounty List → Chat

```
Dashboard/BountyListItem
  ├─ Passes: user_id, username, bountyId
  │
  └─> BountyDetailModal
       ├─ Shows: "Message {username}" button
       │
       └─> messageService.getOrCreateConversation()
            └─> Opens MessengerScreen with new/existing conversation
```

### 2. Requests → Auto-Chat

```
PostingsScreen/Requests Tab
  ├─ User accepts request
  │
  └─> handleAcceptRequest()
       ├─> messageService.getOrCreateConversation()
       └─> messageService.sendMessage() (welcome message)
            └─> User sees new conversation in MessengerScreen
```

### 3. Chat → Profile

```
MessengerScreen/ChatDetailScreen
  ├─ User clicks avatar/name in header
  │
  └─> router.push(`/profile/${otherUserId}`)
       └─> ProfileScreen displays user's public profile
```

## Sequence Diagrams

### Creating a Conversation

```
User             UI              Hook            Service         Storage
 │               │               │               │               │
 │─Click Button─>│               │               │               │
 │               │─getOrCreate──>│               │               │
 │               │               │─getOrCreate──>│               │
 │               │               │               │─Load Data────>│
 │               │               │               │<─Data─────────│
 │               │               │               │─Check Dupe───>│
 │               │               │               │─Save New─────>│
 │               │               │               │<─Saved────────│
 │               │               │               │─Emit Event───>│
 │               │               │<─Conversation─│               │
 │               │<─Conversation─│               │               │
 │<─Navigate─────│               │               │               │
 │               │               │               │               │
 │               │               │◀─Event────────┘               │
 │               │               │─Refetch──────>│               │
 │               │               │               │─Load──────────>│
 │               │               │◀─Data─────────│               │
 │               │◀─Update UI────│               │               │
```

### Sending a Message

```
User             UI              Hook            Service         Storage
 │               │               │               │               │
 │─Type & Send──>│               │               │               │
 │               │─sendMessage──>│               │               │
 │               │               │─Optimistic Add│               │
 │               │◀─Show Temp────│               │               │
 │               │               │─sendMessage──>│               │
 │               │               │               │─Create Msg───>│
 │               │               │               │─Update Conv──>│
 │               │               │               │─Save─────────>│
 │               │               │               │<─Saved────────│
 │               │               │               │─Emit Event───>│
 │               │               │◀─Message──────│               │
 │               │               │               │               │
 │               │               │◀─Event────────┘               │
 │               │               │─Refetch──────>│               │
 │               │               │               │─Load──────────>│
 │               │               │◀─Messages─────│               │
 │               │◀─Update UI────│               │               │
```

## Performance Considerations

### Optimizations Implemented

1. **Event Batching**
   - Multiple updates trigger single re-render
   - EventEmitter naturally batches synchronous emissions

2. **Lazy Loading**
   - Messages only loaded when conversation opened
   - Conversations loaded on demand

3. **Memoization**
   - FlatList callbacks memoized with useCallback
   - Key extractors optimized

4. **Efficient Storage**
   - Single read/write per operation
   - JSON serialization/deserialization cached by AsyncStorage

### Scaling Recommendations

For large datasets:

1. **Pagination**
   ```typescript
   getMessages(conversationId, offset = 0, limit = 50)
   ```

2. **Message Pruning**
   - Keep only recent N messages in storage
   - Archive old messages to separate key

3. **Indexing**
   - Store conversation lookup table
   - Store message count per conversation

4. **Migration Path**
   ```
   AsyncStorage → SQLite → Backend API
   ```

## Security Model

### Current (Local-only)

```
User Device
├── AsyncStorage (unencrypted)
│   ├── Conversations
│   └── Messages
└── App Memory
    └── EventEmitter
```

### Production Recommendations

```
User Device                  Backend
├── AsyncStorage (encrypted) │
│   ├── Conversations ───────┼──> Server Storage
│   └── Messages ────────────┼──> Server Storage
└── App Memory               │
    ├── EventEmitter         │
    └── WebSocket ───────────┼──> Real-time Server
```

1. **Encrypt at Rest**: Use expo-secure-store for sensitive data
2. **Validate User IDs**: Verify user existence before creating conversations
3. **Rate Limiting**: Prevent message spam
4. **Content Moderation**: Scan messages for inappropriate content
5. **Audit Trail**: Log all messaging actions

## Migration Path to Backend

### Phase 1: Hybrid (Current + Backend)

```typescript
// messaging.ts modifications
async function sendMessage(conversationId, text, senderId) {
  // 1. Save locally (immediate)
  const message = await saveLocally(conversationId, text, senderId);
  
  // 2. Send to backend (async)
  try {
    await api.sendMessage(conversationId, text);
  } catch (error) {
    // Queue for retry
    await queueForRetry(message);
  }
  
  return message;
}
```

### Phase 2: Backend-first

```typescript
async function sendMessage(conversationId, text, senderId) {
  // 1. Send to backend
  const message = await api.sendMessage(conversationId, text);
  
  // 2. Cache locally
  await cacheLocally(message);
  
  return message;
}
```

### Phase 3: Full Backend

```typescript
async function sendMessage(conversationId, text, senderId) {
  // Backend only, with WebSocket for real-time updates
  const message = await api.sendMessage(conversationId, text);
  
  // EventEmitter still used for optimistic updates
  emitter.emit('messageSent', message);
  
  return message;
}
```

## Troubleshooting Guide

### Issue: Messages not persisting

**Symptoms:** Messages disappear after app restart

**Check:**
```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

// Test storage
try {
  await AsyncStorage.setItem('test', 'value');
  const value = await AsyncStorage.getItem('test');
  console.log('Storage works:', value === 'value');
} catch (error) {
  console.error('Storage error:', error);
}
```

**Solutions:**
- Check AsyncStorage permissions
- Verify storage quota
- Clear corrupted data: `await AsyncStorage.clear()`

### Issue: UI not updating

**Symptoms:** Send message but UI doesn't show it

**Check:**
```typescript
useEffect(() => {
  const handler = () => console.log('Event received!');
  messagingService.on('messageSent', handler);
  return () => messagingService.off('messageSent', handler);
}, []);
```

**Solutions:**
- Verify event listeners are registered
- Check console for event logs
- Ensure cleanup functions run

### Issue: Duplicate conversations

**Symptoms:** Multiple chats with same user

**Check:**
```typescript
// Are you using the right method?
// ✅ Good
await messageService.getOrCreateConversation([userId], name);

// ❌ Bad
await messageService.createConversation([userId], name, false);
```

**Solutions:**
- Use `getOrCreateConversation` for 1:1 chats
- Clear storage and recreate: `await AsyncStorage.removeItem('@bountyexpo:conversations')`

## Testing Checklist

### Manual Tests

- [ ] Send message in new conversation
- [ ] Send message in existing conversation
- [ ] Messages persist after app restart
- [ ] Conversations persist after app restart
- [ ] Create conversation from bounty detail
- [ ] Accept request creates conversation
- [ ] Click avatar navigates to profile
- [ ] Click username navigates to profile
- [ ] Profile navigation disabled for groups
- [ ] Empty state shows when no conversations
- [ ] Unread count updates correctly
- [ ] Last message updates in list
- [ ] Conversation sorted by most recent

### Integration Tests

```typescript
// Test conversation creation
it('creates conversation from bounty detail', async () => {
  const conversation = await messageService.getOrCreateConversation(
    ['user-123'],
    'Test User',
    '42'
  );
  
  expect(conversation.id).toBeDefined();
  expect(conversation.participantIds).toContain('user-123');
  expect(conversation.bountyId).toBe('42');
});

// Test duplicate prevention
it('prevents duplicate conversations', async () => {
  const conv1 = await messageService.getOrCreateConversation(['user-123'], 'User');
  const conv2 = await messageService.getOrCreateConversation(['user-123'], 'User');
  
  expect(conv1.id).toBe(conv2.id);
});

// Test message sending
it('sends message successfully', async () => {
  const conversation = await messageService.createConversation(
    ['user-123'],
    'Test',
    false
  );
  
  const { message } = await messageService.sendMessage(
    conversation.id,
    'Hello!',
    'current-user'
  );
  
  expect(message.text).toBe('Hello!');
  expect(message.status).toBe('sent');
});
```

## Performance Benchmarks

### Target Metrics

| Operation | Target | Notes |
|-----------|--------|-------|
| Load conversations | < 100ms | For up to 100 conversations |
| Load messages | < 200ms | For up to 1000 messages |
| Send message | < 50ms | Optimistic update |
| Create conversation | < 100ms | Including storage write |
| Event propagation | < 10ms | From emit to handler |

### Monitoring

```typescript
// Add timing logs
const start = Date.now();
const conversations = await messagingService.listConversations(userId);
console.log(`Load time: ${Date.now() - start}ms`);
```

## Future Enhancements

### Short-term

- [ ] Message read receipts
- [ ] Typing indicators (infrastructure exists)
- [ ] Rich media attachments
- [ ] Message search

### Medium-term

- [ ] Backend integration
- [ ] WebSocket real-time sync
- [ ] Push notifications
- [ ] Message encryption

### Long-term

- [ ] Voice messages
- [ ] Video calls
- [ ] Screen sharing
- [ ] AI moderation
