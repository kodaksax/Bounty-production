# Payment Testing Guide

This document provides comprehensive instructions for testing the deposit and withdrawal flows in the BountyExpo application.

## Overview

The BountyExpo payment system consists of:
- **Wallet Context**: Manages balance and transaction history
- **Deposit Flow**: Add funds via Stripe or Apple Pay
- **Withdrawal Flow**: Transfer funds to connected bank account
- **Escrow System**: Hold funds for bounty completion

## Prerequisites

Before testing, ensure you have:

1. **Backend Server Running**
   ```bash
   npm run payments:server
   # or
   npm run dev:serve
   ```

2. **Environment Variables Configured**
   ```env
   EXPO_PUBLIC_API_BASE_URL=http://localhost:3001
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```

3. **Stripe Test Mode**
   - Use Stripe test keys (prefixed with `sk_test_` and `pk_test_`)
   - Test cards available at: https://stripe.com/docs/testing

## Testing Deposit Flow

### Step 1: Navigate to Wallet
1. Open the app
2. Tap on the wallet icon in the bottom navigation
3. Verify the current balance is displayed

### Step 2: Add Payment Method (if needed)
1. Tap "Manage" next to Linked Accounts
2. Add a test card:
   - **Success Card**: `4242 4242 4242 4242`
   - **Declined Card**: `4000 0000 0000 0002`
   - Any future expiry and any 3-digit CVC

### Step 3: Add Money
1. Tap "Add Money" button
2. Enter an amount using the keypad (e.g., $10.00)
3. For iOS: Test Apple Pay if available
4. For Card: Tap "Add Money" button

### Step 4: Verify Success
- Success alert should appear
- Navigate back to wallet
- Verify balance increased by deposit amount
- Check transaction history for deposit record

### Test Cases for Deposit

| Test Case | Input | Expected Result |
|-----------|-------|-----------------|
| Valid deposit | $10.00 with valid card | Success, balance increases |
| Minimum amount | $0.50 | Success |
| Below minimum | $0.25 | Error: Amount must be at least $0.50 |
| Invalid amount | $0.00 | Error: Invalid amount |
| Declined card | 4000000000000002 | Error: Card was declined |
| Expired card | 4000000000000069 | Error: Card expired |
| No payment method | No card added | Prompt to add payment method |

## Testing Withdrawal Flow

### Step 1: Ensure Sufficient Balance
- Must have funds in wallet to withdraw
- Add funds first if balance is 0

### Step 2: Connect Bank Account (Stripe Connect)
1. Navigate to Withdraw screen
2. Tap "Connect Bank Account"
3. Complete Stripe Connect onboarding
   - **Test mode**: Use test account numbers
   - Routing: `110000000`
   - Account: `000123456789`

### Step 3: Initiate Withdrawal
1. Enter withdrawal amount
2. Select connected bank account
3. Tap "Withdraw" button

### Step 4: Verify Success
- Success alert with transfer ID
- Balance decreases by withdrawal amount
- Transaction appears in history

### Test Cases for Withdrawal

| Test Case | Input | Expected Result |
|-----------|-------|-----------------|
| Valid withdrawal | $5.00 with connected account | Success, balance decreases |
| Exceed balance | Amount > balance | Error: Insufficient balance |
| No connected account | No bank linked | Prompt to connect bank |
| Zero amount | $0.00 | Error: Invalid amount |

## Testing Escrow Flow

### Step 1: Create Bounty with Payment
1. Create a new bounty posting
2. Set a payment amount (e.g., $25.00)
3. Confirm bounty creation

### Step 2: Accept Hunter
1. When a hunter applies, review their request
2. Accept the request
3. Verify escrow transaction in wallet history

### Step 3: Complete Bounty
1. Mark bounty as complete
2. Confirm payout release
3. Verify funds released in transaction history

### Test Cases for Escrow

| Test Case | Action | Expected Result |
|-----------|--------|-----------------|
| Create escrow | Accept hunter for paid bounty | Balance decreases, escrow transaction logged |
| Release funds | Mark bounty complete | Release transaction logged |
| Refund (cancellation) | Cancel bounty | Refund transaction, balance restored |
| Insufficient funds | Accept without enough balance | Error: Insufficient balance |

## Transaction History Verification

After each operation, verify in Transaction History:

1. **Deposit Transactions**
   - Type: "Deposit"
   - Amount: Positive (+$X.XX)
   - Color: Green

2. **Withdrawal Transactions**
   - Type: "Withdrawal"
   - Amount: Negative (-$X.XX)
   - Color: Red

3. **Escrow Transactions**
   - Type: "Escrow Hold"
   - Status Badge: "FUNDED"
   - Amount: Negative

4. **Release Transactions**
   - Type: "Escrow Released"
   - Amount: Positive (for recipient)

## Common Issues & Troubleshooting

### "Not authenticated" Error
- Ensure user is logged in
- Check if session has expired
- Try logging out and back in

### "Failed to create payment intent" Error
- Verify backend server is running
- Check API_BASE_URL configuration
- Verify Stripe keys are configured

### Balance Not Updating
- Pull-to-refresh on wallet screen
- Check network connectivity
- Verify API response in console logs

### Stripe Connect Onboarding Fails
- Clear app cache and retry
- Use test credentials in test mode
- Check backend logs for errors

## API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/payments/create-payment-intent` | POST | Create Stripe payment intent |
| `/wallet/balance` | GET | Fetch current balance |
| `/wallet/transactions` | GET | Fetch transaction history |
| `/connect/create-account-link` | POST | Start Stripe Connect onboarding |
| `/connect/verify-onboarding` | POST | Check Connect account status |
| `/connect/transfer` | POST | Initiate withdrawal transfer |

## Security Considerations

1. **Never use real cards in test mode**
2. **Keep test Stripe keys separate from production**
3. **Clear test data before production deployment**
4. **Verify escrow amounts match bounty values**

## Production Readiness Checklist

- [ ] Replace test Stripe keys with production keys
- [ ] Configure production API_BASE_URL
- [ ] Test with real Stripe Connect accounts
- [ ] Verify webhook endpoints are configured
- [ ] Test with production payment methods
- [ ] Review transaction logs for accuracy
- [ ] Enable Stripe fraud protection
