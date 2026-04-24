# Payment System Analysis — BOUNTYExpo

> **Last updated:** 2026-03-28  
> **Scope:** Full review of client-side payment services, backend payment routes, wallet service, and Stripe integration.

---

## 1. Architecture Overview

```
Mobile App (Expo / React Native)
  └── lib/stripe-context.tsx          → React context; auth-guards all payment actions
  └── lib/services/stripe-service.ts  → Low-level Stripe SDK + REST calls (1 930 lines)
  └── lib/services/payment-service.ts → Business-logic wrapper over stripe-service
  └── lib/services/apple-pay-service.ts → Apple Pay specific flows

API Server (Fastify / Node)
  └── services/api/src/routes/payments.ts           → REST endpoints (auth-gated)
  └── services/api/src/routes/wallet.ts             → Wallet CRUD + balance
  └── services/api/src/routes/apple-pay.ts          → Apple Pay routes
  └── services/api/src/services/consolidated-wallet-service.ts → Ledger + balance
  └── services/api/src/services/consolidated-payment-service.ts → Stripe singleton
  └── services/api/src/services/wallet-service.ts   → Legacy thin wrapper (still used by release route)
  └── services/api/src/services/stripe-connect-service.ts → Hunter payout accounts

Database (Supabase / PostgreSQL)
  └── wallet_transactions              → Ledger of all money movements
  └── profiles.balance                 → Denormalised balance (authoritative after migrations)
  └── stripe_events                    → Webhook idempotency log
  └── payment_methods                  → Saved payment methods per user
```

### End-to-End Payment Flow

```
Poster creates bounty
    → Poster deposits funds (PaymentIntent → wallet_deposit)
    → Hunter accepts bounty (createEscrow → manual-capture PaymentIntent)
    → Bounty completed → Poster marks complete
    → releaseEscrow → capture PaymentIntent + Stripe Transfer → hunter wallet
    → If bounty cancelled → refundEscrow → cancel/refund PaymentIntent → poster wallet
```

---

## 2. Changes Made in This Cleanup

### 2.1 Critical Bug Fixed: Incomplete `/payments/escrows` POST Handler

**File:** `services/api/src/routes/payments.ts`

The `POST /payments/escrows` handler had input-parsing and idempotency logic but then
**fell through without creating a PaymentIntent or returning any data**.  
Every client call to `stripeService.createEscrow()` would receive an empty/undefined
response and throw `"Missing escrowId or client secret"`.

**Fix:** Implemented the missing body of the handler:
1. Validates required fields (`bountyId`, `posterId`, `hunterId`, `amountCents ≥ 100`).
2. Enforces that only the poster (`posterId === request.userId`) can create an escrow.
3. Creates a Stripe `PaymentIntent` with `capture_method: 'manual'` and appropriate metadata.
4. Returns `{ escrowId, paymentIntentId, paymentIntentClientSecret, status }`.

### 2.2 Logging: Replaced `console.error/warn` with structured `logger`

**Files:** `lib/services/payment-service.ts`, `lib/services/stripe-service.ts`, `lib/stripe-context.tsx`

The project convention is to use `logger` from `lib/utils/error-logger` for all
client-side services (buffers offline log entries, normalises `Error` objects for the
React Native developer overlay).  All `console.error` / `console.warn` calls in the
three payment files (≈ 36 occurrences) were replaced with `logger.error` / `logger.warning`
with the `{ error }` context shape expected by the logger's normalisation pass.

---

## 3. Current State (Post-Cleanup)

### ✅ What Is Working Well

| Area | Status | Notes |
|------|--------|-------|
| Wallet deposit (card) | ✅ Complete | PaymentIntent → webhook → `createDeposit` |
| Wallet deposit (Apple Pay) | ✅ Complete | `apple-pay-service.ts` + `/apple-pay` routes |
| Save/list/remove payment methods | ✅ Complete | SetupIntent + Stripe customer |
| Escrow creation (POST /payments/escrows) | ✅ **Fixed** | Was empty; now creates manual-capture PaymentIntent |
| Escrow release (POST /payments/escrows/:id/release) | ✅ Complete | Captures PI + Stripe Transfer to hunter |
| Escrow refund | ✅ Complete | Cancel/refund PI → poster wallet |
| Webhook verification | ✅ Complete | HMAC sig + idempotency via Redis/local |
| Replay attack protection | ✅ Complete | `stripe_events` table + idempotency service |
| Idempotency keys | ✅ Complete | All mutation endpoints accept `idempotencyKey` |
| 3DS / SCA handling | ✅ Complete | `handleNextAction` + `requiresAction` path |
| Stripe Connect (hunter payouts) | ✅ Complete | `consolidated-stripe-connect-service.ts` |
| Platform fee (10% on release) | ✅ Complete | Hardcoded in release route; configurable via `config.stripe.platformFeePercent` |
| Input validation | ✅ Complete | zod schemas on most routes |

### ✅ Fixed in This PR (Previously Broken)

1. **In-memory `customerIds` Map**  
   Stripe Customer IDs were cached only in memory; a process restart lost all mappings,
   causing duplicate Stripe customers per user.  
   **Fixed:** `getOrCreateStripeCustomer()` now reads/writes `profiles.stripe_customer_id`
   in Supabase. The local `getStripeCustomerId()` helper also queries the DB.

2. **Hunter balance not credited after escrow release**  
   The escrow-release handler used `walletService.createTransaction()` which records a
   ledger row but does NOT update `profiles.balance`.  
   **Fixed:** Added `ConsolidatedWalletService.updateBalance(hunterId, ...)` after the
   transaction is recorded to credit the hunter's balance.

### ⚠️ Known Limitations / Technical Debt

#### HIGH PRIORITY

