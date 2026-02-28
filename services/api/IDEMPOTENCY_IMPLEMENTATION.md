# Idempotency Key Implementation Guide

## Overview

This document describes the comprehensive idempotency key implementation across all payment operations in BOUNTYExpo. Idempotency keys prevent duplicate charges and ensure data consistency when the same operation is retried (e.g., due to network issues, webhook replays, or user retries).

## What is Idempotency?

Idempotency means that making the same request multiple times has the same effect as making it once. In payment systems, this is critical to prevent:
- Duplicate charges to customers
- Double-crediting of funds
- Multiple escrow holds for the same bounty
- Repeated withdrawals

## Architecture

### Two-Layer Protection

1. **Application Layer** (services/api/src/services/idempotency-service.ts)
   - Redis-backed (production) or in-memory (development) storage
   - 24-hour TTL for idempotency keys
   - Used for request-level duplicate detection

2. **Stripe SDK Layer**
   - Idempotency keys passed to all Stripe API calls
   - Stripe's built-in duplicate request handling
   - Provides additional safety at the payment processor level

### Service Architecture

```
Client Request
    ↓
Application Idempotency Check (optional)
    ↓
Service Layer (with idempotency key parameter)
    ↓
Stripe API Call (with RequestOptions.idempotencyKey)
    ↓
Database Transaction (with idempotency key in metadata)
```

## Implementation Details

### Payment Operations

#### 1. Payment Intent Creation

**Service:** `consolidated-payment-service.ts`

```typescript
await createPaymentIntent({
  userId: 'user123',
  amountCents: 5000,
  currency: 'usd',
  idempotencyKey: 'payment_intent_user123_20240101_123456'
});
```

**Key Format:** `payment_intent_{userId}_{timestamp}_{purpose}`

#### 2. Payment Intent Confirmation

```typescript
await confirmPaymentIntent(
  'pi_123',
  'user123',
  'pm_456',
  'confirm_pi123_20240101'
);
```

**Key Format:** `confirm_{paymentIntentId}_{timestamp}`

#### 3. Setup Intent Creation

```typescript
await createSetupIntent(
  'user123',
  'setup_intent_user123_20240101'
);
```

**Key Format:** `setup_intent_{userId}_{timestamp}`

### Wallet Operations

#### 4. Deposit (Webhook Processing)

**Service:** `consolidated-wallet-service.ts`

```typescript
await createDeposit(
  'user123',
  100.00,
  'pi_stripe_123',
  'deposit_pi_stripe_123'
);
```

**Key Format:** `deposit_{paymentIntentId}` (auto-generated if not provided)

**Special Handling:**
- Automatically checks for existing transaction with same payment intent ID
- Returns existing transaction if duplicate detected (webhook replay safety)
- Critical for webhook idempotency

#### 5. Withdrawal

```typescript
await createWithdrawal(
  'user123',
  50.00,
  'acct_stripe_destination',
  'withdrawal_user123_20240101_123456'
);
```

**Key Format:** `withdrawal_{userId}_{timestamp}` (auto-generated if not provided)

**Stripe Transfer:** Idempotency key passed to `stripe.transfers.create()`

#### 6. Escrow Creation

```typescript
await createEscrow(
  'bounty456',
  'poster123',
  100.00,
  'escrow_bounty456_poster123'
);
```

**Key Format:** `escrow_{bountyId}_{posterId}` (auto-generated if not provided)

**Additional Protection:** Database-level duplicate check on `bounty_id` + `type='escrow'`

#### 7. Escrow Release

```typescript
await releaseEscrow(
  'bounty456',
  'hunter789',
  'release_bounty456_hunter789'
);
```

**Key Format:** `release_{bountyId}_{hunterId}` (auto-generated if not provided)

**Additional Protection:** Database-level check prevents both release and refund for same escrow

#### 8. Escrow Refund

```typescript
await refundEscrow(
  'bounty456',
  'poster123',
  'Bounty cancelled',
  'refund_bounty456_poster123'
);
```

**Key Format:** `refund_{bountyId}_{posterId}` (auto-generated if not provided)

**Additional Protection:** Database-level check prevents both release and refund for same escrow

## Route Integration

### Consolidated Payment Routes

All payment routes accept optional `idempotencyKey` in request body:

```typescript
// POST /payments/create-payment-intent
{
  "amountCents": 5000,
  "currency": "usd",
  "idempotencyKey": "client_generated_key_123"
}

// POST /payments/confirm
{
  "paymentIntentId": "pi_123",
  "idempotencyKey": "confirm_key_456"
}

// POST /payments/:id/cancel
{
  "reason": "requested_by_customer",
  "idempotencyKey": "cancel_key_789"
}
```

## Client Implementation

### Generating Idempotency Keys

**Best Practices:**

1. **Deterministic:** Same inputs should generate same key
2. **Unique:** Different operations should generate different keys
3. **Format:** Use underscores, alphanumeric characters only
4. **Length:** Keep under 255 characters (Stripe limit)

**Example Client Code:**

