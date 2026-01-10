# Complete Payout System Documentation

## Overview

The BOUNTYExpo payout system enables users to withdraw their earnings to their bank accounts using Stripe Connect. The system provides a secure, reliable way to transfer funds with proper bank account management and verification.

## Architecture

### Components

1. **Stripe Connect Integration**
   - Express accounts for each user
   - External bank accounts for payouts
   - Automatic verification and onboarding

2. **Backend API** (`services/api/src`)
   - `consolidated-stripe-connect-service.ts` - Core Stripe Connect operations
   - `routes/wallet.ts` - Bank account and withdrawal endpoints

3. **Frontend** (`components/`)
   - `withdraw-with-bank-screen.tsx` - Enhanced withdrawal UI
   - `add-bank-account-modal.tsx` - Bank account addition flow

## Features

### Bank Account Management

#### Add Bank Account
Users can add multiple bank accounts to their Stripe Connect account:
- Account holder name
- 9-digit routing number (with validation)
- Account number
- Account type (checking/savings)

**Endpoint:** `POST /connect/bank-accounts`

```typescript
{
  accountHolderName: string;
  routingNumber: string;  // 9 digits
  accountNumber: string;   // 4-17 digits
  accountType: 'checking' | 'savings';
}
```

**Response:**
```typescript
{
  success: true;
  bankAccount: {
    id: string;
    accountHolderName: string;
    last4: string;
    bankName?: string;
    accountType: 'checking' | 'savings';
    status: string;
    default: boolean;
  }
}
```

#### List Bank Accounts
Retrieve all bank accounts for the authenticated user.

**Endpoint:** `GET /connect/bank-accounts`

**Response:**
```typescript
{
  bankAccounts: BankAccount[];
}
```

#### Remove Bank Account
Delete a bank account from the user's Connect account.

**Endpoint:** `DELETE /connect/bank-accounts/:bankAccountId`

**Response:**
```typescript
{
  success: true;
}
```

#### Set Default Bank Account
Mark a bank account as the default for payouts.

**Endpoint:** `POST /connect/bank-accounts/:bankAccountId/default`

**Response:**
```typescript
{
  success: true;
  bankAccount: BankAccount;
}
```

### Withdrawal Flow

#### 1. Prerequisites
- User must have a verified email address
- User must complete Stripe Connect onboarding
- User must have at least one bank account added
- User must have sufficient balance

#### 2. Initiate Withdrawal
**Endpoint:** `POST /connect/transfer`

```typescript
{
  amount: number;      // Dollar amount
  currency: 'usd';
}
```

**Response:**
```typescript
{
  success: true;
  transferId: string;
  transactionId: string;
  amount: number;
  newBalance: number;
  estimatedArrival: string;
  message: string;
}
```

#### 3. Transfer Processing
- Funds are immediately deducted from user's wallet balance
- Stripe transfer is created to user's Connect account
- Transfer typically arrives in 1-2 business days
- No fees for standard bank transfers

### Stripe Connect Onboarding

Users must complete Stripe Connect onboarding to receive payouts:

1. **Create Account Link**
   - `POST /connect/create-account-link`
   - Returns onboarding URL

2. **Verify Onboarding**
   - `POST /connect/verify-onboarding`
   - Checks if account is fully onboarded

3. **Account Status**
   - `GET /stripe/connect/status`
   - Returns detailed account status

## User Interface

### Withdraw Screen Features

1. **Balance Display**
   - Shows current available balance
   - Real-time updates

2. **Amount Selection**
   - Manual entry
   - Quick selection buttons (25%, 50%, 75%, Max)

3. **Bank Account Selection**
   - List of all added bank accounts
   - Visual indication of default account
   - Add/remove functionality
   - Account verification status

4. **Status Indicators**
   - Connect onboarding status
   - Email verification requirement
   - Bank account status

5. **Transaction History**
   - View past withdrawals
   - Transaction IDs for tracking
   - Estimated arrival dates

## Security Features

1. **Bank Account Tokenization**
   - No raw account numbers stored
   - Stripe handles all sensitive data
   - PCI compliance maintained

