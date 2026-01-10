# Complete Payout System Guide

## Overview

The BountyExpo payout system allows users to withdraw funds from their wallet to their bank accounts using Stripe Connect. This guide covers the complete implementation including bank account linking and withdrawal flows.

## Architecture

### Components

1. **Backend (services/api/src/routes/wallet.ts)**
   - Bank account linking endpoints
   - Withdrawal endpoints
   - Balance management

2. **Frontend (components/)**
   - `AddBankAccountModal.tsx` - UI for adding bank accounts
   - `WithdrawScreen.tsx` - Withdrawal interface

3. **Stripe Connect**
   - Express accounts for users
   - External bank accounts for payouts
   - Transfer API for withdrawals

## API Endpoints

### 1. POST /connect/bank-accounts

Add a bank account to the user's Stripe Connect account.

**Headers:**
```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "accountHolderName": "John Doe",
  "routingNumber": "110000000",
  "accountNumber": "000123456789",
  "accountType": "checking"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "bankAccount": {
    "id": "ba_1234...",
    "last4": "6789",
    "bankName": "STRIPE TEST BANK",
    "accountType": "checking",
    "verified": false
  }
}
```

**Error Responses:**
- `400` - Invalid routing number, account number, or missing fields
- `401` - Unauthorized
- `500` - Stripe error or server error

**Error: Requires Onboarding:**
```json
{
  "error": "Stripe Connect account required. Please complete onboarding first.",
  "requiresOnboarding": true
}
```

### 2. GET /connect/bank-accounts

List all bank accounts on the user's Connect account.

**Headers:**
```
Authorization: Bearer {access_token}
```

**Response (200 OK):**
```json
{
  "bankAccounts": [
    {
      "id": "ba_1234...",
      "last4": "6789",
      "bankName": "STRIPE TEST BANK",
      "accountType": "individual",
      "verified": true,
      "defaultForCurrency": true
    }
  ],
  "hasConnectAccount": true
}
```

**Response (No Connect Account):**
```json
{
  "bankAccounts": [],
  "hasConnectAccount": false
}
```

### 3. POST /connect/transfer

Initiate a withdrawal from wallet to bank account.

**Headers:**
```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "amount": 50.00,
  "currency": "usd"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "transferId": "tr_1234...",
  "transactionId": "txn_uuid...",
  "amount": 50.00,
  "newBalance": 150.00,
  "estimatedArrival": "1-2 business days",
  "message": "Transfer of $50.00 has been initiated."
}
```

**Error Responses:**
- `400` - Invalid amount, insufficient balance, or no bank account
- `401` - Unauthorized
- `500` - Transfer failed

### 4. POST /connect/verify-onboarding

Check if user has completed Stripe Connect onboarding.

**Headers:**
```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Response (200 OK):**
```json
{
  "onboarded": true,
  "accountId": "acct_1234...",
  "chargesEnabled": true,
  "payoutsEnabled": true,
  "requiresAction": false,
  "currentlyDue": []
}
```

### 5. POST /connect/create-account-link

Generate Stripe Connect onboarding link for new users.

**Headers:**
```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "returnUrl": "bountyexpo://wallet/connect/return",
  "refreshUrl": "bountyexpo://wallet/connect/refresh"
}
```

**Response (200 OK):**
```json
{
  "url": "https://connect.stripe.com/express/...",
  "expiresAt": 1704067200
}
```

## Implementation Flow

### User Journey: Adding Bank Account and Withdrawing

1. **User completes Stripe Connect onboarding** (if not done)
   - App calls `POST /connect/create-account-link`
   - Opens URL in browser
   - User completes Stripe form
   - Returns to app

2. **User adds bank account**
   - Opens `AddBankAccountModal`
   - Enters account details
   - Modal calls `POST /connect/bank-accounts`
   - Bank account is tokenized and added to Connect account
   - Never stores raw account numbers

3. **User initiates withdrawal**
   - Opens `WithdrawScreen`
   - Sees available balance
   - Selects amount to withdraw
   - App calls `POST /connect/transfer`
   - Stripe initiates ACH transfer
   - Wallet balance updated immediately
   - Funds arrive in 1-2 business days

### Security Considerations

1. **Bank Account Tokenization**
   - Raw account numbers never stored
   - Stripe tokens used for all operations
   - Only last 4 digits displayed to user

2. **Connect Account Isolation**
   - Each user has separate Stripe Connect account
   - Bank accounts tied to Connect accounts
   - Platform cannot access user funds

3. **Validation**
   - Routing number checksum validation
   - Account number length validation
   - Balance checks before transfer
   - Connect onboarding status checks

4. **Error Handling**
   - Specific error messages for user
   - Sensitive details not exposed
   - Proper HTTP status codes
   - Transaction rollback on failure

## Testing

### Test Bank Account Numbers

For testing in Stripe test mode, use these values:

**Routing Number:** `110000000` (Stripe test bank)

**Account Number:** `000123456789` (or any 4-17 digit number)

**Account Type:** `checking` or `savings`

### Testing Script

Run the automated test script:

```bash
cd services/api

# Set your test user token
export TEST_USER_TOKEN="eyJhb..."

