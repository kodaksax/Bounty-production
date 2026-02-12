# Fix for 41% Upload Hang Issue

## Problem Analysis

Users reported that profile picture uploads would hang at 41% in production. After analyzing the code flow, the 41% progress mark corresponds to a critical point in the upload process:

### Progress Breakdown
- **0-40%**: Image processing (crop, resize, compress)
- **40%**: Processing complete, upload starting
- **41%**: `attachmentService` called with progress 0.01
  - Maps to storage service at progress 0.3
  - This is **right before URI-to-ArrayBuffer conversion**
- **42-100%**: Upload to Supabase storage

### Root Cause

The hang at 41% occurred during the `uriToArrayBuffer` conversion step in `storage-service.ts`. Several issues could cause this:

1. **No timeout protection**: If network requests hang, the upload never recovers
2. **Promise.any compatibility**: Older React Native environments might not support `Promise.any`
3. **All parallel methods hanging**: If all three conversion methods (fetch, blob, base64) hang simultaneously, `Promise.any` never resolves
4. **Long gap in progress updates**: No progress updates between 30% (before conversion) and 90% (after upload)

## Solution Implemented

### 1. Added Timeout Protection

Wrapped all async operations with a `withTimeout` helper:

```typescript
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ])
}
```

**Timeouts applied:**
- URI conversion methods: 10 seconds each
- Base64 fallback: 15 seconds
- Final fallback: 20 seconds
- Supabase upload: 30 seconds

### 2. Promise.any Fallback

Added fallback for environments without `Promise.any`:

```typescript
if (typeof Promise.any === 'function') {
  return await Promise.any(methods)
} else {
  // Fallback to Promise.race with error handling
  return await Promise.race(methods.map(p => p.catch(e => {
    console.warn('[StorageService] Method failed:', e.message)
    return Promise.reject(e)
  })))
}
```

### 3. Better Progress Updates

Added intermediate progress update after successful URI conversion:

```typescript
arrayBuffer = await uriToArrayBuffer(fileUri)
onProgress?.(0.5)  // Progress update added here
```

This changes the progress flow:
- **Before**: 30% → (hang?) → 90%
- **After**: 30% → 50% (conversion done) → 90%

### 4. Enhanced Error Handling

Added multi-level fallback with detailed error messages:

```typescript
try {
  return await Promise.any(methods)
} catch (e) {
  // Try final base64 fallback with timeout
  try {
    const base64 = await withTimeout(readAsBase64(uri), 20000, 'Final base64 read timeout')
    return decode(base64)
  } catch (finalError) {
    throw new Error(`Failed to convert URI to ArrayBuffer after all attempts: ${finalError.message}`)
  }
}
```

### 5. User-Friendly Error Messages

Updated error messages in `edit-profile-screen.tsx` to be more specific:

```typescript
if (errorMessage.includes('timeout')) {
  setUploadMessage('Upload timeout - check your connection and try again');
} else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
  setUploadMessage('Network error - using local image for now');
} else {
  setUploadMessage('Upload failed - using local image');
}
```

## Benefits

### Prevents Indefinite Hangs
- Maximum 30 seconds for URI conversion attempts
- Maximum 30 seconds for Supabase upload
- Total maximum: ~60 seconds before giving up (instead of infinite)

### Better User Feedback
- Progress updates at 30%, 50%, 90%, 100%
- Specific error messages explain what went wrong
- Users know to check their connection or retry

### Improved Reliability
- Multiple fallback paths with timeouts
- Works in environments without Promise.any
- Catches and logs all failures for debugging

### Production Monitoring
- All errors logged with context
- Console logs help diagnose production issues
- Error messages help users self-diagnose

## Testing Recommendations

### Test Scenarios

1. **Good network (WiFi)**
   - Should complete in 3-5 seconds
   - Should not hang at 41%

2. **Poor network (3G)**
   - Should complete or timeout within 60 seconds
   - Should show clear error message if timeout

3. **Airplane mode during upload**
   - Should timeout within 30 seconds
   - Should show "Network error - using local image for now"

4. **Intermittent connection**
   - Should retry with different methods
   - Should succeed if any method completes

### Expected Behavior

**Before fix:**
- Upload hangs at 41% indefinitely
- No error message
- User forced to restart app

**After fix:**
- Upload progresses: 41% → 70% → 100%
- If timeout: Clear error message within 60 seconds
- User can retry immediately

## Monitoring

### Key Metrics to Track

1. **Timeout occurrences**
   - Log: `[StorageService] ... timeout`
   - Indicates network issues

2. **Method failures**
   - Log: `[StorageService] Method failed: ...`
   - Shows which conversion method failed

3. **Complete failures**
   - Log: `[StorageService] All URI conversion methods failed`
   - Rare but indicates serious issues

4. **Upload success rate**
   - Should improve from previous rate
   - Target: >98% success rate

### Production Logs to Watch

```
// Normal successful upload
[StorageService] Trying URI conversion methods
[StorageService] Upload complete

// Timeout scenario
[StorageService] Trying URI conversion methods
[StorageService] Method failed: fetch->arrayBuffer timeout
[StorageService] Final base64 read timeout
[StorageService] URI conversion failed: Failed to convert URI...

// Network error
[StorageService] Trying URI conversion methods
[StorageService] Supabase upload failed: Upload to Supabase failed: timeout
```

## Rollback Plan

If issues arise, rollback is simple - revert to commit before this change:

```bash
git revert <commit-hash>
```

The old code had no timeout protection, so reverting would restore previous behavior (but also restore the hang issue).

## Future Improvements

### Short Term
1. Add retry logic for failed uploads
2. Queue uploads for retry when connection returns
3. Show upload speed/time estimate

### Medium Term
1. Implement upload resumption for large files
2. Add network quality detection
3. Adjust timeouts based on network speed

### Long Term
1. Direct CDN uploads for faster performance
2. Progressive uploads with chunking
3. Background upload queue with persistence

## Summary

This fix addresses the 41% hang issue by:
- ✅ Adding timeout protection (max 60 seconds)
- ✅ Providing Promise.any fallback for compatibility
- ✅ Adding progress updates (30% → 50% → 90%)
- ✅ Enhancing error messages for users
- ✅ Implementing multi-level fallback paths

**Result**: Uploads will complete or fail gracefully within 60 seconds, with clear feedback to users.