```typescript
import { generateIdempotencyKey } from '@/lib/services/payment-error-handler';

const key = generateIdempotencyKey(
  userId,
  amount,
  'wallet_deposit'
);

const response = await fetch('/api/payments/create-payment-intent', {
  method: 'POST',
  body: JSON.stringify({
    amountCents: 5000,
    idempotencyKey: key
  })
});
```

### Handling Duplicate Errors

```typescript
try {
  await createPayment({ idempotencyKey: key });
} catch (error) {
  if (error.code === 'duplicate_transaction') {
    // Operation already completed successfully
    console.log('Payment already processed');
    return;
  }
  throw error;
}
```

## Database Storage

All idempotency keys are stored in transaction metadata for audit trail:

```typescript
{
  id: 'tx_123',
  user_id: 'user456',
  type: 'deposit',
  amount: 100.00,
  metadata: {
    idempotency_key: 'deposit_pi_stripe_123',
    payment_intent_id: 'pi_stripe_123',
    created_via: 'webhook',
    // ... other metadata
  }
}
```

## Testing

### Test Coverage

See `services/api/src/__tests__/idempotency.test.ts` for comprehensive tests:

1. **Basic Operations**
   - Duplicate detection
   - Key removal and reuse
   - Concurrent operations

2. **Payment Operations**
   - Payment intent idempotency
   - Retry after failure

3. **Wallet Operations**
   - Deposit duplicate prevention
   - Escrow, release, refund idempotency
   - Withdrawal protection

4. **Edge Cases**
   - Empty keys
   - Long keys
   - Special characters
   - Cross-operation isolation

### Running Tests

```bash
cd services/api
npm test -- idempotency.test.ts
```

## Configuration

### Environment Variables

```bash
# Redis configuration for production
REDIS_URL=redis://localhost:6379
REDIS_ENABLED=true

# In development, Redis is optional (uses in-memory fallback)
```

### Idempotency Service Status

Check service status via health endpoint:

```bash
curl http://localhost:3001/health
```

Response includes:
```json
{
  "idempotency": {
    "backend": "redis",  // or "in-memory"
    "connected": true
  }
}
```

## Security Considerations

1. **Key Privacy:** Idempotency keys may contain user IDs and timestamps - don't log them in plain text
2. **Replay Protection:** 24-hour TTL prevents indefinite replay
3. **Authorization:** Always verify user authorization before using their idempotency key
4. **Uniqueness:** Ensure keys are unique per user and operation type

## Monitoring

### Metrics to Track

1. **Idempotency Hit Rate:** Percentage of duplicate requests detected
2. **Backend Status:** Redis connection health
3. **Key Collision Rate:** Unexpected duplicates (should be near zero)
4. **Retry Success Rate:** Operations that succeed after initial failure

### Logging

All idempotency-related operations are logged:

```
[IdempotencyService] Redis connected successfully
[WalletService] Duplicate deposit detected: pi_123
[PaymentService] Using idempotency key: payment_123
```

## Migration Guide

### Updating Existing Code

1. Add optional `idempotencyKey` parameter to function calls
2. Generate keys at the request boundary (API routes or client)
3. Pass keys through service layer to Stripe API calls

**Before:**
```typescript
await createPaymentIntent({
  userId: user.id,
  amountCents: 5000
});
```

**After:**
```typescript
await createPaymentIntent({
  userId: user.id,
  amountCents: 5000,
  idempotencyKey: generateKey(user.id, 5000, 'deposit')
});
```

## Troubleshooting

### Issue: "Duplicate transaction" error on legitimate retry

**Cause:** Idempotency key not cleared after failure

**Solution:** 
- Application layer: Call `removeIdempotencyKey()` on failure
- Stripe layer: Use different key for retry (include retry counter)

### Issue: Redis connection failures

**Cause:** Redis unavailable or misconfigured

**Solution:**
- Service automatically falls back to in-memory storage
- Check Redis connection: `REDIS_URL` environment variable
- Review logs for connection errors

### Issue: Webhook processing duplicates

**Cause:** Idempotency key not used in webhook handler

**Solution:**
- Always pass payment intent ID as idempotency key
- `createDeposit` has built-in duplicate detection
- Check `stripe_events` table for webhook idempotency

## Best Practices Summary

✅ **DO:**
- Generate deterministic keys for same operations
- Pass idempotency keys to all payment operations
- Store keys in transaction metadata
- Clean up keys on operation failure
- Use different keys for different operation types

❌ **DON'T:**
- Reuse keys across different operation types
- Include sensitive data in keys
- Skip idempotency keys on critical operations
- Use sequential or predictable keys
- Forget to handle duplicate errors gracefully

## References

- [Stripe Idempotency Documentation](https://stripe.com/docs/api/idempotent_requests)
- `services/api/src/services/idempotency-service.ts` - Service implementation
- `services/api/src/services/consolidated-payment-service.ts` - Payment operations
- `services/api/src/services/consolidated-wallet-service.ts` - Wallet operations
- `services/api/src/__tests__/idempotency.test.ts` - Test suite

## Support

For questions or issues with idempotency implementation:
1. Check service logs for idempotency-related errors
2. Review health endpoint for backend status
3. Consult test suite for usage examples
4. Check Stripe dashboard for API logs
