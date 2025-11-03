# Stripe Integration Backend Guide

This guide describes the Stripe backend integration for BountyExpo, including payment processing, webhook handling, and Connect integration for withdrawals.

## Architecture Overview

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────┐
│  Mobile App     │         │  Express Server  │         │   Stripe    │
│  (React Native) │────────▶│  (server/)       │────────▶│   API       │
└─────────────────┘         └──────────────────┘         └─────────────┘
        │                            │                            │
        │                            │                            │
        └────────────────────────────┴────────────────────────────┘
                         Webhook Events
```

## Components

### 1. Backend Server (`server/`)

Minimal Express.js server handling:
- Payment Intent creation for deposits
- Webhook event processing
- Stripe Connect scaffolding for withdrawals
- Transaction logging (demo mode)

**Key Files**:
- `server/index.js`: Main server with all endpoints
- `server/package.json`: Dependencies
- `server/.env.example`: Configuration template
- `server/wallet-transactions.json`: Local transaction storage (demo)

### 2. Frontend Integration

React Native components updated to communicate with backend:
- `components/add-money-screen.tsx`: Calls `/payments/create-payment-intent`
- `components/withdraw-screen.tsx`: Calls Connect endpoints
- `lib/stripe-context.tsx`: Stripe SDK integration
- `lib/services/stripe-service.ts`: Payment processing utilities

## Setup Instructions

### Prerequisites

1. **Node.js** 16+ installed
2. **Stripe Account** with test mode keys
3. **Stripe CLI** (optional, for local webhook testing)

### Backend Setup

1. **Navigate to server directory**:
   ```bash
   cd server
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` file** with your Stripe credentials:
   ```bash
   STRIPE_SECRET_KEY=sk_test_your_key_here
   STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
   PORT=3001
   ```

   Get your keys from:
   - API Keys: https://dashboard.stripe.com/apikeys
   - Webhook Secret: (see Webhook Setup below)

5. **Start the server**:
   ```bash
   npm start
   ```

   Server will run on `http://localhost:3001`

### Frontend Setup

1. **Configure API URL** in root `.env`:
   ```bash
   EXPO_PUBLIC_API_URL=http://localhost:3001
   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
   ```

2. **Start the mobile app**:
   ```bash
   npm start
   ```

## API Endpoints

### POST /payments/create-payment-intent

Creates a Stripe PaymentIntent for adding money to wallet.

**Request**:
```json
{
  "amountCents": 5000,
  "currency": "usd",
  "metadata": {
    "userId": "user_123",
    "purpose": "wallet_deposit"
  }
}
```

**Response**:
```json
{
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx"
}
```

**Usage in Frontend**:
```typescript
// add-money-screen.tsx
const response = await fetch(`${API_BASE_URL}/payments/create-payment-intent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amountCents: amount * 100,
    currency: 'usd',
    metadata: { userId, purpose: 'wallet_deposit' }
  })
});
const { clientSecret } = await response.json();
// Use clientSecret with Stripe SDK to confirm payment
```

### POST /webhooks/stripe

Receives and processes Stripe webhook events with signature verification.

**Handled Events**:
- `payment_intent.succeeded`: Confirms successful payment and logs transaction
- `charge.refunded`: Logs refund transaction

**Security**: Verifies webhook signature using `STRIPE_WEBHOOK_SECRET`

**Transaction Storage**: Logs events to `wallet-transactions.json` (demo only)

### POST /connect/create-account-link

Scaffold endpoint for initiating Stripe Connect onboarding.

**Request**:
```json
{
  "userId": "user_123",
  "email": "user@example.com"
}
```

**Response** (Mock):
```json
{
  "url": "https://connect.stripe.com/setup/c/...",
  "accountId": "acct_xxx",
  "expiresAt": 1234567890000
}
```

**TODO for Production**:
- Create actual Stripe Connect account
- Generate real account link
- Store account ID in database
- Handle onboarding completion

### POST /connect/transfer

Scaffold endpoint for initiating transfers to connected accounts (withdrawals).

**Request**:
```json
{
  "accountId": "acct_xxx",
  "amount": 5000,
  "currency": "usd",
  "metadata": {}
}
```

**Response** (Mock):
```json
{
  "transferId": "tr_xxx",
  "status": "pending",
  "amount": 5000,
  "estimatedArrival": "2024-01-04T00:00:00.000Z"
}
```

**TODO for Production**:
- Verify connected account status
- Create actual Stripe transfer
- Update database with transfer status
- Handle transfer events via webhooks

## Webhook Configuration

### Local Development

Use Stripe CLI for local webhook testing:

1. **Install Stripe CLI**: https://stripe.com/docs/stripe-cli

2. **Login**:
   ```bash
   stripe login
   ```

3. **Forward webhooks**:
   ```bash
   stripe listen --forward-to localhost:3001/webhooks/stripe
   ```

4. **Copy webhook secret** from CLI output to `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```

5. **Test webhook**:
   ```bash
   stripe trigger payment_intent.succeeded
   ```

### Production

1. Go to https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. Enter your server URL: `https://yourdomain.com/webhooks/stripe`
4. Select events:
   - `payment_intent.succeeded`
   - `charge.refunded`
   - `account.updated` (for Connect)
   - `transfer.created`, `transfer.paid` (for Connect)
