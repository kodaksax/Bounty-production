# Complete Escrow Payment Flow - Implementation Guide

This document describes the complete implementation of the escrow payment flow in BountyExpo, including escrow creation, fund release, and refund processing.

## Overview

The payment flow ensures secure transactions between bounty creators (posters) and hunters through Stripe's payment infrastructure. All transactions follow an escrow model where funds are held securely until work is completed.

## Architecture

### Core Components

1. **Bounty Service** (`services/bounty-service.ts`)
   - Handles bounty lifecycle: accept, complete
   - Creates outbox events for payment triggers
   - Validates business logic and permissions

2. **Completion Release Service** (`services/completion-release-service.ts`)
   - Processes fund transfers to hunters
   - Calculates platform fees
   - Creates Stripe Transfers
   - Updates bounty status on successful payment

3. **Refund Service** (`services/refund-service.ts`)
   - Handles bounty cancellations
   - Processes Stripe refunds
   - Manages refund transaction records

4. **Email Service** (`services/email-service.ts`)
   - Sends transaction receipts
   - Provides detailed payment breakdowns
   - Supports escrow, release, and refund confirmations

5. **Outbox Worker** (`services/outbox-worker.ts`)
   - Processes async payment events
   - Handles retries with exponential backoff
   - Ensures reliable event processing

## Payment Flow Diagrams

### 1. Escrow Creation (Bounty Acceptance)

```
┌─────────────────────────────────────────────────────────────┐
│ User accepts bounty via /bounties/:id/accept endpoint       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ bountyService.acceptBounty()                                │
│ ├─ Update bounty: status = 'in_progress', hunter_id set    │
│ ├─ Create ESCROW_HOLD outbox event                         │
│ ├─ Create escrow wallet transaction record                 │
│ └─ Send escrow confirmation email to poster                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Outbox Worker processes ESCROW_HOLD event                  │
│ ├─ Call stripeConnectService.createEscrowPaymentIntent()   │
│ ├─ Create Stripe PaymentIntent (captures funds)            │
│ ├─ Store payment_intent_id on bounty                       │
│ └─ Log ESCROW_HELD success                                 │
└─────────────────────────────────────────────────────────────┘
```

**Result**: Funds are held securely via Stripe PaymentIntent

### 2. Fund Release (Bounty Completion)

```
┌─────────────────────────────────────────────────────────────┐
│ Hunter completes work via /bounties/:id/complete endpoint  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ bountyService.completeBounty()                              │
│ ├─ Validate: status = 'in_progress', hunter matches        │
│ ├─ Verify payment_intent_id exists                         │
│ ├─ Create COMPLETION_RELEASE outbox event                  │
│ └─ Bounty stays in_progress until payment completes        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Outbox Worker processes COMPLETION_RELEASE event           │
│ └─ Call completionReleaseService.processCompletionRelease()│
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ completionReleaseService.processCompletionRelease()        │
│ ├─ Check for existing release (prevent double processing)  │
│ ├─ Get bounty and hunter details                           │
│ ├─ Calculate: platformFee = amount * 5%                    │
│ ├─ Calculate: releaseAmount = amount - platformFee         │
│ ├─ Create Stripe Transfer to hunter's account              │
│ ├─ Record release transaction in wallet_transactions       │
│ ├─ Record platform_fee transaction                         │
│ ├─ Update bounty: status = 'completed'                     │
│ ├─ Send email receipts to poster & hunter                  │
│ └─ Publish realtime status change event                    │
└─────────────────────────────────────────────────────────────┘
```

**Result**: Hunter receives payment (minus platform fee), bounty marked complete

### 3. Refund Flow (Cancellation)

```
┌─────────────────────────────────────────────────────────────┐
│ User cancels bounty via /bounties/:id/cancel endpoint      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ refundService.processRefund()                               │
│ ├─ Validate: not completed, not honor-only                 │
│ ├─ Check for existing refund (prevent double processing)   │
│ ├─ Call stripeConnectService.refundPaymentIntent()         │
│ ├─ Create refund in Stripe                                 │
│ ├─ Record refund transaction in wallet_transactions        │
│ ├─ Update bounty: status = 'cancelled'                     │
│ ├─ Create BOUNTY_REFUNDED outbox event                     │
│ └─ Outbox worker sends refund confirmation email           │
└─────────────────────────────────────────────────────────────┘
```

**Result**: Poster receives full refund, bounty marked cancelled

## API Endpoints

### Accept Bounty
```http
POST /bounties/:bountyId/accept
Authorization: Bearer <token>

Response:
{
  "message": "Bounty accepted successfully",
  "bountyId": "uuid"
}
```

### Complete Bounty
```http
POST /bounties/:bountyId/complete
Authorization: Bearer <token>

Response:
{
  "message": "Bounty completed successfully",
  "bountyId": "uuid"
}
```

### Cancel Bounty
```http
POST /bounties/:bountyId/cancel
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "Cancellation reason (optional)"
}

Response:
{
  "message": "Bounty cancelled and refund processed successfully",
  "bountyId": "uuid",
  "refundId": "re_xxx",
  "amount": 100.00
}
```

## Database Schema

### bounties table
```sql
CREATE TABLE bounties (
  id UUID PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES users(id),
  hunter_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  is_for_honor BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'open',
  payment_intent_id TEXT,  -- Stripe PaymentIntent ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### wallet_transactions table
```sql
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY,
  bounty_id UUID REFERENCES bounties(id),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,  -- 'escrow', 'release', 'refund', 'platform_fee'
  amount_cents INTEGER NOT NULL,
  stripe_transfer_id TEXT,  -- Stripe Transfer ID for releases
  platform_fee_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Email Receipts

