# Testing Error Handling Improvements

## Overview
This document provides a comprehensive test plan for validating the error handling improvements made to address network timeout and WebSocket connection errors.

## Test Scenarios

### Scenario 1: Backend Server Running (Normal Operation)

**Setup:**
- Ensure backend API server is running on configured port (default: 3001)
- Launch the mobile app

**Expected Behavior:**
- ✅ No error messages in console
- ✅ Notifications load successfully
- ✅ WebSocket connects successfully
- ✅ Unread count updates in real-time
- ✅ Messages sync via WebSocket

**Validation Steps:**
1. Open the app
2. Check console for errors (should be minimal/none)
3. Navigate to notifications
4. Verify unread count displays correctly
5. Send a test message and verify real-time delivery

---

### Scenario 2: Backend Server Not Running (Offline Mode)

**Setup:**
- Stop the backend API server
- Launch the mobile app or keep it running

**Expected Behavior:**
- ✅ App remains functional with cached data
- ✅ Console shows ONE log message: `[NotificationService] Backend unreachable - using cached notifications`
- ✅ Console shows ONE log message: `[WebSocket] Connection unavailable - retrying in background`
- ✅ No repeated error spam (throttled to once per minute/5 minutes)
- ✅ Cached notifications are displayed
- ✅ UI shows cached unread count
- ✅ WebSocket retries quietly in background

**Validation Steps:**
1. Stop the backend server
2. Open the app or wait for next notification fetch
3. Observe console logs - should see initial warning, then silence
4. Wait 1-2 minutes and observe no new error messages
5. Verify app still shows cached notifications
6. Verify app doesn't crash or freeze

---

### Scenario 3: Backend Server Becomes Available After Downtime

**Setup:**
- Start with backend server stopped
- Launch app
- After 30 seconds, start the backend server

**Expected Behavior:**
- ✅ WebSocket automatically reconnects
- ✅ Console shows: `[WebSocket] Connected` or similar
- ✅ Fresh data is fetched from backend
- ✅ Unread count updates to current value
- ✅ Real-time messaging resumes

**Validation Steps:**
1. Start with server stopped, app running
2. Verify app uses cached data
3. Start the backend server
4. Wait up to 30 seconds for automatic reconnection
5. Verify WebSocket reconnects (check console)
6. Verify notifications refresh with latest data
7. Send a test notification and verify real-time delivery

---

### Scenario 4: Slow Network / High Latency

**Setup:**
- Use network throttling tools or simulate slow connection
- Throttle network to 3G speeds or slower

**Expected Behavior:**
- ✅ API calls have 15-second timeout (increased from 8s)
- ✅ App doesn't timeout prematurely
- ✅ Loading indicators show while waiting
- ✅ Eventually succeeds or falls back to cache gracefully

**Validation Steps:**
1. Enable network throttling
2. Launch app or trigger a refresh
3. Observe that requests don't fail immediately
4. Verify longer timeout allows slow requests to complete
5. If timeout occurs, verify fallback to cached data

---

### Scenario 5: Supabase Direct Access (Primary Strategy)

**Setup:**
- Backend API server stopped or unreachable
- Supabase configured correctly in environment
- Launch app

**Expected Behavior:**
- ✅ App queries Supabase directly for notifications
- ✅ Unread count fetched from Supabase
- ✅ No API timeout errors
- ✅ Faster response time (direct database query)

**Validation Steps:**
1. Stop backend API server
2. Ensure Supabase credentials are configured
3. Launch app
4. Open developer console
5. Verify logs show: `[NotificationService] Supabase query succeeded`
6. Verify notifications load from Supabase
7. Verify no API timeout errors

---

### Scenario 6: WebSocket Reconnection Behavior

**Setup:**
- Backend server running
- App connected
- Restart backend server

**Expected Behavior:**
- ✅ WebSocket detects disconnection
- ✅ Max 5 reconnection attempts (reduced from 10)
- ✅ Exponential backoff starting at 2 seconds (increased from 1s)
- ✅ Less frequent console logs (once per minute max)
- ✅ Automatic reconnection when server available

**Validation Steps:**
1. Start with app and server running, WebSocket connected
2. Restart backend server (simulates brief outage)
3. Observe console for reconnection attempts
4. Count number of log messages (should be minimal)
5. Verify connection re-establishes within 30 seconds
6. Verify message delivery resumes