5. Copy signing secret to production `.env`

## Payment Flow

### Adding Money Flow

```
1. User enters amount in AddMoneyScreen
2. App calls POST /payments/create-payment-intent
3. Server creates PaymentIntent with Stripe
4. Server returns clientSecret to app
5. App uses Stripe SDK to confirm payment with payment method
6. Stripe processes payment
7. Stripe sends webhook event to server
8. Server logs transaction and updates wallet balance
9. App updates UI to reflect new balance
```

### Withdrawal Flow (Scaffold)

```
1. User initiates withdrawal in WithdrawScreen
2. App checks if user has connected account
3. If not, app calls POST /connect/create-account-link
4. User completes Connect onboarding
5. App calls POST /connect/transfer with amount
6. Server initiates transfer to connected account
7. Stripe processes transfer (1-3 business days)
8. User receives funds in bank account
```

## Security Best Practices

⚠️ **Current Implementation is a Minimal Demo**

For production deployment:

### Required Security Measures

1. **HTTPS Only**: Never use HTTP in production
2. **Authentication**: Implement JWT or session-based auth
3. **Rate Limiting**: Prevent abuse of API endpoints
4. **Input Validation**: Validate all request parameters
5. **Database**: Replace JSON file with proper database
6. **Error Handling**: Don't expose internal errors to clients
7. **Logging**: Implement structured logging and monitoring
8. **Secret Management**: Use secure secret storage (not .env in production)

### Stripe-Specific Security

1. **Webhook Signature**: Always verify webhook signatures
2. **Idempotency**: Use idempotency keys for payment operations
3. **Amount Validation**: Validate amounts match expected values
4. **Connected Accounts**: Verify account ownership before transfers
5. **PCI Compliance**: Never handle raw card data server-side

## Deployment Considerations

### Environment Variables

Set these in your production environment:
```bash
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://yourdomain.com
```

### Database Migration

Replace `wallet-transactions.json` with:
- PostgreSQL, MySQL, or MongoDB
- Proper schema with indexes
- Transaction logs table
- User account linking table

### Monitoring

Implement:
- Application performance monitoring (APM)
- Error tracking (Sentry, Rollbar, etc.)
- Webhook event logging
- Failed payment alerts
- Transfer status tracking

## Testing

### Unit Tests

```bash
# TODO: Add Jest/Mocha tests for:
# - Payment intent creation
# - Webhook signature verification
# - Connect account linking
# - Transfer validation
```

### Integration Tests

Use Stripe's test mode:
- Test cards: https://stripe.com/docs/testing
- Test webhooks with Stripe CLI
- Test Connect onboarding flow

### Test Cards

```
Success: 4242 4242 4242 4242
Decline: 4000 0000 0000 0002
3D Secure: 4000 0025 0000 3155
```

## Troubleshooting

### Common Issues

**"Webhook signature verification failed"**
- Ensure `STRIPE_WEBHOOK_SECRET` is correct
- Use raw body parser for webhook endpoint
- Check Stripe CLI is forwarding to correct port

**"Failed to create payment intent"**
- Verify `STRIPE_SECRET_KEY` is valid and active
- Check Stripe account is not restricted
- Ensure amount is positive integer in cents

**"CORS error when calling API"**
- Add app origin to `ALLOWED_ORIGINS` in `.env`
- Check server is running and accessible
- Verify URL in `EXPO_PUBLIC_API_URL`

### Debug Mode

Enable verbose logging:
```bash
NODE_ENV=development npm start
```

## Next Steps

### Immediate

1. ✅ Set up `.env` with Stripe keys
2. ✅ Start backend server
3. ✅ Configure webhook endpoint
4. ✅ Test payment flow

### Short-term

1. Implement user authentication
2. Add database for transaction storage
3. Complete Stripe Connect integration
4. Add error monitoring

### Long-term

1. Implement recurring payments
2. Add subscription support
3. Multi-currency support
4. Advanced fraud prevention
5. Dispute handling automation

## Resources

- **Stripe API Docs**: https://stripe.com/docs/api
- **Stripe Connect**: https://stripe.com/docs/connect
- **Webhooks**: https://stripe.com/docs/webhooks
- **Testing**: https://stripe.com/docs/testing
- **Security**: https://stripe.com/docs/security

## Support

For issues or questions:
1. Check Stripe Dashboard logs
2. Review webhook event history
3. Test with Stripe CLI
4. Consult Stripe documentation

## License

MIT
