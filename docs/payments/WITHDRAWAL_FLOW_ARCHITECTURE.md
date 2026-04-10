# Withdrawal Flow Architecture

This document describes the end-to-end withdrawal flow for the BOUNTYExpo wallet, covering
client responsibilities, backend logic, database behaviour, webhook handling, retry/failure
strategy, and payout status synchronisation.

---

## Overview

```
Mobile client
  ↓  POST /connect/transfer  (with idempotency key)
Fastify API (services/api)
  ↓  ConsolidatedWalletService.createWithdrawal
Supabase Postgres
  ├─ INSERT wallet_transactions (status='pending')
  └─ UPDATE profiles SET balance = balance - amount   ← atomic, raises if balance < 0
  ↓
Stripe API  (transfers.create with idempotency key)
  ↓
Supabase Postgres
  └─ UPDATE wallet_transactions SET status='completed', stripe_transfer_id=…
  ↓
Client refreshes balance via GET /wallet/balance
```

---

## Client responsibilities

| Responsibility | Implementation |
|---|---|
| Minimum amount check | `MIN_WITHDRAWAL_AMOUNT = 10` validated before submission |
| Balance check | Client-side guard prevents values > displayed balance |
| Email verification | `useEmailVerification` hook blocks the withdraw button |
| Connect onboarding | Redirect to Stripe Connect via `/connect/create-account-link` |
| Per-tap idempotency key | Generated as `` `withdraw_${userId}_${Date.now()}` `` and sent in request body |
| Concurrent submission guard | `isProcessing` state disables button while in-flight |
| Balance refresh | `useWallet().refresh()` called after successful confirmation |

**Secrets**: The client never sees the Stripe secret key, payout account details, or bank
routing numbers. All sensitive operations run server-side.

---

## Server responsibilities (Fastify — `services/api`)

The `/connect/transfer` endpoint:

1. **Schema validation** — `transferSchema` enforces `amount >= 10` (USD) and `currency = 'usd'`.
2. **Idempotency check** — incoming `idempotencyKey` is looked up in the in-process cache; a
   `409 Conflict` is returned for duplicates.
3. **Connect account verification** — Stripe Connect status is fetched; 400 is returned if
   `payoutsEnabled = false` or onboarding is incomplete.
4. **Atomic withdrawal via `createWithdrawal`** — see _Database_ section below.
5. **Balance response** — the authoritative post-deduction balance is fetched from Supabase
   and returned to the client.

---

## Edge Function responsibilities

The **webhooks** Edge Function (`supabase/functions/webhooks/index.ts`) handles Stripe
callbacks:

| Event | Action |
|---|---|
| `transfer.created` | Log; no balance change needed (already deducted at request time) |
| `transfer.paid` | Optionally update transaction metadata with confirmation timestamp |
| `payout.paid` | Clear `profiles.payout_failed_at`; log success |
| `payout.failed` | Set `profiles.payout_failed_at = NOW()` for support follow-up; optionally re-credit balance and mark transaction `failed` |
| `transfer.reversed` | Re-credit balance; mark transaction `failed`; alert support |

> The webhooks Edge Function is deployed with `--no-verify-jwt` because Stripe does not send
> a Supabase JWT. Webhook signatures are verified using `STRIPE_WEBHOOK_SECRET`.

---

## Database tables and ledger behaviour

### `wallet_transactions`

| Column | Description |
|---|---|
| `id` | UUID primary key |
| `user_id` | Owner of the transaction |
| `type` | `'withdrawal'` for payouts |
| `amount` | **Signed** USD value — negative for debits (e.g. `-50.00`) |
| `status` | `'pending'` → `'completed'` or `'failed'` |
| `stripe_transfer_id` | Set after Stripe transfer is created |
| `stripe_connect_account_id` | Destination Stripe Connect account |
| `metadata` | JSON blob — idempotency key, timestamps |

#### Authoritative balance

Balance is derived by summing **all** completed `wallet_transactions.amount` values (signed)
for a user:

```sql
SELECT COALESCE(SUM(amount), 0)
FROM wallet_transactions
WHERE user_id = $1 AND status = 'completed';
```

`profiles.balance` is a **cached** copy kept in sync by the `update_balance` Postgres RPC.

#### Race condition protection

A **partial unique index** prevents two pending withdrawals from being created concurrently:

```sql
CREATE UNIQUE INDEX idx_wallet_tx_one_pending_withdrawal
  ON wallet_transactions (user_id)
  WHERE type = 'withdrawal' AND status = 'pending';
```

The `update_balance` RPC enforces a **non-negative balance constraint** at the database level:

```sql
IF v_new_balance < 0 THEN
  RAISE EXCEPTION 'Insufficient funds' USING ERRCODE = '23514';
END IF;
```

Combined, these two guards prevent overdrafts even under concurrent requests.

---

## Withdrawal state machine

```
[requested]
     │  POST /connect/transfer received → pending tx inserted
     ▼
 [pending]
     │  update_balance RPC succeeds + Stripe Transfer created
     ▼
[completed]   ←── Stripe transfer.created webhook confirms

     │  (on any error after balance deduction)
     ▼
  [failed]    ←── balance rolled back + transaction marked failed
```

---

## Retry and failure strategy

### Client side
- Idempotency key prevents duplicate charges if the user retries or the network drops.
- The unique pending-withdrawal index ensures a second in-flight request gets a `409` before
  any money moves.

### Server side
- `createWithdrawal` uses `withStripeIdempotency` which passes the idempotency key to Stripe,
  so a Stripe-level retry of the same key is safe.
- On Stripe or DB failure:
  1. Transaction is marked `'failed'`.
  2. Balance is rolled back via `updateBalance(userId, +amount)`.
  3. Error is logged with `userId`, `transactionId`, and `amount` for support.
- CRITICAL failures (balance rollback also fails) are logged at `ERROR` level and flagged for
  manual reconciliation.

---

## Payout status synchronisation

| Source | Mechanism | Latency |
|---|---|---|
| Stripe transfer creation | Synchronous in request handler | < 2 s |
| Stripe payout confirmation | `payout.paid` webhook | 1–2 business days |
| Client balance refresh | `GET /wallet/balance` after success alert | Immediate |
| Auto-reconciliation | `getBalance()` cross-checks `profiles.balance` vs transaction sum | On next balance fetch |

---

## Security checklist

- [x] Stripe secret key never sent to client.
- [x] Withdrawal amount validated server-side (schema + `update_balance` RPC).
- [x] Balance deducted atomically at the DB level — not optimistically on the client.
- [x] Idempotency enforced both client-side (per-tap key) and server-side (key cache + DB index).
- [x] Email verification required before any withdrawal is accepted.
- [x] Connect account `payoutsEnabled` verified before transfer.
- [x] Webhook signature verified via `STRIPE_WEBHOOK_SECRET`.
- [x] Minimum withdrawal amount ($10) enforced in UI, schema, and documented.

---

## Minimum withdrawal amount

The platform minimum is **$10.00 USD**. This threshold is defined in two places:

- `lib/constants.ts` → `MIN_WITHDRAWAL_AMOUNT` — imported by all mobile UI components
- `services/api/src/routes/wallet.ts` → `MIN_WITHDRAWAL_AMOUNT` — server-side schema validation

The server keeps its own copy because it cannot import from the mobile `lib/` directory.
**Keep both values in sync** when changing the threshold.
