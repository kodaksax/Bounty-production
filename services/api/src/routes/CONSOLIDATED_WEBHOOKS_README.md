# Consolidated Webhook Handler

**Phase 3.3 - Backend Consolidation Project**

This document describes the consolidated Stripe webhook handler implementation.

## Overview

The consolidated webhook handler (`services/api/src/routes/consolidated-webhooks.ts`) processes Stripe webhook events for payment processing, transfers, and account updates. It replaces the webhook logic previously in `server/index.js` (lines 633-1008).

## Architecture

### Request Flow

```
1. Stripe sends POST to /webhooks/stripe
2. Custom content type parser preserves raw body
3. Verify webhook signature (security)
4. Check for duplicate events (idempotency)
5. Log event to database
6. Process event based on type
7. Mark event as processed
8. Return 200 OK to Stripe
```

### Key Components

- **Content Type Parser**: Custom parser preserves raw body while still parsing JSON
- **Signature Verification**: Uses `stripe.webhooks.constructEvent()` with webhook secret
- **Idempotency**: Uses `stripe_events` table to prevent duplicate processing
- **Atomic Operations**: Uses consolidated wallet service for balance updates
- **Error Isolation**: Each event handler wrapped in try/catch
- **Comprehensive Logging**: Detailed logs for debugging

## Event Handlers

### Payment Events

#### `payment_intent.succeeded`
- **Purpose**: Payment completed successfully
- **Actions**:
  - Creates wallet deposit transaction
  - Updates user balance (atomic)
  - Logs success
- **Service Used**: `WalletService.createDeposit()`

#### `payment_intent.payment_failed`
- **Purpose**: Payment failed
- **Actions**:
  - Logs failure with reason
  - Updates event data with failure notes
- **Future**: Send notification to user

#### `payment_intent.requires_action`
- **Purpose**: Payment requires 3D Secure authentication
- **Actions**:
  - Informational logging only
  - Client SDK handles the authentication

#### `charge.refunded`
- **Purpose**: Payment refunded
- **Actions**:
  - Creates refund transaction (tracked by refund ID)
  - Deducts from user balance
  - Logs refund reason
  - Handles partial refunds correctly
- **Note**: Transaction creation and balance update are separate operations
- **Service Used**: `WalletService.updateBalance()`

### Transfer Events

#### `transfer.created`
- **Purpose**: Transfer to Connect account created
- **Actions**:
  - Updates wallet transaction with transfer ID
  - Logs creation

#### `transfer.paid`
- **Purpose**: Transfer completed to bank
- **Actions**:
  - Marks wallet transaction as 'completed'
  - Logs success
- **Future**: Send notification to user

#### `transfer.failed`
- **Purpose**: Transfer to Connect account failed
- **Actions**:
  - Marks wallet transaction as 'failed'
  - Refunds user's wallet balance (atomic)
  - Logs failure with reason
- **Service Used**: `WalletService.updateBalance()`
- **Future**: Send notification to user

### Account Events

#### `account.updated`
- **Purpose**: Connect account info updated
- **Actions**:
  - Updates user's `stripe_connect_onboarded_at` if complete
  - Logs update

### Payout Events

#### `payout.paid`
- **Purpose**: Payout to bank completed
- **Actions**:
  - Informational logging only

#### `payout.failed`
- **Purpose**: Payout to bank failed
- **Actions**:
  - Error logging
- **Future**: Notify user and support

## Database Schema

### stripe_events Table

Used for idempotency and event tracking:

```sql
CREATE TABLE stripe_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_event_id text NOT NULL UNIQUE,
    event_type text NOT NULL,
    processed boolean DEFAULT false,
    processed_at timestamptz,
    event_data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `idx_stripe_events_event_id` on `stripe_event_id`
- `idx_stripe_events_type` on `event_type`
- `idx_stripe_events_processed` on `processed, created_at`

## Configuration

### Environment Variables

```bash
# Required
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# From unified config
EXPO_PUBLIC_SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Webhook Endpoint

**URL**: `https://your-api.com/webhooks/stripe`
**Method**: `POST`
**Content-Type**: `application/json`

Configure in Stripe Dashboard → Webhooks → Add endpoint

## Security

### Signature Verification

Every webhook request is verified using Stripe's signature verification:

```typescript
const event = stripe.webhooks.constructEvent(
  rawBody,
  signature,
  webhookSecret
);
```

**Why this matters:**
- Prevents malicious requests
- Ensures events come from Stripe
- Protects against replay attacks

### Idempotency

Events are checked against the database before processing:

```typescript
const alreadyProcessed = await checkEventProcessed(event.id);
if (alreadyProcessed) {
  return { received: true, alreadyProcessed: true };
}
```

**Why this matters:**
- Stripe retries failed webhooks
- Network issues can cause duplicates
- Prevents double charges/refunds

### Atomic Operations

All balance updates use the consolidated wallet service:

```typescript
// Atomic deposit
await WalletService.createDeposit(userId, amount, paymentIntentId);

// Atomic balance update
await WalletService.updateBalance(userId, amount);
```

