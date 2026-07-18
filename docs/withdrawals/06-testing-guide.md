# Withdrawal System — Testing Guide

> **Read this framing before anything else:** there is no isolated test Supabase project and no Stripe test-mode credential set for this app. One production project, Stripe in live mode. This has been true throughout this project's history and remains true after this hardening pass — closing it is a recommended future architectural change (see the Production Readiness Review), not something done in this pass. Every scenario below is marked with what's actually automated today versus what requires manual, human-present, live-mode verification with real (minimal) amounts. **No scenario in this document was executed live during this documentation pass** — this is a specification of how to test, not a report of tests run.

## What's actually automated today

| Coverage | What it tests | What it does NOT test |
|---|---|---|
| `__tests__/unit/withdrawal-validation.test.ts` | Pure validation helpers (`validateWithdrawalRequest`, `mapStripeTransferError`, `resolveWithdrawalDestination`) from `supabase/functions/connect/withdrawal-validation.ts`, plus a contract test asserting the copy inlined into `connect/index.ts` stays in sync | The actual edge function's HTTP handling, Stripe calls, or DB writes |
| `__tests__/e2e/complete-payment-flows.test.ts` ("Wallet Deposit and Withdrawal Flow") | Withdrawal logic against a **mocked Supabase client** | Not the real edge function, not real Stripe |
| `__tests__/integration/api/payment-flows.test.ts` (`POST /api/wallet/withdraw`) | A hand-rolled Express-style test route mirroring withdrawal logic | Also not the real edge function |
| CI `edge-functions` job (new this pass) | `deno check` + `deno lint` on `connect`/`webhooks`/`wallet`/`admin-withdrawals` | Type/lint correctness only, no behavioral testing |

**The bottom line: the actual production Deno Edge Functions (`connect/index.ts`, `webhooks/index.ts`) have zero automated behavioral test coverage.** The jest suite tests pure logic extracted from them and a separate/legacy Express mirror, not the functions themselves. This is a real, accepted gap — see the Production Readiness Review's "Recommended Future Work."

## Manual verification procedures

For each scenario: what to check, and the expected database state after. Execute only with a human directly present and explicitly authorizing the live-money steps; anything marked "read-only safe" can be done unilaterally.

### 1. Successful withdrawal

**Setup:** A test/real hunter account with a confirmed balance ≥ $10 and a completed Stripe Connect onboarding.

**Steps:** Submit a withdrawal for the minimum amount ($10) via the app.

**Expected DB state:**
- `wallet_transactions`: new row, `type: 'withdrawal'`, `amount: -10.00`, `status: 'completed'` (immediately, never `'pending'`), `stripe_transfer_id` populated, `metadata.destination_bank_account_id` matches the selected account.
- `profiles.balance`: decremented by $10 atomically with the insert.

**Expected Stripe state:** A real `Transfer` object exists, `destination` = the hunter's connected account. A `Payout` will appear later on Stripe's own schedule — not observable synchronously.

### 2. Payout success (async, observe don't trigger)

**Setup:** An existing `'completed'` withdrawal, wait for Stripe's natural payout cycle (do not attempt to force this).

**Expected DB state after `payout.paid` webhook delivery:** No status change (payout success is notification-only) — `wallet_transactions.status` stays `'completed'`. A `notifications` row is inserted.

### 3. Payout failure

**This cannot be safely triggered on demand** — Stripe doesn't offer a "make this payout fail" API in live mode. Verify the *code path* instead: read `handleUndeliveredPayout()` in `webhooks/index.ts`, confirm test coverage of the pure logic it depends on, and rely on production monitoring (the reconciliation job, CRITICAL logs) to catch a real occurrence rather than simulating one.

**If one is observed in production:**
**Expected DB state:** matching `wallet_transactions` row → `status: 'failed'`, `metadata.payout_status: 'failed'`, `metadata.payout_failure_code` populated. `profiles.balance` credited back by the same amount. `profiles.payout_failed_at` set. A `notifications` row inserted.

### 4. Webhook replay

**Read-only safe to verify the mechanism, not to actually replay a live event without confirming it's a genuine duplicate delivery.**

