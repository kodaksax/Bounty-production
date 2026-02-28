# Supabase + Stripe Integration Guide

This guide explains the complete integration between Supabase (database & authentication) and Stripe (payments) for the BountyExpo payment system.

## Overview

The payment system now uses:
- **Supabase PostgreSQL** for persistent storage (replacing JSON files)
- **Supabase Auth** for user authentication (UUID-based user IDs)
- **Stripe PaymentIntents** for deposits
- **Stripe Connect** for withdrawals to bank accounts
- **Stripe Webhooks** for payment event processing

## Database Schema

### Migration: `supabase/migrations/20251102_stripe_payments_integration.sql`

This migration adds Stripe payment support to the existing schema:

#### New Columns on `wallet_transactions`:
```sql
stripe_payment_intent_id    text      -- Links to Stripe PaymentIntent
stripe_charge_id            text      -- Links to Stripe Charge
stripe_transfer_id          text      -- Links to Stripe Transfer
stripe_connect_account_id   text      -- Recipient's Connect account
metadata                    jsonb     -- Additional payment metadata
```

#### New Columns on `profiles`:
```sql
stripe_connect_account_id     text         -- User's Connect account ID
stripe_customer_id            text         -- User's Stripe Customer ID
stripe_connect_onboarded_at   timestamptz  -- When Connect onboarding completed
```

#### New Table: `payment_methods`
```sql
CREATE TABLE payment_methods (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES profiles(id),
    stripe_payment_method_id text UNIQUE,
    type text,  -- 'card', 'bank_account', etc.
    card_brand text,
    card_last4 text,
    card_exp_month integer,
    card_exp_year integer,
    is_default boolean,
    created_at timestamptz,
    updated_at timestamptz
);
```

#### New Table: `stripe_events`
```sql
CREATE TABLE stripe_events (
    id uuid PRIMARY KEY,
    stripe_event_id text UNIQUE,  -- For idempotency
    event_type text,
    processed boolean,
    processed_at timestamptz,
    event_data jsonb,
    created_at timestamptz
);
```

## Backend Implementation

### Authentication

All payment endpoints now require authentication via Supabase JWT:

```javascript
// Middleware extracts user from JWT token
async function authenticateUser(req, res, next) {
  const token = req.headers.authorization?.substring(7); // Remove 'Bearer '
  const { data: { user } } = await supabase.auth.getUser(token);
  req.user = user;  // User ID is user.id (UUID)
  next();
}
```

### Endpoints

#### POST `/payments/create-payment-intent`
- **Auth**: Required
- **Rate Limit**: 10 requests per 15 minutes
- **Purpose**: Creates a Stripe PaymentIntent for wallet deposits

**Request**:
```json
{
  "amountCents": 5000,
  "currency": "usd",
  "metadata": {
    "purpose": "wallet_deposit"
  }
}
```

**Headers**:
```
Authorization: Bearer <supabase_jwt_token>
Content-Type: application/json
```

**Process**:
1. Validates user authentication
2. Gets or creates Stripe Customer for user
3. Creates PaymentIntent with user metadata
4. Returns clientSecret for frontend confirmation

#### POST `/webhooks/stripe`
- **Auth**: Webhook signature verification
- **Purpose**: Processes Stripe payment events

**Supported Events**:
- `payment_intent.succeeded`: Creates deposit transaction, updates balance
- `charge.refunded`: Creates refund transaction, decreases balance

**Idempotency**: Uses `stripe_events` table to prevent duplicate processing

#### POST `/connect/create-account-link`
- **Auth**: Required
- **Rate Limit**: 100 requests per 15 minutes
- **Purpose**: Creates/retrieves Stripe Connect account and generates onboarding link

**Request**:
```json
{
  "returnUrl": "bountyexpo://wallet/connect/return",
  "refreshUrl": "bountyexpo://wallet/connect/refresh"
}
```

**Process**:
1. Checks if user has existing Connect account
2. Creates Express Connect account if needed
3. Generates account onboarding link
4. Saves account ID to user profile

#### POST `/connect/verify-onboarding`
- **Auth**: Required
- **Purpose**: Checks if user's Connect account is fully onboarded

**Response**:
```json
{
  "onboarded": true,
  "accountId": "acct_xxx",
  "chargesEnabled": true,
  "payoutsEnabled": true,
  "detailsSubmitted": true
}
```

