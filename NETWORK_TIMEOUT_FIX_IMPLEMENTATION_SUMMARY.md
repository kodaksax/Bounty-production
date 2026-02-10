# Network Timeout Fix - Implementation Summary

## Issue Resolved
Fixed persistent "Network request timed out" errors occurring in wallet and payment screens, particularly when:
- Loading payment methods from Stripe API
- Refreshing wallet balance and transaction history
- Creating payment intents for adding money

## Root Cause
The application was using raw `fetch()` calls without:
1. Configurable timeout limits
2. Automatic retry logic for transient failures
3. Exponential backoff to prevent server overload
4. User-friendly error messages

This caused failures especially on:
- Slow cellular networks
- WiFi with poor connectivity
- During temporary network interruptions

## Solution Architecture

### 1. Core Utilities Created

#### `lib/utils/fetch-with-timeout.ts`
A robust fetch wrapper providing:
- **Configurable Timeouts**: Uses `AbortController` to enforce time limits
- **Automatic Retry**: Exponential backoff with jitter (±25% randomization)
- **Smart Retry Logic**: Retries on network errors, timeouts, and 5xx server errors
- **Flexible Configuration**: Per-request timeout and retry settings

**Key Features:**
```typescript
// Example usage
const response = await fetchWithTimeout('https://api.example.com/data', {
  timeout: 30000,      // 30 second timeout
  retries: 2,          // 2 additional attempts after initial (3 total)
  retryDelay: 1000,    // Base delay of 1 second
});
```

**Retry Behavior:**
- Attempt 1: Immediate
- Attempt 2: ~1-1.5 seconds later (with jitter)
- Attempt 3: ~2-3 seconds later (exponential + jitter)
- Max delay capped at 10 seconds

#### `lib/utils/network-connectivity.ts`
Network state utilities providing:
- Device connectivity checking (via @react-native-community/netinfo)
- User-friendly error message generation
- Distinction between timeout, network, and other error types

### 2. Service Updates

#### `lib/services/stripe-service.ts`
Updated all fetch calls to use `fetchWithTimeout`:

| Method | Timeout | Retries | Rationale |
|--------|---------|---------|-----------|
| `listPaymentMethods` | 30s | 2 | Payment data is critical, worth longer wait |
| `createPaymentIntent` | 30s | 2 | Payment creation needs reliability |
| `detachPaymentMethod` | 15s | 1 | Delete operations should be quick |
| `confirmPayment` | 15s | 1 | Confirmation is typically fast |

All errors now include user-friendly messages and preserve original error context for debugging.

#### `lib/wallet-context.tsx`
Updated `refreshFromApi` method:
- Balance fetch: 15s timeout, 2 retries
- Transaction fetch: 15s timeout, 2 retries
- Enhanced error messages using `getNetworkErrorMessage`

#### `lib/stripe-context.tsx`
Improved error handling in `loadPaymentMethods`:
- Uses centralized `getNetworkErrorMessage` utility
- Provides clear, actionable error messages to users

### 3. Configuration

Timeout values configured via `lib/config/network.ts`:
- `API_TIMEOUTS.DEFAULT`: 15 seconds (standard operations)
- `API_TIMEOUTS.LONG`: 30 seconds (payment operations)
- `API_TIMEOUTS.QUICK`: 5 seconds (lightweight checks)

Can be overridden via environment variables:
- `EXPO_PUBLIC_API_TIMEOUT`
- `EXPO_PUBLIC_API_TIMEOUT_LONG`
- `EXPO_PUBLIC_API_TIMEOUT_QUICK`

## User Experience Improvements

### Before Fix
```
Error: TypeError: Network request failed
[User sees generic error or loading spinner indefinitely]
```

### After Fix
```
Request timed out. Please check your internet connection and try again.
[Clear message with automatic retries in background]
```

### Error Messages by Type
- **Timeout**: "Request timed out. Please check your internet connection and try again."
- **No Network**: "No internet connection. Please check your network settings and try again."
- **Network Unreachable**: "Connected to network but internet is not reachable."
- **Generic Network**: "Unable to connect. Please check your internet connection."

## Technical Details

### Retry Strategy
- **Exponential Backoff**: Delay doubles with each retry (1s → 2s → 4s)
- **Jitter**: ±25% randomization prevents thundering herd
- **Max Delay**: Capped at 10 seconds to avoid excessive wait times
- **Selective Retry**: Only retries on network errors, timeouts, and 5xx (not 4xx client errors)

### Error Preservation
Enhanced errors maintain debugging context:
```typescript
const enhancedError: any = new Error(userFriendlyMessage);
enhancedError.name = originalError.name;
enhancedError.cause = originalError; // Preserves stack trace and details
```

