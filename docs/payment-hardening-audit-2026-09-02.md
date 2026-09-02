# BOUNTY P0 Payment Hardening Audit - 2026-09-02

## Executive Summary

This pass audited the Supabase Edge Function payment surfaces and implemented three immediate hardening changes:

1. Phase 2 bounty funding now creates Stripe PaymentIntents with a deterministic idempotency key per bounty and amount.
2. A concurrent insert conflict after a Stripe-idempotent PaymentIntent replay is treated as an idempotent replay, not as a reason to cancel the shared PaymentIntent.
3. Stripe webhooks now fail closed if the handler succeeds but the durable `stripe_events.processed` marker cannot be written.
4. A database migration adds uniqueness backstops for live bounty payment rows and Stripe object evidence.

The most important remaining risk is operational: the new migration intentionally fails if existing duplicate active `bounty_payments` rows exist. Production should check and reconcile those rows before applying it.

## Architecture

Mobile clients call Supabase Edge Functions for payment, wallet, Connect, and completion operations. Stripe state is reflected into Postgres primarily through `webhooks`, with reconciliation backstops in `reconciliation` and `admin-withdrawals`.

Authoritative sources observed in code:

- Stripe is authoritative for PaymentIntent, Charge, Transfer, Refund, Connect Account, Balance, and Payout state.
- `stripe_events` is the durable webhook idempotency and retry/DLQ table.
- `wallet_transactions` remains the legacy wallet ledger and withdrawal history.
- `bounty_payments` tracks Phase 2 Stripe-native bounty escrow and release.
- `bounty_v3_funding` tracks Phase 3 manual-capture authorization and release state.
- `ledger_entries` is the v3/shadow financial ledger and observability spine.
- `reconciliation_findings`, `reconciliation_reports`, and `stripe_balance_snapshots` are audit/reconciliation outputs, not primary money movers.

## Financial State Machine

Legacy wallet flow:

1. Wallet deposit creates or confirms a Stripe PaymentIntent.
2. `payment_intent.succeeded` calls `apply_deposit`, which inserts one `wallet_transactions` row and credits `profiles.balance` atomically.
3. Legacy bounty escrow reserves `profiles.balance` through SQL RPCs and writes `wallet_transactions`.
4. Legacy withdrawal reserves balance in `begin_legacy_withdrawal`, creates a Stripe Transfer, then creates/records a Payout where supported.
5. `payout.paid` is the only authority that promotes a withdrawal to `completed`.
6. `payout.failed` and `payout.canceled` fail the withdrawal through `fail_legacy_withdrawal` and restore balance atomically.

Phase 2 bounty payment flow:

1. Poster calls `/bounty-payments/create`.
2. Server derives amount from the bounty row, not the client.
3. Stripe PaymentIntent is created with `capture_method: automatic` and transfer group `bounty_<id>`.
4. `bounty_payments` records `pending_payment`; `payment_intent.succeeded` promotes to `captured` and records the charge.
5. Poster release creates a Stripe Transfer from the recorded charge and records `release_pending`.
6. `transfer.created` promotes the row to `released`; `transfer.failed` or `transfer.reversed` promotes only valid prior states to `failed`.

Phase 3/v3 bounty payment flow:

1. Poster calls `/bounty-payments/create` and, when rollout selects v3, creates a manual-capture PaymentIntent keyed by `v3_bounty_authorize_<bountyId>`.
2. `payment_intent.amount_capturable_updated` promotes `bounty_v3_funding` to `authorized`.
3. Poster release requires an approved completion, a real accepted hunter, and a live Stripe account read showing payouts enabled.
4. Release captures the PaymentIntent with `v3_capture_<bountyId>` and creates a Transfer with `v3_release_<bountyId>`.
5. The API returns `release_pending`; only `transfer.created` with `reversed === false` promotes `bounty_v3_funding` to `released` and `ledger_entries.stripe_state` to `confirmed`.

## Edge Function Inventory

