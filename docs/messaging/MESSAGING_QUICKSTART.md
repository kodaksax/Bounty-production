# Messaging System Quick Start Guide

## 🚀 Getting Started in 5 Minutes

This guide will get you up and running with the new messaging system.

## ✅ What's New

The app now has a **real, persistent messaging system**! 

Before: Hardcoded fake messages that disappeared on restart  
After: Real conversations that persist across app restarts

## 🎯 Key Features

1. **Send real messages** that actually save
2. **Create conversations** from bounty details
3. **Auto-created chats** when accepting requests
4. **Navigate to profiles** by clicking avatars in chats
5. **No duplicate conversations** - smart matching

## 📱 User Flows

### Flow 1: Message a Bounty Poster

```
1. Browse bounties on the Dashboard
2. Tap a bounty to view details
3. Scroll down to "Contact" section
4. Tap "Message {username}" button
5. Start chatting!
```

**Note:** The button only appears if:
- The bounty has a user_id
- You're not trying to message yourself

### Flow 2: Auto-Created Chat (Request Acceptance)

```
1. Go to Postings tab → Requests
2. Review incoming requests for your bounty
3. Tap "Accept" on a request
4. A conversation is automatically created
5. An initial welcome message is sent
6. View the chat in the Messenger tab
```

### Flow 3: Navigate to User Profile

```
1. Open any conversation in Messenger
2. Tap the avatar or name in the chat header
3. View the user's public profile
```

**Note:** This only works for:
- 1:1 conversations (not groups)
- Other users (not yourself)

## 🔧 For Developers

### Basic Usage

#### Import the service

```typescript
import { messageService } from 'lib/services/message-service';
```

#### Create a conversation

```typescript
const conversation = await messageService.getOrCreateConversation(
  [otherUserId],      // Array of participant IDs
  'Display Name',     // Name to show in conversation list
  bountyId?.toString() // Optional: link to a bounty
);
```

#### Send a message

```typescript
await messageService.sendMessage(
  conversationId,
  'Hello, world!',
  currentUserId
);
```

#### Get conversations

```typescript
const conversations = await messageService.getConversations();
// Returns all conversations for current user
```

#### Get messages

```typescript
const messages = await messageService.getMessages(conversationId);
// Returns all messages in a conversation
```

### React Hook Usage

#### List conversations

```typescript
import { useConversations } from 'hooks/useConversations';

function MyComponent() {
  const { conversations, loading, error, refresh } = useConversations();
  
  if (loading) return <Loading />;
  if (error) return <Error message={error} />;
  
  return <ConversationList conversations={conversations} />;
}
```

#### Display messages

```typescript
import { useMessages } from 'hooks/useMessages';

function ChatScreen({ conversationId }) {
  const { messages, sendMessage, loading } = useMessages(conversationId);
  
  return (
    <View>
      {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
      <Input onSend={sendMessage} />
    </View>
  );
}
```

## 📂 File Structure

```
lib/services/
├── messaging.ts           ← Core messaging service (NEW!)
└── message-service.ts     ← Adapter layer (updated)

hooks/
├── useConversations.ts    ← Conversation list hook (updated)
└── useMessages.ts         ← Message list hook (updated)

app/tabs/
├── messenger-screen.tsx   ← Conversation list UI
├── chat-detail-screen.tsx ← Individual chat UI (updated)
└── postings-screen.tsx    ← Auto-create chats (updated)

components/
├── bountydetailmodal.tsx  ← Message button (updated)
└── bounty-list-item.tsx   ← Pass user_id (updated)
```

## 🐛 Troubleshooting

### Issue: Messages disappear after restart

**Cause:** Data not being persisted

**Fix:**
1. Check that AsyncStorage is installed:
   ```bash
   npm list @react-native-async-storage/async-storage
   ```
2. Verify you're using the `message-service` (not calling storage directly)

### Issue: UI doesn't update after sending message

**Cause:** React hooks not subscribed to events

**Fix:** The hooks should automatically subscribe. Check console for errors.

### Issue: Multiple conversations with same user

**Cause:** Using `createConversation` instead of `getOrCreateConversation`

**Fix:** Always use `getOrCreateConversation` for 1:1 chats:
```typescript
// ✅ Good
await messageService.getOrCreateConversation([userId], name);

// ❌ Bad - creates duplicates
await messageService.createConversation([userId], name, false);
```

### Issue: Can't see "Message" button in bounty detail

**Cause:** user_id not being passed or user trying to message themselves

**Fix:** Verify:
1. BountyListItem receives and passes user_id
2. You're not viewing your own bounty
3. user_id is defined in bounty data

## 🧪 Testing Your Changes

### Quick Test

1. **Send a message**
   - Open a conversation
   - Type and send a message
   - Verify it appears in the chat

2. **Restart the app**
   - Close and reopen the app
   - Check that conversations and messages are still there

3. **Create a conversation**
   - Go to a bounty detail
   - Click "Message {username}"
   - Verify a new conversation opens