# Run tests
npm run test:bank-accounts
# or
tsx src/test-bank-accounts.ts
```

### Manual Testing Steps

1. **Complete Connect Onboarding**
   ```bash
   curl -X POST http://localhost:3001/connect/create-account-link \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "returnUrl": "http://localhost:3000/return",
       "refreshUrl": "http://localhost:3000/refresh"
     }'
   ```

2. **Verify Onboarding Status**
   ```bash
   curl -X POST http://localhost:3001/connect/verify-onboarding \
     -H "Authorization: Bearer $TOKEN"
   ```

3. **Add Bank Account**
   ```bash
   curl -X POST http://localhost:3001/connect/bank-accounts \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "accountHolderName": "Test User",
       "routingNumber": "110000000",
       "accountNumber": "000123456789",
       "accountType": "checking"
     }'
   ```

4. **List Bank Accounts**
   ```bash
   curl -X GET http://localhost:3001/connect/bank-accounts \
     -H "Authorization: Bearer $TOKEN"
   ```

5. **Test Withdrawal**
   ```bash
   curl -X POST http://localhost:3001/connect/transfer \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 10.00,
       "currency": "usd"
     }'
   ```

## Stripe Connect Account Lifecycle

### Account Creation
- Created automatically on first onboarding attempt
- Type: Express account (simplified onboarding)
- Capabilities: transfers, card_payments

### Onboarding States
1. **Not Started** - User hasn't begun onboarding
2. **In Progress** - User clicked link but hasn't completed
3. **Details Submitted** - User completed form
4. **Payouts Enabled** - Account fully verified and ready

### Bank Account Verification
- **Instant Verification** - Some banks support instant verification
- **Micro-deposits** - 2 small deposits sent to account (1-2 business days)
- **Status Polling** - App should periodically check verification status

## UI Components

### AddBankAccountModal

**Props:**
```typescript
interface AddBankAccountModalProps {
  onBack: () => void;
  onSave?: (bankData: BankAccountData) => void;
  embedded?: boolean; // Inline vs overlay mode
}
```

**Features:**
- Routing number validation (9 digits + checksum)
- Account number confirmation
- Account type selection (checking/savings)
- Real-time error messages
- Secure input fields (secureTextEntry)

### WithdrawScreen

**Props:**
```typescript
interface WithdrawScreenProps {
  onBack?: () => void;
  balance?: number;
}
```

**Features:**
- Balance display with visual progress
- Amount input with validation
- Bank account status display
- Connect onboarding flow
- Payment method fallback
- Email verification check

## Error Handling

### Common Errors

1. **Invalid Routing Number**
   ```json
   {
     "error": "Invalid routing number"
   }
   ```
   - Check digit validation failed
   - Not 9 digits
   - Bank not recognized

2. **Requires Onboarding**
   ```json
   {
     "error": "Stripe Connect account required. Please complete onboarding first.",
     "requiresOnboarding": true
   }
   ```
   - User hasn't completed Connect onboarding
   - Frontend should prompt to start onboarding

3. **Insufficient Balance**
   ```json
   {
     "error": "Insufficient balance"
   }
   ```
   - Withdrawal amount exceeds wallet balance
   - Frontend should validate before submitting

4. **Transfer Failed**
   ```json
   {
     "error": "Failed to process Stripe transfer. Please contact support.",
     "transactionId": "txn_123"
   }
   ```
   - Stripe API error
   - Transaction recorded but transfer failed
   - Support team can investigate with transaction ID

## Monitoring & Logs

### Key Log Messages

```typescript
// Bank account added
console.log(`✅ Added external bank account to Connect account ${accountId}`);

// Transfer initiated
console.log(`✅ Created Stripe transfer ${transferId} for $${amount}`);

// Transfer error
console.error('Stripe transfer error:', error);
```

### Metrics to Track

1. **Onboarding Completion Rate**
   - Users who start vs complete onboarding
   - Drop-off points in flow

2. **Bank Account Addition Success Rate**
   - Successful vs failed additions
   - Common validation errors

3. **Withdrawal Success Rate**
   - Successful vs failed transfers
   - Average withdrawal amount
   - Time to complete

4. **Transfer Times**
   - From initiation to bank arrival
   - By bank and account type

## Troubleshooting

### Issue: Bank Account Not Appearing

**Symptoms:** User added bank but it doesn't show in list

**Solutions:**
1. Check if Connect onboarding completed
2. Verify account was added to correct Connect account
3. Check for Stripe API errors in logs
4. Refresh bank account list

### Issue: Withdrawal Fails

**Symptoms:** Transfer API returns error

**Solutions:**
1. Verify sufficient balance
2. Check bank account verification status
3. Ensure payouts enabled on Connect account
4. Check Stripe Dashboard for restrictions

### Issue: Micro-deposits Not Received

**Symptoms:** User waiting for verification deposits

**Solutions:**
1. Wait full 1-2 business days
2. Check if bank supports instant verification
3. Verify correct account number was entered
4. User should check with bank

## Production Checklist

Before going live:

- [ ] Test with real bank accounts in test mode
- [ ] Configure production Stripe keys
- [ ] Set up webhook endpoints
- [ ] Configure Connect platform settings
- [ ] Add monitoring and alerting
- [ ] Review Stripe terms of service
- [ ] Ensure KYC/AML compliance
- [ ] Test error scenarios
- [ ] Document support procedures
- [ ] Train support team

## References

- [Stripe Connect Documentation](https://stripe.com/docs/connect)
- [Stripe Connect Express Accounts](https://stripe.com/docs/connect/express-accounts)
- [Stripe External Accounts](https://stripe.com/docs/connect/bank-accounts)
- [Stripe Transfers](https://stripe.com/docs/connect/charges-transfers)
- [Stripe Testing](https://stripe.com/docs/testing)

## Support

For issues or questions:
- Check logs in `services/api/logs/`
- Review Stripe Dashboard for account status
- Contact: support@bountyexpo.com