| Function                                          | Purpose                                      | Auth             | Financial impact               | External APIs            | Idempotency                         | Transaction safety                   | Failure handling               | Risk                |
| ------------------------------------------------- | -------------------------------------------- | ---------------- | ------------------------------ | ------------------------ | ----------------------------------- | ------------------------------------ | ------------------------------ | ------------------- |
| `accept-bounty-request`                           | Accept hunter request                        | User JWT         | Indirect escrow/state          | Supabase                 | SQL RPC guarded                     | DB RPC                               | API errors                     | P1                  |
| `admin-profiles`                                  | Admin profile ops                            | Admin            | Possible account state         | Supabase                 | N/A                                 | RLS/admin checks                     | API errors                     | P1                  |
| `admin-review-id`                                 | Identity admin review                        | Admin            | No direct money                | Supabase/Stripe Identity | N/A                                 | Admin gated                          | API errors                     | P2                  |
| `admin-verifications-list`                        | Verification list                            | Admin            | No direct money                | Supabase                 | N/A                                 | Admin gated                          | API errors                     | P2                  |
| `admin-withdrawals`                               | Withdrawal recovery/reconciliation           | Admin            | Yes                            | Stripe/Supabase          | Mixed, audited separately           | RPCs and manual logs                 | Loud logs                      | P0/P1               |
| `apple-pay`                                       | Apple Pay PaymentIntent                      | User             | Yes                            | Stripe                   | Needs route-specific review         | API + DB                             | API errors                     | P1                  |
| `auth`                                            | Auth helper                                  | User/public      | No direct money                | Supabase                 | N/A                                 | Auth checks                          | API errors                     | P2                  |
| `bounty-payments`                                 | Fund, release, cancel bounty payments        | User JWT         | Yes                            | Stripe                   | Hardened in this pass               | DB-backed rows + constraints         | Pending/retry states           | P0 fixed/P1 remains |
| `completion`                                      | Completion approval/submission               | User JWT         | Indirect release trigger       | Supabase                 | Status guards                       | DB state checks                      | API errors                     | P1                  |
| `connect`                                         | Connect onboarding, transfers, payouts       | User JWT         | Yes                            | Stripe Connect           | Existing deterministic keys         | RPCs/Stripe                          | Pending/retry/fail states      | P0/P1               |
| `expire-bounties`                                 | Expire stale bounties                        | Scheduled/admin  | Indirect payment state         | Supabase                 | Status guards                       | DB updates                           | Logs                           | P1                  |
| `identity-*`                                      | Stripe Identity sessions/status/webhooks     | User/webhook     | No direct money, affects trust | Stripe Identity          | Webhook/Stripe IDs                  | DB updates                           | Logs                           | P1                  |
| `moderation-sweep`                                | Moderation background                        | Scheduled/admin  | No direct money                | Supabase                 | N/A                                 | DB updates                           | Logs                           | P2                  |
| `notifications`, `process-notification`, `send-*` | Notifications                                | User/system      | No direct money                | Expo/email               | Outbox dedupe in places             | Best effort                          | Non-fatal                      | P2                  |
| `payments`                                        | Wallet deposits and payment methods          | User JWT         | Yes                            | Stripe                   | `apply_deposit`, PaymentIntent IDs  | RPCs                                 | Rejects unverifiable state     | P0/P1               |
| `reconciliation`                                  | Stripe/local comparison                      | Cron/admin       | No money movement              | Stripe/Supabase          | Finding keys                        | Read mostly; safe status repair only | Findings/alerts                | P1                  |
| `review-id`                                       | Identity review                              | User/admin       | No direct money                | Supabase                 | N/A                                 | Auth checks                          | API errors                     | P2                  |
| `stripe-mode-check`                               | Environment/mode check                       | User/system      | No direct money                | Stripe                   | N/A                                 | Read-only                            | API errors                     | P2                  |
| `wallet`                                          | Wallet balance/deposit helpers               | User JWT         | Yes                            | Stripe/Supabase          | PaymentIntent verification and RPCs | RPCs                                 | Rejects unverifiable state     | P0/P1               |
| `webhooks`                                        | Stripe platform and Connect webhook endpoint | Stripe signature | Yes                            | Stripe/Supabase          | `claim_stripe_event` lease          | CAS updates/RPCs                     | DLQ + fail-closed finalization | P0 fixed/P1 remains |
| Share/app-link/marketing analytics functions      | Public/share/analytics                       | Mixed            | No direct money                | Supabase/storage         | N/A                                 | Best effort                          | Logs                           | P2                  |

## Stripe Webhook Inventory

The `webhooks` function handles these event families:

- `payment_intent.succeeded`: wallet deposit via `apply_deposit`; Phase 2 bounty escrow to `captured`.
- `payment_intent.canceled`: Phase 2/v3 funding to `canceled` or v3 `expired`.
- `payment_intent.amount_capturable_updated`: v3 authorization to `authorized`.
- `payment_intent.payment_failed`: v3 funding to `failed`; legacy failure tracking.
- `setup_intent.succeeded/setup_failed`: payment method/profile customer sync.
- `charge.refunded`: wallet refund via `apply_refund`; Phase 2 bounty refund reflection.
- `refund.created/refund.updated/refund.failed`: observability and failed-refund rollback to `captured`.
- `transfer.created/failed/reversed`: Phase 2/v3 release confirmation/failure; legacy transfer setback handling.
- `payout.created/updated/paid/failed/canceled`: withdrawal payout id backfill, status tracking, completion, failure refund.
- `account.updated`, `capability.updated`, `person.updated`, `account.application.deauthorized`, external account events: Connect capability and payout-method sync.
- `balance.available`: platform and connected-account reconciliation snapshots.
- `charge.dispute.*`: dispute rows, balance freeze/unfreeze/deduction, findings.
- `checkout.session.completed/async_payment_succeeded`: web bounty checkout conversion through `fn_create_bounty_from_pending`.