**Expected behavior:** `stripe_events` is upserted on `stripe_event_id` *before* processing — a replayed event with the same ID doesn't re-execute the balance-affecting logic (each handler additionally checks `metadata.transfer_status`/`payout_status` before refunding, so even independent of the `stripe_events` table, a second delivery is a no-op).

**Verification approach:** read the code path, don't attempt to force real Stripe event redelivery against production.

### 5. Duplicate requests (client double-tap)

**Read-only-safe to verify structurally; live-money to actually reproduce.**

**Expected DB state:** exactly one `wallet_transactions` row per idempotency key regardless of how many times the client submits — the unique index on `(user_id, idempotency_key)` combined with the losing-request-refunds-its-own-deduction logic guarantees this. If genuinely testing live, submit the same request twice in rapid succession with the same idempotency key and confirm only one debit persists.

### 6. Retry flow

**Setup:** A `'failed'` withdrawal with `retry_count < 3`.

**Steps:** Call `/connect/retry-transfer` (self-service) or `admin-withdrawals` `force_retry` (admin, uncapped).

**Expected DB state:** the same row updates in place — `stripe_transfer_id` replaced with the new Transfer's ID, `status: 'completed'`, `metadata.retry_count` incremented, `metadata.retried_at` set (and `metadata.retried_by_admin` if via the admin tool).

**At `retry_count >= 3`:** self-service retry must return `400` with `maxRetriesReached: true` and must NOT touch the balance. Admin `force_retry` has no such cap by design.

### 7. Bank account changes

**Read-only safe:** confirm `GET /connect/bank-accounts` reflects Stripe's live external-account list (not a local cache — there is no local bank account table).

**Live-money-adjacent:** submitting a withdrawal with a specific `bankAccountId` should result in that account being promoted to `default_for_currency` on the connected account (verify via `stripe.accounts.listExternalAccounts` before/after) *before* the balance is debited. If the promotion can't be confirmed (read-back check fails), the code must abort with `502 bank_account_default_update_unconfirmed` and the balance must remain untouched — verify this specific failure path doesn't leave a stale debit.

### 8. Onboarding failures

**Read-only safe.** Verify `POST /connect/verify-onboarding` correctly reflects Stripe's live `charges_enabled`/`payouts_enabled` state for accounts in various requirement states — use existing test/real accounts already in different onboarding states rather than manufacturing new failure states.

**Expected DB state:** `stripe_connect_onboarded_at` set exactly once, never cleared. `stripe_connect_payouts_enabled`/`charges_enabled` reflect current, not historical, state.

### 9. Insufficient balance

**Read-only safe** (no balance is touched on this path by design).

**Steps:** Submit a withdrawal for more than `balance - balance_on_hold`.

**Expected result:** `400 insufficient_balance`, checked twice (a pre-check plus the `withdraw_balance()` RPC's own atomic check) — no `wallet_transactions` row inserted, no balance change.

### 10. Network interruption

**Read-only safe to verify client-side handling; doesn't require live money to test the client's own timeout behavior.**

**Steps:** Kill network connectivity mid-request from the client, or simulate via dev tools.

**Expected client behavior:** the 20-second `AbortController` timeout fires, the client shows "Request Timed Out," and the idempotency key is **preserved** (not rotated) so a subsequent retry with the same key is safe even if the server-side request actually completed.

### 11. Stripe outages

**Cannot be safely simulated against live Stripe.** Verify the code path instead: `connect/index.ts`'s `stripe.transfers.create()` call is wrapped in try/catch that refunds the balance on any thrown error and maps connection errors specifically (`StripeConnectionError`/`api_connection_error` → `503 stripe_unreachable`). If the refund itself also fails, that's the CRITICAL-logged double-failure case — verify the log line is emitted with full context (`logCritical()`, structured JSON as of this pass) rather than attempting to force a live double-failure.

## What a future test environment would need (recommended future work, not built here)

- A separate Supabase project (or branch) with its own schema, seeded with test profiles
- Stripe test-mode API keys, a test-mode Connect platform, and test bank accounts (Stripe provides these for test mode)
- A way to point the deployed Edge Functions at test-mode credentials without touching production
- Stripe's test-mode tools for simulating payout failures, which don't exist in live mode

Until this exists, this document is the closest thing to a test plan — a checklist of what to verify and how, executed carefully and manually against production when necessary.
