# Payment Escrow Flow - Testing Guide

## Overview
This guide covers end-to-end testing of the complete payment escrow flow implemented for BountyExpo. The flow ensures secure transactions between bounty posters and hunters through Stripe's payment infrastructure.

## Prerequisites

### Backend Setup
1. **Stripe API Keys**
   - Set `STRIPE_SECRET_KEY` in `services/api/.env`
   - Set `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` in root `.env`

2. **Database**
   - Ensure PostgreSQL is running with the bounties schema
   - Verify `payment_intent_id` field exists in `bounties` table
   - Verify `wallet_transactions` table exists

3. **Start API Server**
   ```bash
   cd services/api
   npm install
   npm run dev
   ```

### Frontend Setup
1. **Environment Variables**
   ```
   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
   EXPO_PUBLIC_API_BASE_URL=http://localhost:3001
   ```

2. **Start Expo App**
   ```bash
   npm install
   npx expo start
   ```

## Test Scenarios

### 1. Stripe Test Cards
Use these cards for testing different scenarios:

- **Success**: `4242 4242 4242 4242`
- **Requires Authentication (3D Secure)**: `4000 0027 6000 3184`
- **Insufficient Funds**: `4000 0000 0000 9995`
- **Card Declined**: `4000 0000 0000 0002`
- **Expired Card**: Use any expired date (e.g., 01/20)

**For all cards**:
- Any future expiry date (e.g., 12/34)
- Any 3-digit CVC
- Any 5-digit ZIP code

### 2. Complete Escrow Flow Test

#### Step 1: Create User Accounts
1. Create Poster Account (User A)
2. Create Hunter Account (User B)
3. Both users complete profile setup

#### Step 2: Setup Stripe Connect (Hunter Only)
1. Log in as Hunter (User B)
2. Navigate to Profile → Settings → Payout Settings
3. Complete Stripe Connect onboarding
4. Verify "Payouts Enabled" status
5. Add bank account for payouts

#### Step 3: Poster Adds Money to Wallet
1. Log in as Poster (User A)
2. Navigate to Wallet
3. Click "Add Money"
4. Enter amount (e.g., $50)
5. Use test card: `4242 4242 4242 4242`
6. Verify funds added to wallet balance
7. Check wallet transactions for deposit record

**Expected Results**:
- Balance increases by deposited amount
- Transaction appears in wallet history
- Transaction type: "deposit"
- Payment recorded in database

#### Step 4: Create Bounty
1. Log in as Poster (User A)
2. Navigate to Create Bounty
3. Fill in details:
   - Title: "Test Escrow Flow"
   - Description: "Testing payment escrow"
   - Amount: $30 (must be ≤ wallet balance)
   - Skills, location, etc.
4. Submit bounty
5. Verify bounty appears in Postings

**Expected Results**:
- Bounty created with status "open"
- Bounty visible in postings list

#### Step 5: Hunter Applies
1. Log in as Hunter (User B)
2. Navigate to Postings
3. Find the test bounty
4. Click "Apply"
5. Submit application

**Expected Results**:
- Application submitted
- Request appears in Poster's applications list
- Request status: "pending"

#### Step 6: Poster Accepts Application (ESCROW CREATED)
1. Log in as Poster (User A)
2. Navigate to bounty details
3. View applications
4. Accept Hunter's application

**Expected Results**:
- ✅ **Escrow created automatically**
- PaymentIntent created in Stripe (status: `requires_capture`)
- `payment_intent_id` stored in bounty record
- Escrow transaction recorded in wallet
- Poster's wallet balance deducted by bounty amount
- Bounty status changed to "in_progress"
- Hunter notified of acceptance

**Database Verification**:
```sql
-- Check bounty has payment_intent_id
SELECT id, title, amount, status, payment_intent_id 
FROM bounties 
WHERE title = 'Test Escrow Flow';

-- Check escrow transaction created
SELECT id, type, amount_cents, bounty_id, user_id
FROM wallet_transactions
WHERE type = 'escrow' AND bounty_id = '<bounty_id>';
```

#### Step 7: Hunter Completes Work
1. Log in as Hunter (User B)
2. Navigate to In Progress bounties
3. Open the accepted bounty
4. Mark as "Work Completed"
5. Submit completion

**Expected Results**:
- Bounty marked ready for review
- Poster receives notification
- Status remains "in_progress" pending release

#### Step 8: Poster Releases Payment (FUNDS RELEASED)
1. Log in as Poster (User A)
2. Navigate to bounty details or payout screen
3. Review completion
4. Toggle "I confirm payout release"
5. Click "Release Payout"

**Expected Results**:
- ✅ **PaymentIntent captured in Stripe**
- ✅ **Funds transferred to Hunter's Connect account**
- Platform fee (10%) deducted automatically
- Release transaction created in wallet
- Platform fee transaction created
- Bounty status changed to "completed"
- Success animation displayed
- Poster sees reduced balance
- Hunter receives payout notification

**Database Verification**:
```sql
-- Check release transaction
SELECT id, type, amount_cents, stripe_transfer_id, platform_fee_cents
FROM wallet_transactions
WHERE type = 'release' AND bounty_id = '<bounty_id>';

-- Check platform fee recorded
SELECT id, type, amount_cents
FROM wallet_transactions
WHERE type = 'platform_fee' AND bounty_id = '<bounty_id>';

-- Verify bounty completed
SELECT id, status, payment_intent_id
FROM bounties
WHERE id = '<bounty_id>';
```