Webhook idempotency is through `claim_stripe_event(stripe_event_id, event_type, event_data)` and the `stripe_events` table. Handler-level money effects also use Stripe object IDs, SQL RPC idempotency, and compare-and-set status guards.

## Findings

### P0 Fixed

- Phase 2 `/bounty-payments/create` could create multiple Stripe PaymentIntents for one bounty under concurrent requests because the initial existence check was not a lock and the Stripe call had no idempotency key. Fixed by adding `idempotencyKey: bounty_payment_create_<bountyId>_<amountCents>`, so a materially different bounty amount does not silently replay an old PaymentIntent.
- The same path could cancel a shared Stripe-idempotent PaymentIntent if the loser hit a DB unique conflict after Stripe replayed the winner's object. Fixed by retrying reads for the winning `bounty_payments` row by PaymentIntent and bounty ID, then returning `reused: true` or an explicit in-flight conflict without canceling on `23505`.
- `webhooks` could finish handling an event, fail to mark `stripe_events` as processed, log CRITICAL, and still return 200 to Stripe. Fixed by throwing so Stripe retries after the processing lease expires.
- Storage could allow duplicate active bounty payment rows and duplicate Stripe-object ledger evidence. Fixed by adding unique indexes.

### P1 Remaining

- v3 release still writes `bounty_v3_funding` and `ledger_entries` in separate API calls after Stripe capture/transfer. Stripe idempotency prevents duplicate money movement, but a DB failure can still leave a temporarily incomplete local state until webhook or reconciliation repairs it.
- Several webhook side effects such as notifications are best-effort or insert/update fallback rather than fully outbox-transactional. This is operationally acceptable for notification delivery but not a source of financial truth.
- `apple-pay`, `admin-withdrawals`, and the full `payments`/`wallet` routes deserve a deeper live-schema review before declaring no residual P0s.

### P2 Remaining

- Edge Function inventory is manually maintained in this report. A generated inventory command would reduce drift.
- Observability exists through logs and reconciliation tables, but alert wiring should be verified in production.

## Database Changes

Added migration `20260902213000_payment_idempotency_constraints.sql`:

- `bounty_payments_one_live_row_per_bounty_idx`: one non-canceled/non-failed payment row per bounty, built concurrently.
- `bounty_payments_stripe_transfer_unique_idx`: one bounty payment per Stripe Transfer, built concurrently.
- `bounty_payments_stripe_refund_unique_idx`: one bounty payment per Stripe Refund, built concurrently.
- `ledger_entries_one_transfer_leg_idx`: one ledger entry per `(leg, stripe_transfer_id)`, built concurrently.
- `ledger_entries_one_payout_leg_idx`: one ledger entry per `(leg, stripe_payout_id)`, built concurrently.

## Tests Run

- `__tests__/unit/financial-invariants.test.ts`: 32 passed.
- `__tests__/unit/webhooks-contract.test.ts`: 6 passed.
- `npx tsc --noEmit`: passed with no output.

## Deployment Plan

1. Run duplicate preflight in production before applying the new migration:
   ```sql
   select bounty_id, count(*)
   from public.bounty_payments
   where status not in ('canceled', 'failed')
   group by bounty_id
   having count(*) > 1;
   ```
2. If rows are returned, reconcile each bounty against Stripe before migration.
3. Apply `20260902210000_stripe_event_claim_lease.sql` if not already applied, then reload PostgREST schema cache.
4. Apply `20260902213000_payment_idempotency_constraints.sql` with a migration runner that does not wrap the file in a transaction; it uses `CREATE UNIQUE INDEX CONCURRENTLY` to avoid blocking payment writes during index builds.
5. Deploy `bounty-payments` and `webhooks` Edge Functions together.
6. Verify env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, optional rotation secret, and reconciliation cron secret.
7. Confirm Stripe Dashboard sends platform and Connect events to the same webhook URL with matching secrets.
8. Monitor `stripe_events` for `failed`/stuck `processing`, reconciliation health, and CRITICAL logs for at least one webhook retry window.

## Post-Deployment Checklist

- Send a Stripe test webhook with a bad signature and confirm 400.
- Send the same valid event twice and confirm the second response is duplicate/no-op.
- Trigger two simultaneous Phase 2 funding requests for one test bounty and confirm one Stripe PaymentIntent and one live `bounty_payments` row.
- Confirm `payment_intent.succeeded` advances only matching pending bounty payments.
- Confirm a webhook finalization DB failure produces a 500 and a failed `stripe_events` record.
- Run reconciliation and confirm no new critical findings.
- Confirm payout and transfer webhooks are arriving from both platform and Connect endpoints.
