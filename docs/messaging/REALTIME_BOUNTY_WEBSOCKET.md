# Real-time WebSocket Integration for Bounty Updates

## Overview

This document describes the complete real-time WebSocket integration for bounty status updates in BOUNTYExpo. The implementation provides multi-client synchronization, optimistic UI updates, and automatic reconnection.

## Architecture

```
┌─────────────────┐        WebSocket         ┌──────────────────┐
│   Mobile App    │◄──────────────────────► │   API Server     │
│   (React Native)│    bounty.status events  │   (Node.js)      │
└─────────────────┘                          └──────────────────┘
        │                                              │
        │                                              │
        ├─ useBounties Hook                           ├─ RealtimeService
        │  └─ WebSocket Subscriptions                 │  └─ Publish Events
        │  └─ Optimistic Updates                      │
        │  └─ State Management                        ├─ BountyService
        │                                              │  └─ Status Updates
        ├─ WebSocketProvider
        │  └─ Connection Management                   └─ WebSocket Server
        │  └─ Reconnection Logic                         └─ Broadcast to Clients
        │
        └─ bountyService
           └─ API Calls
           └─ WebSocket Publish
```

## Features

### 1. Real-time Status Updates
- **Automatic synchronization** across all connected clients
- **Instant updates** when bounty status changes
- **Multi-user coordination** - all users see changes immediately

### 2. Optimistic UI Updates
- **Immediate feedback** - UI updates before API confirmation
- **Automatic rollback** on API failure
- **Seamless user experience** with no loading delays

### 3. Reconnection Logic
- **Exponential backoff** - smart retry strategy (1s, 2s, 4s, 8s...)
- **Max 10 attempts** - prevents infinite retry loops
- **Auto-recovery** - reconnects on network changes or app foreground
- **Connection quality monitoring** - excellent/good/poor/disconnected states

### 4. Multi-client Synchronization
- **Real-time broadcast** - status changes sent to all connected clients
- **Consistent state** - all users see the same bounty status
- **Race condition prevention** - optimistic updates with server confirmation

## Usage

### Basic Usage with useBounties Hook

```typescript
import { useBounties } from '../hooks/useBounties';

function BountyList() {
  const { 
    bounties, 
    loading, 
    error, 
    updateBountyStatus,
    refreshBounties 
  } = useBounties({
    status: 'open',           // Filter by status
    optimisticUpdates: true,  // Enable optimistic UI
    autoRefresh: true         // Auto-refresh on reconnection
  });

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <View>
      {bounties.map(bounty => (
        <BountyCard 
          key={bounty.id} 
          bounty={bounty}
          onAccept={() => updateBountyStatus(bounty.id, 'in_progress')}
        />
      ))}
    </View>
  );
}
```

### Advanced Usage - Custom Filtering

```typescript
function MyBounties() {
  const { user } = useAuthContext();
  
  const { bounties, updateBountyStatus } = useBounties({
    userId: user.id,          // Filter by user
    optimisticUpdates: true
  });

  const handleComplete = async (bountyId: number) => {
    try {
      // Optimistically update UI
      await updateBountyStatus(bountyId, 'completed');
      // Success toast
      Toast.show({ type: 'success', text1: 'Bounty completed!' });
    } catch (error) {
      // Automatically rolled back
      Toast.show({ type: 'error', text1: 'Failed to complete bounty' });
    }
  };

  return (
    <View>
      {bounties.map(bounty => (
        <MyBountyCard
          key={bounty.id}
          bounty={bounty}
          onComplete={() => handleComplete(bounty.id)}
        />
      ))}
    </View>
  );
}
```

### Connection Status Monitoring

```typescript
import { useWebSocketContext } from '../providers/websocket-provider';

function ConnectionIndicator() {
  const { 
    isConnected, 
    connectionQuality, 
    lastConnectedAt,
    reconnect 
  } = useWebSocketContext();

  const getStatusColor = () => {
    switch (connectionQuality) {
      case 'excellent': return 'green';
      case 'good': return 'yellow';
      case 'poor': return 'orange';
      case 'disconnected': return 'red';
    }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View 
        style={{ 
          width: 8, 
          height: 8, 
          borderRadius: 4, 
          backgroundColor: getStatusColor() 
        }} 
      />
      <Text style={{ marginLeft: 8 }}>
        {isConnected ? 'Connected' : 'Disconnected'}
      </Text>
      {!isConnected && (
        <TouchableOpacity onPress={reconnect}>
          <Text style={{ color: 'blue' }}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
```

## Implementation Details

### Client-Side (React Native)

#### useBounties Hook (`hooks/useBounties.ts`)
- Manages bounty state with useState
- Subscribes to `bounty.status` WebSocket events
- Implements optimistic updates with rollback
- Handles errors and logging

#### WebSocketProvider (`providers/websocket-provider.tsx`)
- Manages WebSocket connection lifecycle
- Implements reconnection with exponential backoff
- Monitors connection quality
- Auto-connects/disconnects based on auth state

