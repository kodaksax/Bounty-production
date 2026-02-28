# Payment Flow Testing & Troubleshooting Guide

This is the single authoritative reference for testing and troubleshooting the BountyExpo payment system end-to-end. It consolidates information from the more focused guides (`PAYMENT_ESCROW_TESTING_GUIDE.md`, `PAYMENT_TESTING_GUIDE.md`, `TROUBLESHOOTING_PAYMENT_NETWORK.md`, `PAYOUT_SYSTEM_TESTING_GUIDE.md`) into one place.

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Environment Setup](#2-environment-setup)
3. [Stripe Test Cards & Bank Accounts](#3-stripe-test-cards--bank-accounts)
4. [Test Scenarios](#4-test-scenarios)
   - 4.1 [Add Money (Deposit)](#41-add-money-deposit)
   - 4.2 [Bounty Escrow Creation](#42-bounty-escrow-creation)
   - 4.3 [Bounty Completion & Fund Release](#43-bounty-completion--fund-release)
   - 4.4 [Cancellation & Refund](#44-cancellation--refund)
   - 4.5 [Payout / Withdrawal](#45-payout--withdrawal)
   - 4.6 [Error Scenarios](#46-error-scenarios)
   - 4.7 [Edge Cases](#47-edge-cases)
5. [Running Automated Tests](#5-running-automated-tests)
6. [Verifying Results](#6-verifying-results)
7. [Troubleshooting Reference](#7-troubleshooting-reference)
8. [API Quick Reference](#8-api-quick-reference)
9. [Monitoring & Observability](#9-monitoring--observability)
10. [CI/CD Integration](#10-cicd-integration)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                    BountyExpo Payment Stack                          │
│                                                                      │
│  Mobile App (React Native / Expo)                                    │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────────┐ │
│  │ Wallet Screen│  │  Add Money     │  │  Withdraw / Payout       │ │
│  │  + History   │  │  Screen        │  │  Screen                  │ │
│  └──────┬───────┘  └───────┬────────┘  └────────────┬─────────────┘ │
│         └──────────────────┼───────────────────────┘              │
│                   ┌────────▼────────┐                              │
│                   │ Stripe Context  │ (StripeProvider)             │
│                   └────────┬────────┘                              │
│                   ┌────────▼────────┐                              │
│                   │ StripeService   │ (lib/services/stripe-service) │
│                   └────────┬────────┘                              │
└────────────────────────────┼─────────────────────────────────────────┘
                             │ HTTPS
              ┌──────────────▼──────────────┐
              │   Backend API (Express.js)   │
              │   services/api/src/routes/   │
              │   ├── wallet.ts             │
              │   ├── consolidated-payments │
              │   ├── completion-release.ts │
              │   └── consolidated-webhooks │
              └──────────────┬──────────────┘
                             │
        ┌────────────────────┼─────────────────────┐
        │                    │                     │
┌───────▼──────┐  ┌──────────▼─────────┐  ┌───────▼───────┐
│ Stripe API   │  │ Supabase / Postgres │  │ Outbox Worker │
│ PaymentIntent│  │ bounties            │  │ (async retry) │
│ Transfer     │  │ wallet_transactions │  │               │
│ Refund       │  │ outbox_events       │  │               │
└──────────────┘  └────────────────────┘  └───────────────┘
```

### Core Payment Components

| Component | File | Responsibility |
|---|---|---|
| Wallet routes | `services/api/src/routes/wallet.ts` | Balance, transactions, escrow, release, refund |
| Payment routes | `services/api/src/routes/consolidated-payments.ts` | PaymentIntents, payment methods |
| Completion release | `services/api/src/routes/completion-release.ts` | Fund transfer on bounty completion |
| Stripe Connect | `services/api/src/services/stripe-connect-service.ts` | Hunter onboarding, payouts |
| Outbox worker | `services/api/src/services/outbox-worker.ts` | Async retries, event processing |
| Refund service | `services/api/src/services/refund-service.ts` | Cancellations and refunds |
| Email service | `services/api/src/services/email-service.ts` | Transaction receipts |

### Payment Flow Summary

```
Poster deposits money → Wallet balance increases
          │
          ▼
Poster creates bounty (amount ≤ wallet balance)
          │
          ▼
Hunter applies → Poster accepts application
          │
          ▼
ESCROW: Funds deducted from poster wallet;
        Stripe PaymentIntent created (requires_capture)
          │
     ─────┴──────
    │              │
Hunter          Poster
completes       cancels
    │              │
    ▼              ▼
RELEASE:        REFUND:
Stripe          Stripe
Transfer        Refund
5% fee          Full amount
to hunter       to poster
```

---

## 2. Environment Setup

### 2.1 Required Environment Variables

**Root `.env` (mobile app)**
```env
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
EXPO_PUBLIC_API_BASE_URL=http://<your-local-ip>:3001
```

**`services/api/.env` (backend)**
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
NODE_ENV=development
```

**`services/api/.env.test` (automated tests)**
```env
STRIPE_SECRET_KEY=sk_test_mock_key
SUPABASE_URL=https://test.supabase.co
SUPABASE_SERVICE_ROLE_KEY=test-service-role-key
NODE_ENV=test
```

> **Never commit real API keys.** Use `.env.example` as a template and keep secrets in your local `.env` files.

### 2.2 Starting Services

```bash
# 1. Start the API server
cd services/api
npm install
npm run dev
# Server starts on port 3001

# 2. Start the Expo app (new terminal)
cd <repo-root>
npm install
npx expo start

# 3. (Optional) Start Stripe CLI for local webhooks
stripe listen --forward-to localhost:3001/webhooks/stripe
```

### 2.3 Physical Device Setup

Physical iOS/Android devices cannot reach `localhost`. Use your machine's LAN IP:

```bash
# Mac/Linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows
ipconfig | findstr "IPv4"
```

Set `EXPO_PUBLIC_API_BASE_URL=http://<lan-ip>:3001` and rebuild the app.  
If your network blocks device-to-device traffic, use Expo Tunnel:
```bash
npx expo start --tunnel
```

### 2.4 iOS Network Security (Local Dev Only)

Add to `app.json` for local HTTP testing:
```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSAppTransportSecurity": {
          "NSAllowsArbitraryLoads": true
        }
      }
    }
  }
}
```

> Remove this for production builds.

---

## 3. Stripe Test Cards & Bank Accounts

Use these in **Stripe test mode only**. For all cards, use:
- Any future expiry date (e.g., `12/34`)
- Any 3-digit CVC (e.g., `123`)
- Any 5-digit ZIP (e.g., `10001`)

### 3.1 Credit / Debit Cards

| Card Number | Scenario |
|---|---|
| `4242 4242 4242 4242` | ✅ Successful payment |
| `4000 0027 6000 3184` | 🔐 Requires 3D Secure authentication |
| `4000 0025 0000 3155` | 🔐 Requires 3D Secure (always) |
| `4000 0000 0000 9995` | ❌ Insufficient funds |
| `4000 0000 0000 0002` | ❌ Card declined (generic) |
| `4000 0000 0000 0069` | ❌ Expired card |
| `4000 0000 0000 0127` | ❌ Incorrect CVC |
| `4000 0000 0000 0119` | ❌ Processing error |

### 3.2 Bank Accounts (ACH / Stripe Connect)

| Routing | Account Number | Scenario |
|---|---|---|
| `110000000` | `000123456789` | ✅ Successful bank account |
| `110000000` | `000111111116` | ✅ Verified immediately |
| `110000000` | `000222222227` | ⏳ Verification required |

### 3.3 Stripe Connect Test Accounts

For testing Stripe Connect (hunter payout accounts), during onboarding use:
- **SSN**: `000-00-0000`
- **Phone**: Any valid US format
- **DOB**: Any date for someone 18+ years old
- **Address**: Any valid US address

---

## 4. Test Scenarios

### Prerequisites for All Scenarios

1. Create **Poster account** (User A) and verify email.
2. Create **Hunter account** (User B) and verify email.
3. Hunter (User B) completes Stripe Connect onboarding (see [Section 4.5](#45-payout--withdrawal)).

---

### 4.1 Add Money (Deposit)

**Goal:** Verify Poster can deposit funds to their wallet via Stripe.

**Steps:**
1. Log in as Poster (User A).
2. Navigate to **Wallet**.
3. Tap **"Add Money"**.
4. Enter amount (e.g., `$100.00`).
5. Use card `4242 4242 4242 4242`, any future expiry, any CVC/ZIP.
6. Confirm payment.

**Expected Results:**
- ✅ Wallet balance increases by deposited amount.
- ✅ Deposit transaction appears in wallet history (type: `deposit`).
- ✅ Success confirmation displayed.

**Database Verification:**
```sql
SELECT id, type, amount_cents, created_at
FROM wallet_transactions
WHERE user_id = '<poster_user_id>' AND type = 'deposit'
ORDER BY created_at DESC
LIMIT 1;
```

**API Verification:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:3001/wallet/balance
# Expected: { "balance": 100.00, "balanceCents": 10000 }
```

---

### 4.2 Bounty Escrow Creation

**Goal:** Verify accepting an application deducts funds from Poster wallet and creates a Stripe PaymentIntent.

**Steps:**
1. Log in as Poster (User A).
2. Navigate to **Create Bounty**.
3. Enter title, description, amount (e.g., `$30.00`), submit.
4. Verify bounty appears in Postings with status `open`.
5. Log in as Hunter (User B).
6. Navigate to Postings, find the bounty, click **Apply**.
7. Log back in as Poster (User A).
8. Navigate to the bounty detail → Applications.
9. **Accept** Hunter's application.

**Expected Results:**
- ✅ `ESCROW_HOLD` outbox event created.
- ✅ Stripe PaymentIntent created (status: `requires_capture` or `succeeded` depending on config).
- ✅ `payment_intent_id` stored in the `bounties` row.
- ✅ Escrow transaction in `wallet_transactions` (type: `escrow`, negative amount for poster).
- ✅ Poster wallet balance reduced by bounty amount.
- ✅ Bounty status changes to `in_progress`.
- ✅ Poster receives escrow confirmation email.

**Database Verification:**
```sql
-- Confirm bounty has payment_intent_id and correct status
SELECT id, title, amount_cents, status, payment_intent_id
FROM bounties
WHERE title = '<your-bounty-title>';

-- Confirm escrow transaction
SELECT id, type, amount_cents, bounty_id
FROM wallet_transactions
WHERE type = 'escrow' AND bounty_id = '<bounty_id>';
```

**Stripe Dashboard Verification:**
1. Stripe Dashboard → Payments.
2. Find the PaymentIntent by the ID stored in `bounties.payment_intent_id`.
3. Confirm status is `requires_capture` (or `succeeded`).

---

### 4.3 Bounty Completion & Fund Release

**Goal:** Verify completing a bounty transfers funds to the Hunter minus the platform fee.

**Steps:**
1. Log in as Hunter (User B).
2. Navigate to **In Progress** bounties.
3. Open the accepted bounty.
4. Tap **"Mark Work Completed"**.
5. Log in as Poster (User A).
6. Navigate to the bounty detail.
7. Review completion, toggle **"I confirm payout release"**, tap **"Release Payout"**.

**Expected Results:**
- ✅ `COMPLETION_RELEASE` outbox event processed.
- ✅ Stripe Transfer created to Hunter's Connect account.
- ✅ Release transaction in `wallet_transactions` (type: `release`).
- ✅ Platform fee transaction in `wallet_transactions` (type: `platform_fee`), 5% of bounty amount.
- ✅ Bounty status changes to `completed`.
- ✅ Both Poster and Hunter receive payment receipt emails.
- ✅ Success animation shown in app.

**Platform Fee Calculation:**
```
Platform fee = bounty amount × 5%
Hunter receives = bounty amount - platform fee
Example: $30.00 bounty → $1.50 fee → Hunter receives $28.50
```

**Database Verification:**
```sql
-- Confirm release transaction
SELECT id, type, amount_cents, stripe_transfer_id, platform_fee_cents
FROM wallet_transactions
WHERE type = 'release' AND bounty_id = '<bounty_id>';

-- Confirm platform fee
SELECT id, type, amount_cents
FROM wallet_transactions
WHERE type = 'platform_fee' AND bounty_id = '<bounty_id>';

-- Confirm bounty completed
SELECT id, status, payment_intent_id
FROM bounties WHERE id = '<bounty_id>';
```

**Stripe Dashboard Verification:**
1. Payments → Find PaymentIntent → Verify status: `succeeded`.
2. Connect → Transfers → Find transfer to Hunter's account.
3. Verify transfer amount = bounty amount − 5% fee.

---

### 4.4 Cancellation & Refund

**Goal:** Verify cancelling a bounty after escrow returns full funds to Poster.

**Steps:**
1. Create a bounty and accept an application (escrow created, see Section 4.2).
2. Log in as Poster (User A).
3. Navigate to the bounty detail.
4. Tap **"Cancel Bounty"** and confirm cancellation.

**Expected Results:**
- ✅ Stripe Refund created for the full PaymentIntent amount.
- ✅ Refund transaction in `wallet_transactions` (type: `refund`, positive amount for poster).
- ✅ Poster wallet balance restored.
- ✅ Bounty status changes to `cancelled`.
- ✅ Poster receives refund confirmation email (includes refund timeline: 5–10 business days).

**Database Verification:**
```sql
SELECT id, type, amount_cents, created_at
FROM wallet_transactions
WHERE type = 'refund' AND bounty_id = '<bounty_id>';

SELECT id, status FROM bounties WHERE id = '<bounty_id>';
```

**API Test:**
```bash
curl -X POST http://localhost:3001/bounties/<bounty_id>/cancel \
  -H "Authorization: Bearer $POSTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Test cancellation"}'
# Expected: { "message": "...", "refundId": "re_...", "amount": 30.00 }
```

---

### 4.5 Payout / Withdrawal

**Goal:** Verify Hunter can withdraw earnings to a linked bank account.

#### Step A: Complete Stripe Connect Onboarding (Hunter only, once)

1. Log in as Hunter (User B).
2. Navigate to **Profile → Settings → Payout Settings** (or Wallet → Withdraw).
3. Tap **"Complete Onboarding"**.
4. Complete Stripe Connect form with test data (see Section 3.3).
5. Return to app.

**Verification:**
```bash
curl -H "Authorization: Bearer $HUNTER_TOKEN" \
     http://localhost:3001/connect/verify-onboarding
# Expected: { "onboarded": true, "payoutsEnabled": true, "chargesEnabled": true }
```

#### Step B: Add Bank Account

1. In Wallet → Withdraw, tap **"Add Bank Account"**.
2. Fill in:
   - Account Holder Name: `John Doe`
   - Routing Number: `110000000`
   - Account Number: `000123456789`
   - Account Type: `Checking`
3. Tap **"Add Bank Account"**.

**Expected Results:**
- ✅ Bank account appears in list, showing last 4 digits (`6789`).
- ✅ Status shows `new` or `verified`.

#### Step C: Withdraw Funds

1. Enter withdrawal amount (must be ≤ wallet balance).
2. Select bank account.
3. Tap **"Withdraw"**.

**Expected Results:**
- ✅ Wallet balance decreases by withdrawal amount.
- ✅ Withdrawal transaction in `wallet_transactions` (type: `withdrawal`).
- ✅ Transfer visible in Stripe Dashboard → Connect → Accounts → Hunter's account → Transfers.
- ✅ Estimated arrival: 1–2 business days.

---

### 4.6 Error Scenarios

#### E1: Insufficient Wallet Balance (Bounty Creation)

- Create a bounty with `amount > current wallet balance`.
- **Expected:** Error displayed, bounty NOT created.

#### E2: Card Declined During Deposit

- Use card `4000 0000 0000 0002`.
- **Expected:** Error message shown, wallet balance NOT updated, NO transaction created.

#### E3: Insufficient Funds Card

- Use card `4000 0000 0000 9995`.
- **Expected:** Specific "insufficient funds" error, no transaction.

#### E4: 3D Secure Authentication

- Use card `4000 0027 6000 3184`.
- **Expected:** 3DS challenge appears, payment succeeds only after completing challenge.

#### E5: Hunter Without Connect Account

1. Accept an application from a hunter without Stripe Connect.
2. Complete work.
3. Attempt release.
- **Expected:** Error: "Hunter does not have a valid payout account." Funds remain in escrow.

#### E6: Double Release Prevention

1. Release payment for a completed bounty.
2. Attempt to release again.
- **Expected:** Error: "Funds already released." No duplicate transfer.

#### E7: Double Refund Prevention

1. Refund a cancelled bounty.
2. Attempt to refund again.
- **Expected:** Error: "Already refunded." No duplicate refund.

#### E8: Refund After Completion

1. Complete and release a bounty successfully.
2. Attempt to cancel/refund.
- **Expected:** Error: bounty is already `completed`, refund blocked.

#### E9: Missing Payment Intent

1. Accept a bounty application (escrow created).
2. Manually remove `payment_intent_id` from the bounty in the DB.
3. Attempt to release or refund.
- **Expected:** Error: "No payment_intent_id found for this bounty."

#### E10: Network Timeout During Deposit

1. Stop the API server.
2. Attempt to add money.
- **Expected:** App retries up to 4 times with escalating timeouts (10s, 15s, 20s, 25s), then shows "Payment service temporarily unavailable."

---

### 4.7 Edge Cases

#### EC1: Honor Bounties (No Payment)

1. Create a bounty with **"For Honor"** selected.
2. Accept application.
3. **Expected:** No escrow created, no `payment_intent_id` stored.
4. Complete bounty.
5. **Expected:** Bounty marked `completed` immediately, no Stripe transfer.

#### EC2: Multiple Applications (One Accepted)

1. Create one bounty.
2. Have 3 hunters apply.
3. Accept exactly one application.
4. **Expected:** Only one escrow created; other applications remain `pending` (or auto-rejected depending on config).

#### EC3: Concurrent Release Attempts

1. Trigger two simultaneous release requests for the same bounty.
2. **Expected:** Only one release processed; the second returns a duplicate-prevention error. (Outbox pattern + DB constraint enforces this.)

#### EC4: Zero/Minimum Amount

- Stripe requires a minimum charge of **$0.50 USD**.
- Attempting to create a bounty or deposit below this threshold should fail validation before reaching Stripe.
- **Expected:** Input validation error, no API call made.

#### EC5: Very Large Amount

- Test with a bounty amount of `$9,999.99` (near the app's $99,999.99 cap).
- **Expected:** Escrow, release, and refund all work correctly; platform fee scales proportionally.

---

## 5. Running Automated Tests

### 5.1 Test Suite Overview

| Directory | Files | Tests | Coverage |
|---|---|---|---|
| `__tests__/unit/services/` | 5 files | 160 | >85% service code |
| `__tests__/integration/api/` | 1 file | 25 | All payment endpoints |
| `__tests__/e2e/` | 3 files | ~40 | Complete user flows |

### 5.2 Running Tests

```bash
# Run full test suite
npm test

# Payment-specific unit tests
npm test -- __tests__/unit/services/consolidated-payment-service.test.ts
npm test -- __tests__/unit/services/consolidated-wallet-service.test.ts
npm test -- __tests__/unit/services/completion-release-service.test.ts
npm test -- __tests__/unit/services/refund-service.test.ts
npm test -- __tests__/unit/services/stripe-connect-service.test.ts

# Integration tests
npm test -- __tests__/integration/api/payment-flows.test.ts

# E2E payment flow tests
npm test -- __tests__/e2e/complete-payment-flows.test.ts
npm test -- __tests__/e2e/payment-flow.test.ts

# All payment tests at once
npm test -- __tests__/unit/services/ \
            __tests__/integration/api/payment-flows.test.ts \
            __tests__/e2e/complete-payment-flows.test.ts

# With coverage report
npm test -- --coverage

# Watch mode (development)
npm test -- --watch
```

### 5.3 Coverage Report

```bash
npm test -- --coverage
open coverage/lcov-report/index.html
```

Coverage targets:

| Service | Target | Expected |
|---|---|---|
| `consolidated-payment-service.ts` | >80% | ~90% |
| `consolidated-wallet-service.ts` | >80% | ~90% |
| `completion-release-service.ts` | >80% | ~95% |
| `refund-service.ts` | >80% | ~95% |
| `stripe-connect-service.ts` | >80% | ~85% |

### 5.4 Real Stripe Integration Tests

To test against real Stripe test infrastructure (not mocks):

```bash
cd services/api

# End-to-end payment flow with real Stripe test keys
TEST_USE_REAL_STRIPE=true npm run test:payment-flow
```

Make sure `.env` has valid `sk_test_...` keys before running.

### 5.5 Writing New Tests

Follow the AAA (Arrange–Act–Assert) pattern used throughout the existing suite:

```typescript
describe('PaymentService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createEscrow', () => {
    it('should create escrow transaction for valid bounty', async () => {
      // Arrange
      const params = { bountyId: 'bounty123', amount: 5000, posterId: 'user123' };
      mockStripe.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_test123',
        status: 'requires_capture',
      });

      // Act
      const result = await paymentService.createEscrow(params);

      // Assert
      expect(result.paymentIntentId).toBe('pi_test123');
      expect(mockSupabase.from('wallet_transactions').insert).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'escrow', bounty_id: 'bounty123' })
      );
    });

    it('should throw if bounty amount is below minimum', async () => {
      await expect(
        paymentService.createEscrow({ bountyId: 'b1', amount: 30, posterId: 'u1' })
      ).rejects.toThrow('Amount below minimum');
    });
  });
});
```

---

## 6. Verifying Results

### 6.1 Database Queries

Use these queries to verify payment state directly in Supabase or Postgres:

```sql
-- Current wallet balance for a user
SELECT balance_cents, updated_at
FROM wallets
WHERE user_id = '<user_id>';

-- All transactions for a bounty
SELECT id, type, amount_cents, stripe_transfer_id, platform_fee_cents, created_at
FROM wallet_transactions
WHERE bounty_id = '<bounty_id>'
ORDER BY created_at;

-- Bounty payment state
SELECT id, title, status, amount_cents, payment_intent_id, hunter_id
FROM bounties
WHERE id = '<bounty_id>';

-- Pending outbox events (should be empty when processing is healthy)
SELECT id, event_type, retry_count, retry_metadata, created_at
FROM outbox_events
WHERE processed_at IS NULL
ORDER BY created_at;

-- Failed outbox events
SELECT id, event_type, retry_count, retry_metadata, last_error, created_at
FROM outbox_events
WHERE retry_count >= 3
ORDER BY created_at DESC;
```

### 6.2 Stripe Dashboard

1. **Payments** → Search by PaymentIntent ID → Check status and event log.
2. **Connect → Accounts** → Find hunter's account → **Transfers** tab → Verify amount.
3. **Refunds** → Search by PaymentIntent ID or Refund ID.
4. **Webhooks** → Check recent events and delivery status.

### 6.3 Application Logs

```bash
# Backend API (look for payment log events)
cd services/api && npm run dev

# Key log markers to watch:
# [payments] Created escrow PaymentIntent pi_xxx for bounty yyy
# [payments] Released escrow pi_xxx, transferred zzz cents to hunter
# [wallet] Transaction created: type=escrow, bounty_id=xxx
# [wallet] Transaction created: type=release, bounty_id=xxx
# 🔒 ESCROW_HOLD — outbox event created
# ✅ ESCROW_HELD — PaymentIntent created and linked
# 💸 COMPLETION_RELEASE — release initiated
# ✅ COMPLETION_RELEASED — funds transferred
# 💸 BOUNTY_REFUNDED — refund processed
# ❌ [Event] Failed — error occurred (check retry_metadata)
```

---

## 7. Troubleshooting Reference

### 7.1 Payment / Escrow Issues

| Symptom | Likely Cause | Resolution |
|---|---|---|
| Escrow not created on acceptance | `is_for_honor = true` skips escrow; OR API server not running; OR `STRIPE_SECRET_KEY` missing | Verify bounty has `amount > 0` and `is_for_honor = false`; check API health; verify env vars |
| `payment_intent_id` null after acceptance | Outbox worker not running; Stripe API error | Check outbox_events table for failures; check backend logs; restart outbox worker |
| "No payment_intent_id found" on release | Escrow step was skipped or failed | Re-accept the bounty to recreate escrow, OR check and fix the outbox event |
| "Hunter does not have valid payout account" | Hunter's Stripe Connect account not fully onboarded | Hunter must complete Connect onboarding and add a bank account |
| "PaymentIntent in wrong state" for release | PaymentIntent was already captured or cancelled | Check PaymentIntent status in Stripe Dashboard; create a new test bounty |
| Release amount incorrect | Platform fee miscalculated or wrong config | Verify `platformFeePercentage` setting (default 5%); check `platform_fee_cents` in DB |
| Double release attempted | Bug in caller or concurrent requests | DB constraint prevents second release; verify `isAlreadyReleased()` returns `true` |
| Refund fails after completion | Bounty is `completed`; refund only valid before completion | Expected behaviour; no fix needed |
| "Already refunded" error | Refund already processed | Check `refund` transaction in `wallet_transactions`; this is correct idempotency behaviour |

### 7.2 Network & Connectivity Issues

| Symptom | Likely Cause | Resolution |
|---|---|---|
| "Connection timed out" (physical device) | Device cannot reach `localhost` | Set `EXPO_PUBLIC_API_BASE_URL` to your machine's LAN IP (e.g., `http://192.168.0.59:3001`) |
| "Network request failed" | API server not running; firewall blocking port | Start API server; open port 3001 in firewall (see below) |
| Timeout on iOS only | App Transport Security blocking HTTP | Add `NSAllowsArbitraryLoads` to `app.json` for local dev |
| Works on simulator but not device | LAN isolation on corporate/guest Wi-Fi | Use `npx expo start --tunnel` or ngrok |
| "Payment service temporarily unavailable" | API returned 500 or timed out after 4 retries | Check API server logs; wait and retry |

**Open firewall port 3001 (local dev):**
```powershell
# Windows (PowerShell as Administrator)
New-NetFirewallRule -DisplayName "Allow Node 3001" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow -Profile Any
```

```bash
# Mac: System Preferences → Security & Privacy → Firewall → Firewall Options
# Add Node.js to allowed applications
```

**Use ngrok as an alternative:**
```bash
npm install -g ngrok
ngrok http 3001
# Copy the https URL into EXPO_PUBLIC_API_BASE_URL
```

### 7.3 Stripe API Issues

| Symptom | Likely Cause | Resolution |
|---|---|---|
| `401 Unauthorized` from Stripe | Wrong or missing `STRIPE_SECRET_KEY` | Verify key in `services/api/.env`; confirm it's a test key starting with `sk_test_` |
| `400 Bad Request` — amount too small | Amount below Stripe minimum ($0.50 = 50 cents) | Enforce minimum $0.50 in input validation |
| Webhook signature verification failed | Using wrong `STRIPE_WEBHOOK_SECRET`; or raw body not passed to verifier | Ensure you use `stripe listen` CLI to get the correct secret; verify raw body middleware is applied before JSON parsing |
| Transfer fails — account not active | Hunter's Connect account not fully verified | Hunter must complete onboarding and provide all required documents |
| PaymentIntent stuck in `requires_payment_method` | Payment confirmation never completed client-side | Ensure `confirmPayment` or `confirmSetup` is called client-side with a valid payment method |

### 7.4 Automated Test Issues

| Symptom | Likely Cause | Resolution |
|---|---|---|
| `Cannot find module` | Missing dev dependency | `npm install --save-dev jest ts-jest @types/jest supertest @types/supertest` |
| `Exceeded timeout of 5000ms` | Async test too slow | Add `jest.setTimeout(30000)` at top of test file |
| Mock not intercepting real calls | Mock defined after import | Move `jest.mock(...)` calls above all import statements |
| TypeScript errors in test files | Missing type definitions | `npm install --save-dev @types/node @types/jest @types/supertest` |
| Tests pass locally but fail in CI | Different Node.js version or missing env vars | Pin Node.js version; add required env vars to CI secrets |

---

## 8. API Quick Reference

All endpoints require `Authorization: Bearer <access_token>`.

### Wallet

```http
GET  /wallet/balance
GET  /wallet/transactions?page=1&limit=20
POST /wallet/escrow     { bountyId, amount, title }
POST /wallet/release    { bountyId, hunterId }
POST /wallet/refund     { bountyId, reason? }
```

### Payments

```http
POST /payments/create-payment-intent  { amountCents, currency, metadata }
POST /payments/confirm                { paymentIntentId, paymentMethodId }
GET  /payment-methods
POST /payment-methods/attach          { paymentMethodId }
DELETE /payment-methods/:id
```

### Bounty Lifecycle

```http
POST /bounties/:id/accept
POST /bounties/:id/complete
POST /bounties/:id/cancel   { reason? }
```

### Stripe Connect (Hunter)

```http
GET  /connect/verify-onboarding
POST /connect/create-account-link   { returnUrl, refreshUrl }
GET  /connect/bank-accounts
POST /connect/bank-accounts         { accountHolderName, routingNumber, accountNumber, accountType }
DELETE /connect/bank-accounts/:id
POST /connect/bank-accounts/:id/default
POST /connect/transfer              { amount, destinationAccountId }
```

### Webhooks

```http
POST /webhooks/stripe   (Stripe signature required)
```

### Example Responses

**Wallet balance:**
```json
{ "balance": 100.00, "balanceCents": 10000, "currency": "USD" }
```

**Create escrow:**
```json
{
  "success": true,
  "transactionId": "uuid",
  "paymentIntentId": "pi_xxx",
  "amount": 30.00,
  "newBalance": 70.00,
  "message": "$30.00 held in escrow for bounty."
}
```

**Release funds:**
```json
{
  "success": true,
  "transactionId": "uuid",
  "transferId": "tr_xxx",
  "releaseAmount": 28.50,
  "platformFee": 1.50,
  "message": "$28.50 released to hunter."
}
```

**Refund:**
```json
{
  "success": true,
  "transactionId": "uuid",
  "refundId": "re_xxx",
  "amount": 30.00,
  "message": "$30.00 refunded to your wallet."
}
```

---

## 9. Monitoring & Observability

### 9.1 Key Metrics to Track

| Metric | Target | Alert Threshold |
|---|---|---|
| Escrow creation success rate | >99% | <95% |
| Release processing time | <5 seconds | >30 seconds |
| Refund success rate | >99% | <95% |
| Outbox pending events | ~0 | >10 stuck for >5 min |
| Outbox failed events (retries ≥ 3) | 0 | Any |

### 9.2 Stripe Webhook Events to Monitor

| Event | Meaning |
|---|---|
| `payment_intent.created` | Escrow initiated |
| `payment_intent.succeeded` | Funds captured |
| `payment_intent.payment_failed` | Payment failed — investigate |
| `transfer.created` | Payout to hunter initiated |
| `transfer.reversed` | Transfer reversed — investigate |
| `payout.paid` | Hunter's bank payout completed |
| `payout.failed` | Hunter's bank payout failed — action required |
| `charge.refunded` | Refund processed |
| `charge.dispute.created` | Chargeback opened — urgent action required |
| `radar.early_fraud_warning.created` | Fraud signal detected |

### 9.3 Outbox Worker Health

```sql
-- Check for stuck events (not processed after 5 minutes)
SELECT id, event_type, retry_count, created_at,
       NOW() - created_at AS age
FROM outbox_events
WHERE processed_at IS NULL
  AND created_at < NOW() - INTERVAL '5 minutes'
ORDER BY created_at;

-- Check failed events requiring manual intervention
SELECT id, event_type, retry_count, last_error, created_at
FROM outbox_events
WHERE retry_count >= 3
ORDER BY created_at DESC;
```

### 9.4 Retry Backoff Schedule

The outbox worker retries failed events with exponential backoff:

| Retry | Delay |
|---|---|
| 1st retry | 2 seconds |
| 2nd retry | 4 seconds |
| 3rd retry | 8 seconds |
| After 3rd failure | Event flagged for manual review |

---

## 10. CI/CD Integration

### 10.1 GitHub Actions

```yaml
name: Payment Flow Tests

on: [push, pull_request]

jobs:
  payment-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run payment unit tests
        run: npm test -- __tests__/unit/services/ --ci --maxWorkers=2
        env:
          NODE_ENV: test
          STRIPE_SECRET_KEY: sk_test_mock_key
          SUPABASE_URL: https://test.supabase.co
          SUPABASE_SERVICE_ROLE_KEY: test-service-role-key

      - name: Run payment integration & E2E tests
        run: |
          npm test -- \
            __tests__/integration/api/payment-flows.test.ts \
            __tests__/e2e/complete-payment-flows.test.ts \
            --ci --maxWorkers=2

      - name: Generate coverage report
        run: npm test -- --coverage --ci
        
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          flags: payment-tests
```

### 10.2 NPM Scripts

Add or verify these in `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest __tests__/unit/",
    "test:integration": "jest __tests__/integration/",
    "test:e2e": "jest __tests__/e2e/",
    "test:payment": "jest __tests__/unit/services/ __tests__/integration/api/payment-flows.test.ts __tests__/e2e/complete-payment-flows.test.ts",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --coverage --maxWorkers=2"
  }
}
```

### 10.3 Pre-commit Hook

Add to `.husky/pre-commit`:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"
npm test -- __tests__/unit/services/ --passWithNoTests --ci
```

---

## Success Criteria Checklist

Use this checklist before releasing payment features to production:

- [ ] Deposit funds to wallet via Stripe — balance updates correctly
- [ ] Escrow PaymentIntent created on bounty acceptance
- [ ] `payment_intent_id` stored in `bounties` table
- [ ] Funds held in Stripe (`requires_capture` or `succeeded`)
- [ ] Release captures PaymentIntent and transfers to Hunter's Connect account
- [ ] Platform fee (5%) deducted and recorded
- [ ] All transaction types logged in `wallet_transactions`
- [ ] Refund returns full amount to Poster on cancellation
- [ ] Double-release and double-refund both prevented
- [ ] Honor bounties skip payment flow entirely
- [ ] 3D Secure cards handled correctly
- [ ] Card declined and insufficient funds show user-friendly errors
- [ ] Hunter without Connect account blocked from payout
- [ ] Outbox worker retries failed events with backoff
- [ ] Email receipts sent for escrow, release, and refund
- [ ] All 206 automated tests pass with >80% coverage
- [ ] Stripe webhook events verified in Dashboard
- [ ] No sensitive data (card numbers, CVVs) stored in DB or logs
- [ ] All payment endpoints require authentication

---

## Related Documentation

| Document | Description |
|---|---|
| `PAYMENT_ESCROW_TESTING_GUIDE.md` | Detailed step-by-step escrow testing checklist |
| `PAYMENT_TESTING_GUIDE.md` | Automated test suite guide (Jest) |
| `PAYMENT_TEST_QUICK_REFERENCE.md` | Quick CLI commands for running payment tests |
| `TROUBLESHOOTING_PAYMENT_NETWORK.md` | Network connectivity troubleshooting (device ↔ API) |
| `PAYOUT_SYSTEM_TESTING_GUIDE.md` | Manual testing guide for Stripe Connect onboarding and withdrawals |
| `COMPLETE_ESCROW_PAYMENT_FLOW.md` | Implementation architecture and flow diagrams |
| `FINANCIAL_TRANSACTIONS_SPECIFICATION.md` | Financial operations specification |
| `PAYMENT_INTEGRATION_SECURITY_GUIDE.md` | PCI compliance, TLS, CSP requirements |
| `STRIPE_ESCROW_COMPLETE_GUIDE.md` | Complete Stripe integration walkthrough |
| `STRIPE_CONNECT_IMPLEMENTATION.md` | Stripe Connect account setup and management |
| `PAYMENT_MANAGEMENT_ARCHITECTURE.md` | System architecture and component hierarchy |
| `STRIPE_INTEGRATION.md` | Stripe SDK integration overview |
| `server/README.md` | Backend payment server documentation |

---

_Last updated: February 2026_  
_Maintained by: Development Team_  
_For questions, contact the engineering team or open a GitHub issue._
