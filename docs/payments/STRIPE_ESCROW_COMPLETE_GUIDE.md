# Complete Stripe Escrow Payment Flow Implementation Guide

## Overview

This guide covers the complete escrow payment flow implementation for BountyExpo, including:
- Escrow creation with Stripe PaymentIntents
- Fund release with platform fee deduction
- Refund flow for cancellations
- Stripe Connect onboarding
- Email receipts
- Edge case handling

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [Payment Flow](#payment-flow)
5. [API Endpoints](#api-endpoints)
6. [Error Handling](#error-handling)
7. [Testing](#testing)
8. [Production Deployment](#production-deployment)
9. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      BOUNTY LIFECYCLE                            │
└─────────────────────────────────────────────────────────────────┘

1. CREATE BOUNTY
   ↓
   Creator posts bounty with amount
   Status: "open"

2. ACCEPT BOUNTY (Escrow Creation)
   ↓
   ┌─────────────────────────────────────┐
   │ Stripe PaymentIntent Created        │
   │ - Amount: bounty.amount_cents       │
   │ - Capture: automatic                │
   │ - Status: requires_payment_method   │
   └─────────────────────────────────────┘
   ↓
   PaymentIntent ID stored in bounty
   Email receipt sent to creator
   Status: "in_progress"

3a. COMPLETE BOUNTY (Fund Release)
    ↓
    ┌─────────────────────────────────────┐
    │ Stripe Transfer Created             │
    │ - To: hunter.stripe_account_id      │
    │ - Amount: total - platform_fee      │
    │ - Platform Fee: 5% (default)        │
    └─────────────────────────────────────┘
    ↓
    Email receipts sent to both parties
    Status: "completed"

3b. CANCEL BOUNTY (Refund)
    ↓
    ┌─────────────────────────────────────┐
    │ Stripe Refund Created               │
    │ - PaymentIntent: refunded           │
    │ - Amount: full refund               │
    │ - Reason: requested_by_customer     │
    └─────────────────────────────────────┘
    ↓
    Email receipt sent to creator
    Status: "cancelled"
```

---

## Prerequisites

### 1. Stripe Account Setup

1. **Create Stripe Account**
   - Go to [stripe.com](https://stripe.com)
   - Sign up for a free account
   - Complete business information

2. **Enable Stripe Connect**
   - Dashboard → Settings → Connect
   - Choose "Platform or Marketplace"
   - Complete Connect settings

3. **Get API Keys**
   - Dashboard → Developers → API Keys
   - Copy **Publishable Key** (starts with `pk_`)
   - Copy **Secret Key** (starts with `sk_`)
   - For testing, use test mode keys

### 2. Database Setup

The implementation uses PostgreSQL with Drizzle ORM. Required tables:

```sql
-- Users table (already exists)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle TEXT NOT NULL,
  stripe_account_id TEXT, -- Stripe Connect account ID
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Bounties table (already exists)
CREATE TABLE bounties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES users(id) NOT NULL,
  hunter_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  is_for_honor BOOLEAN DEFAULT FALSE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open, in_progress, completed, cancelled
  payment_intent_id TEXT, -- Stripe PaymentIntent ID
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Wallet transactions table (already exists)
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id UUID REFERENCES bounties(id),
  user_id UUID REFERENCES users(id) NOT NULL,
  type TEXT NOT NULL, -- escrow, release, refund
  amount_cents INTEGER NOT NULL,
  stripe_transfer_id TEXT, -- Stripe Transfer or Refund ID
  platform_fee_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(bounty_id, type) -- Prevent duplicate releases
);
```

---

## Environment Setup

### 1. Configure Environment Variables

Create `.env` file in `services/api/`:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/bountyexpo

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Optional: Email Configuration
EMAIL_PROVIDER=console  # or 'stripe', 'sendgrid'

# API Configuration
PORT=3001
HOST=0.0.0.0
FRONTEND_URL=http://localhost:3000
```

### 2. Install Dependencies

```bash
cd services/api
npm install
```

### 3. Run Database Migrations

```bash
npm run db:migrate
```

---

## Payment Flow

### 1. Escrow Creation (Bounty Acceptance)

**When:** A hunter accepts a bounty

**Process:**
1. Validate bounty status is "open"
2. Create Stripe PaymentIntent
3. Store PaymentIntent ID in bounty
4. Create escrow transaction record
5. Send email receipt to creator
6. Update bounty status to "in_progress"

**Code Example:**

```typescript
// Backend: POST /bounties/:bountyId/accept
const result = await bountyService.acceptBounty(bountyId, hunterId);

// Internally calls:
const paymentIntent = await stripe.paymentIntents.create({
  amount: bounty.amount_cents,
  currency: 'usd',
  capture_method: 'automatic',
  payment_method_types: ['card'],
  metadata: {
    bounty_id: bountyId,
    creator_id: bounty.creator_id,
    type: 'escrow',
  },
});
```

**Email Receipt:**
```
Subject: Escrow Confirmation - [Bounty Title]

Your payment for the bounty "[Title]" has been successfully held in escrow.

TRANSACTION DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bounty ID: xxx-xxx-xxx
Amount Held: $50.00
Status: Funds Held in Escrow
Date: January 1, 2025
```

### 2. Fund Release (Bounty Completion)

**When:** Bounty is marked as complete

**Process:**
1. Validate bounty status is "in_progress"
2. Check for existing release (prevent double release)
3. Calculate platform fee (default 5%)
4. Create Stripe Transfer to hunter
5. Record release and fee transactions
6. Send email receipts to both parties
7. Update bounty status to "completed"

**Code Example:**

```typescript
// Backend: POST /bounties/:bountyId/complete
const result = await bountyService.completeBounty(bountyId, hunterId);

// Internally calls:
const transfer = await stripe.transfers.create({
  amount: releaseAmountCents, // total - platform fee
  currency: 'usd',
  destination: hunter.stripe_account_id,
  metadata: {
    bounty_id: bountyId,
    platform_fee_cents: platformFeeCents,
  },
});
```

**Platform Fee Calculation:**
```typescript
const totalAmount = 10000; // $100.00 in cents
const platformFeePercentage = 5; // 5%
const platformFee = Math.round((totalAmount * platformFeePercentage) / 100); // $5.00
const hunterReceives = totalAmount - platformFee; // $95.00
```

**Email Receipts:**

*To Hunter:*
```
Subject: Payment Received - [Bounty Title]

Congratulations! Payment for "[Title]" has been released to you.

PAYMENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Gross Amount: $100.00
Platform Fee: $5.00
Net Payment: $95.00
```

*To Creator:*
```
Subject: Payment Sent - [Bounty Title]

Payment for "[Title]" has been successfully sent to [Hunter].

TRANSACTION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Amount: $100.00
Paid to Hunter: $95.00
Platform Fee: $5.00
```

### 3. Refund (Bounty Cancellation)

**When:** Bounty is cancelled before completion

**Process:**
1. Validate bounty can be cancelled (not completed)
2. Check for existing refund (prevent duplicate)
3. Create Stripe Refund
4. Record refund transaction
5. Send email receipt to creator
6. Update bounty status to "cancelled"

**Code Example:**

```typescript
// Backend: POST /bounties/:bountyId/cancel
const result = await refundService.processRefund({
  bountyId,
  reason: 'No longer needed',
  cancelledBy: userId,
});

// Internally calls:
const refund = await stripe.refunds.create({
  payment_intent: paymentIntentId,
  reason: 'requested_by_customer',
  metadata: {
    bounty_id: bountyId,
    type: 'bounty_cancellation',
  },
});
```

**Email Receipt:**
```
Subject: Refund Processed - [Bounty Title]

Your bounty "[Title]" has been cancelled and a refund has been processed.

REFUND DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Refund Amount: $100.00
Reason: No longer needed
Status: Refund Processed
```

---

## API Endpoints

### 1. Create Escrow (Accept Bounty)

```http
POST /bounties/:bountyId/accept
Authorization: Bearer <token>
```

**Response:**
```json
{
  "message": "Bounty accepted successfully",
  "bountyId": "xxx-xxx-xxx"
}
```

### 2. Release Funds (Complete Bounty)

```http
POST /bounties/:bountyId/complete
Authorization: Bearer <token>
```

**Response:**
```json
{
  "message": "Bounty completed successfully",
  "bountyId": "xxx-xxx-xxx"
}
```

### 3. Refund (Cancel Bounty)

```http
POST /bounties/:bountyId/cancel
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "No longer needed"
}
```

**Response:**
```json
{
  "message": "Bounty cancelled and refund processed successfully",
  "bountyId": "xxx-xxx-xxx",
  "refundId": "re_xxx",
  "amount": 100.00
}
```

### 4. Stripe Connect Onboarding

```http
POST /stripe/connect/onboarding-link
Authorization: Bearer <token>
Content-Type: application/json

{
  "refreshUrl": "https://yourapp.com/onboarding/refresh",
  "returnUrl": "https://yourapp.com/onboarding/return"
}
```

**Response:**
```json
{
  "url": "https://connect.stripe.com/express/oauth/...",
  "expiresAt": 1704067200
}
```

### 5. Check Connect Status

```http
GET /stripe/connect/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "hasStripeAccount": true,
  "stripeAccountId": "acct_xxx",
  "detailsSubmitted": true,
  "chargesEnabled": true,
  "payoutsEnabled": true,
  "requiresAction": false,
  "currentlyDue": []
}
```

### 6. Validate Payment Capability

```http
POST /stripe/validate-payment
Authorization: Bearer <token>
Content-Type: application/json

{
  "amountCents": 5000
}
```

**Response:**
```json
{
  "canPay": true
}
```

**Error Response:**
```json
{
  "canPay": false,
  "error": "User has not set up payment method. Please complete Stripe onboarding first."
}
```

---

## Error Handling

### Edge Cases Handled

#### 1. Insufficient Funds / Payment Fails

**Scenario:** User's payment method is declined

**Handling:**
- PaymentIntent status: `requires_payment_method`
- User prompted to update payment method
- Bounty remains in "open" status
- No escrow transaction created

**Error Message:**
```json
{
  "error": "Payment failed: Insufficient funds"
}
```

#### 2. Unverified Stripe Account

**Scenario:** Hunter hasn't completed Stripe Connect onboarding

**Handling:**
- Validate before creating PaymentIntent
- Return clear error message
- Provide onboarding link

**Error Message:**
```json
{
  "canPay": false,
  "error": "User account is not verified to make payments. Please complete account verification."
}
```

#### 3. Double Release Prevention

**Scenario:** Attempt to release funds twice

**Handling:**
- Database unique constraint on `(bounty_id, type)`
- Check for existing release before creating transfer
- Return error if already released

**Error Message:**
```json
{
  "error": "Release already processed for this bounty"
}
```

#### 4. Double Refund Prevention

**Scenario:** Attempt to refund twice

**Handling:**
- Check for existing refund transaction
- Return error if already refunded

**Error Message:**
```json
{
  "error": "Bounty has already been refunded"
}
```

#### 5. Minimum Amount Validation

**Scenario:** Amount below Stripe minimum ($0.50)

**Handling:**
- Validate amount before creating PaymentIntent
- Return clear error message

**Error Message:**
```json
{
  "canPay": false,
  "error": "Amount must be at least $0.50"
}
```

### Retry Mechanism

The implementation uses an **Outbox Pattern** for reliable event processing with exponential backoff:

```typescript
// Retry configuration
const maxRetries = 3;
const backoffFormula = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s

// Failed operations are queued for retry
await outboxService.createEvent({
  type: 'REFUND_RETRY',
  payload: { bountyId, error },
});
```

---

## Testing

### 1. Test Mode Setup

Use Stripe test mode for development:

```bash
# Use test keys in .env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### 2. Test Cards

Stripe provides test cards for various scenarios:

| Card Number         | Scenario                    |
|--------------------|-----------------------------|
| 4242 4242 4242 4242 | Success                     |
| 4000 0000 0000 9995 | Insufficient funds          |
| 4000 0000 0000 0002 | Card declined               |
| 4000 0025 0000 3155 | Requires authentication     |

### 3. Testing Escrow Flow

```bash
# Start the API server
cd services/api
npm run dev

# In another terminal, test the flow
curl -X POST http://localhost:3001/bounties/test-bounty-id/accept \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. Testing Webhooks

Use Stripe CLI to forward webhooks to local development:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks
stripe listen --forward-to localhost:3001/webhooks/stripe
```

---

## Production Deployment

### 1. Switch to Live Mode

1. **Get Live API Keys**
   - Stripe Dashboard → Developers → API Keys
   - Switch to "Live" mode (toggle in top left)
   - Copy live keys (starts with `sk_live_` and `pk_live_`)

2. **Update Environment Variables**
   ```bash
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_PUBLISHABLE_KEY=pk_live_...
   ```

3. **Complete Stripe Account Activation**
   - Submit business information
   - Verify bank account
   - Complete tax forms

### 2. Configure Webhooks

1. **Create Webhook Endpoint**
   - Dashboard → Developers → Webhooks
   - Add endpoint: `https://your-domain.com/webhooks/stripe`
   
2. **Select Events**
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `transfer.created`
   - `refund.created`
   - `account.updated`

3. **Get Webhook Secret**
   - Copy webhook signing secret
   - Add to environment: `STRIPE_WEBHOOK_SECRET=whsec_...`

### 3. Security Checklist

- [ ] Use HTTPS for all API endpoints
- [ ] Validate webhook signatures
- [ ] Store API keys in secure environment variables (not in code)
- [ ] Implement rate limiting on payment endpoints
- [ ] Log all payment transactions for audit
- [ ] Set up monitoring and alerts for failed payments
- [ ] Implement fraud detection rules in Stripe Dashboard
- [ ] Enable 3D Secure for card payments
- [ ] Review Stripe security best practices

### 4. Compliance

- [ ] PCI DSS compliance (Stripe handles this for you)
- [ ] GDPR compliance for user data
- [ ] Terms of Service including payment terms
- [ ] Privacy Policy including payment processing
- [ ] Refund policy clearly stated

---

## Troubleshooting

### Common Issues

#### 1. "Stripe service not configured"

**Cause:** Missing `STRIPE_SECRET_KEY` environment variable

**Solution:**
```bash
# Add to .env file
STRIPE_SECRET_KEY=sk_test_your_key_here
```

#### 2. "No such payment_intent"

**Cause:** PaymentIntent ID not found in Stripe

**Solution:**
- Verify payment intent was created successfully
- Check Stripe Dashboard for the payment intent
- Ensure using correct Stripe account (test vs live)

#### 3. "Transfer destination must have at least one of the capabilities"

**Cause:** Hunter's Stripe account not fully set up

**Solution:**
- Hunter must complete Stripe Connect onboarding
- Verify `chargesEnabled` is `true` in account status
- Check account requirements in Stripe Dashboard

#### 4. "Amount must be at least $0.50"

**Cause:** Stripe minimum amount requirement

**Solution:**
- Enforce minimum bounty amount of $0.50 in UI
- Add validation before creating PaymentIntent

#### 5. Email receipts not sending

**Cause:** Email provider not configured

**Solution:**
```bash
# Check EMAIL_PROVIDER setting
EMAIL_PROVIDER=console  # For development

# For production, configure SendGrid or Stripe
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxx
```

### Debugging Tools

#### 1. Stripe Dashboard

- View all payment intents, transfers, and refunds
- Check webhook delivery logs
- Test API calls in API explorer

#### 2. API Logs

```bash
# View API logs
cd services/api
npm run dev

# Logs will show:
# ✅ Created Stripe PaymentIntent pi_xxx for bounty xxx
# ✅ Created Stripe Transfer tr_xxx for 9500 cents
# 📧 Email receipt sent to user@example.com
```

#### 3. Database Queries

```sql
-- Check bounty status and payment intent
SELECT id, status, payment_intent_id, amount_cents
FROM bounties
WHERE id = 'xxx-xxx-xxx';

-- Check wallet transactions
SELECT type, amount_cents, stripe_transfer_id, created_at
FROM wallet_transactions
WHERE bounty_id = 'xxx-xxx-xxx'
ORDER BY created_at DESC;
```

---

## Additional Resources

### Documentation

- [Stripe API Reference](https://stripe.com/docs/api)
- [Stripe Connect Guide](https://stripe.com/docs/connect)
- [PaymentIntents API](https://stripe.com/docs/payments/payment-intents)
- [Transfers API](https://stripe.com/docs/connect/charges-transfers)
- [Refunds API](https://stripe.com/docs/refunds)

### Support

- **Stripe Support:** https://support.stripe.com
- **BountyExpo Support:** support@bountyexpo.com
- **GitHub Issues:** https://github.com/bountyexpo/bountyexpo/issues

---

## Summary

This implementation provides a complete, production-ready escrow payment flow with:

✅ **Escrow Creation** - Automatic PaymentIntent creation on bounty acceptance  
✅ **Fund Release** - Transfer to hunter with platform fee deduction  
✅ **Refund Flow** - Full refund on cancellation  
✅ **Stripe Connect** - Onboarding for hunters to receive payments  
✅ **Email Receipts** - Notifications for all parties  
✅ **Error Handling** - Comprehensive edge case handling  
✅ **Transaction History** - Complete audit trail in wallet  
✅ **Security** - PCI compliant, webhook validation  
✅ **Retry Mechanism** - Reliable event processing with outbox pattern  

The system is designed to be:
- **Reliable** - Transaction outbox pattern ensures no lost payments
- **Secure** - Follows Stripe security best practices
- **Transparent** - Email receipts and transaction history
- **Scalable** - Async processing for high volume
- **Maintainable** - Clear service boundaries and error handling