4. **Profile navigation**
   - Open any chat
   - Click the avatar in the header
   - Verify you navigate to that user's profile

### Validation Script

Run this to verify the service is set up correctly:

```bash
node /tmp/test-messaging.js
```

Expected output:
```
✓ messaging.ts file exists
✓ Export found: listConversations
✓ Export found: getConversation
✓ Export found: getMessages
✓ Export found: sendMessage
✓ Export found: createConversation
✓ Export found: markAsRead
✓ Export found: getOrCreateConversation
✓ Export found: on
✓ Export found: off
✓ AsyncStorage import found
✓ EventEmitter usage found

✅ All required exports and imports are present!
```

## 📚 Further Reading

- **MESSAGING_IMPLEMENTATION.md** - Technical details and API reference
- **MESSAGING_ARCHITECTURE.md** - Architecture diagrams and data flow
- **examples/messaging-usage-examples.ts** - 10 code examples

## 💡 Pro Tips

### 1. Always use getOrCreateConversation for 1:1 chats

This prevents duplicate conversations between the same two users.

### 2. Link conversations to bounties

Pass the bountyId when creating a conversation to maintain context:

```typescript
await messageService.getOrCreateConversation(
  [userId],
  username,
  bountyId.toString() // ← This creates the link
);
```

### 3. Check for existing conversations

Before creating a new conversation, the system automatically checks for existing ones:

```typescript
// This will return existing conversation if one exists
const conversation = await messageService.getOrCreateConversation([userId], name);
```

### 4. Use the hooks in React components

Don't call the service directly in components. Use the hooks:

```typescript
// ✅ Good
const { conversations, loading } = useConversations();

// ❌ Bad
const [conversations, setConversations] = useState([]);
useEffect(() => {
  messageService.getConversations().then(setConversations);
}, []);
```

The hooks automatically handle:
- Loading states
- Error handling
- Real-time updates
- Cleanup

### 5. Handle offline scenarios

The system automatically queues messages when offline. No special handling needed:

```typescript
// This works both online and offline
await messageService.sendMessage(conversationId, text, userId);
```

## 🎨 UI Customization

### Styling

The messaging UI follows the emerald theme:

```typescript
// Primary background
backgroundColor: '#047857' // emerald-700

// Message bubbles
userMessage: '#10b981'  // emerald-500
otherMessage: '#047857' // emerald-700

// Text colors
primaryText: '#ffffff'
secondaryText: '#a7f3d0' // emerald-200
```

### Animations

The chat screen uses:
- Optimistic updates for instant feedback
- Smooth scrolling to new messages
- Fade-in for new conversations

## 🔐 Security Notes

**Current Implementation:**
- Data stored locally in AsyncStorage (unencrypted)
- No server-side validation
- Client-side only

**For Production:**
- Add message encryption
- Validate user IDs on backend
- Implement rate limiting
- Add content moderation

## 🚀 Next Steps

1. **Test the new system**
   - Send some messages
   - Create conversations
   - Verify persistence

2. **Read the documentation**
   - MESSAGING_IMPLEMENTATION.md for technical details
   - MESSAGING_ARCHITECTURE.md for architecture
   - examples/messaging-usage-examples.ts for code patterns

3. **Integrate with your features**
   - Add message buttons where needed
   - Link conversations to your domain objects
   - Customize the UI to match your design

4. **Plan for backend migration**
   - Review the migration guide in MESSAGING_IMPLEMENTATION.md
   - Design your API endpoints
   - Plan WebSocket integration

## ❓ FAQ

**Q: Do I need to set up a backend?**  
A: No! The system works locally using AsyncStorage. Backend integration is optional for later.

**Q: Will my messages be there after app restart?**  
A: Yes! All conversations and messages are persisted to AsyncStorage.

**Q: Can I use this with my existing code?**  
A: Yes! The implementation is backward compatible. Existing code using `message-service.ts` will work unchanged.

**Q: How do I prevent duplicate conversations?**  
A: Use `getOrCreateConversation` instead of `createConversation` for 1:1 chats.

**Q: Can I add group chat support?**  
A: Yes! Use `createConversation` with `isGroup: true`:
```typescript
await messageService.createConversation(
  [user1, user2, user3],
  'Group Name',
  true // isGroup
);
```

**Q: How do I add attachments/media?**  
A: The Message type has a `mediaUrl` field. Extend `sendMessage` to handle file uploads.

**Q: Is the system scalable?**  
A: For small to medium datasets, yes. For large scale, see the migration guide to move to a backend.

**Q: Can I customize the UI?**  
A: Yes! All UI components are in `app/tabs/` and `components/`. Modify as needed while maintaining the data layer.

## 🎉 Success!

You're now ready to use the messaging system! If you have questions:

1. Check this guide
2. Read MESSAGING_IMPLEMENTATION.md
3. Review the code examples
4. Check inline comments in the code

Happy messaging! 💬