### Escrow Confirmation (to Poster)
- Sent when funds are held in escrow
- Shows amount held, bounty details
- Explains next steps

### Release Confirmation (to Poster and Hunter)
- **To Hunter**: Shows gross amount, platform fee, net payment
- **To Poster**: Shows total amount, breakdown of payment
- Includes Stripe Transfer ID

### Refund Confirmation (to Poster)
- Shows refund amount
- Includes reason for cancellation
- Explains refund timeline (5-10 business days)

## Testing

### Test Scripts

```bash
# Run end-to-end payment flow test
cd services/api
npm run test:payment-flow

# Run escrow-specific tests
npm run test:escrow

# Run with real Stripe test environment
TEST_USE_REAL_STRIPE=true npm run test:payment-flow
```

### Test Coverage

The test suite (`test-end-to-end-payment-flow.ts`) validates:

1. **Happy Path**: Accept → Escrow → Complete → Release
2. **Cancellation Path**: Accept → Escrow → Cancel → Refund
3. **Edge Cases**:
   - Double release prevention
   - Double refund prevention
   - Honor-only bounties (no payment)
   - Bounty completion by wrong user
   - Missing payment intent
   - Already refunded bounties

## Stripe Test Cards

When testing with `TEST_USE_REAL_STRIPE=true`, use these test cards:

| Card Number         | Description                |
|---------------------|----------------------------|
| 4242 4242 4242 4242 | Successful payment         |
| 4000 0000 0000 9995 | Declined (insufficient funds) |
| 4000 0025 0000 3155 | Requires authentication    |

## Platform Fee Configuration

Default platform fee: **5%**

To customize, set `platformFeePercentage` when calling `processCompletionRelease()`:

```typescript
await completionReleaseService.processCompletionRelease({
  bountyId,
  hunterId,
  paymentIntentId,
  platformFeePercentage: 10, // 10% platform fee
});
```

## Error Handling & Retry Mechanism

### Outbox Pattern
All payment operations use the outbox pattern for reliable processing:

1. Create outbox event
2. Worker processes event asynchronously
3. On failure, retry with exponential backoff
4. Max retries: 3 (configurable)

### Retry Backoff
- Retry 1: 2 seconds
- Retry 2: 4 seconds
- Retry 3: 8 seconds

### Double Processing Prevention
- Release: Check for existing release transaction
- Refund: Check for existing refund transaction
- Both use database constraints for atomicity

## Security Considerations

1. **Authorization**: All endpoints require authentication
2. **Hunter Validation**: Only the assigned hunter can complete a bounty
3. **Status Validation**: Bounties must be in correct status for operations
4. **Double Processing**: Prevented via database checks
5. **Payment Intent Validation**: Verified before processing refunds/releases
6. **Amount Validation**: Minimum amounts enforced by Stripe ($0.50)

## Production Deployment Checklist

- [ ] Set `STRIPE_SECRET_KEY` environment variable
- [ ] Configure `STRIPE_PUBLISHABLE_KEY` for frontend
- [ ] Set up Stripe webhook endpoint for PaymentIntent events
- [ ] Configure email service (replace console logging)
- [ ] Set up monitoring for outbox worker
- [ ] Configure database backups
- [ ] Set appropriate platform fee percentage
- [ ] Review and adjust retry mechanism settings
- [ ] Set up alerts for failed payment events
- [ ] Configure Stripe Connect for hunters

## Monitoring & Observability

### Key Metrics to Track

1. **Escrow Creation Success Rate**
   - Target: >99%
   - Alert if <95%

2. **Release Processing Time**
   - Target: <5 seconds
   - Alert if >30 seconds

3. **Refund Success Rate**
   - Target: >99%
   - Alert if <95%

4. **Outbox Event Processing**
   - Pending events count
   - Failed events requiring manual intervention
   - Average retry count

### Log Events

All payment operations log events:
- `🔒 ESCROW_HOLD`: PaymentIntent creation
- `✅ ESCROW_HELD`: Successful escrow
- `💸 COMPLETION_RELEASE`: Release initiated
- `✅ COMPLETION_RELEASED`: Funds transferred
- `💸 BOUNTY_REFUNDED`: Refund processed
- `❌ [Event] Failed`: Error occurred

## Troubleshooting

### PaymentIntent Creation Fails
- Check Stripe API credentials
- Verify amount meets minimum ($0.50)
- Ensure user has valid payment method

### Transfer Fails
- Verify hunter has Stripe Connect account
- Check account is fully onboarded
- Verify transfer amount is valid

### Refund Fails
- Ensure PaymentIntent has succeeded
- Check refund is within Stripe's refund window
- Verify PaymentIntent hasn't already been refunded

### Outbox Events Stuck
- Check outbox worker is running
- Review retry_metadata for error details
- Check database connection
- Review Stripe API status

## Related Documentation

- [Stripe Connect Documentation](https://stripe.com/docs/connect)
- [Stripe PaymentIntents](https://stripe.com/docs/payments/payment-intents)
- [Stripe Transfers](https://stripe.com/docs/connect/separate-charges-and-transfers)
- [Escrow Implementation Guide](./ESCROW_IMPLEMENTATION.md)

## Support

For issues or questions:
- Review logs for error messages
- Check Stripe Dashboard for payment details
- Review outbox_events table for event status
- Contact support@bountyexpo.com
