# Demo: Messenger Quality-of-Life Features

## Quick Start Demo

### 1. Start the app
```bash
npm start
```

### 2. Navigate to Messenger
- Tap the "create" icon in bottom navigation (Messenger screen)
- Select any conversation

### 3. Demo Typing Indicator

Open the React Native debugger console and run:

```javascript
// Import the socket stub
import { socketStub } from './hooks/useSocketStub';

// Simulate someone typing in conversation 'c1'
socketStub.emitTyping('user-1', 'c1');

// The typing indicator will appear for 3 seconds, then auto-clear
```

**Expected Result**: 
- Three animated dots appear at the bottom of the message list
- Text shows "Someone is typing..."
- Indicator disappears after 3 seconds

### 4. Demo Message Status Transitions

Send a message in the conversation. You'll see the status automatically transition:

1. **Sending** (immediately) - Clock icon, gray
2. **Delivered** (after 300ms) - Double checkmark, emerald
3. **Read** (after 3 seconds) - Double checkmark, blue

The status transitions are handled by the socket stub automatically.

### 5. Demo Pin Message

1. Long-press on any message
2. Action sheet appears with options
3. Tap "Pin Message"
4. **Result**:
   - Pinned message header appears at the top (amber color)
   - Pin icon shows next to the message
5. Tap the pinned header to scroll to that message
6. Long-press the header's X button to unpin

### 6. Demo Copy Message

1. Long-press on any message
2. Tap "Copy Text"
3. Alert confirms "Copied"
4. Try pasting in another app - the message text is there!

### 7. Demo Report Message

1. Long-press on any message
2. Tap "Report Message" (red text)
3. Confirmation dialog appears
4. Tap "Report"
5. Alert confirms "Reported"

### 8. Demo Performance

With a conversation that has 100+ messages:

1. Scroll quickly from top to bottom
2. Notice smooth scrolling with no lag
3. Memory usage stays stable
4. Messages render efficiently with `getItemLayout`

## Code Examples

### Example 1: Using Socket Stub in Dev Tools

```javascript
// Simulate typing
socketStub.emitTyping('user-123', 'c1');

// Simulate message delivered
socketStub.emitMessageDelivered('m1');

// Simulate message read
socketStub.emitMessageRead('m1');

// Simulate full status transition (delivered → read)
socketStub.simulateMessageStatusTransition('m2');
```

### Example 2: Programmatic Pin/Unpin

```javascript
// In your component
const { pinMessage, unpinMessage, pinnedMessage } = useMessages('c1');

// Pin a message
await pinMessage('m1');

// Unpin
if (pinnedMessage) {
  await unpinMessage(pinnedMessage.id);
}
```

### Example 3: Subscribe to Socket Events

```javascript
import { socketStub } from './hooks/useSocketStub';

// Subscribe to typing
const unsubscribeTyping = socketStub.onTyping((event) => {
  console.log(`User ${event.userId} is typing in ${event.conversationId}`);
});

// Subscribe to message status
const unsubscribeStatus = socketStub.onMessageStatus((event) => {
  console.log(`Message ${event.messageId} is now ${event.status}`);
});

// Clean up
unsubscribeTyping();
unsubscribeStatus();
```

## UI Component Showcase

### TypingIndicator
```tsx
import { TypingIndicator } from './components/TypingIndicator';

<TypingIndicator userName="Alice" />
```

### MessageActions
```tsx
import { MessageActions } from './components/MessageActions';

<MessageActions
  visible={showActions}
  onClose={() => setShowActions(false)}
  onPin={() => pinMessage(selectedId)}
  onCopy={() => copyMessage(selectedId)}
  onReport={() => reportMessage(selectedId)}
  isPinned={selectedMessage?.isPinned}
/>
```

### PinnedMessageHeader
```tsx
import { PinnedMessageHeader } from './components/PinnedMessageHeader';

{pinnedMessage && (
  <PinnedMessageHeader
    text={pinnedMessage.text}
    onPress={() => scrollToMessage(pinnedMessage.id)}
    onDismiss={() => unpinMessage(pinnedMessage.id)}
  />
)}
```

### MessageBubble
```tsx
import { MessageBubble } from './components/MessageBubble';

<MessageBubble
  id={message.id}
  text={message.text}
  isUser={message.senderId === 'current-user'}
  status={message.status}
  isPinned={message.isPinned}
  onLongPress={(id) => handleLongPress(id)}
/>
```

## Testing Checklist

- [ ] Typing indicator appears and auto-clears
- [ ] Message status transitions: sending → delivered → read
- [ ] Long-press opens action sheet
- [ ] Pin message shows header and badge
- [ ] Pinned header scrolls to message
- [ ] Copy message works
- [ ] Report message shows confirmation
- [ ] Performance: smooth scrolling with 200+ messages
- [ ] No memory leaks during long sessions
- [ ] Accessibility: screen reader announces actions
- [ ] Theme: emerald colors throughout

## Known Limitations

1. **Socket Stub**: Currently uses setTimeout for simulations. Replace with real WebSocket in production.
2. **Input**: Current input is simplified. Use StickyMessageInterface for full typing experience.
3. **Read Receipts**: Currently simulated. In production, should be triggered by actual user viewing.
4. **Persistence**: Pin state is in-memory. Should persist to database in production.

## Next Steps

1. Integrate with real backend WebSocket server
2. Add unit tests for all components
3. Add integration tests for user flows
4. Add analytics tracking for pin/copy/report actions
5. Implement server-side moderation queue for reports
6. Add notification preferences for typing indicators
7. Add batch message operations
8. Add message search functionality