#### POST `/connect/transfer`
- **Auth**: Required
- **Rate Limit**: 10 requests per 15 minutes
- **Purpose**: Initiates withdrawal to user's connected bank account

**Request**:
```json
{
  "amount": 50.00,
  "currency": "usd"
}
```

**Process**:
1. Validates user balance
2. Verifies Connect account is onboarded
3. Creates Stripe Transfer to connected account
4. Creates withdrawal transaction in database
5. Updates user balance

### Rate Limiting

Two rate limiters implemented:
- **General API**: 100 requests per 15 minutes
- **Payment Operations**: 10 requests per 15 minutes

### Logging

All requests are logged with:
- Timestamp
- HTTP method and path
- Status code
- Response time in milliseconds

Example:
```
[2025-11-02T10:15:30.123Z] POST /payments/create-payment-intent 200 456ms
```

## Frontend Integration

### Authentication Token

Components now use Supabase session for authentication:

```typescript
import { useAuthContext } from '../hooks/use-auth-context';
import { supabase } from '../lib/supabase';

const { session } = useAuthContext();

// Include token in API calls
const response = await fetch(`${API_BASE_URL}/payments/create-payment-intent`, {
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json'
  },
  ...
});
```

### Updated Components

#### `add-money-screen.tsx`
- Uses `session.access_token` for backend authentication
- Calls `/payments/create-payment-intent` with auth header
- Webhook handles balance update automatically

#### `withdraw-screen.tsx`
- Checks Connect onboarding status on mount
- Creates Connect account and opens onboarding flow
- Verifies onboarding completion
- Initiates transfers with authentication

## Setup Instructions

### 1. Run Database Migration

```bash
# Using Supabase CLI
supabase db push

# Or execute directly in SQL Editor
psql $DATABASE_URL < supabase/migrations/20251102_stripe_payments_integration.sql
```

### 2. Configure Server Environment

Update `server/.env`:

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_secret

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Server
PORT=3001
NODE_ENV=development
APP_URL=http://localhost:8081
```

### 3. Install Dependencies

```bash
cd server
npm install
```

New dependencies:
- `@supabase/supabase-js`: ^2.38.5
- `express-rate-limit`: ^7.1.5

### 4. Start Server

```bash
cd server
npm start
```

### 5. Configure Stripe Webhook

#### Local Development (Stripe CLI):
```bash
stripe listen --forward-to localhost:3001/webhooks/stripe
# Copy webhook secret to server/.env
```

#### Production:
1. Go to https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://yourdomain.com/webhooks/stripe`
3. Select events: `payment_intent.succeeded`, `charge.refunded`
4. Copy signing secret to production `.env`

## Testing

### Test Authentication

```bash
# Get Supabase JWT token
curl -X POST https://your-project.supabase.co/auth/v1/token \
  -H "apikey: your_anon_key" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Use token in requests
TOKEN="your_jwt_token"
curl -X POST http://localhost:3001/payments/create-payment-intent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amountCents":5000}'
```

### Test Payment Flow

1. Create PaymentIntent via authenticated endpoint
2. Use test card: `4242 4242 4242 4242`
3. Webhook processes `payment_intent.succeeded`
4. Check database:
   ```sql
   SELECT * FROM wallet_transactions WHERE user_id = 'your_user_uuid';
   SELECT balance FROM profiles WHERE id = 'your_user_uuid';
   ```

### Test Connect Flow

1. Call `/connect/create-account-link`
2. Complete onboarding in Stripe dashboard
3. Verify with `/connect/verify-onboarding`
4. Test withdrawal via `/connect/transfer`
5. Check Stripe Dashboard for transfer

## Security Features

### ✅ Implemented

1. **Authentication**: All payment endpoints require valid Supabase JWT
2. **Rate Limiting**: Payment operations limited to 10/15min
3. **Webhook Verification**: Signature validation with Stripe secret
4. **Idempotency**: Prevents duplicate webhook processing
5. **RLS Policies**: Database-level access control
6. **Input Validation**: Amount, currency, and account ID validation
7. **Error Handling**: Sanitized error messages, no internal exposure
8. **Logging**: Comprehensive request/response logging

### 🔒 Production Requirements