**Stripe Dashboard Verification**:
1. Go to Stripe Dashboard → Payments
2. Find the PaymentIntent by ID
3. Verify status is "succeeded"
4. Check Events tab for capture event
5. Go to Connect → Transfers
6. Verify transfer to Hunter's account
7. Check transfer amount = bounty amount - platform fee

### 3. Error Scenario Tests

#### Test 3.1: Insufficient Wallet Balance
1. Create bounty with amount > wallet balance
2. Verify error message displayed
3. Bounty should not be created

#### Test 3.2: Hunter Without Connect Account
1. Accept application for hunter without Stripe Connect
2. Complete work
3. Attempt to release payment
4. Verify error: "Hunter does not have a valid payout account"
5. Funds remain in escrow

#### Test 3.3: Card Declined During Deposit
1. Attempt to add money with test card `4000 0000 0000 0002`
2. Verify error message displayed
3. Balance not updated
4. No transaction created

#### Test 3.4: Already Released Escrow
1. Complete and release a bounty
2. Attempt to release again
3. Verify error: "Funds already released"

#### Test 3.5: Missing Payment Intent
1. Manually create bounty without acceptance flow
2. Attempt to release without payment_intent_id
3. Verify error: "No payment_intent_id found"

### 4. Edge Cases

#### Test 4.1: Honor Bounties (No Payment)
1. Create bounty with "For Honor" selected
2. Accept application
3. Verify NO escrow created
4. Complete work
5. Mark as complete without payment flow

#### Test 4.2: Bounty Cancellation
1. Create and accept bounty (escrow created)
2. Cancel bounty before completion
3. Verify refund flow (if implemented)
4. Check funds returned to poster

#### Test 4.3: Multiple Applications
1. Create one bounty
2. Have 3 hunters apply
3. Accept one application
4. Verify only one escrow created
5. Other applications automatically rejected

#### Test 4.4: 3D Secure Authentication
1. Add money with card `4000 0027 6000 3184`
2. Complete 3D Secure challenge
3. Verify funds added after authentication

## Monitoring & Logs

### Backend Logs to Watch
```bash
# In services/api terminal
# Look for these log messages:

[payments] Created escrow PaymentIntent pi_xxx for bounty yyy
[payments] Released escrow pi_xxx, transferred zzz cents to hunter
[wallet] Transaction created: type=escrow, bounty_id=xxx
[wallet] Transaction created: type=release, bounty_id=xxx
```

### Frontend Console Logs
```javascript
// Look for these in browser/Expo console:
'[PaymentService] Error creating escrow:'
'[wallet] Error releasing funds:'
'Escrow created successfully for accepted bounty'
'Failed to release escrow:'
```

### Stripe Dashboard Events
Monitor these webhook events:
- `payment_intent.created`
- `payment_intent.succeeded`
- `transfer.created`
- `payout.paid`

## Troubleshooting

### Issue: Escrow Not Created on Acceptance
**Check**:
1. Bounty has `amount > 0` and `is_for_honor = false`
2. Backend API is running and reachable
3. STRIPE_SECRET_KEY is set correctly
4. Check browser/Expo console for errors
5. Check backend logs for API errors

**Fix**: Ensure all environment variables are set and API server is running.

### Issue: Release Fails with "No payment_intent_id"
**Check**:
1. Database has `payment_intent_id` column in bounties table
2. Escrow was created successfully (check logs)
3. Bounty record has non-null `payment_intent_id`

**Fix**: Re-accept the bounty to create escrow again, or manually set payment_intent_id.

### Issue: "Hunter does not have valid payout account"
**Check**:
1. Hunter completed Stripe Connect onboarding
2. Hunter's Connect account has `payouts_enabled = true`
3. Bank account added to Connect account

**Fix**: Complete Stripe Connect setup for hunter.

### Issue: PaymentIntent in Wrong State
**Check**:
1. PaymentIntent status in Stripe Dashboard
2. Should be `requires_capture` before release
3. Should be `succeeded` after release

**Fix**: If stuck, create new test bounty.

## Success Criteria Checklist

- [ ] Can deposit funds to wallet via Stripe
- [ ] Escrow PaymentIntent created on bounty acceptance
- [ ] payment_intent_id stored in bounty record
- [ ] Funds held in Stripe (status: requires_capture)
- [ ] Release captures PaymentIntent
- [ ] Transfer created to Hunter's Connect account
- [ ] Platform fee (10%) deducted correctly
- [ ] All transactions logged in database
- [ ] Proper error messages displayed
- [ ] Success animations shown
- [ ] Bounty status updated correctly
- [ ] Email notifications sent (if configured)
- [ ] Stripe webhook events received
- [ ] Transaction history accurate

## Additional Resources

- [Stripe Testing Docs](https://stripe.com/docs/testing)
- [Stripe Connect Testing](https://stripe.com/docs/connect/testing)
- [Payment Intents Guide](https://stripe.com/docs/payments/payment-intents)
- [Manual Capture](https://stripe.com/docs/payments/capture-later)

## Reporting Issues

When reporting bugs, include:
1. Test scenario being run
2. Expected behavior
3. Actual behavior
4. Console/log output
5. Stripe Dashboard screenshots
6. Database query results
7. Environment details (dev/staging/prod)
