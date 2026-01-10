# Enhanced Offline Experience Implementation

## Overview

This document describes the enhanced offline experience implemented in BOUNTYExpo, providing users with seamless functionality even when disconnected from the internet.

## Key Features

### 1. **Global Offline Mode Banner**
   - Displays at the top of the app when offline or syncing
   - Shows real-time sync status
   - Auto-dismisses when back online
   - Manual refresh trigger available

### 2. **Enhanced Data Caching**
   - Caches bounties, conversations, and user profiles
   - Intelligent cache invalidation
   - Stale-while-revalidate strategy
   - Pattern-based cache clearing

### 3. **Sync Status Indicators**
   - Real-time sync progress display
   - Badge indicators showing pending/failed items
   - Detailed and compact variants for different contexts

### 4. **Offline Queue Management**
   - Automatic queuing of offline actions
   - Smart retry logic with exponential backoff
   - Manual retry for failed items
   - Clear indication of queue status

## Components

### OfflineModeBanner
**Location:** `components/offline-mode-banner.tsx`

A global banner that appears when the device is offline or has pending sync items.

```tsx
import { OfflineModeBanner } from 'components/offline-mode-banner';

// Full banner with details
<OfflineModeBanner showDetails={true} />

// Compact version
<CompactOfflineBanner />
```

**Features:**
- Animated slide-in/out transitions
- Shows offline status with appropriate icon
- Displays count of pending sync items
- Manual sync trigger button
- Auto-hides when online with no pending items

**Props:**
- `showDetails?: boolean` - Whether to show sync details (default: true)
- `style?: any` - Custom style for the banner

### SyncStatusIndicator
**Location:** `components/sync-status-indicator.tsx`

Shows real-time sync progress for offline queue items.

```tsx
import { SyncStatusIndicator, SyncStatusBadge } from 'components/sync-status-indicator';

// Detailed indicator
<SyncStatusIndicator detailed={true} size="medium" />

// Badge version (count only)
<SyncStatusBadge />
```

**Features:**
- Different states: syncing, idle, error
- Size options: small, medium, large
- Activity indicator during sync
- Error and warning states

**Props:**
- `detailed?: boolean` - Show details or just icon (default: false)
- `size?: 'small' | 'medium' | 'large'` - Size of the indicator (default: 'medium')
- `style?: any` - Custom style

### ConnectionStatus
**Location:** `components/connection-status.tsx`

Banner that appears at the top when offline, auto-dismisses when back online.

```tsx
import { ConnectionStatus } from 'components/connection-status';

<ConnectionStatus showQueueCount={true} />
```

**Features:**
- Auto-dismiss after specified delay when back online
- Shows queued items count
- Manual retry button
- Animated transitions

## Hooks

### useOfflineMode
**Location:** `hooks/useOfflineMode.ts`

Detects offline/online status and provides utilities for offline mode.

```tsx
import { useOfflineMode } from 'hooks/useOfflineMode';

const { 
  isOnline,           // Current online/offline status
  isChecking,         // Whether currently checking connectivity
  queuedItemsCount,   // Number of items queued for sync
  checkConnection,    // Manually trigger connectivity check
  processQueue,       // Force process the offline queue
} = useOfflineMode();
```

**Features:**
- Real-time online/offline detection
- Queue status monitoring
- Manual connectivity checks
- Force queue processing

### useOfflineQueue
**Location:** `hooks/useOfflineQueue.ts`

Access and manage the offline queue.

```tsx
import { useOfflineQueue } from 'hooks/useOfflineQueue';

const { 
  queue,           // All queued items
  isOnline,        // Connection status
  pendingCount,    // Number of pending items
  failedCount,     // Number of failed items
  hasPending,      // Boolean: has pending items
  retryItem,       // Retry a specific item
  removeItem,      // Remove from queue
  clearFailed,     // Clear all failed items
} = useOfflineQueue();
```

## Services

### CachedDataService
**Location:** `lib/services/cached-data-service.ts`

Enhanced to support multiple data types with intelligent caching.