1. **`platform_fee` transaction uses a hardcoded zero-UUID** (`PLATFORM_ACCOUNT_ID`)  
   `00000000-0000-0000-0000-000000000000` is used as the platform user ID.  This must be
   replaced with a real platform account UUID (or a dedicated ledger mechanism).

#### MEDIUM PRIORITY

2. **`stripe-service.ts` is 1 930 lines**  
   The file handles SDK initialisation, PaymentIntents, SetupIntents, payment methods,
   escrow, Apple Pay, Stripe Connect, and utility helpers.  Splitting into focused modules
   (`escrow-service.ts`, `payment-methods-service.ts`, `connect-service.ts`) would improve
   readability and testability.

3. **`processPayment` in `StripeProvider` (lib/stripe-context.tsx)**  
   Uses `createPaymentIntent` (no idempotency) rather than `createPaymentIntentSecure`.
   Consider deprecating `processPayment` in favour of `processPaymentSecure`.

4. **`_getPaymentReceiptNotImplemented` placeholder**  
   This method in `payment-service.ts` throws unconditionally and has a prefixed underscore
   name.  It should be removed until the backend endpoint exists.

5. **Webhook handlers with `TODO:` stubs** (several events in `payments.ts`)  
   `payment_intent.payment_failed`, `setup_intent.succeeded`, `charge.refunded`,
   `payout.paid`, `account.updated` all have TODO comments.  These are required for production
   reliability (user notifications, dispute handling, account status sync).

#### LOW PRIORITY

8. **Inconsistent `TransactionType` between services**  
   `consolidated-wallet-service.ts` defines `TransactionType = 'deposit' | 'withdrawal' | 'escrow' | 'release' | 'refund'`  
   but `wallet-service.ts` uses a loose `string` and the release route passes `'platform_fee'`
   which is not in the union.  Centralise the type and add `'platform_fee'`.

9. **Duplicate documentation folder** (`docs/payments/` has 50 files)  
   Most files are implementation summaries from past development sprints.  Consider archiving
   all but the essential reference files (STRIPE_INTEGRATION.md, STRIPE_CONNECT_IMPLEMENTATION.md,
   FINANCIAL_TRANSACTIONS_SPECIFICATION.md, and this file).

---

## 4. Future Enhancements / Next Steps

### Short-Term (Before Launch)

| Priority | Task |
|----------|------|
| ✅ Done | Migrate `customerIds` Map to database (`profiles.stripe_customer_id`) — completed in this PR |
| ✅ Done | Fix escrow-release hunter balance credit — completed in this PR |
| 🔴 Critical | Implement webhook stubs: `payment_intent.payment_failed`, `setup_intent.succeeded`, `charge.refunded` |
| 🔴 Critical | Implement real `PLATFORM_ACCOUNT_ID` or dedicated ledger row for platform fees |
| 🟠 High | Add input validation schemas (zod) for `POST /payments/escrows` body fields |

### Medium-Term (Post-Launch)

| Priority | Task |
|----------|------|
| 🟡 Medium | Split `stripe-service.ts` into focused modules |
| 🟡 Medium | Remove `_getPaymentReceiptNotImplemented`; implement receipt retrieval via `/payments/:id/receipt` |
| 🟡 Medium | Deprecate `processPayment` in `StripeProvider`; use `processPaymentSecure` everywhere |
| 🟡 Medium | Implement `payout.paid` / `payout.failed` webhook handlers (notify hunters) |
| 🟡 Medium | Add webhook handler for `account.updated` to sync Stripe Connect status to DB |
| 🟡 Medium | Add e2e integration tests for the full escrow lifecycle (create → confirm → release) |

### Long-Term

| Priority | Task |
|----------|------|
| 🟢 Low | Dispute / chargeback handling: freeze funds on `charge.dispute.created`, resolve on `charge.dispute.closed` |
| 🟢 Low | Multi-currency support (currently US-only via `currency: 'usd'`) |
| 🟢 Low | Recurring bounties / subscriptions via `stripe.subscriptions` |
| 🟢 Low | Consolidate `docs/payments/` — archive sprint logs, keep reference docs |
| ✅ Done | ~~Migrate from `stripe.tokens.create` (deprecated) for ACH to `stripe.setupIntents` with `us_bank_account`~~ — `POST /payments/bank-accounts` now uses `stripe.setupIntents.create` with `us_bank_account` + microdeposit verification (see `services/api/src/routes/payments.ts`) |
| 🟢 Low | Radar / fraud rules: define custom Radar rules aligned with platform risk model |
| 🟢 Low | PCI DSS SAQ-A compliance review before processing live card data |

---

## 5. Key File Reference

| File | Purpose |
|------|---------|
| `lib/services/stripe-service.ts` | Client-side: all Stripe SDK + REST interactions |
| `lib/services/payment-service.ts` | Client-side: business-logic wrapper with security checks |
| `lib/stripe-context.tsx` | React context: auth-gated payment actions |
| `lib/services/apple-pay-service.ts` | Apple Pay specific flow |
| `services/api/src/routes/payments.ts` | Backend: card payments, escrow, webhooks |
| `services/api/src/routes/wallet.ts` | Backend: balance, deposit, withdraw |
| `services/api/src/services/consolidated-wallet-service.ts` | Backend: authoritative ledger + balance |
| `services/api/src/services/consolidated-payment-service.ts` | Backend: Stripe singleton |
| `services/api/src/services/stripe-connect-service.ts` | Backend: hunter payout accounts |
| `lib/security/payment-security-config.ts` | SCA rules, protocol checks |
| `lib/services/payment-error-handler.ts` | Idempotency + retry logic (client) |
| `supabase/migrations/20251102_stripe_payments_integration.sql` | DB schema for payments |