**Why this matters:**
- Prevents race conditions
- Ensures data consistency
- Uses database transactions

## Error Handling

### Signature Verification Failure

**HTTP 400** - Bad Request
```json
{
  "error": "ValidationError",
  "message": "Webhook signature verification failed: ..."
}
```

**Action**: Stripe will not retry, check webhook secret configuration

### Event Already Processed

**HTTP 200** - OK
```json
{
  "received": true,
  "alreadyProcessed": true
}
```

**Action**: Normal behavior for retried webhooks

### Processing Error

**HTTP 500** - Internal Server Error

**Action**: Stripe will retry with exponential backoff

### Event Handler Errors

Each event handler is wrapped in try/catch:

```typescript
try {
  await handlePaymentIntentSucceeded(event);
} catch (error) {
  logger.error({ error, eventType, eventId }, 'Error processing webhook');
  throw error; // Signal Stripe to retry
}
```

## Testing

### Using Stripe CLI

Install and authenticate:
```bash
stripe login
```

Forward webhooks to local server:
```bash
stripe listen --forward-to localhost:3001/webhooks/stripe
```

Trigger test events:
```bash
# Test payment success
stripe trigger payment_intent.succeeded

# Test payment failure
stripe trigger payment_intent.payment_failed

# Test transfer failure
stripe trigger transfer.failed

# Test refund
stripe trigger charge.refunded
```

### Manual Testing

Run the test script:
```bash
cd services/api
npm run test:webhooks
```

**Note**: Requires configured environment variables

## Monitoring

### Logs to Monitor

```typescript
// Successful processing
logger.info({ eventType, eventId }, 'Received Stripe webhook event');
logger.info({ paymentIntentId, userId, amount }, 'Payment processed successfully');

// Failures
logger.error({ error, eventType }, 'Error processing webhook event');
logger.warn({ eventId }, 'Event already processed, skipping');
```

### Database Queries

Check recent webhook events:
```sql
SELECT 
  stripe_event_id,
  event_type,
  processed,
  processed_at,
  created_at
FROM stripe_events
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC
LIMIT 50;
```

Check unprocessed events:
```sql
SELECT 
  stripe_event_id,
  event_type,
  created_at
FROM stripe_events
WHERE processed = false
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at ASC;
```

## Integration with Services

### Wallet Service

```typescript
import * as WalletService from '../services/consolidated-wallet-service';

// Create deposit (payment succeeded)
await WalletService.createDeposit(userId, amount, paymentIntentId);

// Update balance (refund, failed transfer)
await WalletService.updateBalance(userId, amount);
```

### Payment Service

```typescript
import { stripe } from '../services/consolidated-payment-service';

// Used for signature verification
const event = stripe.webhooks.constructEvent(rawBody, sig, secret);
```

### Connect Service

Event handlers update Connect account status:
```typescript
// Update onboarding status
await supabaseAdmin
  .from('profiles')
  .update({ stripe_connect_onboarded_at: new Date().toISOString() })
  .eq('id', userId);
```

## Migration from Legacy Handler

### Old Location
`server/index.js` lines 633-1008

### Changes Made

1. **Moved to**: `services/api/src/routes/consolidated-webhooks.ts`
2. **Uses**: Consolidated wallet service instead of direct Supabase calls
3. **Improved**: Error handling and logging
4. **Added**: Comprehensive event tracking
5. **Maintained**: All existing event handlers
6. **Enhanced**: Signature verification and idempotency

### Backward Compatibility

The webhook endpoint URL remains the same: `/webhooks/stripe`

No changes needed to Stripe Dashboard configuration.

## Future Enhancements

1. **Notifications**: Send push/email notifications for events
2. **Retry Logic**: Custom retry for failed operations
3. **Analytics**: Track webhook processing metrics
4. **Alerting**: Alert on high failure rates
5. **Audit Trail**: Enhanced audit logging for compliance

## Troubleshooting

### Webhook Not Receiving Events

**Check:**
- Stripe Dashboard → Webhooks → Endpoint configuration
- Webhook secret is correct in environment variables
- Endpoint URL is publicly accessible (or using Stripe CLI for local)

### Signature Verification Failing

**Check:**
- `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard
- Raw body is preserved (not parsed before verification)
- Webhook secret is for the correct Stripe environment (test/live)

### Events Not Processing

**Check:**
- Database connectivity (Supabase)
- User exists in `profiles` table
- Wallet service methods working
- Check logs for specific error messages

### Duplicate Processing

**Check:**
- Idempotency check is working
- Database unique constraint on `stripe_event_id`
- Events marked as processed after successful handling

## Support

For issues or questions:
1. Check logs: `services/api/src/services/logger.ts`
2. Review database: `stripe_events` table
3. Test locally: Use Stripe CLI
4. Check Stripe Dashboard: Webhooks → Events

## References

- [Stripe Webhooks Documentation](https://stripe.com/docs/webhooks)
- [Stripe CLI Documentation](https://stripe.com/docs/stripe-cli)
- [Consolidated Wallet Service](../services/consolidated-wallet-service.ts)
- [Consolidated Payment Service](../services/consolidated-payment-service.ts)
