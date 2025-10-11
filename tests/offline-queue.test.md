# Offline Queue Service Testing Guide

## Manual Testing Checklist

### Setup
- [ ] Start the app on a physical device or emulator with network controls
- [ ] Log into the app
- [ ] Navigate to either Postings (for bounties) or Messenger (for messages)

### Test 1: Offline Bounty Creation

**Steps:**
1. Go to Postings screen
2. Tap "New" tab
3. Turn off WiFi and cellular data
4. Fill out bounty form:
   - Title: "Test Offline Bounty"
   - Description: "Testing offline functionality"
   - Amount: $50
   - Location: "Remote"
5. Submit the bounty

**Expected Results:**
- [ ] No error about network connection
- [ ] Alert shows "Bounty Queued! 📤"
- [ ] Message says "You're offline. Your bounty will be posted automatically when you reconnect."
- [ ] Offline status badge appears (orange with "1 pending")

**Verification:**
6. Turn on WiFi/cellular
7. Wait 5-10 seconds

**Expected Results:**
- [ ] Status badge updates to "1 syncing..."
- [ ] Badge disappears after successful upload
- [ ] Bounty appears in "My Postings" tab with real ID

### Test 2: Offline Message Sending

**Steps:**
1. Go to Messenger screen
2. Open a conversation
3. Turn off network
4. Type and send message: "Test offline message 1"
5. Send another: "Test offline message 2"

**Expected Results:**
- [ ] Both messages appear immediately
- [ ] Each has clock icon (⏱️) indicating 'sending' status
- [ ] Offline badge shows "2 pending"

**Verification:**
6. Turn on network
7. Watch messages update

**Expected Results:**
- [ ] Clock icons change to check marks (✓)
- [ ] Eventually show double check (✓✓) for delivered
- [ ] Offline badge disappears

### Test 3: Retry Failed Messages

**Steps:**
1. Go to Messenger
2. Turn off network
3. Send message: "This will fail"
4. Wait 30+ seconds (while offline)
5. Turn on network briefly then off again (simulate unstable connection)

**Expected Results:**
- [ ] After multiple failed attempts, message shows error icon
- [ ] Retry button appears below the message
- [ ] Offline badge shows "1 failed" in red

**Verification:**
6. Turn on network (stable)
7. Tap the retry button

**Expected Results:**
- [ ] Message status changes back to 'sending'
- [ ] Successfully sends and shows check mark
- [ ] Badge updates/disappears

### Test 4: Queue Persistence Across App Restarts

**Steps:**
1. Turn off network
2. Create 2 bounties offline
3. Send 3 messages offline
4. Close the app completely (kill process)
5. Reopen the app

**Expected Results:**
- [ ] Offline badge shows "5 pending" immediately
- [ ] All queued items still present

**Verification:**
6. Turn on network

**Expected Results:**
- [ ] All 5 items process automatically
- [ ] Badge shows "5 syncing..." then disappears
- [ ] All content appears in correct places

### Test 5: Visual Status Indicators

**Steps:**
1. Navigate to different screens while offline
2. Create content (bounty/message)

**Expected Results on Messenger:**
- [ ] Badge appears below "INBOX" title
- [ ] Shows pending count
- [ ] Updates in real-time

**Expected Results on Postings:**
- [ ] Badge appears below header
- [ ] Shows pending count
- [ ] Updates in real-time

**Expected Results on Messages:**
- [ ] Clock icon for sending
- [ ] Check for sent
- [ ] Double check for delivered
- [ ] Blue double check for read
- [ ] Error icon with retry for failed

### Test 6: Multiple Retries and Exponential Backoff

**Note:** This test requires developer tools or patience

**Steps:**
1. Turn off network
2. Send a message
3. Monitor console logs for retry attempts

**Expected Behavior:**
- Attempt 1: Immediate (on send)
- Attempt 2: After ~1 second
- Attempt 3: After ~2 seconds
- Attempt 4: After ~4 seconds
- After 3 retries: Mark as failed

**Console Output:**
```
📤 Enqueued message item: message-1234567890-abc123
🔄 Processing 1 queued items
⚠️ Failed to process item message-1234567890-abc123, retry 1/3
🔄 Processing 1 queued items
⚠️ Failed to process item message-1234567890-abc123, retry 2/3
🔄 Processing 1 queued items
⚠️ Failed to process item message-1234567890-abc123, retry 3/3
❌ Item message-1234567890-abc123 failed: max retries exceeded
```

### Test 7: Network Transitions

**Steps:**
1. Start online
2. Create bounty (should post immediately)
3. Go offline
4. Create another bounty (should queue)
5. Go back online
6. Create third bounty (should post immediately)

**Expected Results:**
- [ ] First bounty: Posts immediately, no badge
- [ ] Second bounty: Shows "Queued" message, badge appears
- [ ] Badge syncs and disappears
- [ ] Third bounty: Posts immediately, no badge

### Test 8: Edge Cases

#### Empty Queue on Startup
**Steps:**
1. Ensure all items synced
2. Restart app
3. Check screens

**Expected:** No offline badge visible

#### Mixed Success and Failure
**Steps:**
1. Go offline
2. Queue 3 items
3. Manually corrupt one item's data (developer only)
4. Go online

**Expected:** 
- 2 items succeed and remove from queue
- 1 item fails and shows in badge

#### Rapid Network Switching
**Steps:**
1. Toggle network on/off quickly multiple times
2. Queue should handle gracefully without crashes

## Automated Test Cases (Future)

```typescript
describe('OfflineQueueService', () => {
  it('should enqueue items when offline', async () => {
    // Mock NetInfo to return offline
    // Call enqueue
    // Verify item in queue
  })

  it('should process queue when coming online', async () => {
    // Add items to queue
    // Trigger online event
    // Verify processQueue called
  })

  it('should implement exponential backoff', async () => {
    // Mock failed attempts
    // Verify retry timing
  })

  it('should mark as failed after max retries', async () => {
    // Mock 3 failed attempts
    // Verify status is 'failed'
  })

  it('should persist queue to AsyncStorage', async () => {
    // Add items to queue
    // Verify AsyncStorage.setItem called
  })
})
```

## Common Issues and Solutions

### Issue: Badge doesn't appear
**Solution:** Ensure NetInfo is properly detecting offline state. Check device network settings.

### Issue: Items don't sync when coming online
**Solution:** Check console for errors. Verify bounty/message service methods are working.

### Issue: Queue grows indefinitely
**Solution:** Check that successful items are being removed. Verify `removeItem()` is called.

### Issue: App crashes on restart
**Solution:** Check AsyncStorage data is valid JSON. Clear if corrupted: `AsyncStorage.removeItem('offline-queue-v1')`

## Performance Benchmarks

Target performance:
- Queue operation < 50ms
- UI remains at 60fps during sync
- Memory usage < 5MB for 100 queued items
- Battery impact < 2% over 24 hours

## Accessibility Testing

- [ ] VoiceOver announces queue status
- [ ] Retry button accessible via screen reader
- [ ] Status badge has appropriate aria labels
- [ ] Color contrast meets WCAG AA standards

## Summary

All tests passing indicates:
✅ Offline queue working correctly
✅ Visual indicators showing proper states
✅ Retry logic functioning as designed
✅ Queue persists across restarts
✅ Performance within acceptable range
✅ User experience smooth and intuitive
