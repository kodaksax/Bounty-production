# Messenger Quality-of-Life Features - Architecture

## Component Hierarchy

```
ChatDetailScreen
├── Header (existing)
│   ├── Back Button
│   ├── Avatar
│   ├── Name
│   └── Actions (Phone, Video)
├── PinnedMessageHeader (NEW)
│   ├── Pin Icon
│   ├── Message Text
│   └── Dismiss Button
├── Error Banner (existing)
├── FlatList (optimized)
│   ├── MessageBubble (NEW) × N
│   │   ├── Pin Badge (if pinned)
│   │   ├── Message Text
│   │   └── Status Icon (NEW)
│   │       ├── sending: ⏰
│   │       ├── sent: ✓
│   │       ├── delivered: ✓✓
│   │       ├── read: ✓✓ (blue)
│   │       └── failed: ⚠️
│   └── TypingIndicator (NEW)
│       ├── Animated Dots
│       └── "User is typing..."
├── Message Input (affixed)
└── MessageActions Modal (NEW)
    ├── Pin/Unpin
    ├── Copy
    ├── Report
    └── Cancel
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    ChatDetailScreen                      │
│                                                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │            useMessages Hook                        │  │
│  │                                                     │  │
│  │  State:                                            │  │
│  │  • messages: Message[]                             │  │
│  │  • pinnedMessage: Message | null                   │  │
│  │  • loading, error                                  │  │
│  │                                                     │  │
│  │  Actions:                                          │  │
│  │  • sendMessage(text)                               │  │
│  │  • pinMessage(id)                                  │  │
│  │  • unpinMessage(id)                                │  │
│  │  • copyMessage(id)                                 │  │
│  │  • reportMessage(id)                               │  │
│  └────────┬──────────────────────────────┬───────────┘  │
│           │                               │              │
│           │ subscribes to                 │ calls        │
│           ▼                               ▼              │
│  ┌────────────────┐           ┌──────────────────────┐  │
│  │  useSocketStub │           │   messageService      │  │
│  │                │           │                       │  │
│  │  • onTyping    │           │  • sendMessage()     │  │
│  │  • onStatus    │           │  • pinMessage()      │  │
│  └────────────────┘           │  • getPinnedMessage()│  │
│                                │  • reportMessage()   │  │
│                                └──────────────────────┘  │
└─────────────────────────────────────────────────────────┘

                        │
                        │ emits events
                        ▼
              ┌──────────────────┐
              │   socketStub      │
              │                   │
              │  Auto-transitions:│
              │  sending → delivered (300ms) │
              │  delivered → read (3s)       │
              └──────────────────┘
```

## Message Status State Machine

```
    [User sends message]
            │
            ▼
    ┌───────────────┐
    │   SENDING     │  (optimistic, immediate)
    │   icon: ⏰     │
    └───────┬───────┘
            │
            │ 300ms (socket event)
            ▼
    ┌───────────────┐
    │  DELIVERED    │  (server received)
    │   icon: ✓✓    │
    └───────┬───────┘
            │
            │ 3s (socket event)
            ▼
    ┌───────────────┐
    │     READ      │  (recipient viewed)
    │  icon: ✓✓ 🔵  │
    └───────────────┘
```

## Pin Message Flow

```
User long-press message
        │
        ▼
MessageActions modal opens
        │
        │ user taps "Pin"
        ▼
Optimistic update:
• Set isPinned=true on message
• Clear isPinned on other messages
• Update pinnedMessage state
        │
        ▼
Call messageService.pinMessage(id)
        │
        ├─ Success ─→ Keep optimistic UI
        │
        └─ Error ───→ Rollback UI
                      Show error banner
```

## Component Responsibilities

### ChatDetailScreen
- **Responsibility**: Orchestrate all sub-components
- **State Management**: Uses useMessages hook
- **Interactions**: 
  - Long-press → show MessageActions
  - Send message → scroll to bottom
  - Tap pinned header → scroll to message

### MessageBubble (Memoized)
- **Responsibility**: Render individual message
- **Props**: id, text, isUser, status, isPinned, onLongPress
- **Performance**: React.memo prevents unnecessary re-renders
- **Features**:
  - Shows status icon based on message.status
  - Shows pin badge if message.isPinned
  - Handles long-press for actions

### PinnedMessageHeader
- **Responsibility**: Display pinned message
- **Props**: text, onPress, onDismiss
- **Features**:
  - Amber accent color
  - Click to scroll to message
  - Dismiss to unpin

### TypingIndicator
- **Responsibility**: Show typing animation
- **Props**: userName
- **Features**:
  - Animated bouncing dots
  - Auto-clear after 3s
  - Emerald theme

### MessageActions
- **Responsibility**: Action sheet modal
- **Props**: visible, onClose, onPin, onCopy, onReport, isPinned
- **Features**:
  - Pin/Unpin (dynamic label)
  - Copy to clipboard
  - Report with confirmation

