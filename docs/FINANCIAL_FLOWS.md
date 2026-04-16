# BOUNTYExpo Financial Flows

> **Last Updated:** 2025  
> **Scope:** End-to-end payment, wallet, escrow, payout, and dispute flows for the BOUNTYExpo React-Native (Expo) application.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Payment Method Configuration](#2-payment-method-configuration)
3. [Depositing Funds (Add Money Screen)](#3-depositing-funds-add-money-screen)
4. [Using the Deposited Balance](#4-using-the-deposited-balance)
5. [Fund Management – Standard & Dispute Resolution Flows](#5-fund-management--standard--dispute-resolution-flows)
6. [Payouts / Withdrawal Screen](#6-payouts--withdrawal-screen)
7. [Security & Configuration](#7-security--configuration)
8. [Production Readiness Analysis](#8-production-readiness-analysis)
9. [Recommendations](#9-recommendations)

---

## 1. Architecture Overview

**Production Status: ⚠️ Partial** — Three parallel server surfaces exist; the preferred path (Supabase Edge Functions) is primary for wallet/payments, while the Express server acts as fallback for some routes.

### 1.1 Server Surfaces

The application runs three concurrent server surfaces, each serving different purposes:

| Surface | Entry Point | Technology | Primary Role |
|---------|-------------|------------|--------------|
| **Supabase Edge Functions** | `supabase/functions/` | Deno + TypeScript | Primary backend for wallet, payments, webhooks (production) |
| **Fastify API Server** | `services/api/src/` | Node.js + Fastify | Secondary API; escrow management, dispute routes, admin |
| **Express Server** | `server/index.js` | Node.js + Express | Legacy compatibility layer; wallet balance, payment methods |

### 1.2 Edge Functions Inventory

| Function | Path | Purpose |
|----------|------|---------|
| `payments` | `supabase/functions/payments/index.ts` | Create/manage PaymentIntents, SetupIntents, payment methods |
| `wallet` | `supabase/functions/wallet/index.ts` | Balance read, transaction history, client-side deposit recording |
| `webhooks` | `supabase/functions/webhooks/index.ts` | Stripe webhook event processing (deposit, setup, transfer, payout) |
| `connect` | `supabase/functions/connect/index.ts` | Stripe Connect onboarding, transfers/payouts to hunters |
| `completion` | `supabase/functions/completion/index.ts` | Bounty completion handling |
| `accept-bounty-request` | `supabase/functions/accept-bounty-request/index.ts` | Bounty request acceptance |

### 1.3 Mobile Client Architecture

The client (`lib/`, `app/`, `providers/`, `hooks/`) consumes the backend via two distinct routing mechanisms:

```
Mobile Client
    │
    ├── lib/config/api.ts  ─── resolves API_BASE_URL
    │       │
    │       ├── EXPO_PUBLIC_SUPABASE_URL set?
    │       │       YES → uses https://<ref>.supabase.co/functions/v1  (Edge Functions)
    │       │       NO  → falls back to EXPO_PUBLIC_API_BASE_URL or local dev helper
    │
    ├── lib/services/stripe-service.ts  ──→  invokePayments()
    │       │
    │       └── Direct fetch with apikey + Authorization headers
    │           (avoids supabase.functions.invoke() to prevent session-lock contention)
    │
    ├── lib/wallet-context.tsx  ──→  fetchWithTimeout() for /wallet/* routes
    │
    └── lib/stripe-context.tsx  ──→  stripeService.* for payment method UI
```

**Key design decision:** The client bypasses `supabase.functions.invoke()` for all financial calls. This avoids a race condition where concurrent `getSession()` calls compete for the supabase-js internal lock, causing the Edge Function to never receive the request. Instead, the client obtains the JWT once (with a 5-second race timeout), then makes a direct `fetch()` with both `Authorization: Bearer <token>` and `apikey: <anon-key>` headers.

### 1.4 Database Tables (Financial)

| Table | Description |
|-------|-------------|
| `profiles` | Stores `stripe_customer_id`, `stripe_connect_account_id`, `balance` (cached) |
| `payment_methods` | Card details saved by `setup_intent.succeeded` webhook |
| `wallet_transactions` | Signed ledger; positive = inflow, negative = outflow |
| `stripe_events` | Idempotent log of all received Stripe webhook events |
| `bounty_disputes` | Application-level dispute records |
| `dispute_evidence` | Evidence files uploaded during disputes |

---

## 2. Payment Method Configuration

**Production Status: ✅ Production-Ready**

### 2.1 SetupIntent Creation

A Stripe `SetupIntent` is used to save a card without charging it. This is the PCI-compliant path for storing payment credentials for future off-session use.

**Step-by-step flow:**

```
1. Client calls stripeService.createSetupIntent()
        │
        └── POST {API_BASE_URL}/payments/create-setup-intent
               Authorization: Bearer <JWT>
               apikey: <SUPABASE_ANON_KEY>
        │
2. Edge Function (supabase/functions/payments/index.ts)
        │
        ├── resolveStripeCustomerForUser()
        │       ├── reads profiles.stripe_customer_id
        │       ├── if found, validates via stripe.customers.retrieve()
        │       │   (clears stale ID if resource_missing returned)
        │       └── if not found, creates customer via stripe.customers.create()
        │           then saves to profiles via UPDATE (not upsert — avoids NOT NULL violations)
        │
        └── stripe.setupIntents.create({
                customer: customerId,
                usage: 'off_session',
                automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
                metadata: { user_id: userId }
            })
        │
3. Returns { clientSecret, setupIntentId } to client
        │
4. Client SDK (stripe-react-native) presents card sheet
        │
5. User enters card; Stripe SDK confirms the SetupIntent client-side
```

### 2.2 Webhook: `setup_intent.succeeded`

When Stripe confirms the SetupIntent, it fires a webhook that the `webhooks` Edge Function handles:

```typescript
// supabase/functions/webhooks/index.ts — setup_intent.succeeded handler

1. Retrieve full payment method details: stripe.paymentMethods.retrieve(setupPaymentMethodId)

2. Upsert into payment_methods table:
   supabase.from('payment_methods').upsert({
     user_id, stripe_payment_method_id, type,
     card_brand, card_last4, card_exp_month, card_exp_year
   }, { onConflict: 'stripe_payment_method_id' })

3. Ensure stripe_customer_id is saved on profiles:
   supabase.from('profiles')
     .update({ stripe_customer_id: setupCustomerId })
     .eq('id', setupUserId)
     .is('stripe_customer_id', null)
   // Falls back to unconditional update if conditional update fails
```

### 2.3 DB Fallback When `stripe_customer_id` is Null

A race condition can occur where `stripe_customer_id` has not yet been persisted to `profiles` when `GET /payments/methods` is called. All three server surfaces handle this identically:

```
GET /payments/methods
    │
    ├── Read profiles.stripe_customer_id
    │
    ├── If NULL → query payment_methods table directly
    │       (populated by setup_intent.succeeded webhook)
    │       Returns reconstructed method list from DB
    │
    └── If set → stripe.paymentMethods.list({ customer: id, type: 'card' })
                 (if resource_missing, clear stale ID and return [])
```

### 2.4 Webhook: `setup_intent.setup_failed`

On failure, the `webhooks` function records the failure reason in `stripe_events` for audit logging but takes no balance-affecting action.

### 2.5 Relevant Files

| File | Role |
|------|------|
| `supabase/functions/payments/index.ts` | `create-setup-intent`, `GET /payments/methods`, `POST /payments/methods`, `DELETE /payments/methods/:id` |
| `services/api/src/routes/payments.ts` | Fastify mirror of payment method routes |
| `server/index.js` (line ~450) | Express mirror of `GET /payments/methods` |
| `lib/services/stripe-service.ts` | Client-side `createSetupIntent()`, `getPaymentMethods()` |
| `supabase/functions/webhooks/index.ts` | `setup_intent.succeeded` / `setup_intent.setup_failed` handlers |

---

## 3. Depositing Funds (Add Money Screen)

**Production Status: ✅ Production-Ready**

### 3.1 End-to-End Deposit Flow

```
User taps "Add Money"
    │
    1. AddMoneyScreen renders, user enters amount
    │
    2. stripeService.createPaymentIntent({ amountCents, currency: 'usd', metadata: { purpose: 'wallet_deposit' } })
            │
            └── POST {API_BASE_URL}/payments/create-payment-intent
                    ├── resolveStripeCustomerForUser()  (create customer if needed)
                    └── stripe.paymentIntents.create({
                            amount: validatedAmount,
                            customer: customerId,
                            metadata: { user_id, purpose: 'wallet_deposit' },
                            automatic_payment_methods: { enabled: true, allow_redirects: 'never' }
                        })
            Returns { clientSecret, paymentIntentId }
    │
    3. Stripe React-Native SDK confirms payment (presentPaymentSheet / confirmPayment)
    │
    4. On client confirmation success:
            ├── walletContext.deposit(amount)  ← optimistic update
            │       ├── Increments local balance immediately
            │       └── Records WALLET_LAST_DEPOSIT_TS in SecureStore (guard for cold restarts)
            │
            └── POST {API_BASE_URL}/wallet/deposit
                    { amount, paymentIntentId }
                    ├── Calls apply_deposit RPC (idempotent)
                    └── Returns { success, tx_id, balance }
    │
    5. Stripe fires payment_intent.succeeded webhook → webhooks Edge Function
            │
            └── Checks metadata.purpose === 'wallet_deposit'
                    │
                    └── supabase.rpc('apply_deposit', {
                            p_user_id, p_amount, p_payment_intent_id, p_metadata
                        })
```

### 3.2 `apply_deposit` RPC (Atomic & Idempotent)

Defined in `supabase/migrations/20260310_apply_deposit.sql`:

```sql
-- Atomically: INSERT wallet transaction + UPDATE profiles.balance
-- ON CONFLICT (stripe_payment_intent_id) DO NOTHING  ← idempotency guard

INSERT INTO wallet_transactions(
  user_id, type, amount, description, status, stripe_payment_intent_id, ...
) VALUES (
  p_user_id, 'deposit', p_amount, 'Wallet deposit via Stripe', 'completed', p_payment_intent_id, ...
) ON CONFLICT (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL) DO NOTHING
RETURNING id INTO v_tx_id;

IF v_tx_id IS NOT NULL THEN
  UPDATE profiles SET balance = COALESCE(balance, 0) + p_amount WHERE id = p_user_id;
  RETURN QUERY SELECT true, v_tx_id;   -- newly applied
ELSE
  RETURN QUERY SELECT false, NULL::UUID;  -- already processed, no-op
END IF;
```

The unique partial index that enables `ON CONFLICT` on `stripe_payment_intent_id`:

```sql
-- supabase/migrations/20260311_add_unique_idx_wallet_tx_stripe_payment_intent.sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_stripe_payment_intent_unique
ON wallet_transactions(stripe_payment_intent_id)
WHERE stripe_payment_intent_id IS NOT NULL;
```

### 3.3 Double-Credit Prevention

The deposit is protected by three independent idempotency layers:

| Layer | Mechanism | Where |
|-------|-----------|-------|
| **DB** | `ON CONFLICT (stripe_payment_intent_id) DO NOTHING` partial unique index | `apply_deposit` SQL function |
| **Server** | `apply_deposit` called by both `POST /wallet/deposit` and `payment_intent.succeeded` webhook — second caller is a no-op | `wallet/index.ts`, `webhooks/index.ts` |
| **Client** | Optimistic guard via `WALLET_LAST_DEPOSIT_TS` prevents API from overwriting a pending higher balance | `wallet-context.tsx` |

### 3.4 Client-Side Optimistic Balance Guard

Located in `lib/wallet-context.tsx`, `refreshFromApi()`:

```typescript
const OPTIMISTIC_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const hasRecentOptimisticDeposit =
  lastOptimisticDepositRef.current !== null &&
  now - lastOptimisticDepositRef.current < OPTIMISTIC_WINDOW_MS;

const resolvedBalance = hasRecentOptimisticDeposit && currentBalance > apiBalance
  ? currentBalance   // keep the higher local balance
  : apiBalance;      // accept the API value once webhook has processed
```

The deposit timestamp is persisted to `SecureStore` (`WALLET_LAST_DEPOSIT_TS`) so the guard survives app cold restarts. It is cleared once the API balance catches up or after the 5-minute window expires.

---

## 4. Using the Deposited Balance

**Production Status: ✅ Production-Ready**

### 4.1 Balance Reading — Three Endpoints

The balance is served from three parallel endpoints that implement identical logic:

| Endpoint | Surface | File |
|----------|---------|------|
| `GET /wallet/balance` | Supabase Edge Function | `supabase/functions/wallet/index.ts` |
| `GET /wallet/balance` | Express server | `server/index.js` (line ~1328) |
| `getBalance()` | Fastify service | `services/api/src/services/consolidated-wallet-service.ts` |

The mobile `WalletContext` always calls the Supabase Edge Function URL (derived from `EXPO_PUBLIC_SUPABASE_URL`).

### 4.2 Cross-Check & Auto-Reconcile Logic

All three implementations share the same reconciliation pattern:

```
GET /wallet/balance
    │
    1. Read profiles.balance (cached value)
    │
    2. If balance === 0:
            │
            └── Derive from wallet_transactions (authoritative ledger):
                    SELECT SUM(amount) WHERE user_id = ? AND status = 'completed'
                    -- amounts are SIGNED: positive = inflow, negative = debit
                    -- direct sum, NOT directional by type
            │
    3. If derived > 0:
            ├── Use derived as the response balance
            └── Fire-and-forget: UPDATE profiles SET balance = derived  ← reconcile cache
    │
    4. Return { balance, currency: 'USD' }
```

This guards against the case where a deposit webhook successfully inserted a `wallet_transaction` but failed to update `profiles.balance` (e.g., profile row missing mid-flight, partial DB failure).

### 4.3 Balance Derivation Schema

`wallet_transactions.amount` is a **signed numeric value**:

| Transaction Type | Sign | Example |
|-----------------|------|---------|
| `deposit` | positive `+` | +50.00 |
| `release` (funds received by hunter) | positive `+` | +45.00 |
| `refund` | positive `+` | +50.00 |
| `escrow` (funds locked for bounty) | negative `-` | -50.00 |
| `withdrawal` | negative `-` | -45.00 |

**Balance = `SUM(amount)` for all `status = 'completed'` rows.**  
Do not apply directional logic based on type — amounts are already signed.

### 4.4 Escrowing Funds on Bounty Acceptance

When a poster accepts a hunter's application, the `createEscrow()` function in `WalletContext` is called:

```typescript
// lib/wallet-context.tsx — createEscrow()

1. Verify poster has sufficient balance (balance >= amount)
2. POST {API_BASE_URL}/wallet/escrow { bountyId, amount, title }
        │
        └── Server: deducts balance, records escrow transaction
            Returns { newBalance }
3. Local state: setBalance(newBalance)
4. logTransaction({ type: 'escrow', amount: -amount, escrowStatus: 'funded' })
```

The escrow creates a negative `wallet_transaction` entry that immediately reduces the spendable balance. Funds are held until bounty completion or cancellation.

---

## 5. Fund Management – Standard & Dispute Resolution Flows

**Production Status: ⚠️ Partial** — Standard completion is implemented. Stripe-level `charge.dispute` webhooks are not handled; application-level dispute management exists in Fastify but has no webhook integration.

### 5.1 Standard Completion Flow (Escrow Release to Hunter)

```
Poster approves bounty completion
    │
    1. walletContext.releaseFunds(bountyId, hunterId, title)
    │
    2. bountyService.getById(bountyId) — get payment_intent_id
    │
    3. paymentService.releaseEscrow(paymentIntentId)
            │
            └── POST /payments/escrow/release  (Fastify or Express)
                    ├── Capture PaymentIntent via stripe.paymentIntents.capture()
                    └── stripe.transfers.create({ destination: hunter.stripe_connect_account_id })
    │
    4. Platform fee: 10% (PLATFORM_FEE_PERCENTAGE = 0.10)
            ├── Gross amount = escrow amount
            ├── Platform fee = gross × 10%
            └── Hunter receives = gross - platform fee
    │
    5. Log transactions locally:
            ├── { type: 'platform_fee', amount: -platformFee }
            └── { type: 'release', amount: netAmount }
    │
    6. Update escrow transaction: escrowStatus → 'released', status → 'completed'
```

**Fee structure:**

| Event | Rate | Applied At |
|-------|------|-----------|
| Platform fee | 10% | Bounty completion (release) |
| Early cancellation | 5% | Cancellation before work starts |
| Late cancellation | 15% | Cancellation after work started |

### 5.2 Application-Level Dispute Flow

The `bounty_disputes` table and `dispute_evidence` storage bucket are implemented in `services/api/src/routes/disputes.ts`. The flow operates at the application layer (not tied to Stripe disputes):

```
Hunter or Poster initiates dispute
    │
1. POST /api/disputes/evidence-stage
        └── Stages evidence metadata in dispute_evidence table
    │
2. POST /api/disputes/evidence-upload/:id
        └── Uploads file to Supabase Storage (bucket: 'disputes')
        └── Marks evidence as uploaded and verified
    │
3. POST /api/disputes/commit
        └── Creates bounty_disputes record
        └── Links evidence to dispute
        └── Updates bounty_cancellations.status → 'disputed'
```

### 5.3 Stripe Charge Dispute Webhooks

> ⚠️ **Gap:** The `webhooks` Edge Function does **not** handle `charge.dispute.created` or `charge.dispute.closed` events. Stripe-level chargebacks are not surfaced in the app's dispute or transaction state.

The following webhook events **are** handled:

| Event | Handler | Action |
|-------|---------|--------|
| `payment_intent.succeeded` | `webhooks/index.ts` | `apply_deposit` RPC — credits user balance |
| `payment_intent.payment_failed` | `webhooks/index.ts` | Records failure in `stripe_events` |
| `setup_intent.succeeded` | `webhooks/index.ts` | Saves card to `payment_methods`, updates `stripe_customer_id` |
| `setup_intent.setup_failed` | `webhooks/index.ts` | Records failure in `stripe_events` |
| `charge.refunded` | `webhooks/index.ts` | Inserts refund transaction, calls `update_balance` RPC |
| `transfer.created` | `webhooks/index.ts` | Links `stripe_transfer_id` to withdrawal transaction |
| `transfer.paid` | `webhooks/index.ts` | Marks withdrawal transaction as `completed` |
| `transfer.failed` | `webhooks/index.ts` | Marks transaction `failed`, refunds balance via `update_balance` |
| `account.updated` | `webhooks/index.ts` | Updates `stripe_connect_onboarded_at` on profile |
| `payout.paid` | `webhooks/index.ts` | Inserts success notification for hunter |
| `payout.failed` | `webhooks/index.ts` | Inserts failure notification, sets `payout_failed_at` on profile |

### 5.4 Webhook Idempotency

All webhook events are upserted into `stripe_events` before processing, using `stripe_event_id` as the conflict key:

```typescript
await supabase.from('stripe_events').upsert(
  { stripe_event_id: event.id, event_type: event.type, event_data: ..., processed: false },
  { onConflict: 'stripe_event_id' }
)
```

This ensures Stripe retries (which resend the same `event.id`) are safely deduplicated at the DB level before any business logic runs.

---

## 6. Payouts / Withdrawal Screen

**Production Status: ⚠️ Partial** — Transfer infrastructure exists; Connect onboarding UI is incomplete for seamless in-app completion.

### 6.1 Hunter Payout Architecture

Hunters receive payment via **Stripe Connect** (Express accounts). The flow requires:

1. **Onboarding:** Hunter creates a Stripe Express account and completes KYC via Stripe-hosted onboarding.
2. **Transfer:** Poster/platform sends funds from platform Stripe account to hunter's Connect account.
3. **Payout:** Stripe automatically pays out from Connect account to hunter's bank.

### 6.2 Connect Onboarding

```
Hunter navigates to payout screen (app/in-progress/[bountyId]/hunter/payout.tsx)
    │
POST {API_BASE_URL}/connect/create-account-link
        │
        ├── Check profiles.stripe_connect_account_id
        │       ├── If missing: stripe.accounts.create({ type: 'express', capabilities: { transfers: { requested: true } } })
        │       └── Save account ID to profiles
        │
        └── stripe.accountLinks.create({ account: accountId, type: 'account_onboarding', return_url, refresh_url })
    │
Returns { url } — open in WebView or browser
    │
Hunter completes Stripe-hosted KYC form
    │
POST {API_BASE_URL}/connect/verify-onboarding
        │
        └── stripe.accounts.retrieve(accountId)
                ├── Returns { detailsSubmitted, chargesEnabled, payoutsEnabled }
                └── Sets profiles.stripe_connect_onboarded_at if fully onboarded
```

### 6.3 Transfer Execution

```
POST {API_BASE_URL}/connect/transfer
        │
        ├── Validate hunter is onboarded (payoutsEnabled = true)
        │
        ├── Deduct balance BEFORE creating Stripe transfer (atomic via update_balance RPC)
        │       Reason: prevents double-spend if transfer creation fails after balance deduction
        │
        ├── stripe.transfers.create({
        │       amount: amountCents,
        │       currency: 'usd',
        │       destination: hunterConnectAccountId,
        │       metadata: { user_id }
        │   })
        │
        ├── On Stripe failure: refund balance via update_balance RPC
        │
        └── INSERT wallet_transactions { type: 'withdrawal', amount: -amount, stripe_transfer_id }
```

### 6.4 Retry Failed Transfers

`POST /connect/retry-transfer` allows retrying transfers that failed, with optimistic locking to prevent concurrent retries:

```
1. Fetch failed transaction, verify ownership
2. Check retry count (max retries enforced)
3. Re-deduct balance → stripe.transfers.create() → on failure, refund balance
4. Update transaction with new stripe_transfer_id
```

### 6.5 Relevant Files

| File | Role |
|------|------|
| `supabase/functions/connect/index.ts` | `/connect/create-account-link`, `/connect/verify-onboarding`, `/connect/transfer`, `/connect/retry-transfer` |
| `server/index.js` (line ~1232) | Express mirror of `/connect/transfer` |
| `app/in-progress/[bountyId]/hunter/payout.tsx` | Hunter payout screen |
| `app/postings/[bountyId]/payout.tsx` | Poster payout management screen |

---

## 7. Security & Configuration

**Production Status: ✅ Production-Ready** (core security is solid; minor hardening opportunities noted)

### 7.1 Webhook Signature Verification

The `webhooks` Edge Function is deployed with `verify_jwt = false` (Supabase gateway skips its JWT check) because Stripe sends webhooks without a Supabase user JWT. Instead, the function performs **manual HMAC-SHA256 verification** using the `STRIPE_WEBHOOK_SECRET`:

```typescript
// supabase/functions/webhooks/index.ts

async function verifyStripeSignature(payload: string, header: string | null, secret: string) {
  // 1. Parse t= (timestamp) and v1= (signature) from Stripe-Signature header
  // 2. Construct signedPayload = `${timestamp}.${rawBody}`
  // 3. HMAC-SHA256(secret, signedPayload) using Web Crypto API
  // 4. constant-time comparison (safeCompare) to prevent timing attacks
  // 5. Validate timestamp skew ≤ 5 minutes
}
```

The raw request body is read with `req.text()` before any JSON parsing to preserve byte-for-byte fidelity required by Stripe's signature algorithm.

### 7.2 Edge Function JWT Configuration

All five financial Edge Functions set `verify_jwt = false` in `supabase/config.toml`:

```toml
# supabase/config.toml

[functions.payments]
verify_jwt = false    # Performs own auth via supabaseAdmin.auth.getUser(token)

[functions.wallet]
verify_jwt = false    # Performs own auth via supabase.auth.getUser(token)

[functions.webhooks]
verify_jwt = false    # External webhook — no Supabase JWT present

[functions.connect]
verify_jwt = false    # Performs own auth via supabase.auth.getUser(token)

[functions.completion]
verify_jwt = false    # Performs own auth
```

> **Important:** This does NOT mean the functions are unauthenticated. Every function except `webhooks` performs explicit authentication by calling `supabase.auth.getUser(token)` at the start of the handler. The `webhooks` function uses Stripe signature verification instead.

### 7.3 Required Auth Headers

When calling Edge Functions directly (not via `supabase.functions.invoke()`), **both headers are mandatory**:

```
Authorization: Bearer <user-JWT>
apikey: <SUPABASE_ANON_KEY>
```

The `apikey` header identifies the Supabase project to the gateway. Without it, the gateway rejects with "Invalid JWT" before the Edge Function is ever invoked.

### 7.4 SecureStore SENSITIVE_KEYS Allowlist

Financial data is stored exclusively in Expo SecureStore (encrypted at rest) via `lib/utils/secure-storage.ts`. For keys in the `SENSITIVE_KEYS` set, fallback to `AsyncStorage` is explicitly prohibited — a `SecureStoreUnavailable` error is thrown instead, which surfaces a warning to the user via `WalletContext.secureStoreAvailable`:

```typescript
const SENSITIVE_KEYS = new Set([
  '@bountyexpo:secure:wallet_balance',
  '@bountyexpo:secure:wallet_transactions',
  '@bountyexpo:secure:wallet_last_deposit_ts',
  '@bountyexpo:secure:payment_token',
]);
```

Any new wallet keys **must** be added to this set. If a key is not listed, `setSecureItem()` will silently fall back to unencrypted `AsyncStorage` when SecureStore is unavailable.

**iOS:** Keys use `keychainAccessible: AFTER_FIRST_UNLOCK` so they remain accessible for background app refresh after device unlock.

### 7.5 Config Resolution Order

`lib/config.ts` resolves environment values in this priority:

```
1. process.env.EXPO_PUBLIC_<KEY>      ← Metro-inlined at build time (preferred)
2. process.env.<KEY>                  ← Bare env var (server-side / dev fallback)
3. Constants.expoConfig.extra[KEY]    ← app.config.js extra{} — runtime bake
```

For `API_BASE_URL` (`lib/config/api.ts`), the `Constants.expoConfig.extra` source is checked **first** to ensure the correct environment (staging vs. production) overrides a stale Metro-bundled value:

```typescript
// lib/config/api.ts
const explicitFunctionsUrl = fromExtra('EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL')
  || process.env.EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL?.trim()
  || ''
// If set, Supabase Edge Functions are used as the primary API backend
```

### 7.6 Session Lock Contention Mitigation

`lib/services/stripe-service.ts` uses a 5-second race timeout around `supabase.auth.getSession()` to prevent deadlock when concurrent auth events (e.g., token refresh + existing session read) hold the supabase-js internal lock:

```typescript
const sessionResult = await Promise.race([
  supabase.auth.getSession(),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject({ type: 'network_error', code: 'TIMEOUT', ... }), 5000)
  ),
]);
```

If the timeout fires, the function proceeds without a token (the Edge Function will return 401), which is handled gracefully by the retry/auth-recovery path.

### 7.7 Input Sanitization

Edge Functions sanitize all inputs before passing to Stripe:

```typescript
function sanitizeText(input: unknown): string {
  return String(input).replace(/[<>]/g, '').trim().slice(0, 1000)  // strip HTML injection
}

function sanitizePositiveNumber(input: unknown): number {
  const num = Number(input)
  if (!isFinite(num) || isNaN(num) || num <= 0) throw new Error('Must be a positive number')
  return num
}
```

Stripe requires amounts as **integer cents** (minimum 50 cents), enforced at the `create-payment-intent` endpoint before any Stripe API call.

---

## 8. Production Readiness Analysis

### 8.1 What Is Working End-to-End ✅

| Feature | Status | Notes |
|---------|--------|-------|
| Add a payment method (SetupIntent) | ✅ Working | Webhook saves to DB; DB fallback for missing `stripe_customer_id` |
| Deposit funds (PaymentIntent + webhook) | ✅ Working | Atomic `apply_deposit` RPC; idempotent by `stripe_payment_intent_id` |
| Optimistic balance display | ✅ Working | 5-minute guard with SecureStore persistence survives cold restarts |
| Balance cross-check & reconcile | ✅ Working | Derives balance from transactions when cached balance is 0 |
| Create escrow (bounty acceptance) | ✅ Working | Server-confirmed; no retry for financial ops (double-spend prevention) |
| Transfer to hunter (Stripe Connect) | ✅ Working | Balance deducted before transfer; refunded on Stripe failure |
| `payout.paid` / `payout.failed` notifications | ✅ Working | Hunter notified via `notifications` table |
| Webhook signature verification | ✅ Working | HMAC-SHA256 with constant-time compare and 5-minute skew check |
| SecureStore for financial data | ✅ Working | SENSITIVE_KEYS allowlist enforced; iOS AFTER_FIRST_UNLOCK |
| Duplicate webhook replay prevention | ✅ Working | `stripe_events` upsert on `stripe_event_id` |

### 8.2 Known Gaps and Risks ⚠️❌

| Issue | Severity | Detail |
|-------|----------|--------|
| **No `charge.dispute.created` / `charge.dispute.closed` webhook handlers** | ⚠️ High | If a cardholder files a chargeback with their bank, the platform has no automated response. Disputed funds are not frozen in the app. The application-level `bounty_disputes` table exists but is not linked to Stripe chargebacks. |
| **Stripe Connect onboarding UX is incomplete** | ⚠️ High | Hunters are redirected to a Stripe-hosted URL; return flow to the app after KYC completion is not fully integrated with a seamless in-app experience. |
| **Three parallel server surfaces for the same routes** | ⚠️ Medium | `GET /wallet/balance` exists in the Express server, the Fastify service, and the Edge Function. Routing depends on which `API_BASE_URL` is resolved. A configuration mistake could silently route to the wrong surface. |
| **RLS policies for `wallet_transactions` not verified** | ⚠️ Medium | The codebase uses service-role keys for most DB writes (bypassing RLS). It's unclear whether RLS policies exist on `wallet_transactions` for direct user access, which is required if client-side Supabase queries are ever used. |
| **No dispute freeze UI** | ⚠️ Medium | When a dispute is opened (application level), there is no mechanism to freeze the wallet balance of the poster to prevent withdrawal of disputed funds. |
| **Webhook replay risk beyond `stripe_event_id`** | ⚠️ Low | `apply_deposit` is idempotent, but `charge.refunded` and transfer event handlers perform direct inserts without conflict guards — a rare network-level replay could double-insert these records. |
| **`transfer.failed` retry count not consistently enforced** | ⚠️ Low | `POST /connect/retry-transfer` checks a retry count, but the initial `transfer.failed` webhook handler does not increment or enforce it. |
| **No push notification on balance change** | ⚠️ Low | Webhooks update the DB balance but do not trigger a push notification to the mobile app. The app learns of balance changes only when `refreshFromApi` is called (screen focus or auth events). |
| **Payout notification only on `payout.paid` event** | ℹ️ Info | `payout.failed` sets `profiles.payout_failed_at` but the UI has no recovery screen guiding the hunter to fix their bank details. |
| **iOS SecureStore key format** | ℹ️ Info | Keys containing `:` are sanitized to `_` (e.g., `@bountyexpo:secure:wallet_balance` → `@bountyexpo_secure_wallet_balance`). Existing installs that wrote keys before sanitization was added may not be able to read them. |

---

## 9. Recommendations

**Production Status: N/A — Forward-looking improvements**

The following enhancements are prioritized by impact on security, correctness, and user experience:

| Priority | Enhancement | Rationale |
|----------|-------------|-----------|
| **P0** | Implement `charge.dispute.created` and `charge.dispute.closed` webhook handlers | Chargebacks are a financial liability. Without handlers, the platform cannot freeze funds, submit evidence to Stripe, or reconcile disputed amounts. At minimum, freeze the user's wallet and alert support. |
| **P0** | Audit and enforce RLS policies on `wallet_transactions` | Ensure users can only read their own rows via the authenticated Supabase client. Service-role writes bypass RLS; confirm that direct client queries (if any) are protected. |
| **P1** | Add in-app push notification when balance changes | Deliver a push notification after `payment_intent.succeeded` processes via `apply_deposit`. Use the existing `process-notification` Edge Function + Expo push token stored on `profiles`. |
| **P1** | Complete Stripe Connect onboarding deep-link return flow | Implement a universal link / app scheme handler for `connect/create-account-link`'s `return_url` so hunters return to the app after completing KYC rather than to a dead browser tab. |
| **P1** | Add dispute freeze to wallet | When `bounty_disputes` record is created, freeze `profiles.balance` so the disputed amount cannot be withdrawn. Unfreeze on dispute resolution. |
| **P2** | Consolidate three parallel server surfaces | Route all traffic through the Supabase Edge Functions (already the preferred path). Deprecate the Express and Fastify mirrors for `/wallet/*` and `/payments/*` to reduce maintenance surface and risk of divergence. |
| **P2** | Add idempotency guards to `charge.refunded` and transfer event handlers | Use `ON CONFLICT DO NOTHING` or a lookup check before inserting refund/transfer transactions to prevent double-inserts on webhook replay. |
| **P2** | Expose `payout.failed` recovery UI | When `profiles.payout_failed_at` is set, show an in-app banner guiding the hunter to update their bank account details in Stripe Connect. |
| **P2** | Enforce retry count in `transfer.failed` webhook handler | Increment a `retry_count` field and halt retries beyond a configured maximum (e.g., 3) to prevent infinite retry loops on permanently invalid Connect accounts. |
| **P3** | Improve offline resilience | Queue failed deposit/withdrawal API calls in a persistent job queue (e.g., `react-native-mmkv` + background task) so they are retried automatically when connectivity is restored. |
| **P3** | Add idempotency key to `createEscrow` API call | The current escrow creation call has `retries: 0` (correct) but no server-side idempotency key check. If the client retries after a timeout, a second escrow could be created for the same bounty. |
| **P3** | Instrument financial events with analytics | Add structured analytics events (`analytics_service.track`) for deposit, escrow, release, and payout milestones to support cohort analysis and fraud detection. |
| **P3** | Surface `secureStoreAvailable = false` warning to user | `WalletContext` already sets this flag, but there is no UI element that alerts the user that their financial data is not being encrypted. Add a persistent banner for affected devices. |

---

## Appendix: Key Constants & Environment Variables

### Client-Side (EXPO_PUBLIC_*)

| Variable | Purpose | Required |
|----------|---------|----------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL; also derives Edge Functions URL | Yes |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key for `apikey` header | Yes |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key for React-Native SDK | Yes |
| `EXPO_PUBLIC_API_BASE_URL` | Explicit API URL override (optional if Supabase URL is set) | No |
| `EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL` | Explicit Edge Functions URL override | No |

### Server-Side (Edge Functions / Node)

| Variable | Purpose | Required |
|----------|---------|----------|
| `STRIPE_SECRET_KEY` | Stripe API secret key | Yes |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret for signature verification | Yes |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin DB access (bypasses RLS) | Yes |
| `APP_URL` | App base URL for Connect onboarding return/refresh URLs | Yes (Connect) |

### SecureStore Keys

| Constant | Key | Sensitive |
|----------|-----|-----------|
| `SecureKeys.WALLET_BALANCE` | `@bountyexpo:secure:wallet_balance` | ✅ Yes |
| `SecureKeys.WALLET_TRANSACTIONS` | `@bountyexpo:secure:wallet_transactions` | ✅ Yes |
| `SecureKeys.WALLET_LAST_DEPOSIT_TS` | `@bountyexpo:secure:wallet_last_deposit_ts` | ✅ Yes |
| `SecureKeys.PAYMENT_TOKEN` | `@bountyexpo:secure:payment_token` | ✅ Yes |

### Fee Configuration (`lib/wallet-context.tsx`)

| Constant | Value | Applied When |
|----------|-------|-------------|
| `PLATFORM_FEE_PERCENTAGE` | 10% | Bounty completion (escrow release) |
| `CANCELLATION_FEE_EARLY` | 5% | Poster cancels before any work begins |
| `CANCELLATION_FEE_AFTER_WORK` | 15% | Poster cancels after hunter has started work |
