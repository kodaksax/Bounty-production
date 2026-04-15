# Financial Flows Testing Guide

> **Scope:** Core financial features of BOUNTYExpo — payment processing, bounty escrow, bounty completion, dispute resolution, in-app payouts, bank/alternative-method withdrawals, and in-app money transfers.
>
> **Last updated:** 2026-04-15

---

## Table of Contents

1. [Prerequisites & Test Environment Setup](#1-prerequisites--test-environment-setup)
2. [Core Constraints & Validation Rules](#2-core-constraints--validation-rules)
3. [Payment Processing (Deposit / Add Money)](#3-payment-processing-deposit--add-money)
4. [Bounty Creation & Escrow](#4-bounty-creation--escrow)
5. [Bounty Completion & Payout (In-App)](#5-bounty-completion--payout-in-app)
6. [Dispute Resolution Flows](#6-dispute-resolution-flows)
7. [Withdrawal to Bank Account / Alternative Payment Methods](#7-withdrawal-to-bank-account--alternative-payment-methods)
8. [In-App Money Transfer](#8-in-app-money-transfer)
9. [Webhook & Idempotency Testing](#9-webhook--idempotency-testing)
10. [Security & Error-Handling Scenarios](#10-security--error-handling-scenarios)
11. [Test Data & Stripe Test Cards Reference](#11-test-data--stripe-test-cards-reference)

---

## 1. Prerequisites & Test Environment Setup

### 1.1 Required Accounts & Keys

| Resource | Purpose | Where to configure |
|---|---|---|
| Stripe **test-mode** secret key (`sk_test_…`) | Server-side Stripe calls | `.env.development` → `STRIPE_SECRET_KEY` |
| Stripe **publishable** key (`pk_test_…`) | Client-side Stripe SDK | `.env.development` → `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| Stripe **webhook secret** (`whsec_…`) | Verifying webhook signatures | `.env.development` → `STRIPE_WEBHOOK_SECRET` |
| Supabase project URL + anon key | Database & Edge Functions | `.env.development` → `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| Supabase **service-role** key | Admin RPC calls | Server env → `SUPABASE_SERVICE_ROLE_KEY` |

### 1.2 Database State

Before each test session, ensure:

- At least **two test user accounts** exist in `profiles`:
  - **Poster** (user who creates bounties)
  - **Hunter** (user who accepts and completes bounties)
- Both accounts have `onboarding_completed = true`.
- Stripe customers have been provisioned for each test user (column `profiles.stripe_customer_id`).
- The **Poster** account has a known wallet balance seeded directly into `profiles.balance` (e.g. `$500.00`).
- No open/pending wallet transactions or disputes exist for test users (clean state).

### 1.3 Running the Stripe CLI for Local Webhooks

```bash
# Forward Stripe events to the local webhook handler
stripe listen --forward-to http://localhost:3001/webhooks

# Or for the Supabase Edge Function variant:
stripe listen --forward-to http://localhost:54321/functions/v1/webhooks
```

### 1.4 Running the Test Suite

```bash
# Full test suite
npx jest

# Only financial/payment tests
npx jest --testPathPattern='payment|wallet|escrow|dispute'

# Typecheck (run before every PR)
npx tsc --noEmit
```

---

## 2. Core Constraints & Validation Rules

These rules are enforced at the database level and **must** be respected in every test case.

| Constraint | Value | Source |
|---|---|---|
| Minimum escrow amount | $1.00 (100 cents) | `lib/utils/bounty-validation.ts: MIN_ESCROW_CENTS` |
| Maximum escrow amount | $10,000.00 (1,000,000 cents) | `lib/utils/bounty-validation.ts: MAX_ESCROW_CENTS` |
| Minimum bounty title length | 5 characters | `lib/utils/bounty-validation.ts: validateTitle` |
| Minimum bounty description length | 20 characters | `lib/utils/bounty-validation.ts: validateDescription` |
| `wallet_transactions.status` allowed values | `pending`, `completed`, `failed` | DB CHECK constraint |
| `wallet_transactions.type` allowed values | `escrow`, `release`, `refund`, `deposit`, `withdrawal`, `dispute_loss` | DB CHECK constraint |
| `profiles.balance` non-negative | ≥ 0 | DB CHECK `check_balance_non_negative` |
| `profiles.balance_on_hold` non-negative | ≥ 0 | DB CHECK `check_balance_on_hold_non_negative` |
| Only one pending withdrawal per user | Unique partial index | `idx_wallet_tx_one_pending_withdrawal` |
| Only one completed escrow per bounty | Unique partial index | `idx_wallet_tx_one_escrow_per_bounty` |

---

## 3. Payment Processing (Deposit / Add Money)

### 3.1 Overview

Users fund their in-app wallet using a Stripe PaymentIntent. The flow is:

1. Client calls `POST /payments/create-payment-intent` → backend creates a Stripe PI.
2. Client confirms the payment via the Stripe React Native SDK (card or Apple Pay).
3. Client immediately calls `POST /wallet/deposit` with `{ amount, paymentIntentId }`.
4. Stripe sends `payment_intent.succeeded` webhook → backend idempotently calls `apply_deposit` RPC.

Both step 3 and step 4 call `apply_deposit`, which is **idempotent by `stripe_payment_intent_id`** — only the first call credits the balance.

### 3.2 Happy-Path Test Cases

#### TC-DEP-01: Standard card deposit

| Field | Value |
|---|---|
| **Test ID** | TC-DEP-01 |
| **Preconditions** | User is authenticated. Stripe customer exists. No prior deposit with this PI ID. |
| **Steps** | 1. Call `POST /payments/create-payment-intent` with `{ amount: 50 }`. <br>2. Confirm with Stripe test card `4242 4242 4242 4242`. <br>3. Call `POST /wallet/deposit` with returned PI ID. |
| **Expected outcome** | `wallet_transactions` row inserted with `type='deposit'`, `status='completed'`, `amount=50`. `profiles.balance` increases by 50. |
| **Validation query** | `SELECT balance FROM profiles WHERE id = '<user_id>'` |

#### TC-DEP-02: Apple Pay deposit (iOS only)

| Field | Value |
|---|---|
| **Test ID** | TC-DEP-02 |
| **Preconditions** | Running on an iOS device/simulator with Apple Pay configured. |
| **Steps** | 1. Call `applePayService.isAvailable()` — must return `true`. <br>2. Initiate Apple Pay payment for $25.00. <br>3. Confirm via Face ID / Touch ID. <br>4. Verify deposit endpoint called with valid PI. |
| **Expected outcome** | Same as TC-DEP-01: `deposit` transaction created, balance credited. |

#### TC-DEP-03: Duplicate webhook delivery (idempotency)

| Field | Value |
|---|---|
| **Test ID** | TC-DEP-03 |
| **Preconditions** | A deposit with PI ID `pi_test_001` already exists with `status='completed'`. |
| **Steps** | 1. Re-send `payment_intent.succeeded` webhook with same `pi_test_001`. <br>2. Call `POST /wallet/deposit` again with `pi_test_001`. |
| **Expected outcome** | `apply_deposit` RPC returns `applied=false`. **No second credit to balance**. Transaction count for this PI ID remains 1. |

### 3.3 Edge Cases & Failure Scenarios

#### TC-DEP-04: Insufficient card funds

| Field | Value |
|---|---|
| **Test ID** | TC-DEP-04 |
| **Stripe test card** | `4000 0000 0000 9995` (insufficient funds) |
| **Expected outcome** | Stripe PI has status `payment_failed`. Client receives an error object with `type='card_error'`. No `wallet_transactions` row inserted. `profiles.balance` unchanged. |

#### TC-DEP-05: Amount below minimum

| Field | Value |
|---|---|
| **Test ID** | TC-DEP-05 |
| **Steps** | Send `POST /wallet/deposit` with `amount=0` or `amount=-1`. |
| **Expected outcome** | API returns `400 Bad Request`. No DB write. |

#### TC-DEP-06: 3D Secure / SCA authentication required

| Field | Value |
|---|---|
| **Test ID** | TC-DEP-06 |
| **Stripe test card** | `4000 0027 6000 3184` (3DS required) |
| **Expected outcome** | PI reaches `requires_action` status. Client presents 3DS modal. On successful authentication, `payment_intent.succeeded` fires and balance is credited normally. On cancellation/failure, no balance change. |

#### TC-DEP-07: Network timeout during deposit confirmation

| Field | Value |
|---|---|
| **Test ID** | TC-DEP-07 |
| **Steps** | Simulate a network drop after the Stripe PI is confirmed client-side but before `POST /wallet/deposit` is called. Re-send the deposit call after recovery. |
| **Expected outcome** | Because `apply_deposit` is idempotent, the second call succeeds with `applied=true` if the webhook has not yet arrived, or `applied=false` if the webhook beat the client. Either way, balance is credited exactly once. |

---

## 4. Bounty Creation & Escrow

### 4.1 Overview

1. Poster fills out the bounty creation form (title ≥ 5 chars, description ≥ 20 chars, amount $1–$10,000 or `is_for_honor=true`).
2. On accept by a hunter, `fn_accept_bounty_request` RPC is called (SECURITY DEFINER) — atomically transitions bounty to `in_progress` and bounty request to `accepted`.
3. The `apply_escrow` RPC is called to atomically deduct the bounty amount from the poster's balance and record the escrow transaction.

### 4.2 Happy-Path Test Cases

#### TC-ESC-01: Monetary bounty — successful escrow

| Field | Value |
|---|---|
| **Test ID** | TC-ESC-01 |
| **Preconditions** | Poster balance ≥ bounty amount ($50). No existing escrow for this bounty ID. |
| **Steps** | 1. Create bounty with `amount=50, is_for_honor=false`. <br>2. Hunter applies. <br>3. Poster accepts request via `fn_accept_bounty_request`. <br>4. `apply_escrow` is called server-side. |
| **Expected outcome** | `wallet_transactions` row with `type='escrow'`, `status='completed'`, `amount=-50` (negative = debit). `profiles.balance` decreases by 50. Bounty status = `in_progress`. |

#### TC-ESC-02: Honor bounty — no escrow required

| Field | Value |
|---|---|
| **Test ID** | TC-ESC-02 |
| **Steps** | 1. Create bounty with `is_for_honor=true`, `amount=0`. <br>2. Hunter applies & poster accepts. |
| **Expected outcome** | **No** `wallet_transactions` row of type `escrow` is created. Bounty transitions to `in_progress`. Poster balance unchanged. |

#### TC-ESC-03: Daily creation limit enforcement

| Field | Value |
|---|---|
| **Test ID** | TC-ESC-03 |
| **Preconditions** | Poster has already created 10 bounties today. |
| **Steps** | Attempt to create an 11th bounty. |
| **Expected outcome** | API or client-side guard rejects the request with an appropriate error message (daily limit = 10 per `bounty-service.ts`). |

### 4.3 Edge Cases & Failure Scenarios

#### TC-ESC-04: Concurrent escrow — race condition guard

| Field | Value |
|---|---|
| **Test ID** | TC-ESC-04 |
| **Steps** | Send two simultaneous `apply_escrow` calls for the **same bounty ID**. |
| **Expected outcome** | Only one succeeds (`applied=true`). The second returns `applied=false` (409-equivalent). Poster's balance is deducted **exactly once**. The unique partial index `idx_wallet_tx_one_escrow_per_bounty` prevents a second completed escrow row. |

#### TC-ESC-05: Insufficient balance for escrow

| Field | Value |
|---|---|
| **Test ID** | TC-ESC-05 |
| **Preconditions** | Poster balance = $10. Bounty amount = $50. |
| **Steps** | Attempt to call `apply_escrow` for a $50 bounty. |
| **Expected outcome** | RPC raises SQLSTATE `23514` (insufficient funds). No `wallet_transactions` row inserted. Poster balance unchanged. API responds with a user-friendly error. |

#### TC-ESC-06: Escrow with balance_on_hold (active dispute)

| Field | Value |
|---|---|
| **Test ID** | TC-ESC-06 |
| **Preconditions** | Poster balance = $100. `balance_on_hold = $80` (due to open dispute). Bounty amount = $30. |
| **Steps** | Attempt `apply_escrow` for a new $30 bounty. |
| **Expected outcome** | Available = $100 − $80 = $20 < $30 → escrow rejected. Error indicates held funds. Poster balance unchanged. |

---

## 5. Bounty Completion & Payout (In-App)

### 5.1 Overview

1. Hunter submits a `completion_submissions` record with proof items.
2. The hunter calls `POST /completion/ready` (via Edge Function or relay API) to signal readiness.
3. Poster reviews the proof and approves or requests revision.
4. On approval, the backend calls `apply_escrow_release` (or equivalent) to transfer funds: escrowed amount minus platform fee is credited to the hunter's in-app balance.

### 5.2 Completion Submission States

| Status | Description |
|---|---|
| `pending` | Submitted, awaiting poster review |
| `approved` | Poster accepted the submission; payout triggered |
| `rejected` | Poster rejected the submission |
| `revision_requested` | Poster asked for changes |

### 5.3 Happy-Path Test Cases

#### TC-COMP-01: Successful completion and fund release

| Field | Value |
|---|---|
| **Test ID** | TC-COMP-01 |
| **Preconditions** | Bounty in `in_progress` with completed escrow. Hunter has submitted proof. |
| **Steps** | 1. Hunter marks completion via `POST /completion/ready`. <br>2. Poster approves the submission. <br>3. Backend releases escrow. |
| **Expected outcome** | `wallet_transactions` row with `type='release'`, `status='completed'`. Hunter's `profiles.balance` increases by `(bounty_amount − platform_fee)`. Bounty status = `completed`. Platform ledger records the fee. |

#### TC-COMP-02: Revision requested then re-submitted and approved

| Field | Value |
|---|---|
| **Test ID** | TC-COMP-02 |
| **Steps** | 1. Hunter submits proof. <br>2. Poster requests revision (`status='revision_requested'`). <br>3. Hunter re-submits updated proof (`revision_count` increments). <br>4. Poster approves. |
| **Expected outcome** | Final state identical to TC-COMP-01. `revision_count` correctly reflects the number of revision cycles. |

#### TC-COMP-03: Auto-release on timeout (if configured)

| Field | Value |
|---|---|
| **Test ID** | TC-COMP-03 |
| **Steps** | Set `auto_close_at` to a time in the past and trigger the stale bounty job. |
| **Expected outcome** | Bounty auto-releases escrow. `wallet_transactions` row type `release`, status `completed`. |

### 5.4 Edge Cases & Failure Scenarios

#### TC-COMP-04: Duplicate release attempt

| Field | Value |
|---|---|
| **Test ID** | TC-COMP-04 |
| **Steps** | Call the release endpoint twice for the same bounty. |
| **Expected outcome** | Second call is a no-op (idempotent). Hunter's balance is credited exactly once. |

#### TC-COMP-05: Release blocked — balance_frozen

| Field | Value |
|---|---|
| **Test ID** | TC-COMP-05 |
| **Preconditions** | Hunter's `balance_frozen = true` (open Stripe chargeback). |
| **Steps** | Attempt to release funds to hunter's wallet. |
| **Expected outcome** | `assert_profile_balance_not_frozen` raises, release blocked. API returns error. Poster's escrow remains held. |

#### TC-COMP-06: Poster rejects submission

| Field | Value |
|---|---|
| **Test ID** | TC-COMP-06 |
| **Steps** | Poster rejects the completion submission. |
| **Expected outcome** | Submission `status='rejected'`. No balance changes. Escrow remains held. Poster can optionally open a dispute or cancel the bounty. |

---

## 6. Dispute Resolution Flows

### 6.1 Overview

BOUNTYExpo has two distinct dispute tracks:

| Track | Trigger | Tables involved | Balance impact |
|---|---|---|---|
| **App-level dispute** | Poster/hunter initiates via cancellation flow | `bounty_cancellations`, `bounty_disputes`, `dispute_resolutions` | `balance_on_hold` (partial freeze on poster) |
| **Stripe chargeback** | Stripe sends `charge.dispute.created` webhook | `bounty_disputes` (with `stripe_dispute_id`) | `balance_frozen = true` (full wallet freeze) |

### 6.2 App-Level Dispute Flow

#### TC-DISP-01: Hunter-initiated cancellation request → dispute opened by poster

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-01 |
| **Preconditions** | Bounty `in_progress`. Valid escrow in place. |
| **Steps** | 1. Hunter calls `cancellationService.createCancellationRequest(...)` with `requesterType='hunter'`. <br>2. Poster disputes the cancellation request. <br>3. `disputeService` opens a `bounty_disputes` row with `status='open'`. <br>4. `fn_open_dispute_hold` is called to place `balance_on_hold` on the poster. |
| **Expected outcome** | `bounty_disputes` row created, `status='open'`. Poster's `balance_on_hold` increases by up to `bounty_amount` (capped at poster's current balance). Poster cannot withdraw the held amount. |

#### TC-DISP-02: Admin resolves — hunter wins

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-02 |
| **Steps** | 1. Admin calls `fn_close_dispute_hold(dispute_id, 'resolved_hunter_wins')`. |
| **Expected outcome** | `bounty_disputes.status = 'resolved_hunter_wins'`. `balance_on_hold` reset to 0. Poster's `balance` is debited by `hold_amount` (using `GREATEST(0, balance - hold_amount)` guard). `dispute_resolutions` record created by admin. |

#### TC-DISP-03: Admin resolves — poster wins

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-03 |
| **Steps** | 1. Admin calls `fn_close_dispute_hold(dispute_id, 'resolved_poster_wins')`. |
| **Expected outcome** | `bounty_disputes.status = 'resolved_poster_wins'`. `balance_on_hold` reset to 0. Poster's `balance` **unchanged**. Escrow may be refunded to poster. |

#### TC-DISP-04: Admin resolves — cancelled

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-04 |
| **Steps** | 1. Admin calls `fn_close_dispute_hold(dispute_id, 'cancelled')`. |
| **Expected outcome** | Hold released. No balance deduction. Dispute closed. |

#### TC-DISP-05: Dispute hold is idempotent

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-05 |
| **Steps** | Call `fn_open_dispute_hold` twice for the same dispute. |
| **Expected outcome** | Second call is a no-op (guard on `hold_amount > 0`). `balance_on_hold` is not double-incremented. |

#### TC-DISP-06: Honor bounty cancellation (no hold required)

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-06 |
| **Preconditions** | Bounty has `is_for_honor=true`. |
| **Steps** | Requester cancels. |
| **Expected outcome** | `cancellationService` sets `status='cancelled'` and `response='Auto-accepted'`. No dispute record created. No balance changes. |

### 6.3 Stripe Chargeback Dispute Flow

#### TC-DISP-07: charge.dispute.created received

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-07 |
| **Steps** | 1. Send Stripe test webhook event `charge.dispute.created` to `/webhooks`. <br>2. Signature must be valid (use `stripe-cli` to sign). |
| **Expected outcome** | `bounty_disputes` row upserted with `status='stripe_dispute'`, `stripe_dispute_id` populated. `profiles.balance_frozen = true` for the affected user. User cannot withdraw funds. |

#### TC-DISP-08: charge.dispute.closed — won

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-08 |
| **Steps** | Send `charge.dispute.closed` with `reason='resolved'` and `status='won'`. |
| **Expected outcome** | `bounty_disputes.status = 'resolved_won'`. `profiles.balance_frozen = false`. User may withdraw funds again. No balance deduction. |

#### TC-DISP-09: charge.dispute.closed — lost

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-09 |
| **Steps** | Send `charge.dispute.closed` with `status='lost'`. |
| **Expected outcome** | `apply_dispute_loss_transaction` RPC called: `wallet_transactions` row `type='dispute_loss'` inserted, user's `balance` debited. `profiles.balance_frozen = false`. |

#### TC-DISP-10: Stripe chargeback webhook replay (idempotency)

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-10 |
| **Steps** | Deliver the same `charge.dispute.closed` (lost) webhook twice. |
| **Expected outcome** | Second delivery: `idx_wallet_tx_stripe_dispute_id_dispute_loss` partial unique index causes `apply_dispute_loss_transaction` to return the existing row (`applied=false`). Balance is debited exactly once. |

### 6.4 Evidence Submission

#### TC-DISP-11: Uploading dispute evidence

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-11 |
| **Steps** | 1. Dispute party uploads evidence (image URL or text). <br>2. `dispute_evidence` row is inserted. |
| **Expected outcome** | Record created with correct `type`, `content`, `uploaded_by`, and `dispute_id`. Only `text`, `image`, `document`, or `link` types accepted (CHECK constraint). |

#### TC-DISP-12: Unauthorized evidence submission (wrong user)

| Field | Value |
|---|---|
| **Test ID** | TC-DISP-12 |
| **Steps** | Third-party user (not poster or hunter) attempts to insert evidence. |
| **Expected outcome** | Supabase RLS policy denies insert. Returns `403`. |

---

## 7. Withdrawal to Bank Account / Alternative Payment Methods

### 7.1 Overview

Withdrawals transfer the user's in-app balance to their bank account via **Stripe Connect**. Prerequisites:

- `profiles.stripe_connect_account_id` is set and onboarded.
- `profiles.stripe_connect_payouts_enabled = true`.
- `profiles.balance_frozen = false`.
- `profiles.balance − profiles.balance_on_hold ≥ withdrawal_amount`.

The `withdraw_balance(user_id, amount)` RPC atomically enforces all balance constraints before debiting. A pending withdrawal prevents a second one (`idx_wallet_tx_one_pending_withdrawal` unique index).

### 7.2 Happy-Path Test Cases

#### TC-WDRAW-01: Successful withdrawal to connected bank account

| Field | Value |
|---|---|
| **Test ID** | TC-WDRAW-01 |
| **Preconditions** | Stripe Connect account onboarded and `payouts_enabled=true`. `balance ≥ withdrawal_amount`. `balance_frozen=false`, `balance_on_hold=0`. No pending withdrawal. |
| **Steps** | 1. User initiates withdrawal for $100. <br>2. Server calls `withdraw_balance(user_id, 100)`. <br>3. Server calls `stripe.transfers.create(...)` to move funds to connected account. <br>4. Stripe sends `transfer.created` webhook. <br>5. Stripe sends `transfer.paid` webhook. |
| **Expected outcome** | Step 2: `profiles.balance` decreases by 100. `wallet_transactions` row `type='withdrawal'`, `status='pending'` inserted. Step 4: `stripe_transfer_id` written to tx row. Step 5: tx `status='completed'`. |

#### TC-WDRAW-02: Stripe Connect onboarding flow

| Field | Value |
|---|---|
| **Test ID** | TC-WDRAW-02 |
| **Steps** | 1. User taps "Connect Bank Account". <br>2. `openUrlInBrowser(onboardingUrl)` launches Stripe Connect OAuth. <br>3. User completes onboarding. <br>4. `account.updated` webhook fires. |
| **Expected outcome** | `profiles.stripe_connect_account_id` populated. `stripe_connect_payouts_enabled=true`, `stripe_connect_charges_enabled=true`. User is directed back to the app. |

### 7.3 Edge Cases & Failure Scenarios

#### TC-WDRAW-03: Withdrawal blocked — balance_frozen

| Field | Value |
|---|---|
| **Test ID** | TC-WDRAW-03 |
| **Preconditions** | `profiles.balance_frozen = true`. |
| **Steps** | Attempt withdrawal. |
| **Expected outcome** | `withdraw_balance` raises with error code `P0001`, hint: "Resolve all open Stripe disputes before withdrawing." API returns `403` or equivalent. No balance change. |

#### TC-WDRAW-04: Withdrawal blocked — held balance

| Field | Value |
|---|---|
| **Test ID** | TC-WDRAW-04 |
| **Preconditions** | `balance = $50`, `balance_on_hold = $40`. Requested withdrawal = $20. |
| **Steps** | Attempt withdrawal of $20. |
| **Expected outcome** | `withdraw_balance` computes available = $50 − $40 = $10 < $20 → raises SQLSTATE `23514`. API returns error: "Part of your balance is reserved by an open dispute." |

#### TC-WDRAW-05: Concurrent withdrawal prevention

| Field | Value |
|---|---|
| **Test ID** | TC-WDRAW-05 |
| **Steps** | Simultaneously initiate two withdrawal requests for the same user. |
| **Expected outcome** | One succeeds and inserts `status='pending'`. The second hits `idx_wallet_tx_one_pending_withdrawal` and receives a conflict error. No double debit. |

#### TC-WDRAW-06: Stripe Connect not onboarded

| Field | Value |
|---|---|
| **Test ID** | TC-WDRAW-06 |
| **Preconditions** | `profiles.stripe_connect_account_id = null`. |
| **Steps** | User attempts withdrawal. |
| **Expected outcome** | Pre-flight check rejects the request with a message instructing the user to complete Stripe Connect onboarding. No DB writes. |

#### TC-WDRAW-07: Transfer fails after balance deduction

| Field | Value |
|---|---|
| **Test ID** | TC-WDRAW-07 |
| **Steps** | 1. `withdraw_balance` succeeds (balance debited). <br>2. `stripe.transfers.create(...)` throws a Stripe API error. |
| **Expected outcome** | `wallet_transactions` row exists with `type='withdrawal'`, `status='failed'`, `payout_failed_at` set. `profiles.balance` has been debited (this is expected — the payout failure is surfaced to the user for re-initiation or admin correction). The transaction should be surfaced in the user's transaction history as failed. |

#### TC-WDRAW-08: Withdrawal amount below platform minimum

| Field | Value |
|---|---|
| **Test ID** | TC-WDRAW-08 |
| **Steps** | Attempt withdrawal of $0 or a negative amount. |
| **Expected outcome** | `withdraw_balance` raises: "Withdrawal amount must be positive." API returns `400`. |

---

## 8. In-App Money Transfer

### 8.1 Overview

In-app transfers move funds directly between two users' wallet balances without leaving the platform (no Stripe charge). They are recorded as paired `wallet_transactions` rows: a debit from the sender and a credit to the recipient.

### 8.2 Happy-Path Test Cases

#### TC-TRANSFER-01: Successful peer-to-peer transfer

| Field | Value |
|---|---|
| **Test ID** | TC-TRANSFER-01 |
| **Preconditions** | Sender balance ≥ transfer amount. Neither party has `balance_frozen=true`. |
| **Steps** | 1. Sender initiates transfer to recipient for $20. <br>2. Server atomically debits sender and credits recipient. |
| **Expected outcome** | Sender `balance` decreases by $20. Recipient `balance` increases by $20. Two `wallet_transactions` rows (or one paired row) with `status='completed'`. |

#### TC-TRANSFER-02: Transfer within escrow release (bounty payout)

> The escrow release on bounty completion is the primary in-app transfer mechanism. See TC-COMP-01.

### 8.3 Edge Cases & Failure Scenarios

#### TC-TRANSFER-03: Transfer exceeds available balance

| Field | Value |
|---|---|
| **Test ID** | TC-TRANSFER-03 |
| **Preconditions** | Sender `balance=$10`, `balance_on_hold=$5`. Transfer amount = $8. |
| **Steps** | Initiate transfer. |
| **Expected outcome** | Transfer rejected (available = $5 < $8). No balance changes. |

#### TC-TRANSFER-04: Transfer to self

| Field | Value |
|---|---|
| **Test ID** | TC-TRANSFER-04 |
| **Steps** | Sender attempts to transfer to their own user ID. |
| **Expected outcome** | API validates that sender ≠ recipient and rejects with a meaningful error. |

#### TC-TRANSFER-05: Transfer while sender balance is frozen

| Field | Value |
|---|---|
| **Test ID** | TC-TRANSFER-05 |
| **Preconditions** | Sender `balance_frozen = true`. |
| **Steps** | Initiate transfer. |
| **Expected outcome** | `assert_profile_balance_not_frozen` raises. Transfer blocked. |

---

## 9. Webhook & Idempotency Testing

### 9.1 Stripe Event Idempotency Matrix

| Event | RPC / handler | Idempotency mechanism | Expected on retry |
|---|---|---|---|
| `payment_intent.succeeded` | `apply_deposit` | Unique index on `stripe_payment_intent_id` (type=deposit) | `applied=false`, balance unchanged |
| `charge.refunded` | `apply_refund` | Partial unique index on `stripe_refund_id` | `applied=false`, balance unchanged |
| `charge.dispute.created` | Upsert on `stripe_dispute_id` | Unique index `idx_bounty_disputes_stripe_dispute_id` | No-op |
| `charge.dispute.closed` | `apply_dispute_loss_transaction` | Unique index `idx_wallet_tx_stripe_dispute_id_dispute_loss` | Returns existing row |
| `transfer.created` | Update `stripe_transfer_id` | `.is('stripe_transfer_id', null)` filter | Matches 0 rows, no-op |
| `transfer.paid` | Update `status='completed'` | Idempotent UPDATE | No-op |

### 9.2 Webhook Signature Validation

#### TC-WH-01: Invalid webhook signature

| Field | Value |
|---|---|
| **Test ID** | TC-WH-01 |
| **Steps** | Send a webhook request with a tampered or missing `Stripe-Signature` header. |
| **Expected outcome** | Server returns `400 Bad Request`. No DB writes. Event logged for monitoring. |

#### TC-WH-02: Replayed event with valid signature

| Field | Value |
|---|---|
| **Test ID** | TC-WH-02 |
| **Steps** | Replay a valid, previously processed `payment_intent.succeeded` event. |
| **Expected outcome** | `stripe_events` table check (`processed=true`) prevents double processing. Balance unchanged. Response `200 OK` (Stripe won't retry). |

---

## 10. Security & Error-Handling Scenarios

### 10.1 Authentication & Authorization

| Test ID | Scenario | Expected outcome |
|---|---|---|
| TC-SEC-01 | Call `POST /wallet/deposit` without Authorization header | `401 Unauthorized` |
| TC-SEC-02 | Call `POST /wallet/deposit` with expired JWT | `401 Unauthorized` |
| TC-SEC-03 | Call `withdraw_balance` RPC directly as `authenticated` role | REVOKED — PostgreSQL permission error |
| TC-SEC-04 | Call `fn_open_dispute_hold` directly as `authenticated` role | REVOKED — PostgreSQL permission error |
| TC-SEC-05 | User A accesses User B's wallet transactions via API | RLS denies; only own rows returned |
| TC-SEC-06 | Non-admin user attempts to resolve a dispute | `verifyAdminRole()` returns `false`; API returns `403` |

### 10.2 Input Validation & Injection

| Test ID | Scenario | Expected outcome |
|---|---|---|
| TC-SEC-07 | Send `amount='<script>alert(1)</script>'` in deposit body | `sanitizeText()` / `sanitizePositiveNumber()` rejects or strips; `400` returned |
| TC-SEC-08 | Send bounty title containing SQL injection pattern | PostgREST parameterized queries prevent injection; record not created or stored safely |
| TC-SEC-09 | Send bounty search query with PostgREST special chars (`,`, `(`, `)`) | `escapeIlike` + `quotePostgrestValue` sanitize the query; no filter-parse exploit |

### 10.3 Balance Consistency

| Test ID | Scenario | Expected outcome |
|---|---|---|
| TC-SEC-10 | `profiles.balance` differs from sum of `wallet_transactions.amount` for user | All three balance endpoints auto-reconcile when cached balance = 0 (cross-check logic in `consolidated-wallet-service.ts`) |
| TC-SEC-11 | Attempt to create negative balance via concurrent escrow + withdrawal | DB CHECK `check_balance_non_negative` and `update_balance` atomic RPC prevent this |

---

## 11. Test Data & Stripe Test Cards Reference

### 11.1 Stripe Test Cards

| Card number | Scenario |
|---|---|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0025 0000 3155` | Requires 3DS authentication |
| `4000 0027 6000 3184` | 3DS required — always authenticated |
| `4100 0000 0000 0019` | Always blocked (fraud) |
| `4000 0000 0000 0002` | Card declined |

> Use expiry `12/34`, any 3-digit CVV, and any 5-digit ZIP.

### 11.2 Sample Seed SQL

```sql
-- Poster test account
INSERT INTO profiles (id, username, email, balance, onboarding_completed)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'test_poster', 'poster@test.bounty', 500.00, true),
  ('00000000-0000-0000-0000-000000000002', 'test_hunter', 'hunter@test.bounty', 0.00, true);

-- Clean up between tests
UPDATE profiles SET balance = 500.00, balance_on_hold = 0, balance_frozen = false
WHERE id = '00000000-0000-0000-0000-000000000001';

UPDATE profiles SET balance = 0.00, balance_on_hold = 0, balance_frozen = false
WHERE id = '00000000-0000-0000-0000-000000000002';

DELETE FROM wallet_transactions WHERE user_id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);

DELETE FROM bounty_disputes WHERE initiator_id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);
```

### 11.3 Validation Criteria Summary

Each test case passes when **all** of the following hold:

1. **HTTP response code** matches the expected value (`2xx` for success, `4xx`/`5xx` for failure).
2. **Database state** reflects the expected changes (or non-changes) exactly.
3. **`profiles.balance`** equals the transaction-derived balance (sum of signed `wallet_transactions.amount` for that user).
4. **Idempotent operations** produce the same observable result when called more than once.
5. **No orphaned transactions** exist (e.g., escrow row without a corresponding balance deduction).
6. **Security constraints** — RLS policies and REVOKED permissions — block unauthorized access.
7. **Stripe webhook events** receive a `200 OK` response so Stripe does not retry unnecessarily.

---

## Related Documentation

- [`docs/payments/FINANCIAL_TRANSACTIONS_SPECIFICATION.md`](../payments/FINANCIAL_TRANSACTIONS_SPECIFICATION.md) — canonical financial flow reference
- [`docs/payments/PAYMENT_ESCROW_TESTING_GUIDE.md`](../payments/PAYMENT_ESCROW_TESTING_GUIDE.md) — detailed escrow testing
- [`docs/payments/PAYOUT_SYSTEM_TESTING_GUIDE.md`](../payments/PAYOUT_SYSTEM_TESTING_GUIDE.md) — Stripe Connect payout testing
- [`docs/payments/WITHDRAWAL_FLOW_ARCHITECTURE.md`](../payments/WITHDRAWAL_FLOW_ARCHITECTURE.md) — withdrawal architecture
- [`docs/testing/E2E_BOUNTY_FLOW_TESTING.md`](E2E_BOUNTY_FLOW_TESTING.md) — end-to-end bounty lifecycle tests
- [`supabase/migrations/`](../../supabase/migrations/) — authoritative DB schema and RPC definitions