### useSocketStub Hook
- **Responsibility**: Mock real-time events
- **Features**:
  - Emit typing events
  - Emit status events
  - Subscribe to events
  - Auto-clear typing after timeout
  - Simulate status transitions

### useMessages Hook
- **Responsibility**: Message CRUD + socket integration
- **Features**:
  - Fetch messages
  - Send with optimistic updates
  - Pin/unpin with rollback
  - Copy to clipboard
  - Report message
  - Subscribe to socket events
  - Auto-update status from socket

### messageService
- **Responsibility**: Data persistence (mock)
- **Features**:
  - CRUD operations on messages
  - Pin logic (one per conversation)
  - Report logging
  - Status updates

## Performance Optimizations

### FlatList Configuration
```typescript
<FlatList
  data={messages}
  renderItem={renderMessage}
  keyExtractor={(item) => item.id}
  
  // Performance props
  inverted={false}           // Natural scroll direction
  getItemLayout={getItemLayout} // Fixed height for fast scroll
  maxToRenderPerBatch={20}   // Render 20 at a time
  initialNumToRender={15}    // Start with 15
  windowSize={10}            // Keep 10 screens in memory
  removeClippedSubviews={true} // Remove off-screen views
/>
```

### getItemLayout Implementation
```typescript
const getItemLayout = (_: any, index: number) => ({
  length: 80,        // Approximate message height
  offset: 80 * index, // Calculate offset
  index,
});
```

### MessageBubble Memoization
```typescript
export const MessageBubble = memo(({ ... }) => {
  // Component logic
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  return prevProps.id === nextProps.id
    && prevProps.status === nextProps.status
    && prevProps.isPinned === nextProps.isPinned;
});
```

## Socket Events Timeline

```
Time    Event                         UI Update
────────────────────────────────────────────────────────
0ms     User sends message            Message appears with ⏰
        socketStub.simulateTransition()
        
300ms   emitMessageDelivered()       Icon changes to ✓✓
        
3000ms  emitMessageRead()            Icon changes to ✓✓ 🔵
```

## Error Handling

### Pin Message Error
```
pinMessage(id)
  ↓
Optimistic UI update
  ↓
API call
  ↓
  ├─ Success → Keep UI
  └─ Error → Rollback UI
             Show error banner
             Re-fetch messages
```

### Network Error
```
sendMessage(text)
  ↓
Optimistic UI update (status: sending)
  ↓
API call fails
  ↓
Update status to 'failed' ⚠️
  ↓
User can tap to retry
```

## Theme Colors

```typescript
// Status icons
sending:   '#d1fae5'  // emerald-200 (gray)
sent:      '#d1fae5'  // emerald-200
delivered: '#d1fae5'  // emerald-200
read:      '#60a5fa'  // blue-400
failed:    '#ef4444'  // red-500

// Pin colors
pinBadge:  'rgba(251, 191, 36, 0.2)' // amber-400 bg
pinIcon:   '#fbbf24'  // amber-400
pinHeader: 'rgba(251, 191, 36, 0.15)' // amber tint

// Message bubbles
userMessage:   'bg-white'
otherMessage:  'bg-emerald-700/60'

// Actions
dangerText:    '#fca5a5'  // red-300
```

## File Structure

```
bountyexpo/
├── app/tabs/
│   └── chat-detail-screen.tsx      (enhanced)
├── components/
│   ├── MessageBubble.tsx           (NEW)
│   ├── MessageActions.tsx          (NEW)
│   ├── PinnedMessageHeader.tsx     (NEW)
│   ├── TypingIndicator.tsx         (NEW)
│   └── sticky-message-interface.tsx (existing)
├── hooks/
│   ├── useMessages.ts              (enhanced)
│   └── useSocketStub.ts            (NEW)
├── lib/
│   ├── types.ts                    (enhanced)
│   └── services/
│       └── message-service.ts      (enhanced)
└── tests/
    ├── messenger-qol-validation.md  (NEW)
    └── demo-messenger-features.md   (NEW)
```

## Integration Points

### With Existing Code
- ✅ Uses existing `Message` and `Conversation` types
- ✅ Works with existing `messageService`
- ✅ Integrates with `ChatDetailScreen`
- ✅ Maintains emerald theme
- ✅ Respects safe area insets

### Future Integration
- 🔄 Replace `socketStub` with real WebSocket
- 🔄 Connect to backend API for persistence
- 🔄 Add analytics tracking
- 🔄 Integrate with notification system
- 🔄 Add moderation queue for reports

## Accessibility

```typescript
// MessageActions
<TouchableOpacity 
  accessible={true}
  accessibilityLabel="Pin message"
  accessibilityRole="button"
>

// Status Icons
<MaterialIcons
  accessible={true}
  accessibilityLabel={`Message ${status}`}
/>

// PinnedMessageHeader
<View
  accessible={true}
  accessibilityLabel={`Pinned: ${text}`}
  accessibilityRole="header"
>
```