#### bountyService (`lib/services/bounty-service.ts`)
- Makes API calls to update bounty status
- Publishes WebSocket events on status changes
- Handles errors gracefully

### Server-Side (Node.js)

#### RealtimeService (`services/api/src/services/realtime-service.ts`)
- Manages WebSocket client connections
- Broadcasts `bounty.status` events
- Fallback to Supabase Realtime if configured

#### BountyService (`services/api/src/services/bounty-service.ts`)
- Updates bounty status in database
- Publishes events via RealtimeService
- Handles transactions and validation

## WebSocket Event Format

### bounty.status Event

```typescript
{
  type: 'bounty.status',
  id: 123,
  status: 'in_progress',
  timestamp: '2026-01-03T12:00:00.000Z'
}
```

### Supported Status Values
- `open` - Bounty is available for hunters
- `in_progress` - Bounty has been accepted by a hunter
- `completed` - Bounty work is complete
- `archived` - Bounty is archived
- `deleted` - Bounty is deleted
- `cancelled` - Bounty is cancelled
- `cancellation_requested` - Cancellation has been requested

## Testing

### Manual Testing

1. **Start the API server:**
   ```bash
   cd services/api
   npm run dev
   ```

2. **Start the Expo app:**
   ```bash
   npx expo start
   ```

3. **Test multi-client sync:**
   - Open app on 2 devices/emulators
   - Accept a bounty on device 1
   - Verify status updates on device 2

4. **Test reconnection:**
   - Disconnect network on device
   - Reconnect network
   - Verify WebSocket reconnects automatically

5. **Test optimistic updates:**
   - Enable airplane mode
   - Try to update bounty status
   - See immediate UI update
   - Disable airplane mode
   - Verify UI rolls back on failure

### Integration Tests

Run the WebSocket integration tests:

```bash
npm test __tests__/integration/websocket-bounty-updates.test.ts
```

Or run all integration tests:

```bash
npm run test:integration
```

## Performance Considerations

### Connection Management
- **Keep-alive pings** every 30 seconds
- **Lazy reconnection** - exponential backoff prevents spam
- **Connection pooling** - reuse existing connections

### Data Transfer
- **Minimal payloads** - only send changed data
- **Binary format** - use efficient message format
- **Compression** - WebSocket compression enabled

### Scalability
- **Horizontal scaling** - multiple WebSocket servers
- **Redis pub/sub** - share events across servers (future)
- **Connection limits** - max connections per user

## Troubleshooting

### WebSocket Not Connecting

**Symptoms:** `isConnected` is always false

**Solutions:**
1. Check API server is running: `curl http://localhost:3001/health`
2. Verify WebSocket URL in environment variables
3. Check network connectivity
4. Look for errors in console logs

### Events Not Being Received

**Symptoms:** Status changes don't sync across clients

**Solutions:**
1. Verify WebSocket is connected: check `isConnected`
2. Check server logs for event publishing
3. Verify event handler registration: `wsAdapter.on('bounty.status', handler)`
4. Test with WebSocket inspection tools

### Optimistic Updates Not Rolling Back

**Symptoms:** UI shows wrong status after API failure

**Solutions:**
1. Ensure `optimisticUpdates: true` in useBounties options
2. Check error handling in updateBountyStatus
3. Verify API error responses are being caught
4. Check console for error logs

## Future Enhancements

### Planned Features
- [ ] **Presence tracking** - show who's viewing a bounty
- [ ] **Typing indicators** - show who's editing
- [ ] **Batch updates** - group multiple status changes
- [ ] **Offline queue** - queue updates when offline
- [ ] **Redis pub/sub** - scale across multiple servers
- [ ] **GraphQL subscriptions** - alternative to WebSocket
- [ ] **Push notifications** - notify on status changes

### Performance Optimizations
- [ ] **Message batching** - group small messages
- [ ] **Delta updates** - only send changed fields
- [ ] **Client-side caching** - reduce server load
- [ ] **Rate limiting** - prevent abuse

## Security Considerations

### Authentication
- WebSocket connections require valid JWT token
- Token validation on connection and every message
- Auto-disconnect on token expiration

### Authorization
- Verify user permissions before broadcasting events
- Filter events based on user access level
- Rate limit per user to prevent abuse

### Data Privacy
- Only send public bounty data via WebSocket
- Private fields filtered out before broadcast
- Audit logs for all status changes

## References

- [WebSocket Quick Reference](./WEBSOCKET_QUICK_REFERENCE.md)
- [WebSocket Setup Guide](./WEBSOCKET_SETUP_GUIDE.md)
- [WebSocket Verification Report](./WEBSOCKET_VERIFICATION_REPORT.md)
- [Backend Consolidation](./BACKEND_CONSOLIDATION_README.md)

---

**Last Updated:** January 3, 2026  
**Version:** 1.0  
**Status:** Production Ready ✅