```tsx
import { cachedDataService, CACHE_KEYS } from 'lib/services/cached-data-service';

// Fetch with automatic caching
const data = await cachedDataService.fetchWithCache(
  CACHE_KEYS.BOUNTIES_LIST,
  () => bountyService.getAllBounties(),
  { ttl: 60 * 60 * 1000 } // 1 hour
);

// Clear specific cache pattern
await cachedDataService.clearPattern('bounty');

// Preload critical data
await cachedDataService.preloadData([
  { 
    key: CACHE_KEYS.BOUNTIES_LIST, 
    fetchFn: () => bountyService.getAllBounties() 
  },
  { 
    key: CACHE_KEYS.CONVERSATIONS_LIST, 
    fetchFn: () => messageService.getConversations() 
  },
]);
```

**New Features:**
- Predefined cache keys for common data types
- Pattern-based cache clearing
- Bulk data preloading
- Memory + AsyncStorage dual caching

**Cache Keys:**
```tsx
CACHE_KEYS = {
  BOUNTIES_LIST: 'bounties_list',
  BOUNTY_DETAIL: (id) => `bounty_${id}`,
  CONVERSATIONS_LIST: 'conversations_list',
  CONVERSATION_MESSAGES: (id) => `conversation_${id}_messages`,
  USER_PROFILE: (id) => `user_profile_${id}`,
  MY_BOUNTIES: 'my_bounties',
  MY_REQUESTS: 'my_requests',
}
```

### OfflineQueueService
**Location:** `lib/services/offline-queue-service.ts`

Existing service that manages offline action queuing and processing.

**Key Methods:**
- `enqueue(type, data)` - Add item to queue
- `processQueue()` - Process all pending items
- `retryItem(itemId)` - Retry a specific item
- `clearFailedItems()` - Remove all failed items
- `hasPendingItems()` - Check if queue has pending items

## User Experience Flows

### Creating a Bounty Offline

1. User fills out bounty form
2. Taps "Post Bounty"
3. **Immediately sees:** "Bounty Queued! 📤" message
4. Bounty appears in their list with temporary ID
5. **When connection restores:** Bounty automatically uploads
6. Status indicator updates in real-time

### Sending Messages Offline

1. User types and sends message
2. Message appears immediately with clock icon ⏱️
3. **If offline:** Message stays in 'sending' state
4. **When connection restores:**
   - Icon changes to ✓ (sent)
   - Then ✓✓ (delivered)
5. **If failure:** Shows error icon and retry button

### Syncing Data When Back Online

1. Network connection restored
2. Global banner shows "Back online"
3. Queue automatically processes
4. Sync status indicators show progress
5. Banner auto-dismisses when sync complete

## Integration Examples

### Adding to a Screen

```tsx
import { OfflineModeBanner } from 'components/offline-mode-banner';
import { SyncStatusIndicator } from 'components/sync-status-indicator';

function MyScreen() {
  return (
    <View>
      {/* Global offline banner */}
      <OfflineModeBanner />
      
      {/* Screen content */}
      <ScrollView>
        {/* Sync status in header */}
        <View style={styles.header}>
          <Text>My Screen</Text>
          <SyncStatusIndicator detailed={false} size="small" />
        </View>
        
        {/* Content */}
      </ScrollView>
    </View>
  );
}
```

### Using Cached Data

```tsx
import { cachedDataService, CACHE_KEYS } from 'lib/services/cached-data-service';

async function loadBounties() {
  try {
    const bounties = await cachedDataService.fetchWithCache(
      CACHE_KEYS.BOUNTIES_LIST,
      async () => {
        const response = await bountyService.getAllBounties();
        return response;
      },
      {
        ttl: 15 * 60 * 1000, // 15 minutes
      }
    );
    
    return bounties;
  } catch (error) {
    // Handle error - will return cached data if available
    console.error('Failed to load bounties:', error);
    return [];
  }
}
```

### Manual Offline Queue Management

