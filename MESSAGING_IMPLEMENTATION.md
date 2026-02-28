# End-to-End Messaging Implementation

## Overview

This document describes the implementation of a persistent, end-to-end messaging system for BOUNTYExpo. The system replaces hardcoded chat data with a local-first, AsyncStorage-backed solution that includes real-time UI updates via EventEmitter.

## Architecture

### Core Components

1. **lib/services/messaging.ts** - New persistent messaging layer
2. **lib/services/message-service.ts** - Existing service adapted to use messaging.ts
3. **hooks/useConversations.ts** - React hook for conversation list
4. **hooks/useMessages.ts** - React hook for message list
5. **app/tabs/chat-detail-screen.tsx** - Individual chat view
6. **app/tabs/messenger-screen.tsx** - Conversation list view
7. **components/bountydetailmodal.tsx** - Start chat from bounty details
8. **app/tabs/postings-screen.tsx** - Auto-create chat on request acceptance

## Data Flow

### Storage Layer (messaging.ts)

```typescript
// AsyncStorage keys
CONVERSATIONS_KEY = '@bountyexpo:conversations'
MESSAGES_KEY = '@bountyexpo:messages'
```

All data is persisted to AsyncStorage and survives app restarts.

### Event System

The messaging service uses Node's EventEmitter to notify the UI of changes:

- `conversationsUpdated` - Fired when conversation list changes
- `messagesUpdated` - Fired when messages change
- `messageSent` - Fired when a new message is sent

### API Methods

#### Core Operations

```typescript
// List all conversations for a user
listConversations(userId: string): Promise<Conversation[]>

// Get a specific conversation
getConversation(conversationId: string): Promise<Conversation | null>

// Get all messages in a conversation
getMessages(conversationId: string): Promise<Message[]>

// Send a message
sendMessage(
  conversationId: string, 
  text: string, 
  senderId: string
): Promise<Message>

// Create a new conversation
createConversation(
  participantIds: string[],
  name: string,
  isGroup?: boolean,
  bountyId?: string
): Promise<Conversation>

// Mark conversation as read
markAsRead(conversationId: string, userId: string): Promise<void>

// Get or create a 1:1 conversation (prevents duplicates)
getOrCreateConversation(
  participantIds: string[],
  name: string,
  bountyId?: string
): Promise<Conversation>
```

#### Event Subscription

```typescript
// Subscribe to events
on(event: string, handler: Function): void

// Unsubscribe from events
off(event: string, handler: Function): void
```

## Key Features

### 1. Persistent Storage

All conversations and messages are stored in AsyncStorage:
- Survives app restarts
- No backend required initially
- Easy to swap with real backend later

### 2. Real-time Updates

React hooks automatically update when data changes:

```typescript
useEffect(() => {
  const handleUpdate = () => fetchConversations();
  
  messagingService.on('conversationsUpdated', handleUpdate);
  messagingService.on('messageSent', handleUpdate);
  
  return () => {
    messagingService.off('conversationsUpdated', handleUpdate);
    messagingService.off('messageSent', handleUpdate);
  };
}, []);
```

### 3. Duplicate Prevention

`getOrCreateConversation()` prevents multiple chats between the same two users:

```typescript
// Always returns the same conversation for user A and user B
const conversation = await messageService.getOrCreateConversation(
  [userA, userB],
  "Chat Name"
);
```

### 4. Profile Navigation

Click any avatar or username in chat views to navigate to that user's profile:

```typescript
// In chat-detail-screen.tsx
<TouchableOpacity 
  onPress={() => router.push(`/profile/${otherUserId}`)}
  disabled={!otherUserId || conversation.isGroup}
>
  <Avatar />
  <Text>{conversation.name}</Text>
</TouchableOpacity>
```

### 5. Multiple Entry Points

#### From Bounty Detail Modal

Users can message the bounty poster directly:

```typescript
<TouchableOpacity 
  onPress={handleMessagePoster}
  disabled={isCreatingChat}
>
  <Text>Message {bounty.username}</Text>
</TouchableOpacity>
```

#### From Requests Tab (Auto-created)

When a poster accepts a request, a conversation is automatically created:

```typescript
const conversation = await messageService.getOrCreateConversation(
  [hunterUserId],
  hunterUsername,
  bountyId.toString()
);

await messageService.sendMessage(
  conversation.id,
  `Welcome! You've been selected for: "${bounty.title}"...`,
  posterUserId
);
```

## Integration Points

### Bounty List → Bounty Detail → Chat

```
BountyListItem (passes user_id)
  ↓
BountyDetailModal (shows "Message" button)
  ↓
messageService.getOrCreateConversation()
  ↓