2. **Email Verification Gate**
   - Users must verify email before withdrawals
   - Prevents fraud and ensures communication

3. **Connect Account Verification**
   - Stripe verifies bank accounts
   - Micro-deposit verification (1-2 days)
   - Required information checks

4. **Transaction Logging**
   - All transfers logged
   - Audit trail maintained
   - Idempotency keys prevent duplicates

## Error Handling

### Common Errors

1. **No Connect Account**
   - Message: "Stripe Connect account required"
   - Action: Prompt user to complete onboarding

2. **No Bank Account**
   - Message: "Please add a bank account"
   - Action: Show add bank account modal

3. **Insufficient Balance**
   - Message: "Insufficient balance"
   - Action: Show current balance

4. **Email Not Verified**
   - Message: "Email verification required"
   - Action: Show verification banner

5. **Invalid Bank Details**
   - Message: "Invalid routing/account number"
   - Action: Show validation error

## Testing

### Test Bank Account Details

For Stripe test mode:
```
Routing Number: 110000000
Account Number: 000123456789
Account Holder: Any name
```

### Test Scenarios

1. **Add Bank Account**
   ```bash
   curl -X POST http://localhost:3000/connect/bank-accounts \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "accountHolderName": "John Doe",
       "routingNumber": "110000000",
       "accountNumber": "000123456789",
       "accountType": "checking"
     }'
   ```

2. **List Bank Accounts**
   ```bash
   curl http://localhost:3000/connect/bank-accounts \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

3. **Create Withdrawal**
   ```bash
   curl -X POST http://localhost:3000/connect/transfer \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 50.00,
       "currency": "usd"
     }'
   ```

## Environment Variables

Required configuration:

```env
# Stripe Keys (use test keys for development)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# Stripe Webhook (optional)
STRIPE_WEBHOOK_SECRET=whsec_...

# Supabase (for user/profile management)
EXPO_PUBLIC_SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...

# Platform Account (for fee collection)
PLATFORM_ACCOUNT_ID=00000000-0000-0000-0000-000000000000
```

## Database Schema

### profiles table
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_connect_onboarded_at TIMESTAMPTZ;
```

### wallet_transactions table
```sql
-- Already exists, used for tracking withdrawals
-- type = 'withdrawal' for payout transactions
```

## Best Practices

1. **Always Use Test Mode in Development**
   - Use Stripe test keys
   - Test bank account details
   - Monitor Stripe dashboard

2. **Handle Async Operations**
   - Bank verification takes 1-2 days
   - Transfers take 1-2 business days
   - Show clear expectations to users

3. **Validate Before Transfer**
   - Check email verification
   - Verify Connect onboarding
   - Ensure bank account exists
   - Validate sufficient balance

4. **Provide Clear Feedback**
   - Show transfer status
   - Display estimated arrival
   - Provide transaction IDs

5. **Error Recovery**
   - Retry failed transfers
   - Refund on failure
   - Log all errors

## Support and Troubleshooting

### Common Issues

1. **"Account not onboarded"**
   - User needs to complete Stripe onboarding
   - Check `stripe_connect_onboarded_at` field

2. **"Bank account not verified"**
   - Verification takes 1-2 business days
   - Check Stripe dashboard for status

3. **"Transfer failed"**
   - Check Stripe dashboard for details
   - Verify bank account is valid
   - Ensure sufficient balance

### Monitoring

Monitor these metrics:
- Successful withdrawal rate
- Average transfer time
- Failed transfer reasons
- Bank account addition rate
- Onboarding completion rate

## Future Enhancements

Potential improvements:
1. Instant payouts (fee-based)
2. Multiple currencies
3. International bank accounts
4. Debit card payouts
5. Automated payout schedules
6. Split payments
7. Tax document generation

## References

- [Stripe Connect Documentation](https://stripe.com/docs/connect)
- [Stripe Bank Accounts](https://stripe.com/docs/connect/bank-accounts)
- [Stripe Transfers](https://stripe.com/docs/connect/charges-transfers)
- [BOUNTYExpo Architecture](./ARCHITECTURE.md)
- [Wallet Implementation](./WALLET_IMPLEMENTATION_SUMMARY.md)
