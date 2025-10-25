# Supabase Realtime Messaging - Quick Reference

## Overview
This implementation provides 1:1 realtime messaging using Supabase with local caching, soft delete, and profile avatars.

## Quick Start

### 1. Setup Supabase
```bash
# Run the schema setup SQL
# In Supabase Dashboard > SQL Editor, run:
supabase/schema-messaging.sql
```

### 2. Configure Environment
```bash
# Add to your .env file:
EXPO_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
EXPO_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
```

### 3. Enable Realtime in Dashboard
1. Go to Database → Replication
2. Enable Realtime for:
   - `conversations`
   - `conversation_participants`  
   - `messages`

## Usage Examples

### Creating a Conversation
```typescript
import * as supabaseMessaging from '@/lib/services/supabase-messaging';

// Get or create a 1:1 conversation
const conversation = await supabaseMessaging.getOrCreateConversation(
  currentUserId,
  otherUserId,
  bountyId // optional
);
```

### Sending a Message
```typescript
const message = await supabaseMessaging.sendMessage(
  conversationId,
  'Hello!',
  currentUserId
);
```

### Subscribe to Realtime Updates
```typescript
// In a component
const subscription = supabaseMessaging.subscribeToMessages(
  conversationId,
  (newMessage) => {
    if (newMessage) {
      // New message received
      console.log('New message:', newMessage);
    }
  }
);

// Cleanup on unmount
return () => {
  supabaseMessaging.unsubscribe(`messages:${conversationId}`);
};
```

### Soft Delete a Conversation
```typescript
await supabaseMessaging.softDeleteConversation(
  conversationId,
  currentUserId
);
```

## Hooks

### useConversations
```typescript
import { useConversations } from '@/hooks/useConversations';

function MessengerScreen() {
  const { 
    conversations, 
    loading, 
    error, 
    refresh, 
    markAsRead,
    deleteConversation 
  } = useConversations();

  return (
    // Conversation list UI
  );
}
```

### useMessages
```typescript
import { useMessages } from '@/hooks/useMessages';

function ChatScreen({ conversationId }) {
  const { 
    messages, 
    loading, 
    error, 
    sendMessage, 
    refresh 
  } = useMessages(conversationId);

  return (
    // Chat UI
  );
}
```

## Features

### ✅ Implemented
- [x] 1:1 realtime messaging
- [x] Optimistic message sending
- [x] Local message caching (AsyncStorage)
- [x] Soft delete for conversations
- [x] Profile avatars with initials fallback
- [x] Color-coded message bubbles
- [x] Swipe-to-delete conversations
- [x] RLS policies for security
- [x] Automatic timestamp updates

### 🚧 Limitations
- Pin/unpin messages not yet implemented in backend
- Group chats not fully implemented (schema supports it)
- Media attachments not implemented
- Message read receipts not implemented

## Architecture

```
┌─────────────────────────────────────────┐
│           UI Components                 │
│  (messenger-screen, chat-detail-screen) │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│          React Hooks                    │
│   (useConversations, useMessages)       │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│    Supabase Messaging Service           │
│  (lib/services/supabase-messaging.ts)   │
└──────────────┬──────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
┌───────▼──────┐ ┌───▼──────────┐
│  Supabase    │ │ AsyncStorage │
│  (Realtime)  │ │  (Caching)   │
└──────────────┘ └──────────────┘
```

## Database Schema

### conversations
- `id` (UUID, PK)
- `is_group` (boolean)
- `bounty_id` (UUID, FK → bounties)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### conversation_participants
- `id` (UUID, PK)
- `conversation_id` (UUID, FK → conversations)
- `user_id` (UUID, FK → profiles)
- `joined_at` (timestamptz)
- `deleted_at` (timestamptz) - **Soft delete**
- `last_read_at` (timestamptz)

### messages
- `id` (UUID, PK)
- `conversation_id` (UUID, FK → conversations)
- `sender_id` (UUID, FK → profiles)
- `text` (text)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)
- `media_url` (text, nullable)
- `reply_to` (UUID, FK → messages, nullable)
- `is_pinned` (boolean)

## Testing

### Manual Test Checklist
1. [ ] Create two user accounts
2. [ ] Start a conversation from user 1 to user 2
3. [ ] Send messages from both users
4. [ ] Verify real-time updates (messages appear without refresh)
5. [ ] Verify message bubble colors (sender: emerald, receiver: neutral)
6. [ ] Test swipe-to-delete on conversation list
7. [ ] Verify soft delete (conversation hidden for current user only)
8. [ ] Test avatar display and initials fallback
9. [ ] Close and reopen app - verify messages persist
10. [ ] Test offline: send message, verify it's queued
11. [ ] Go online, verify queued message is sent

### Testing SQL Queries
```sql
-- View all conversations
SELECT * FROM conversations;

-- View participants
SELECT * FROM conversation_participants;

-- View messages
SELECT * FROM messages ORDER BY created_at DESC;

-- Check RLS policies
SELECT tablename, policyname FROM pg_policies 
WHERE tablename IN ('conversations', 'conversation_participants', 'messages');
```

## Troubleshooting

### Messages not appearing in realtime
- Verify tables are in `supabase_realtime` publication
- Check Realtime is enabled in Supabase dashboard
- Ensure RLS policies allow access

### Soft delete not working
- Check `conversation_participants.deleted_at` is being set
- Verify query filters by `deleted_at IS NULL`

### Avatars not loading
- Confirm `Profilepictures` bucket exists and is public
- Check storage policies allow public read access
- Verify avatar path format: `<user_id>/<filename>`

## Performance Notes

- **Local caching**: Messages cached per conversation in AsyncStorage
- **Optimistic updates**: UI updates immediately, then syncs with server
- **Pagination**: Not yet implemented (all messages loaded at once)
- **Message limits**: Consider implementing pagination for conversations with >100 messages

## Security

### RLS Policies
- Users can only view conversations they're participants in
- Users can only send messages in their conversations
- Users can only update their own messages
- Soft delete prevents other users from seeing deleted conversations

### Best Practices
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in client code
- Use `auth.uid()` in RLS policies for user identification
- Validate message content on client and server
- Implement rate limiting for message sending

## References

- [Full Setup Guide](./docs/SUPABASE_MESSAGING_SETUP.md)
- [Supabase Realtime Docs](https://supabase.com/docs/guides/realtime)
- [Supabase RLS Docs](https://supabase.com/docs/guides/auth/row-level-security)
