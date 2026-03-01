# Offline Resiliency and Optimistic UI Guide

## Overview

This implementation adds offline support and optimistic UI to the BountyExpo app, allowing users to continue creating bounties and sending messages even when offline. All actions are automatically queued and synced when the connection is restored.

## Features

### 1. Offline Queue Service (`lib/services/offline-queue-service.ts`)

A centralized service that manages all offline actions:

- **Persistent Storage**: Uses AsyncStorage to persist queued actions across app restarts
- **Network Monitoring**: Listens to NetInfo for connection state changes
- **Automatic Retry**: Processes queued items when coming back online
- **Exponential Backoff**: Implements smart retry logic (1s, 2s, 4s, 8s...)
- **Max Retries**: Marks items as failed after 3 attempts

#### Queue Item States

- `pending`: Waiting to be processed
- `processing`: Currently being sent
- `failed`: Max retries exceeded

### 2. Bounty Creation with Offline Support

#### Changes to `bounty-service.ts`

The `create()` method now:
1. Checks network connectivity
2. If offline: Queues the bounty and returns a temporary ID for optimistic UI
3. If online: Creates the bounty normally
4. Added `processQueuedBounty()` method called by the queue service

#### Changes to `CreateBounty/index.tsx`

- **Removed blocking connectivity check** that prevented submission
- Shows different success messages for online vs offline:
  - Online: "Bounty Posted! 🎉"
  - Offline: "Bounty Queued! 📤"
- Users can continue working without interruption

### 3. Message Sending with Offline Support

#### Changes to `message-service.ts`

The `sendMessage()` method now:
1. Adds message optimistically with 'sending' status
2. Checks network connectivity
3. If offline: Queues for later delivery
4. If online: Sends normally
5. Added `processQueuedMessage()` method for queue processing

#### Changes to `MessageBubble.tsx`

Added visual indicators:
- **Sending**: Clock icon (⏱️)
- **Sent**: Single check (✓)
- **Delivered**: Double check (✓✓)
- **Read**: Blue double check (✓✓)
- **Failed**: Error icon with retry button

#### Retry Button

Failed messages now show a retry button:
```tsx
<TouchableOpacity onPress={handleRetry}>
  <MaterialIcons name="refresh" size={16} />
  <Text>Retry</Text>
</TouchableOpacity>
```

### 4. Visual Status Indicators

#### Offline Status Badge (`components/offline-status-badge.tsx`)

Shows current sync status:
- **Hidden**: When online with no pending items
- **Orange "X syncing..."**: Items being uploaded
- **Orange "X pending"**: Waiting for connection
- **Red "X failed"**: Items failed after retries

Appears in:
- Messenger screen (below INBOX title)
- Postings screen (below header)

#### Hook for Components (`hooks/useOfflineQueue.ts`)

```tsx
const { 
  queue,           // All queued items
  isOnline,        // Connection status
  pendingCount,    // Number of pending items
  failedCount,     // Number of failed items
  hasPending,      // Boolean: has pending items
  retryItem,       // Retry a specific item
  removeItem,      // Remove from queue
  clearFailed      // Clear all failed items
} = useOfflineQueue()
```

## User Experience Flow

### Creating a Bounty Offline

1. User fills out bounty form
2. Taps "Post Bounty"
3. **Immediately sees**: "Bounty Queued! 📤" message
4. Bounty appears in their list with temporary ID
5. **When connection restores**: Bounty automatically uploads
6. Status badge updates in real-time

### Sending Messages Offline

1. User types and sends message
2. Message appears immediately with clock icon ⏱️
3. **If offline**: Message stays in 'sending' state
4. **When connection restores**: 
   - Icon changes to ✓ (sent)
   - Then ✓✓ (delivered)
5. **If failure**: Shows error icon and retry button

### Handling Failures

1. After 3 failed attempts, item marked as 'failed'
2. Status badge shows red with failed count
3. User can manually retry from badge or message
4. Or clear failed items if they want to give up

## Technical Details

### Queue Processing

```typescript
// On app start
offlineQueueService loads queue from AsyncStorage

// On network change
NetInfo.addEventListener(state => {
  if (state.isConnected) {
    processQueue() // Attempt to send all pending items
  }
})

// Retry logic
const backoffMs = 1000 * Math.pow(2, retryCount) // 1s, 2s, 4s, 8s
```

### Storage Keys

- `offline-queue-v1`: Main queue storage in AsyncStorage
- Items persist across app restarts
- Automatic cleanup on successful processing

### Error Handling

- Network errors: Retry with backoff
- Server errors (4xx/5xx): Log and mark as failed
- Validation errors: Mark as failed (user needs to fix)

## Testing

### Manual Testing Scenarios

1. **Offline Bounty Creation**
   - Turn off WiFi/cellular
   - Create a bounty
   - Verify "Bounty Queued" message
   - Turn on connection
   - Verify bounty uploads automatically

2. **Offline Message Sending**
   - Go offline in a conversation
   - Send multiple messages
   - See all in 'sending' state
   - Go online
   - Watch them update to 'sent'

3. **Retry Failed Messages**
   - Send message while offline
   - Keep offline for 30+ seconds
   - Go back online
   - If it fails, tap retry button

4. **Visual Status Badge**
   - Go offline and create/send items
   - Check badge shows pending count
   - Go online and watch it sync
   - Badge disappears when done

## Performance Considerations

- Queue processing runs in background
- Non-blocking: UI remains responsive
- Efficient polling: Only processes when online
- Listeners clean up properly to avoid memory leaks

## Future Enhancements

- [ ] Conflict resolution for concurrent edits
- [ ] Batch processing for multiple items
- [ ] Progress indicators for large uploads
- [ ] Manual sync trigger in settings
- [ ] Sync history/log viewer
- [ ] Priority queue for urgent items

## Architecture Diagram

```
┌─────────────────────────────────────────────┐
│           User Action (Offline)              │
│         (Create Bounty / Send Message)       │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│         Offline Queue Service                │
│  • Enqueue item with temp ID                 │
│  • Save to AsyncStorage                      │
│  • Return optimistic result                  │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│           UI Updates Optimistically          │
│  • Show success message                      │
│  • Display item with pending badge           │
└─────────────────────────────────────────────┘

         [User goes back online]
                   │
                   ▼
┌─────────────────────────────────────────────┐
│        NetInfo Detects Connection            │
│  • Triggers processQueue()                   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│         Process Each Queue Item              │
│  • Call service method (bounty/message)      │
│  • Handle success/failure                    │
│  • Update status badge                       │
│  • Remove from queue on success              │
└─────────────────────────────────────────────┘
```

## Key Files Modified

- `lib/services/offline-queue-service.ts` ✨ NEW
- `hooks/useOfflineQueue.ts` ✨ NEW
- `components/offline-status-badge.tsx` ✨ NEW
- `lib/services/bounty-service.ts` - Added offline support
- `lib/services/message-service.ts` - Added offline support
- `app/screens/CreateBounty/index.tsx` - Removed blocking check
- `components/MessageBubble.tsx` - Added retry button
- `app/tabs/chat-detail-screen.tsx` - Wire up retry handler
- `app/tabs/messenger-screen.tsx` - Added status badge
- `app/tabs/postings-screen.tsx` - Added status badge

## Summary

This implementation provides a seamless offline experience where users can continue working without worrying about connectivity. All actions are automatically queued, retried, and synced when possible, with clear visual feedback throughout the process.