### Timeout Implementation
Uses standard `AbortController`:
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeout);
const response = await fetch(url, { signal: controller.signal });
clearTimeout(timeoutId);
```

## Testing & Validation

### Automated Tests
- ✅ TypeScript compilation passes
- ✅ No ESLint errors introduced
- ✅ CodeQL security scan: 0 alerts

### Manual Testing Scenarios
1. **Good Connection**: Should work as before, slightly more reliable
2. **Poor Connection**: Should retry automatically and eventually succeed or show clear error
3. **No Connection**: Should show immediate, helpful error message
4. **Intermittent Connection**: Should retry and succeed when connection returns

### Console Output
Developers can track retry behavior:
```
[fetchWithTimeout] Retrying request to https://api.example.com/methods after 1234ms (attempt 1/2 retries)
```

## Performance Impact

### Positive
- **Improved Success Rate**: Automatic retries recover from transient failures
- **Better User Experience**: Clear feedback instead of generic errors
- **Server Protection**: Exponential backoff + jitter prevents overload

### Minimal Overhead
- **Timeout Checking**: Negligible (<1ms per request)
- **Retry Logic**: Only activates on failure
- **Memory**: No significant increase

## Backward Compatibility

- ✅ No breaking API changes
- ✅ Existing error handling preserved
- ✅ Progressive enhancement (degrades gracefully)
- ✅ Environment variable configuration optional

## Configuration Options

### Per-Request Configuration
```typescript
await fetchWithTimeout(url, {
  timeout: 30000,        // Custom timeout
  retries: 3,            // More retries
  retryDelay: 2000,      // Longer base delay
  retryOn: (res, err) => // Custom retry logic
    err?.name === 'TimeoutError'
});
```

### Global Configuration
Via environment variables in `.env`:
```
EXPO_PUBLIC_API_TIMEOUT=20000
EXPO_PUBLIC_API_TIMEOUT_LONG=45000
```

## Monitoring & Observability

### Console Logs
- Retry attempts logged with timing
- Original errors preserved in error.cause
- User-facing vs. technical errors separated

### Analytics Integration
Existing analytics service unchanged. Can add:
```typescript
analyticsService.trackEvent('api_retry', {
  url,
  attempt,
  error: error.name
});
```

## Known Limitations

1. **No Offline Queue**: Failed requests are not persisted for later retry
2. **No Request Deduplication**: Concurrent identical requests not merged
3. **No Circuit Breaker**: Doesn't automatically disable retries if server is down
4. **Advisory Network Check**: `checkNetworkConnectivity` doesn't block requests

These can be addressed in future enhancements if needed.

## Rollback Plan

If issues arise, revert commits in this order:
1. Code review fixes: `b8f8a07`
2. Main implementation: `663f468`

Or selectively revert individual files:
```bash
git checkout main -- lib/utils/fetch-with-timeout.ts
git checkout main -- lib/utils/network-connectivity.ts
git checkout main -- lib/services/stripe-service.ts
git checkout main -- lib/wallet-context.tsx
git checkout main -- lib/stripe-context.tsx
```

## Future Enhancements

1. **Offline Queue**: Persist failed requests for retry when online
2. **Circuit Breaker**: Temporarily disable retries if API is down
3. **Request Deduplication**: Merge concurrent identical requests
4. **Telemetry**: Track retry success rates and timeout patterns
5. **Adaptive Timeouts**: Adjust based on network conditions
6. **Background Sync**: Retry failed operations in background

## Security Considerations

- ✅ No sensitive data logged
- ✅ Error messages don't expose backend details
- ✅ Timeout prevents resource exhaustion
- ✅ Exponential backoff prevents DoS
- ✅ CodeQL scan clean (0 alerts)

## Maintenance

### When to Adjust Timeouts
Monitor these metrics:
- Success rate after retries
- Average response times
- User complaints about slow loading

### When to Adjust Retries
- Increase retries if network is frequently flaky
- Decrease if retries rarely succeed
- Disable for operations that must be immediate

### Debug Checklist
If timeout issues persist:
1. Check environment variables for custom timeouts
2. Verify API server response times (might need scaling)
3. Check network conditions (use Network Link Conditioner)
4. Review console logs for retry patterns
5. Check if rate limiting is triggering retries

## References

- Issue: [#issue-number] - Persistent network connection issues
- PR: [copilot/fix-network-connection-issues]
- Related Docs:
  - `NETWORK_TIMEOUT_FIX_TESTING.md` - Testing guide
  - `NETWORK_TIMEOUT_FIX_VISUAL.md` - Visual flow diagrams
  - `lib/config/network.ts` - Configuration constants

## Contact

For questions or issues:
- Review code at `lib/utils/fetch-with-timeout.ts`
- Check configuration at `lib/config/network.ts`
- See testing guide at `NETWORK_TIMEOUT_FIX_TESTING.md`
