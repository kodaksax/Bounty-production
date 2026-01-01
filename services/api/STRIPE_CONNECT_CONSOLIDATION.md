# Stripe Connect Service Consolidation - Phase 3.2

## Overview

This document describes the consolidated Stripe Connect service created as part of Phase 3.2 of the backend consolidation project. The service unifies Stripe Connect functionality from `services/api/src/services/stripe-connect-service.ts` and `server/index.js` (lines 1012-1421) into a single, well-structured service.

## File Location

- **Service**: `services/api/src/services/consolidated-stripe-connect-service.ts`
- **Tests**: `services/api/src/test-consolidated-stripe-connect.ts`

## Purpose

The consolidated Stripe Connect service enables users to:
1. Create Stripe Express accounts
2. Complete onboarding with Stripe
3. Receive payouts/transfers to their bank accounts
4. Track transfer status and retry failed transfers

## Architecture

### Dependencies

The service integrates with:
- **Unified config**: `services/api/src/config/index.ts` (Stripe configuration)
- **Unified errors**: `services/api/src/middleware/error-handler.ts` (error handling)
- **Payment service**: `services/api/src/services/consolidated-payment-service.ts` (Stripe instance)
- **Wallet service**: `services/api/src/services/consolidated-wallet-service.ts` (balance operations)
- **Logger**: `services/api/src/services/logger.ts` (structured logging)

### Database Schema