Navigate to Messenger → ChatDetailScreen
```

### Requests Tab → Auto-create Chat

```
PostingsScreen (Accept Request)
  ↓
messageService.getOrCreateConversation()
  ↓
messageService.sendMessage() (initial message)
  ↓
User can view in Messenger
```

## Data Contracts

All types follow `lib/types.ts` (source of truth):

### Conversation

```typescript
interface Conversation {
  id: string;
  bountyId?: string;
  isGroup: boolean;
  name: string;
  avatar?: string;
  lastMessage?: string;
  updatedAt?: string;
  participantIds?: string[];
  unread?: number;
}
```

### Message

```typescript
interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
  replyTo?: string;
  mediaUrl?: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  isPinned?: boolean;
}
```

## Backward Compatibility

The implementation maintains full backward compatibility:

1. **message-service.ts** still exports the same API
2. Existing offline queue integration works unchanged
3. Pin/unpin messages currently no-op (can be extended later)
4. No breaking changes to existing code

## Testing

### Manual Testing Checklist

- [ ] Send a message in a conversation
- [ ] Messages persist after app restart
- [ ] Create a new conversation from bounty detail
- [ ] Click "Message Poster" button
- [ ] Verify duplicate conversations are prevented
- [ ] Accept a request and verify auto-created chat
- [ ] Click avatar in chat to view profile
- [ ] Click conversation item to open chat
- [ ] Verify empty state when no conversations exist
- [ ] Test offline message queueing (existing feature)

### Automated Testing

A basic validation script is available at `/tmp/test-messaging.js`:

```bash
node /tmp/test-messaging.js
```

This verifies:
- All required exports are present
- AsyncStorage import exists
- EventEmitter is used

## Future Enhancements

### Easy Backend Migration

The architecture is designed for easy backend integration:

1. Replace AsyncStorage calls with API calls
2. Keep EventEmitter for optimistic updates
3. Add WebSocket for real-time sync
4. Maintain same API interface

### Potential Extensions

- [ ] Message read receipts
- [ ] Typing indicators (stub already exists)
- [ ] Rich media messages (images, files)
- [ ] Message pinning (fully functional)
- [ ] Message search
- [ ] Group chat improvements
- [ ] Push notifications for new messages
- [ ] Message encryption

## Troubleshooting

### Messages not persisting

Check AsyncStorage permissions and quota:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

// Test storage
await AsyncStorage.setItem('test', 'value');
const value = await AsyncStorage.getItem('test');
console.log('Storage working:', value === 'value');
```

### UI not updating

Verify event listeners are properly registered:

```typescript
// In your component
useEffect(() => {
  console.log('Subscribing to messaging events');
  messagingService.on('messageSent', handler);
  
  return () => {
    console.log('Unsubscribing from messaging events');
    messagingService.off('messageSent', handler);
  };
}, []);
```

### Duplicate conversations

Ensure you're using `getOrCreateConversation` instead of `createConversation` for 1:1 chats:

```typescript
// ✅ Good - prevents duplicates
const conv = await messageService.getOrCreateConversation([userId], name);

// ❌ Bad - creates duplicates
const conv = await messageService.createConversation([userId], name, false);
```

## Performance Considerations

### Optimizations Implemented

1. **FlatList optimization** in messenger-screen.tsx:
   - `keyExtractor` memoized
   - `renderItem` memoized
   - `maxToRenderPerBatch`, `windowSize` configured

2. **Event batching**: Multiple updates trigger single re-render

3. **Lazy loading**: Messages loaded only when conversation opened

### Scaling Considerations

For large message volumes:
- Consider pagination for message history
- Implement message pruning (keep recent N messages)
- Add indexes to AsyncStorage data
- Migrate to SQLite for better query performance

## Security Notes

Current implementation is local-only with no encryption. For production:

1. **Encrypt sensitive data** in AsyncStorage
2. **Validate user IDs** before creating conversations
3. **Sanitize message content** to prevent XSS
4. **Implement rate limiting** for message sending
5. **Add content moderation** hooks

## Related Documentation

- [PROFILE_FEATURE.md](./PROFILE_FEATURE.md) - User profile implementation
- [OFFLINE_RESILIENCY_GUIDE.md](./OFFLINE_RESILIENCY_GUIDE.md) - Offline support
- [lib/types.ts](./lib/types.ts) - Authoritative type definitions
- [COPILOT_AGENT.md](./COPILOT_AGENT.md) - Project guidelines

## Support

For questions or issues:
1. Check this documentation
2. Review code comments in lib/services/messaging.ts
3. Test with the validation script
4. Ensure all dependencies are installed (`npm install`)