```tsx
import { useOfflineQueue } from 'hooks/useOfflineQueue';

function QueueManagementScreen() {
  const { 
    queue, 
    pendingCount, 
    failedCount, 
    retryItem, 
    removeItem,
    clearFailed 
  } = useOfflineQueue();
  
  return (
    <View>
      <Text>Pending: {pendingCount}</Text>
      <Text>Failed: {failedCount}</Text>
      
      <FlatList
        data={queue}
        renderItem={({ item }) => (
          <View>
            <Text>{item.type}</Text>
            <Text>{item.status}</Text>
            
            {item.status === 'failed' && (
              <Button onPress={() => retryItem(item.id)}>
                Retry
              </Button>
            )}
            
            <Button onPress={() => removeItem(item.id)}>
              Remove
            </Button>
          </View>
        )}
      />
      
      {failedCount > 0 && (
        <Button onPress={clearFailed}>
          Clear All Failed
        </Button>
      )}
    </View>
  );
}
```

## Testing

### Unit Tests

Run component tests:
```bash
npm test -- offline-mode-banner
npm test -- sync-status-indicator
```

### Manual Testing Scenarios

1. **Offline Bounty Creation**
   - Turn off WiFi/cellular
   - Create a bounty
   - Verify "Bounty Queued" message
   - Check offline banner appears
   - Turn on connection
   - Verify bounty uploads automatically
   - Banner disappears when sync complete

2. **Offline Message Sending**
   - Go offline in a conversation
   - Send multiple messages
   - See all in 'sending' state
   - Check sync indicator shows pending count
   - Go online
   - Watch messages update to 'sent'
   - Verify sync indicator updates

3. **Cache Persistence**
   - Load bounties while online
   - Go offline
   - Force refresh
   - Verify cached data still displays
   - Check offline banner shows

4. **Failed Item Retry**
   - Queue items while offline
   - Simulate server error (if possible)
   - Verify items marked as failed
   - Check error indicator shows
   - Tap retry
   - Verify items reprocess

## Performance Considerations

- **Queue processing runs in background:** Non-blocking UI
- **Efficient polling:** Only processes when online
- **Memory + Storage caching:** Fast access with persistence
- **Automatic cleanup:** Expired cache entries removed
- **Listener management:** Proper cleanup to avoid memory leaks

## Configuration

### Cache Expiry

Adjust cache TTL in `cached-data-service.ts`:
```tsx
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
```

### Retry Logic

Adjust retry configuration in `offline-queue-service.ts`:
```tsx
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000; // 1 second
```

### Auto-Dismiss Delay

Adjust banner auto-dismiss in component usage:
```tsx
<ConnectionStatus dismissDelay={3000} /> // 3 seconds
```

## Troubleshooting

### Banner not appearing when offline
- Check NetInfo configuration
- Verify hook is properly called
- Check component is rendered in view hierarchy

### Queue not processing
- Verify network state is properly detected
- Check queue service is initialized
- Look for errors in console logs

### Cache not working
- Verify AsyncStorage permissions
- Check cache keys are consistent
- Look for storage quota issues

## Future Enhancements

- [ ] Conflict resolution for concurrent edits
- [ ] Batch processing for multiple items
- [ ] Progress indicators for large uploads
- [ ] Manual sync trigger in settings
- [ ] Sync history/log viewer
- [ ] Priority queue for urgent items
- [ ] Smart cache preloading based on usage patterns
- [ ] Network-aware media handling (low/high quality)

## Related Documentation

- [OFFLINE_RESILIENCY_GUIDE.md](./OFFLINE_RESILIENCY_GUIDE.md) - Original implementation guide
- [OFFLINE_UI_MOCKUP.md](./OFFLINE_UI_MOCKUP.md) - UI mockups and flows
- [ERROR_HANDLING_IMPLEMENTATION.md](./ERROR_HANDLING_IMPLEMENTATION.md) - Error handling patterns

## Support

For issues or questions:
1. Check console logs for error messages
2. Verify network state with `useOfflineMode` hook
3. Check queue status with `useOfflineQueue` hook
4. Review cache stats with `cachedDataService.getStats()`