Uses the `profiles` table with these Stripe Connect fields:
- `stripe_connect_account_id`: string (Stripe Connect account ID)
- `stripe_connect_onboarded_at`: timestamp (when onboarding completed)
- `balance`: number (user's wallet balance in USD)

## Functions

### 1. createConnectAccount(userId, email)

Creates a Stripe Express account for a user.

**Behavior**:
- Checks if user already has a Connect account
- If yes, returns existing `accountId`
- If no, creates new Stripe Express account with capabilities for `card_payments` and `transfers`
- Saves `stripe_connect_account_id` to profiles table
- Returns `accountId`

**Parameters**:
- `userId`: string - User ID
- `email`: string - User email address

**Returns**: `Promise<string>` - Stripe Connect account ID

**Errors**:
- `NotFoundError` - User not found
- `ExternalServiceError` - Supabase or Stripe error

### 2. createAccountLink(userId, returnUrl, refreshUrl)

Generates a Stripe AccountLink for onboarding.

**Behavior**:
- Gets user's Connect account ID
- Creates account if doesn't exist
- Generates Stripe AccountLink for onboarding flow
- Returns URL, accountId, and expiration timestamp

**Parameters**:
- `userId`: string - User ID
- `returnUrl`: string - URL to redirect after successful onboarding
- `refreshUrl`: string - URL to redirect if link expires

**Returns**: `Promise<AccountLinkResult>`
```typescript
{
  url: string;
  accountId: string;
  expiresAt: number;  // Unix timestamp
}
```

**Errors**:
- `NotFoundError` - User not found
- `ValidationError` - User email missing
- `ExternalServiceError` - Supabase or Stripe error

### 3. verifyOnboarding(userId)

Verifies that a user has completed Stripe Connect onboarding.

**Behavior**:
- Gets user's Connect account ID
- Queries Stripe for account details
- Checks `charges_enabled` and `payouts_enabled`
- If complete and not already marked, updates `stripe_connect_onboarded_at` timestamp
- Returns verification result

**Parameters**:
- `userId`: string - User ID

**Returns**: `Promise<OnboardingVerificationResult>`
```typescript
{
  onboarded: boolean;
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}
```

**Errors**:
- `NotFoundError` - User or Connect account not found
- `ExternalServiceError` - Supabase or Stripe error

### 4. createTransfer(userId, amount, currency?)

Creates a transfer from user's wallet to their Stripe Connect account.

**Behavior**:
1. Verifies user has Connect account and is onboarded
2. Checks user has sufficient wallet balance
3. Creates wallet withdrawal transaction (deducts balance)
4. Creates Stripe transfer to Connect account
5. Returns transfer details with estimated arrival

**Parameters**:
- `userId`: string - User ID
- `amount`: number - Amount in USD
- `currency`: string - Currency code (default: 'usd')

**Returns**: `Promise<TransferResult>`
```typescript
{
  transferId: string;
  status: string;
  amount: number;
  estimatedArrival: string;  // ISO 8601 timestamp
}
```

**Errors**:
- `ValidationError` - Invalid amount, not onboarded, or insufficient balance
- `NotFoundError` - User not found
- `ExternalServiceError` - Stripe transfer error

**Transfer Workflow**:
1. User requests withdrawal from wallet
2. Verify Connect account onboarded
3. Verify sufficient balance (via wallet service atomic check)
4. Create wallet withdrawal transaction (deduct balance atomically)
5. Create Stripe transfer
6. On success → mark transaction 'pending' (transfer initiated; actual settlement pending)
7. On failure → refund wallet balance, mark transaction 'failed', allow retry
8. Webhooks (Phase 3.3) will update status to 'completed' when transfer settles

**Note**: The 'pending' status indicates the transfer request was successfully submitted to Stripe, not that funds have arrived. Actual transfer completion is tracked via Stripe webhooks.

### 5. retryTransfer(transactionId, userId)

Retries a failed transfer.

**Behavior**:
1. Gets failed transaction from wallet_transactions
2. Verifies transaction belongs to user and status is 'failed'
3. Checks retry count (max 3 retries)
4. Verifies user has sufficient balance (was refunded on failure)
5. Deducts balance again atomically
6. Creates new Stripe transfer
7. Updates transaction with new transfer ID and incremented retry count

**Parameters**:
- `transactionId`: string - Wallet transaction ID
- `userId`: string - User ID

**Returns**: `Promise<TransferResult>`

**Errors**:
- `NotFoundError` - Transaction not found
- `ValidationError` - Not authorized, not failed status, max retries reached, or insufficient balance
- `ExternalServiceError` - Stripe transfer error

**Retry Logic**:
- Maximum 3 retry attempts
- On retry failure, balance is refunded again
- Each retry increments metadata.retry_count
- Previous transfer ID stored in metadata.previous_transfer_id

### 6. getAccountStatus(userId)

Gets detailed account status from Stripe.

**Behavior**:
- Gets Connect account ID from profiles
- Queries Stripe for account details
- Returns account status and capabilities

**Parameters**:
- `userId`: string - User ID

**Returns**: `Promise<AccountStatusResult>`
```typescript
{
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requiresAction: boolean;
  currentlyDue?: string[];  // List of required information
}
```

**Errors**:
- `NotFoundError` - User or Connect account not found
- `ExternalServiceError` - Supabase or Stripe error

## Error Handling

All functions use the unified error handling system from `error-handler.ts`:

- **Account not found**: `NotFoundError('Stripe Connect account')`
- **Not onboarded**: `ValidationError('Complete Stripe Connect onboarding first')`
- **Insufficient balance**: `ValidationError('Insufficient wallet balance')`
- **Max retries reached**: `ValidationError('Maximum retry attempts reached')`
- **Stripe errors**: Handled via `handleStripeError()` which converts Stripe errors to appropriate AppError types

## Integration Points

### With Wallet Service

The Stripe Connect service integrates with the wallet service for:
- **Balance checks**: Via atomic balance validation during withdrawal
- **Transaction creation**: Via `createWithdrawal(userId, amount, destination)`
- **Balance updates**: Via `updateBalance(userId, amount)` for retry rollbacks

The wallet service handles:
- Atomic balance deductions
- Transaction record creation
- Stripe transfer initiation
- Failure handling and refunds

### With Payment Service

Uses the shared `stripe` instance from consolidated-payment-service.ts for:
- Creating Express accounts
- Creating account links
- Retrieving account details
- Creating transfers

### Stripe API Calls

```typescript
// Create Express account
const account = await stripe.accounts.create({
  type: 'express',
  email: email,
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
  business_type: 'individual',
  metadata: { user_id: userId }
});

// Create account link
const accountLink = await stripe.accountLinks.create({
  account: accountId,
  refresh_url: refreshUrl,
  return_url: returnUrl,
  type: 'account_onboarding',
});

// Retrieve account
const account = await stripe.accounts.retrieve(accountId);

// Create transfer (via wallet service)
const transfer = await stripe.transfers.create({
  amount: Math.round(amount * 100), // Convert to cents
  currency: currency,
  destination: accountId,
  metadata: { user_id: userId, transaction_id: transactionId }
});
```

## Testing

### Test File

`services/api/src/test-consolidated-stripe-connect.ts` provides comprehensive tests:

1. **Create Connect Account** - Creates account for test user
2. **Create Account Link** - Generates onboarding link
3. **Get Account Status** - Retrieves account details
4. **Verify Onboarding** - Checks onboarding status
5. **Transfer Without Onboarding** - Expects failure
6. **Transfer With Insufficient Balance** - Expects failure
7. **Create Account Again** - Should return existing account
8. **Retry Non-Existent Transaction** - Expects failure

### Running Tests

```bash
# From services/api directory
npm install
npx tsx src/test-consolidated-stripe-connect.ts
```

**Note**: Tests require environment variables to be set:
- `EXPO_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`

### Test Expectations

In development/test environments:
- Account creation succeeds
- Link generation succeeds
- Account status retrieval succeeds
- Onboarding verification shows not onboarded (expected without manual Stripe dashboard onboarding)
- Transfer attempts fail without onboarding (expected)
- Existing account returns same ID

For full end-to-end testing, manual onboarding via Stripe dashboard is required.

## Usage Example

```typescript
import {
  createConnectAccount,
  createAccountLink,
  verifyOnboarding,
  createTransfer,
  retryTransfer,
  getAccountStatus,
} from './services/consolidated-stripe-connect-service';

// 1. Create Connect account for user
const accountId = await createConnectAccount(userId, userEmail);

// 2. Generate onboarding link
const link = await createAccountLink(
  userId,
  'https://myapp.com/onboarding/return',
  'https://myapp.com/onboarding/refresh'
);
// Redirect user to link.url

// 3. Verify onboarding completion (after user returns)
const verification = await verifyOnboarding(userId);
if (verification.onboarded) {
  console.log('User is fully onboarded!');
}

// 4. Create transfer to user's bank account
try {
  const transfer = await createTransfer(userId, 100.00);
  console.log(`Transfer ${transfer.transferId} created`);
  console.log(`Estimated arrival: ${transfer.estimatedArrival}`);
} catch (error) {
  if (error.message.includes('Insufficient balance')) {
    console.log('User needs to add funds');
  }
}

// 5. Retry failed transfer
const retryResult = await retryTransfer(transactionId, userId);

// 6. Get account status
const status = await getAccountStatus(userId);
if (status.requiresAction) {
  console.log('User needs to complete:', status.currentlyDue);
}
```

## Webhook Handling

Stripe Connect webhooks should be handled in Phase 3.3. The following events are important:

- `transfer.created` - Transfer initiated
- `transfer.paid` - Transfer completed successfully
- `transfer.failed` - Transfer failed, trigger refund
- `account.updated` - Account onboarding status changed

## Migration from Old Services

### From `services/api/src/services/stripe-connect-service.ts`

Old methods → New methods:
- `createOnboardingLink()` → `createAccountLink()`
- `getConnectStatus()` → Combined functionality in `verifyOnboarding()` and `getAccountStatus()`

### From `server/index.js`

Old endpoints → New service functions:
- `POST /connect/create-account-link` → `createAccountLink()`
- `POST /connect/verify-onboarding` → `verifyOnboarding()`
- `POST /connect/transfer` → `createTransfer()`

## Security Considerations

1. **Authentication**: All functions expect authenticated userId
2. **Authorization**: Functions verify user owns the account/transaction
3. **Balance validation**: Atomic balance checks prevent overdrafts
4. **Retry limits**: Maximum 3 retries prevent infinite loops
5. **Metadata**: User ID and transaction ID included in all Stripe operations for audit trail

## Logging

All operations are logged with structured logging via Pino:

```typescript
logger.info({
  userId,
  accountId,
  amount,
  transactionId,
}, '[StripeConnect] Transfer created successfully');

logger.error({
  userId,
  error: errorMessage,
}, '[StripeConnect] Transfer failed');
```

## Next Steps (Phase 3.3)

1. Implement webhook handlers for Stripe Connect events
2. Update API routes to use consolidated service
3. Add monitoring and alerting for failed transfers
4. Implement dashboard for viewing transfer status
5. Add support for bulk transfers
6. Implement automatic retry with exponential backoff

## Maintenance Notes

- Stripe API version: Uses version from consolidated-payment-service
- Transfer timing: Transfers typically arrive in 1-2 business days
- Testing: Stripe test mode accounts require manual onboarding even in test
- Rate limits: Stripe has rate limits on account creation and transfers

## References

- [Stripe Connect Express Documentation](https://stripe.com/docs/connect/express-accounts)
- [Stripe Transfers API](https://stripe.com/docs/api/transfers)
- [Stripe Account Links](https://stripe.com/docs/api/account_links)
- Phase 3.1: Consolidated Wallet Service
- Phase 3.3: Webhook Handlers (upcoming)