1. **HTTPS Only**: Use SSL certificates (Let's Encrypt, CloudFlare)
2. **Environment Secrets**: Use secure secret management (AWS Secrets Manager)
3. **Database Backups**: Automated daily backups
4. **Monitoring**: Set up error tracking (Sentry) and metrics (DataDog)
5. **Audit Logging**: Log all financial transactions
6. **2FA**: Require two-factor auth for withdrawals
7. **Fraud Detection**: Implement transaction limits and monitoring

## Helper Functions

The migration includes SQL helper functions:

### `get_default_payment_method(user_id)`
Returns user's default payment method:
```sql
SELECT * FROM get_default_payment_method('user-uuid');
```

### `has_stripe_connect(user_id)`
Checks if user has completed Connect onboarding:
```sql
SELECT has_stripe_connect('user-uuid');
```

## Troubleshooting

### "Authentication failed"
- Verify JWT token is valid and not expired
- Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in server/.env
- Ensure user exists in Supabase auth

### "Webhook signature verification failed"
- Verify `STRIPE_WEBHOOK_SECRET` matches webhook endpoint
- For local dev, use Stripe CLI forwarding
- Check request body isn't being parsed before verification

### "Failed to create account link"
- Verify Stripe account has Connect enabled
- Check user has email in profile
- Ensure return/refresh URLs are properly formatted

### Balance not updating
- Check webhook is being called (Stripe Dashboard → Developers → Webhooks)
- Verify event is being processed (check `stripe_events` table)
- Check server logs for errors

## Row Level Security (RLS)

The `payment_methods` table has RLS enabled:

```sql
-- Users can only view their own payment methods
CREATE POLICY payment_methods_select_own ON payment_methods
    FOR SELECT USING (auth.uid() = user_id);

-- Users can only insert their own payment methods
CREATE POLICY payment_methods_insert_own ON payment_methods
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own payment methods
CREATE POLICY payment_methods_update_own ON payment_methods
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own payment methods
CREATE POLICY payment_methods_delete_own ON payment_methods
    FOR DELETE USING (auth.uid() = user_id);
```

The `stripe_events` table has RLS enabled but no user policies (backend/webhook only).

## Migration from JSON Storage

Old JSON file approach:
```javascript
// ❌ Old way - file-based
const transactions = readTransactions();
transactions.push({...});
writeTransactions(transactions);
```

New Supabase approach:
```javascript
// ✅ New way - database
const { data, error } = await supabase
  .from('wallet_transactions')
  .insert({
    user_id: userId,
    type: 'deposit',
    amount: amount,
    stripe_payment_intent_id: paymentIntent.id
  });
```

Benefits:
- ✅ Multi-user support with proper isolation
- ✅ ACID transactions
- ✅ Concurrent access handling
- ✅ Automatic backups
- ✅ Query capabilities
- ✅ Row-level security

## Performance Considerations

1. **Indexes**: Added on all foreign keys and Stripe IDs
2. **Connection Pooling**: Supabase handles automatically
3. **Rate Limiting**: Prevents abuse and reduces load
4. **Webhook Idempotency**: Prevents duplicate processing
5. **Async Operations**: Webhooks process asynchronously

## Monitoring Queries

```sql
-- Recent transactions
SELECT * FROM wallet_transactions 
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- User balances
SELECT id, username, balance, stripe_connect_onboarded_at
FROM profiles
WHERE balance > 0
ORDER BY balance DESC;

-- Pending transactions
SELECT * FROM wallet_transactions
WHERE status = 'pending'
ORDER BY created_at DESC;

-- Webhook events
SELECT event_type, processed, created_at
FROM stripe_events
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- Failed webhooks
SELECT * FROM stripe_events
WHERE processed = false
AND created_at < NOW() - INTERVAL '1 hour';
```

## Next Steps

1. ✅ Implement frontend Stripe SDK integration for confirmPayment
2. ✅ Add transaction history UI with Supabase data
3. ✅ Implement refund handling in UI
4. ✅ Add Connect dashboard link in app
5. ✅ Set up production webhooks
6. ✅ Configure production Stripe account
7. ✅ Enable live mode after testing

## References

- [Stripe API Docs](https://stripe.com/docs/api)
- [Stripe Connect](https://stripe.com/docs/connect)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase Database](https://supabase.com/docs/guides/database)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