---

### Scenario 7: Long-Running Session (Stability Test)

**Setup:**
- Launch app with backend running
- Leave app open for 30+ minutes

**Expected Behavior:**
- ✅ WebSocket maintains stable connection
- ✅ Heartbeat pings keep connection alive
- ✅ No connection errors after extended time
- ✅ Notifications continue to work
- ✅ Minimal console logs during normal operation

**Validation Steps:**
1. Launch app
2. Leave app in foreground for 30+ minutes
3. Periodically check console logs
4. Verify no connection errors
5. Test notification delivery after 30 minutes
6. Verify unread count still updates

---

## Performance Metrics

### Before Improvements
- ❌ Console error spam: 50-100+ messages per minute
- ❌ API timeout: 8 seconds
- ❌ WebSocket max retries: 10 attempts
- ❌ Reconnection delay: 1 second (too aggressive)
- ❌ No fallback strategy (app fails without API)

### After Improvements
- ✅ Console error spam: 1 message per 5 minutes max
- ✅ API timeout: 15 seconds (better for development)
- ✅ WebSocket max retries: 5 attempts
- ✅ Reconnection delay: 2 seconds with exponential backoff
- ✅ Triple fallback: API → Supabase → Cache

---

## Debugging Tips

### Enable Verbose Logging
To get detailed logs during debugging, set these environment variables:

```bash
# In .env file
EXPO_PUBLIC_WS_VERBOSE=1
EXPO_PUBLIC_LOG_CLIENT_VERBOSE=1
```

### Check Log Throttling
To verify log throttling is working:
1. Stop the backend server
2. Watch console for initial error messages
3. Wait 1 minute - should see NO new errors
4. Wait 5 minutes - should see at most ONE new error

### Monitor WebSocket State
Check WebSocket connection state:
```typescript
import { wsAdapter } from './lib/services/websocket-adapter';

// Check connection status
console.log('Connected:', wsAdapter.isConnected());
console.log('State:', wsAdapter.getConnectionState());
```

### Check Cached Data
Verify AsyncStorage caching:
```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

// Check cached notifications
const cached = await AsyncStorage.getItem('notifications:cache');
console.log('Cached notifications:', cached);

// Check cached unread count
const lastFetch = await AsyncStorage.getItem('notifications:last_fetch');
console.log('Last fetch:', lastFetch);
```

---

## Common Issues & Solutions

### Issue: Still seeing error spam
**Solution:** 
- Clear app cache and restart
- Verify you're running the latest code
- Check if `__DEV__` is true in development

### Issue: Notifications not loading
**Solution:**
- Check Supabase credentials in .env
- Verify network connectivity
- Check cached data in AsyncStorage

### Issue: WebSocket won't reconnect
**Solution:**
- Restart the app to reset reconnection counter
- Check backend server logs for connection errors
- Verify WebSocket endpoint URL is correct

### Issue: API still timing out at 8 seconds
**Solution:**
- Verify changes were applied correctly
- Check if old code is cached (restart Metro bundler)
- Clear node_modules and reinstall

---

## Success Criteria

The error handling improvements are successful when:

1. ✅ Console error messages reduced by 95%+
2. ✅ App works offline with cached data
3. ✅ Automatic reconnection when backend available
4. ✅ No app crashes due to network errors
5. ✅ Supabase fallback works correctly
6. ✅ WebSocket maintains stable connection
7. ✅ User experience unaffected by temporary outages

---

## Automated Test Coverage

### Unit Tests Created
- `__tests__/unit/services/error-handling.test.ts`
  - Tests fallback to Supabase
  - Tests fallback to cached data
  - Tests error log throttling
  - Tests timeout handling

### Integration Tests Recommended
- End-to-end notification flow
- WebSocket connection lifecycle
- Network state changes
- App state changes (foreground/background)

---

## Manual Verification Checklist

Before marking this issue as resolved, verify:

- [ ] Backend running: No errors in console
- [ ] Backend stopped: Only 1-2 log messages, no spam
- [ ] Backend restart: Automatic reconnection works
- [ ] Slow network: Requests don't timeout prematurely
- [ ] Supabase fallback: Direct queries work
- [ ] WebSocket stability: Connection maintained long-term
- [ ] Cached data: Available when offline
- [ ] User experience: Seamless regardless of backend status
