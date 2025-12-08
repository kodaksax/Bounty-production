# Payment System Integration & Security Guide

## Overview

This guide documents the comprehensive payment system implementation in BOUNTYExpo, following Stripe best practices, PCI compliance requirements, and security recommendations.

## Table of Contents

1. [Security & Compliance](#security--compliance)
2. [Risk Management](#risk-management)
3. [Payment Processing](#payment-processing)
4. [Webhook Handling](#webhook-handling)
5. [Testing Guide](#testing-guide)
6. [Deployment Checklist](#deployment-checklist)

---

## Security & Compliance

### TLS/HTTPS Requirements

**All payment operations MUST use HTTPS with TLS 1.2 or higher.**

#### Server Configuration

```nginx
# Nginx example
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-CHACHA20-POLY1305';
ssl_prefer_server_ciphers on;

# Enable HSTS
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

Verify TLS configuration: [SSL Labs SSL Test](https://www.ssllabs.com/ssltest/)

### Content Security Policy (CSP)

Implement CSP headers to allow Stripe.js and Elements while preventing XSS attacks:

```typescript
import { getSecurityHeaders } from '@/lib/security/payment-security-config';

// Add to your server/API responses
const headers = getSecurityHeaders();
```

**CSP Directives for Stripe:**
- `script-src`: Allow `https://js.stripe.com`
- `frame-src`: Allow `https://js.stripe.com` and `https://*.stripe.com` (for 3D Secure)
- `connect-src`: Allow `https://api.stripe.com`
- `img-src`: Allow `https://*.stripe.com`

### PCI Compliance

BOUNTYExpo follows PCI DSS requirements by:

1. **NEVER storing card data** - All card data is tokenized by Stripe.js client-side
2. **Using HTTPS** - All payment pages served over TLS 1.2+
3. **Minimizing scope** - Card data never touches our servers
4. **Access controls** - Payment endpoints require authentication
5. **Logging & monitoring** - All payment operations are logged

#### What NOT to do:
- ❌ Store full card numbers
- ❌ Store CVV/CVC codes
- ❌ Log sensitive card data
- ❌ Transmit card data unencrypted
- ❌ Store card data in cookies or local storage

#### What to do:
- ✅ Use Stripe.js for tokenization
- ✅ Use HTTPS for all payment pages
- ✅ Use PaymentIntents API
- ✅ Implement webhook signature verification
- ✅ Use idempotency keys

### Strong Customer Authentication (SCA)

SCA is required for European payments under PSD2 regulations.

**Automatic SCA Handling:**
```typescript
// SCA is automatically triggered for:
// 1. European cards
// 2. High-value transactions (>$250 USD)
// 3. First-time customers
// 4. Suspicious transactions (Radar)

import { isSCARequired } from '@/lib/security/payment-security-config';

const needsSCA = isSCARequired({
  amount: 100,
  currency: 'EUR',
  customerRegion: 'EU',
  isFirstTransaction: true,
});
```

The Stripe SDK automatically handles 3D Secure authentication when required.

---

## Risk Management

### Stripe Radar Integration

Radar provides automated fraud detection. Configure in Stripe Dashboard:

1. **Enable Radar** in your Stripe account
2. **Configure rules** in Dashboard → Radar
3. **Set risk thresholds**:
   - Block: Risk score > 85
   - Review: Risk score 65-85
   - Allow: Risk score < 30

#### Recommended Rules:

```javascript
// Block high-value first-time transactions
IF amount > 500 USD AND customer_transactions_count = 0 THEN block

// Review IP mismatches
IF ip_country != card_country THEN review

// Block excessive velocity
IF customer_transaction_count_1h > 5 THEN block
```

### Negative Balance Liability

**Platform assumes liability for negative balances by default.**

Configuration in `lib/security/payment-security-config.ts`:

```typescript
export const NEGATIVE_BALANCE_POLICY = {
  defaultLiability: 'platform',
  thresholds: {
    alertThreshold: 100,    // Alert at -$100
    suspendThreshold: 500,  // Suspend at -$500
    collectionThreshold: 1000, // Collections at -$1000
  },
};
```

#### Monitoring Negative Balances:

1. **Daily checks** run automatically
2. **Alerts sent** to finance@bountyexpo.com
3. **Suspension** occurs at threshold
4. **Collection** process begins after 30 days

#### Database Schema:

```sql
CREATE TABLE negative_balance_liabilities (
  id UUID PRIMARY KEY,
  entity VARCHAR(50) NOT NULL, -- 'platform' or 'connected_account'
  account_id VARCHAR(255) NOT NULL,
  amount INTEGER NOT NULL, -- in cents
  currency VARCHAR(3) NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL, -- 'pending', 'disputed', 'resolved', 'written_off'
  created_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP
);
```

### Dispute Handling

Webhook events track all disputes:

```typescript
// Automatic handling via webhooks
'charge.dispute.created' → Freeze funds
'charge.dispute.closed' → Release or deduct funds
```

---

## Payment Processing

### Idempotency Keys

**All payment requests support idempotency to prevent duplicate charges.**

#### Implementation:

```typescript
import { generateIdempotencyKey } from '@/lib/services/payment-error-handler';

const idempotencyKey = generateIdempotencyKey(userId, amount, 'wallet_deposit');

const response = await fetch('/payments/create-payment-intent', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    amountCents: 5000,
    currency: 'usd',
    idempotencyKey, // Include this!
  }),
});
```

#### Backend Handling:

- Idempotency keys stored for 24 hours
- Duplicate requests return 409 Conflict
- Keys auto-expire after TTL

### Automatic Payment Methods

**We use `automatic_payment_methods` instead of hardcoded types:**

```typescript
const paymentIntent = await stripe.paymentIntents.create({
  amount: 5000,
  currency: 'usd',
  automatic_payment_methods: {
    enabled: true,
    allow_redirects: 'never', // Mobile-friendly
  },
});
```

This automatically enables:
- Credit/debit cards
- Apple Pay (when configured)
- Google Pay (when configured)
- Future payment methods (automatically)

### Retry Mechanisms

Failed API calls are retried with exponential backoff:

```typescript
import { withPaymentRetry } from '@/lib/services/payment-error-handler';

const result = await withPaymentRetry(
  async () => await stripeService.createPaymentIntent(amount, currency),
  {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 5000,
  }
);
```

**Retry Logic:**
- Network errors: Retry up to 3 times
- Card errors: No retry (user must fix)
- API errors: Retry up to 2 times
- Rate limit errors: Exponential backoff

### Error Handling

Comprehensive error types with user-friendly messages:

```typescript
interface PaymentError {
  type: 'card_error' | 'validation_error' | 'api_error' | 'authentication_error' | 'rate_limit_error';
  code?: string;
  decline_code?: string;
  message: string;
}
```

**User-facing messages:**
- `insufficient_funds`: "Your card has insufficient funds."
- `card_declined`: "Your card was declined."
- `expired_card`: "Your card has expired."
- `incorrect_cvc`: "The CVC code is incorrect."
- `authentication_required`: "Additional authentication required."

---

## Webhook Handling

### Security

**All webhooks MUST verify signatures to prevent spoofing.**

```typescript
// Automatic signature verification
const event = stripe.webhooks.constructEvent(
  rawBody,
  signature,
  webhookSecret
);
```

**Replay attack prevention:**
- Event IDs tracked for 24 hours
- Duplicate events ignored
- Timestamp tolerance: 5 minutes

### Supported Events

#### Payment Events
- `payment_intent.succeeded` → Record transaction
- `payment_intent.payment_failed` → Notify user
- `payment_intent.requires_action` → 3DS required
- `payment_intent.canceled` → Clean up

#### Setup Events
- `setup_intent.succeeded` → Payment method saved
- `setup_intent.setup_failed` → Notify user

#### Charge Events
- `charge.refunded` → Update balance
- `charge.dispute.created` → Freeze funds & alert
- `charge.dispute.closed` → Resolve dispute

#### Connect Account Events
- `account.updated` → Update verification status
- `account.external_account.created` → Bank account added
- `account.external_account.deleted` → Bank account removed

#### Payout Events
- `payout.created` → Track payout
- `payout.paid` → Mark as complete
- `payout.failed` → Alert user

#### Transfer Events
- `transfer.created` → Record transfer
- `transfer.reversed` → Handle reversal

#### Fraud Detection Events
- `radar.early_fraud_warning.created` → Freeze & investigate
- `review.opened` → Hold pending review
- `review.closed` → Release or refund

### Webhook Configuration

**Set up webhooks in Stripe Dashboard:**

1. Go to Developers → Webhooks
2. Add endpoint: `https://yourdomain.com/payments/webhook`
3. Select events (or use "Select all events")
4. Copy webhook secret to `STRIPE_WEBHOOK_SECRET` env var

**Test webhooks locally:**
```bash
stripe listen --forward-to localhost:3000/payments/webhook
```

---

## Testing Guide

### Unit Tests

Test payment endpoints with mocked Stripe:

```bash
npm run test:unit
```

**Key test files:**
- `__tests__/unit/services/stripe-service.test.ts`
- `__tests__/integration/api/payment-endpoints.test.ts`

### Integration Tests

Test full payment flows:

```bash
npm run test:integration
```

**Test coverage:**
- ✅ Create payment intent
- ✅ Confirm payment
- ✅ Idempotency key handling
- ✅ Error scenarios
- ✅ Webhook processing

### E2E Tests

Test complete user flows:

```bash
npm run test:e2e
```

**Test scenarios:**
- User adds payment method
- User deposits funds
- User completes bounty payment
- Refund processing

### Test Cards

Use Stripe test cards for different scenarios:

```
Success: 4242 4242 4242 4242
Decline: 4000 0000 0000 0002
Insufficient funds: 4000 0000 0000 9995
3D Secure: 4000 0025 0000 3155
```

[Full test card list](https://stripe.com/docs/testing)

---

## Deployment Checklist

### Environment Variables

Required environment variables:

```bash
# Stripe API Keys
STRIPE_SECRET_KEY=sk_live_xxx          # Live secret key
STRIPE_PUBLISHABLE_KEY=pk_live_xxx    # Live publishable key
STRIPE_WEBHOOK_SECRET=whsec_xxx        # Webhook secret

# Frontend (must be prefixed EXPO_PUBLIC_)
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx

# Optional
EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID=merchant.com.bountyexpo
```

### Pre-launch Checklist

- [ ] **Stripe Account**: Live mode enabled
- [ ] **TLS Certificate**: Valid SSL certificate installed
- [ ] **CSP Headers**: Configured in server/CDN
- [ ] **Webhooks**: Endpoint configured and tested
- [ ] **Radar**: Enabled with rules configured
- [ ] **Test Payments**: Completed successful test payments
- [ ] **Error Handling**: Verified error scenarios
- [ ] **Monitoring**: Logging and alerting configured
- [ ] **Rate Limiting**: Implemented on endpoints
- [ ] **Backup**: Webhook retry strategy in place

### Security Verification

Run security checks before launch:

```typescript
import { validatePaymentSecurity } from '@/lib/security/payment-security-config';

const result = validatePaymentSecurity({
  protocol: req.protocol,
  amount: 100,
  userAgent: req.headers['user-agent'],
});

if (!result.valid) {
  console.error('Security issues:', result.errors);
}
```

### Monitoring & Alerts

**Set up monitoring for:**

1. **Failed payments** - Alert on >5% failure rate
2. **Webhook failures** - Alert on processing errors
3. **Fraud alerts** - Immediate alert on Radar warnings
4. **Negative balances** - Daily threshold checks
5. **API errors** - Track Stripe API error rates

**Recommended tools:**
- Stripe Dashboard for payment metrics
- Sentry for error tracking
- DataDog/CloudWatch for infrastructure
- PagerDuty for critical alerts

### Performance Optimization

- Use Stripe's automatic payment methods
- Implement caching for payment method lists
- Use webhooks instead of polling for status
- Batch database updates where possible
- Use CDN for Stripe.js script

---

## Architecture Separation

### Business Logic vs UI

**Good Practice:**
```typescript
// services/payment-service.ts - Business Logic
export class PaymentService {
  async createPayment(amount: number) {
    // Pure business logic, no UI concerns
    return await stripe.paymentIntents.create({ amount });
  }
}

// components/PaymentButton.tsx - UI Component
export function PaymentButton() {
  const [loading, setLoading] = useState(false);
  
  async function handlePayment() {
    setLoading(true);
    try {
      await paymentService.createPayment(100);
      showSuccess();
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(false);
    }
  }
  
  return <Button onPress={handlePayment} loading={loading} />;
}
```

**Project Structure:**
```
lib/
  services/
    stripe-service.ts          # Stripe API wrapper
    payment-error-handler.ts   # Error handling logic
  types/
    payment-types.ts           # TypeScript interfaces
  security/
    payment-security-config.ts # Security configuration

services/api/src/
  routes/
    payments.ts                # API endpoints
  services/
    stripe-connect-service.ts  # Connect logic
    wallet-service.ts          # Wallet logic

components/
  payment-element-wrapper.tsx  # UI components only
  payment-methods-modal.tsx    # UI components only
```

---

## Additional Resources

- [Stripe API Documentation](https://stripe.com/docs/api)
- [Stripe Integration Security Guide](https://stripe.com/docs/security/guide)
- [PCI Compliance Guide](https://stripe.com/docs/security#pci-dss-compliance)
- [Strong Customer Authentication](https://stripe.com/docs/strong-customer-authentication)
- [Stripe Radar Documentation](https://stripe.com/docs/radar)
- [Webhook Best Practices](https://stripe.com/docs/webhooks/best-practices)

---

## Support

For payment-related issues:

1. Check [Stripe Status Page](https://status.stripe.com/)
2. Review Stripe Dashboard logs
3. Check application logs for errors
4. Contact Stripe support if needed

**Internal contacts:**
- Engineering: dev@bountyexpo.com
- Finance: finance@bountyexpo.com
- Security: security@bountyexpo.com
