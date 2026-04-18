# Withdrawal Fix Diagnostic Playbook

If withdrawals are failing before launch, use this as your triage/runbook. This is ordered to get signal fast and prevent balance mistakes.

## 1) Confirm the active backend surface first (critical)

Withdrawal-related endpoints currently exist across multiple surfaces. Confirm which one the app is hitting before debugging deeper.

- App routing: `/home/runner/work/Bounty-production/Bounty-production/lib/config/api.ts`
- Edge connect function: `/home/runner/work/Bounty-production/Bounty-production/supabase/functions/connect/index.ts`
- Edge wallet function: `/home/runner/work/Bounty-production/Bounty-production/supabase/functions/wallet/index.ts`
- Legacy Fastify routes: `/home/runner/work/Bounty-production/Bounty-production/services/api/src/routes/wallet.ts`

### Known routing risk
The mobile withdrawal screens call `/connect/bank-accounts*`, but those routes are only visible in Fastify wallet routes, not in the Edge connect function.

- Mobile calls: `components/withdraw-screen.tsx`, `components/withdraw-with-bank-screen.tsx`
- Fastify has routes: `/connect/bank-accounts`, `/connect/bank-accounts/:bankAccountId`, `/connect/bank-accounts/:bankAccountId/default`
- Edge connect currently exposes: `/connect/create-account-link`, `/connect/verify-onboarding`, `/connect/transfer`, `/connect/retry-transfer`

## 2) Triage checklist by layer

### Layer A — Mobile validation and request shape

Files:
- `/home/runner/work/Bounty-production/Bounty-production/components/withdraw-screen.tsx`
- `/home/runner/work/Bounty-production/Bounty-production/components/withdraw-with-bank-screen.tsx`

Check:
- Email verification gate blocks correctly before requests.
- `MIN_WITHDRAWAL_AMOUNT` is enforced in UI.
- `idempotencyKey` is generated and sent with transfer requests.
- Error messages surfaced to user are specific (not just generic failures).

### Layer B — Edge connect transfer flow

File:
- `/home/runner/work/Bounty-production/Bounty-production/supabase/functions/connect/index.ts`

Current behavior to validate:
1. Uses `withdraw_balance` RPC to reserve/deduct.
2. Creates Stripe transfer.
3. Inserts `wallet_transactions` row as pending with `stripe_transfer_id`.

High-risk points:
- Client sends `idempotencyKey`, but transfer call path does not currently apply it.
- Transaction row is inserted after Stripe transfer creation; if insert fails, transfer exists without normal app ledger linkage.
- If rollback (`update_balance`) fails after transfer creation error, there is no durable `needs_balance_refund` marker on transaction metadata like the consolidated wallet service path uses.

### Layer C — DB constraints/RPC correctness

Migrations to verify in target environment:
- `/home/runner/work/Bounty-production/Bounty-production/supabase/migrations/20260410_harden_withdrawal_flow.sql`
- `/home/runner/work/Bounty-production/Bounty-production/supabase/migrations/20260417_add_balance_on_hold_dispute_freeze.sql`

Must hold true:
- `idx_wallet_tx_one_pending_withdrawal` exists.
- `withdraw_balance(UUID, NUMERIC)` exists and is callable by service role path in use.
- `withdraw_balance` enforces `balance - balance_on_hold >= amount` and frozen-wallet guards.

### Layer D — Webhooks + payout failure recovery

File:
- `/home/runner/work/Bounty-production/Bounty-production/supabase/functions/webhooks/index.ts`

Check these events in logs and DB:
- `transfer.created`
- `transfer.paid`
- `transfer.failed` (refund path + duplicate-refund guard)
- `payout.failed` (`profiles.payout_failed_at`, `profiles.payout_failure_code`)
- `payout.paid` (clears failure state + notifications)

Also validate balance response includes payout failure fields:
- `/home/runner/work/Bounty-production/Bounty-production/supabase/functions/wallet/index.ts`

### Layer E — Reconciliation safety net

File:
- `/home/runner/work/Bounty-production/Bounty-production/services/api/src/services/reconciliation-cron.ts`

Check:
- Cron is actually running in the deployed environment.
- It can repair flagged balance refund failures (`metadata.needs_balance_refund=true`) for wallet transactions.
- If deployment is Edge-only, document equivalent repair strategy.

## 3) Fast incident SQL checks

Run these against Supabase SQL editor during an incident.

```sql
-- Recent withdrawals with states and transfer linkage
select id, user_id, amount, status, stripe_transfer_id, metadata, created_at
from wallet_transactions
where type = 'withdrawal'
order by created_at desc
limit 100;

-- Users currently blocked by payout failures
select id, payout_failed_at, payout_failure_code, balance, balance_on_hold
from profiles
where payout_failed_at is not null
order by payout_failed_at desc
limit 100;

-- Duplicate/late webhook visibility
select event_id, event_type, processed, error_message, created_at
from stripe_events
where event_type in ('transfer.created','transfer.paid','transfer.failed','payout.failed','payout.paid')
order by created_at desc
limit 200;
```

## 4) Prioritized fix order for launch

1. **Routing parity**: Ensure active backend surface supports `/connect/bank-accounts*` used by mobile.
2. **Idempotency**: Apply request idempotency through transfer creation path.
3. **Ledger safety**: Ensure pending tx + rollback markers exist even on mid-flight failures.
4. **Recovery UX**: Verify payout failure banner and onboarding re-check clear paths work end-to-end.
5. **Ops safety**: Confirm reconciliation/repair is active and alerting on unrecoverable balance rollback failures.

## 5) Regression tests to run (existing suite targets)

- `__tests__/unit/services/wallet-routes.test.ts`
- `__tests__/unit/routes/consolidated-webhooks.test.ts`
- `__tests__/unit/server/transfer-failed-webhook.test.ts`
- `services/api/src/__tests__/idempotency.test.ts`
- `services/api/src/__tests__/reconciliation.test.ts`

## 6) Definition of done for withdrawal launch confidence

- No unresolved 5xx in `/connect/transfer` for golden-path users.
- No missing transaction rows for successful Stripe transfer IDs.
- No duplicate refunds on replayed `transfer.failed` events.
- Payout failure state appears in wallet balance response and clears after successful re-onboarding.
- On-call can diagnose any failed withdrawal in <15 minutes using this playbook.
