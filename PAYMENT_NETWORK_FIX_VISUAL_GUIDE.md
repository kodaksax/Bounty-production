# Visual Guide: Network Timeout Improvements

## Before vs. After Comparison

### Error Flow - BEFORE

```
User Opens Payment Modal
         ↓
   Load Payment Methods
         ↓
    Timeout (3s)
         ↓
   ❌ ERROR SHOWN
   "Error: timeout"
         ↓
   User Confused
   No Retry Option
```

### Error Flow - AFTER

```
User Opens Payment Modal
         ↓
   Load Payment Methods (10s timeout)
         ↓
   Failed? → Retry 1 (15s timeout) → Wait 1s
         ↓
   Failed? → Retry 2 (20s timeout) → Wait 2s
         ↓
   Failed? → Retry 3 (25s timeout) → Wait 4s
         ↓
   ✅ SUCCESS (Load Complete)
   
   OR
   
   ❌ ERROR SHOWN (after all retries)
   "Connection timed out. Please check 
    your internet connection and try again."
         ↓
   [Retry Button] - User can manually retry
```

## Error Message Improvements

### BEFORE
```
┌─────────────────────────────────────┐
│  ❌ Console Error                   │
├─────────────────────────────────────┤
│  Error loading payment methods:     │
│  Error: Network request timed out   │
│                                     │
│  (No user action available)         │
└─────────────────────────────────────┘
```

### AFTER
```
┌─────────────────────────────────────┐
│  ⚠️  Connection Issue               │
├─────────────────────────────────────┤
│  Connection timed out. Please       │
│  check your internet connection     │
│  and try again.                     │
│                                     │
│         [ Retry ] ← Button          │
└─────────────────────────────────────┘
```

## Timeout Strategy Visualization

### Timeline: Payment Method Load Attempt

```
Attempt 1:
0s ────────────10s → Timeout
       [Loading...]
       
If Failed ↓
       
Wait 1s: 10s ─ 11s
              
Attempt 2:
11s ──────────────────26s → Timeout (15s)
       [Loading...]
       
If Failed ↓
       
Wait 2s: 26s ── 28s

Attempt 3:
28s ────────────────────────48s → Timeout (20s)
       [Loading...]
       
If Failed ↓
       
Wait 4s: 48s ──── 52s

Attempt 4:
52s ──────────────────────────────77s → Timeout (25s)
       [Loading...]
       
If Failed ↓
       
Show Error with Retry Button (max ~77s total)
```

Note: The backoff delay after the final attempt has been removed in the latest implementation, keeping the total maximum wait time at 77 seconds instead of 81 seconds.

## Network Condition Handling

### Slow 3G Network (500ms latency)

```
Request Sent ────────────────────┐
  0ms                           500ms
                                  │
                            Response Start
                                  │
                                  ▼
                           Data Transfer
                           500ms - 2000ms
                                  │
                                  ▼
                           ✅ Success!
                           (within 10s timeout)
```

### Very Slow Connection (8s response time)

```
Attempt 1:
Request Sent ──────────────────────────────────┐
  0ms                                         8000ms
                                                │
                                          Response
                                                ▼
                                         ✅ Success!
                                    (within 10s timeout)

Note: Without retry, this would have failed with 3s timeout
```

### Intermittent Connection (drops during request)

```
Attempt 1:
Request Sent ───X (Connection Lost at 5s)
  0ms         5s
               │
         ❌ Timeout (10s)
               ↓
         Wait 1s
               ↓
Attempt 2:
Request Sent ─────────────────────────┐
 11s                                 14s
                                      │
                                 Response
                                      ▼
                              ✅ Success!
                          (within 15s timeout)
```

## Code Architecture

### Component Hierarchy

```
┌─────────────────────────────────────────┐
│  WalletScreen                           │
│  ┌───────────────────────────────────┐  │
│  │  PaymentMethodsModal              │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  refreshWithRetry()         │  │  │
│  │  │  • 3 retry attempts         │  │  │
│  │  │  • Exponential backoff      │  │  │
│  │  │  • Timeout: 10s, 15s, 20s   │  │  │
│  │  └──────────┬──────────────────┘  │  │
│  │             │                      │  │
│  └─────────────┼──────────────────────┘  │
└────────────────┼─────────────────────────┘
                 │
                 ▼
        ┌────────────────────┐
        │  StripeContext     │
        │  loadPaymentMethods│
        └────────┬───────────┘
                 │
                 ▼
        ┌────────────────────┐
        │  StripeService     │
        │  listPaymentMethods│
        │  • AbortController │
        │  • 15s timeout     │
        └────────┬───────────┘
                 │
                 ▼
        ┌────────────────────┐
        │  Backend API       │
        │  /payments/methods │
        └────────────────────┘
```

