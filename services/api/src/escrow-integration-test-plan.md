# Escrow Integration Test Plan

This document outlines the integration test plan for the complete escrow payment flow.

## Test Objectives

Validate the end-to-end escrow payment flow:
1. User deposits funds to wallet
2. User creates a paid bounty (funds deducted from wallet)
3. Hunter accepts bounty (escrow PaymentIntent created)
4. Hunter completes bounty (funds released to hunter)

Alternative flow:
1-3. Same as above
4. Poster cancels bounty (refund processed)

## Prerequisites

- API server running: `npm run dev`
- Test dependencies installed: `npm install --save-dev`
- Valid Stripe test credentials configured

## Test Flow: Happy Path

### 1. Setup Test Users
```
POST /api/auth/register
- Create poster account
- Create hunter account
```

### 2. Deposit Funds
```
POST /wallet/deposit
Body: { amount: 200, paymentIntentId: "pi_test_..." }
Expected: 200 OK, newBalance: 200.00
```

### 3. Check Balance
```
GET /wallet/balance
Expected: { balance: 200.00, balanceCents: 20000, currency: "USD" }
```

### 4. Create Bounty
```
POST /api/bounties
Body: { 
  title: "Test Escrow Bounty",
  description: "Integration test for escrow flow",
  amount: 100,
  isForHonor: false
}
Expected: 201 Created
Verify: Balance drops to $100
```

### 5. Hunter Accepts Bounty
```
POST /api/bounties/:id/accept
Expected: 200 OK
Verify: ESCROW_HOLD event created in outbox
```

### 6. Wait for Outbox Processing
```
Wait 5-10 seconds for outbox worker to process ESCROW_HOLD event
Verify: payment_intent_id is set on bounty record
```

### 7. Hunter Completes Bounty
```
POST /api/bounties/:id/complete
Expected: 200 OK
Verify: COMPLETION_RELEASE event created in outbox
```

### 8. Wait for Release Processing
```
Wait 5-10 seconds for outbox worker to process COMPLETION_RELEASE event
Verify: Bounty status changes to 'completed'
```

### 9. Verify Hunter Payment
```
GET /wallet/transactions (as hunter)
Expected: Release transaction for $95 (100 - 5% platform fee)
```

### 10. Verify Poster Balance
```
GET /wallet/balance (as poster)
Expected: { balance: 100.00, balanceCents: 10000, currency: "USD" }
```

## Test Flow: Cancellation Path

Follow steps 1-6 from Happy Path, then:

### 7. Cancel Bounty
```
POST /wallet/refund
Body: { bountyId: "...", reason: "Test cancellation" }
Expected: 200 OK
Verify: Refund transaction created
```

### 8. Verify Refund
```
GET /wallet/balance (as poster)
Expected: { balance: 200.00, balanceCents: 20000, currency: "USD" }
```

## Edge Cases to Test

1. **Insufficient Balance**
   - Attempt to create bounty with amount > balance
   - Expected: 400 Bad Request with structured error

2. **Double Acceptance**
   - Try to accept already accepted bounty
   - Expected: 400 Bad Request

3. **Unauthorized Completion**
   - Try to complete bounty as non-hunter
   - Expected: 403 Forbidden

4. **Double Completion**
   - Try to complete already completed bounty
   - Expected: 400 Bad Request

5. **Already Refunded**
   - Try to refund already refunded bounty
   - Expected: 400 Bad Request

## Expected Results

- All wallet balances should be consistent
- All transactions should be recorded correctly
- Email notifications should be sent (check logs)
- Outbox events should be processed successfully
- No orphaned transactions

## Automated Test Implementation

To implement this as an automated test:

1. Use Jest or similar test framework
2. Create test helper for API calls
3. Set up test database with clean state
4. Mock Stripe API calls or use test mode
5. Assert on all expected outcomes
6. Clean up test data after each run

See COMPLETE_ESCROW_PAYMENT_FLOW.md for detailed flow diagrams and architecture.