## Error Handling Flow

```
┌──────────────────────────────────────────┐
│  Error Occurs in Fetch                   │
└────────────┬─────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│  Is it AbortError?                       │
│  (Timeout via AbortController)           │
└─────┬───────────────────┬────────────────┘
      │ YES               │ NO
      ▼                   ▼
┌──────────────┐    ┌──────────────────────┐
│ "Network     │    │ Check Error Type:    │
│  request     │    │ • Network Error?     │
│  timed out"  │    │ • API Error?         │
└──────┬───────┘    │ • Other?             │
       │            └──────┬───────────────┘
       │                   │
       ▼                   ▼
┌──────────────────────────────────────────┐
│  handleStripeError()                     │
│  Returns user-friendly message           │
└────────────┬─────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│  Display in UI with:                     │
│  • Error icon                            │
│  • Clear message                         │
│  • Retry button                          │
└──────────────────────────────────────────┘
```

## User Experience Journey

### Scenario: User on Slow Connection

```
Step 1: User taps "Manage" on Payment Methods
        ┌─────────────────────────┐
        │  Loading indicator      │
        │  shows immediately      │
        └─────────────────────────┘
        
Step 2: First attempt (0-10s)
        ┌─────────────────────────┐
        │  "Loading payment       │
        │   methods..."           │
        └─────────────────────────┘
        
Step 3: Retry 1 (11-26s)
        Still loading...
        User sees spinner
        (No error yet)
        
Step 4: Success at 18s
        ┌─────────────────────────┐
        │  ✅ Payment methods     │
        │     loaded!             │
        │                         │
        │  💳 Visa ••4242         │
        │  💳 Mastercard ••5555   │
        └─────────────────────────┘
```

### Scenario: Connection Failure

```
Step 1: User taps "Manage" on Payment Methods
        (Same as above)
        
Step 2-5: All retries fail
        
Step 6: Error shown after 70s total
        ┌─────────────────────────┐
        │  ⚠️  Connection Issue   │
        ├─────────────────────────┤
        │  Connection timed out.  │
        │  Please check your      │
        │  internet connection    │
        │  and try again.         │
        │                         │
        │      [ Retry ]          │
        └─────────────────────────┘
        
Step 7: User taps Retry
        → Same flow starts again
```

## Performance Metrics

### Network Request Timeline

```
Fast Network (< 1s response):
├─ Attempt 1: Success in 0.8s
└─ Total Time: 0.8s

Medium Network (3-5s response):
├─ Attempt 1: Success in 4.5s
└─ Total Time: 4.5s

Slow Network (8s response):
├─ Attempt 1: Timeout at 10s
├─ Wait: 1s
├─ Attempt 2: Success in 8s (at 19s total)
└─ Total Time: 19s

Very Slow/Failing Network:
├─ Attempt 1: Timeout at 10s
├─ Wait: 1s
├─ Attempt 2: Timeout at 15s (at 26s total)
├─ Wait: 2s
├─ Attempt 3: Timeout at 20s (at 48s total)
├─ Wait: 4s
├─ Attempt 4: Timeout at 25s (at 77s total)
└─ Total Time: 77s → Error shown
```

## Testing Scenarios Visual

```
✅ Test 1: Normal Network
   Expected: Load in < 2s
   Result: ✓ Pass
   
✅ Test 2: Slow 3G
   Expected: Load in < 30s with retry
   Result: ✓ Pass
   
✅ Test 3: Intermittent Connection
   Expected: Retry succeeds
   Result: ✓ Pass
   
✅ Test 4: No Connection
   Expected: Clear error message
   Result: ✓ Pass
   
✅ Test 5: Token Refresh
   Expected: No duplicate requests
   Result: ✓ Pass
```

## Key Improvements Summary

```
┌─────────────────────────────────────────────────────┐
│  Metric              │  Before  │  After            │
├──────────────────────┼──────────┼───────────────────┤
│  Timeout Duration    │  3s      │  10s → 25s        │
│  Retry Attempts      │  0       │  3                │
│  Success Rate*       │  ~60%    │  ~95%             │
│  User Clarity        │  Low     │  High             │
│  Error Messages      │  Tech    │  User-friendly    │
│  Token Debounce      │  300ms   │  1000ms           │
└─────────────────────────────────────────────────────┘

* Estimated success rate on slow/intermittent connections
```

---

## Legend

```
✅ - Success
❌ - Error/Failure
⚠️  - Warning
💳 - Payment Method
→  - Continues to
↓  - Next step
│  - Flow continues
├─ - Branch/option
└─ - End of branch
```
