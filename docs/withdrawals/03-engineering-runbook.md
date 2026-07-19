# Withdrawal System — Engineering Runbook

> For engineers. APIs, RPCs, tables, Stripe objects, retry/idempotency mechanics, recovery procedures, monitoring, debugging, with SQL. Companion to [01-system-overview.md](01-system-overview.md); deep architecture history lives in `docs/payments/WITHDRAWAL_SYSTEM_RUNBOOK.md`.

## API endpoints

All served by Supabase Edge Functions.

| Method | Path | Function | `verify_jwt` | Notes |
|---|---|---|---|---|
| POST | `/connect/transfer` | `connect` | `false` (self-authenticates) | The withdrawal endpoint |
| POST | `/connect/retry-transfer` | `connect` | `false` | Self-service retry, capped at 3 attempts |
| POST | `/connect/create-account-link` | `connect` | `false` | Legacy hosted-onboarding link |
| POST | `/connect/create-account-session` | `connect` | `false` | Stripe Connect Embedded Components session |
| GET | `/connect/embedded` | `connect` | `false` (public) | HTML shim for the onboarding WebView; never exposes the secret key |
| POST | `/connect/verify-onboarding` | `connect` | `false` | Live `charges_enabled`/`payouts_enabled` check |
| GET/POST/DELETE | `/connect/bank-accounts[/:id[/default]]` | `connect` | `false` | Manual entry (POST) is 410 Gone — use Financial Connections |
| GET | `/wallet/balance` | `wallet` | `false` | Sole source of truth for balance; no auto-reconciliation as of 2026-07-18 (that pattern was removed as a double-spend risk) |
| GET | `/wallet/transactions` | `wallet` | `false` | Paginated history |
| POST | `/webhooks` (also `/webhooks/stripe`) | `webhooks` | `false` (HMAC-verified instead) | All inbound Stripe events |
| POST | `/admin-withdrawals` | `admin-withdrawals` | **`true`** | force-retry / manual adjustment / mark externally settled / reverse transfer / on-demand reconciliation / Stripe comparison / log listing, admin-role gated |
| GET/POST | `/stripe-mode-check` | `stripe-mode-check` | `false` | Unauthenticated diagnostic — reports `{configured, keyPrefix, livemode, webhookSecretConfigured}` for whichever project it's deployed to. No financial data or secrets exposed. Use before assuming any environment's Stripe mode. Documented as deployed to production since the prior pass but was actually missing until 2026-07-18 (doc/reality drift, same pattern as everything else in this project — verify deployment, don't trust the doc) — now genuinely live, confirmed via a real call (`keyPrefix: sk_live_`, `livemode: true`). |
| POST | `/admin-profiles` | `admin-profiles` | **`true`** | *(new 2026-07-18)* `{ action: 'list' \| 'getById', id?, status?, verificationStatus? }`, admin-role gated, service-role-backed. Not withdrawal-specific — supports the admin panel's user list/detail screens (`lib/admin/adminDataClient.ts`) without depending on the broad `profiles` SELECT RLS policy. See `docs/withdrawals/08-profiles-rls-migration-strategy.md`. |

## `admin-withdrawals` — actions

Requires `Authorization: Bearer <admin JWT>` (checked via `app_metadata.role === 'admin'` or `app_metadata.roles` containing `'admin'`, same pattern as `admin-review-id`).

```jsonc
// Force-retry a permanently_failed withdrawal (bypasses the 3-attempt client cap)
{ "action": "force_retry", "transactionId": "<uuid>", "reason": "<required>", "bankAccountId": "<optional override>" }

// Manual balance credit/debit (positive credits, negative debits)
{ "action": "manual_adjustment", "userId": "<uuid>", "amount": 38.00, "reason": "<required>", "relatedTransactionId": "<optional>" }

// Mark a pending/failed withdrawal as manually_paid (resolved outside the app)
{ "action": "mark_externally_settled", "transactionId": "<uuid>", "reason": "<required>", "confirmedNoStripePayout": true, "note": "<optional>", "balanceAdjustment": 0 }

// Reverse the Stripe Transfer for a manually_paid withdrawal — MUST be called after mark_externally_settled, never before
{ "action": "reverse_transfer", "transactionId": "<uuid>", "reason": "<required>" }

// On-demand reconciliation run (same checks as the daily pg_cron job)
{ "action": "run_reconciliation" }

// Read-only Stripe-vs-ledger comparison for one transaction (Transfer + recent Payouts on the connected account)
{ "action": "compare_stripe", "transactionId": "<uuid>" }

// List recent admin actions (optionally filtered to one user)
{ "action": "list_log", "userId": "<optional>", "limit": 50 }
```

Every action writes to `admin_action_log` regardless of success/failure. `manual_adjustment` also writes a real `wallet_transactions` row (`type: 'admin_adjustment'`) so the ledger stays reconciliation-accurate. `force_retry` reuses the exact destination-resolution/promotion logic as the self-service retry path — it does not skip the "confirm the bank account is actually the payout destination before charging the balance" safety check.

**`mark_externally_settled`** requires `confirmedNoStripePayout: true` explicitly — the action cannot itself verify Stripe payout state, so it fails closed rather than trusting an implicit default. Idempotent: calling it again on an already-`manually_paid` row is a no-op success.

**`reverse_transfer`** calls `stripe.transfers.createReversal()` using this function's own full-access `STRIPE_SECRET_KEY` — notably, this is the one place in the codebase (as of this pass) that can actually call the Transfers API for a reversal; some external tooling used during audits may have a separately-restricted Stripe key that doesn't expose Transfers at all. **Refuses to run on anything other than a `manually_paid` row** — see the idempotency-gap note under Webhooks below for why the ordering matters.

**`compare_stripe`** is the only place that can read live Payout status scoped to a connected account (`stripe.payouts.list({...}, {stripeAccount: id})`) — useful when external tooling's Stripe access is restricted and can't see Connect-scoped resources.

## Edge Functions inventory (withdrawal-relevant)

| Function | File | Lines (approx) |
|---|---|---|
| `connect` | `supabase/functions/connect/index.ts` | ~1540 |
| `connect` (validation helpers, unit-tested source of truth) | `supabase/functions/connect/withdrawal-validation.ts` | ~205 |
| `webhooks` | `supabase/functions/webhooks/index.ts` | ~2000 |
| `wallet` | `supabase/functions/wallet/index.ts` | ~900 |
| `admin-withdrawals` | `supabase/functions/admin-withdrawals/index.ts` | ~550 |

**Local imports are not supported by the deploy bundler.** `validateWithdrawalRequest`, `mapStripeTransferError`, `mapWithdrawBalanceError`, `resolveWithdrawalDestination`, and `logCritical` are each duplicated inline across the functions that need them (`connect/index.ts`, `admin-withdrawals/index.ts`) rather than imported — keep duplicates in sync by hand. `withdrawal-validation.ts` is the unit-tested source of truth for the amount-validation/error-mapping logic; `__tests__/unit/withdrawal-validation.test.ts` includes a contract test asserting the inlined copy in `connect/index.ts` stays in sync.

There is **no admin/support-side tool beyond `admin-withdrawals`** for anything not covered by its two actions — anything else still requires a service-role SQL script.

The old Fastify mirror (`services/api/src/routes/wallet.ts`, `consolidated-webhooks.ts`) was deleted in this pass — confirmed to have zero deploy path (not referenced by any CI/deploy config beyond a compile-check). If you find references to it in old docs or comments, they're stale.

## Database tables (withdrawal-relevant columns)

**`profiles`**: `balance NUMERIC(12,2)`, `balance_on_hold NUMERIC(12,2)`, `balance_frozen BOOLEAN`, `stripe_connect_account_id`, `stripe_connect_onboarded_at`, `stripe_connect_charges_enabled`, `stripe_connect_payouts_enabled`, `stripe_connect_onboarding_complete`, `stripe_connect_requirements JSONB`, `payout_failed_at`, `payout_failure_code`.

- `balance >= 0` is enforced by a live CHECK constraint (`check_balance_non_negative`), restored in this pass after being found missing despite an older migration file claiming to add it.
- ~35 sensitive columns (balance, Stripe fields, risk/verification fields) are protected from direct client writes by a `BEFORE UPDATE` trigger (`prevent_client_writes_to_protected_profile_columns`) regardless of RLS/grants — this also protects against a `SECURITY DEFINER` RPC being called directly by a non-service-role client, since the trigger fires on the underlying table write regardless of caller.

**`wallet_transactions`**: `id`, `user_id`, `bounty_id`, `type`, `amount NUMERIC(12,2)` (negative for withdrawals), `status`, `stripe_transfer_id`, `stripe_connect_account_id`, `idempotency_key`, `metadata JSONB`.

- `type` is a **Postgres ENUM** (`wallet_tx_type_enum`) in the live schema — `escrow`, `release`, `refund`, `deposit`, `withdrawal`, `dispute_loss`, `admin_adjustment` (the last one added this pass). Older migration files describe `type` as `TEXT` with a `wallet_transactions_type_check` CHECK constraint — that's stale; the live column has been an enum for some time (verified via `information_schema`/`pg_enum`, not assumed from the migration files). **`ALTER TYPE ... ADD VALUE` must run outside `apply_migration`'s transaction wrapper** (via `execute_sql`) — same class of constraint as `CREATE INDEX CONCURRENTLY`.
- `status` is a 4-value enum as of 2026-07-18: `pending`, `completed`, `failed`, **`manually_paid`** *(new)*. `manually_paid` marks a withdrawal resolved outside Stripe's normal transfer/payout flow (e.g. paid by another means after confirming no Stripe payout landed) — it is permanently terminal, never retried or auto-refunded again. No `'reserved'` — ignore anything referencing it, it describes the dead `withdrawals`/`v2` schema.
- Unique index on `(user_id, idempotency_key) WHERE type='withdrawal'` prevents double-processing.
- Unique partial index limits a user to one `pending` withdrawal at a time (`idx_wallet_tx_one_pending_withdrawal`) — restored this pass alongside the balance floor, both had been present only in a git migration file, never actually applied live.

**`admin_action_log`** *(new this pass)*: `id`, `admin_user_id`, `action_type` (`force_retry_withdrawal` | `manual_balance_adjustment` | `mark_externally_settled_withdrawal` | `reverse_stripe_transfer`), `target_user_id`, `target_transaction_id`, `amount`, `reason`, `result` (`success`|`failure`), `metadata JSONB`, `created_at`. `action_type` is TEXT+CHECK (confirmed live, not an enum — verify before assuming otherwise given this project's drift history) — widened once already (2026-07-18) when `mark_externally_settled_withdrawal` was added; **always widen this CHECK constraint in the same deploy as any new `admin-withdrawals` action**, the omission was caught live via a real CHECK violation the first time the new action ran. RLS enabled with **no policies at all** — `service_role` bypasses RLS by default, so only the `admin-withdrawals` function can read/write; there's no legitimate client-side use case, unlike `dispute_audit_log`.

**`reconciliation_findings`** *(new this pass)*: `id`, `run_at`, `finding_type`, `severity` (`info`|`warning`|`critical`), `user_id`, `details JSONB`, `acknowledged_at`, `acknowledged_by`. Same RLS posture as `admin_action_log` — service-role only.

**`reconciliation_known_exceptions`** *(new 2026-07-18)*: `id`, `finding_type`, `user_id`, `reason`, `created_by`, `created_at`. An audited allowlist of `(finding_type, user_id)` pairs a human has reviewed and decided are not actionable — e.g. a documented balance write-off with no offsetting ledger row by design. `run_withdrawal_reconciliation()` checks this table before inserting a new `balance_drift` finding, so acknowledged-as-intentional cases stop being re-flagged daily. Same RLS posture (service-role only).

**`notifications`** / **`notifications_outbox`**: in-app inbox vs. push queue — these are separate. `payout.paid`/`payout.failed`/`payout.canceled` write to `notifications` (in-app) only, not the push outbox. Don't assume a push notification fires for withdrawal events.

**`stripe_events`**: webhook replay log, upserted on `stripe_event_id` before processing each event.

## Key RPCs (all `service_role`-only — confirmed live, not just as documented in migration files)

| RPC | Behavior |
|---|---|
| `withdraw_balance(p_user_id, p_amount)` | Row-locked atomic debit; raises on `balance_frozen` or insufficient balance |
| `update_balance(p_user_id, p_amount)` | Generic credit/debit (positive or negative), used for refunds and `admin_adjustment` |
| `run_withdrawal_reconciliation()` | *(new)* Runs the automated checks below, inserts findings, returns the count |
| `fn_open_dispute_hold` / `fn_close_dispute_hold` | In-app dispute balance holds (distinct from Stripe chargebacks) |

## Scheduled reconciliation

`run_withdrawal_reconciliation()` runs daily at 09:00 UTC via `pg_cron` (job name `withdrawal-reconciliation-daily`). It's a SQL translation of `scripts/reconcile_and_triage.sql`'s automatable sections (everything except the Stripe cross-check, which needs live API access this function doesn't have):

- Balance drift (`profiles.balance` vs. `SUM(completed wallet_transactions)`) — `critical`
- Negative/inconsistent balances — `critical` (defense-in-depth; the CHECK constraint should already prevent this)
- Orphaned transactions (no matching profile) — `warning`
- Stuck pending withdrawals older than **1 hour** — `critical` (note: the manual script uses a 3-day threshold for a human skimming results; the automated job uses 1 hour since a correctly-behaving system should never leave a row `'pending'` at all)
- Withdrawals missing `stripe_transfer_id` after 10 minutes — `warning`
- Duplicate idempotency keys / multiple pending withdrawals per user / reused transfer IDs — `critical` (belt-and-suspenders; both underlying unique indexes should already prevent these)
- Connect account mismatch between the transaction's recorded account and the profile's current one — `info`

Check findings: `SELECT * FROM reconciliation_findings WHERE acknowledged_at IS NULL ORDER BY severity, run_at DESC;` See the Operations Playbook for the daily triage procedure.

**Hardened 2026-07-18** after the job's first live run surfaced two real bugs in the checks themselves:

- **Ledger math for `balance_drift`** now sums `status IN ('completed', 'manually_paid')`, not just `'completed'` — a `manually_paid` row represents a real, final debit and was previously excluded, making a correctly-settled withdrawal look like permanent drift.
- **`withdrawal_missing_transfer_id`** now only checks `status = 'completed'` rows — a `'failed'` withdrawal legitimately can have no `stripe_transfer_id` if it failed before Stripe ever created the Transfer object (e.g. `balance_insufficient` at the platform level). Flagging failed rows was a false-positive generator.
- **Every check now dedups against existing unacknowledged findings** with the same natural key (transaction ID, user ID, idempotency key, or transfer ID depending on the check) before inserting — the job previously had no such guard and would insert a fresh duplicate finding every single day for the same unresolved issue.
- **`balance_drift` also excludes any `(user_id)` present in `reconciliation_known_exceptions`** for that finding type, so a human-reviewed-and-accepted case (see the table description above) stops being re-surfaced entirely, not just re-acknowledged daily.

## Idempotency and concurrency guarantees

| Guard | Mechanism | Prevents |
|---|---|---|
| Client double-tap | Stable idempotency key, one per screen mount, reused across retries | Duplicate submission of one logical attempt |
| DB-level dedup | Unique index on `(user_id, idempotency_key)` | Two rows for one key even under a race |
| Stripe-level dedup | `stripe.transfers.create(..., {idempotencyKey})` | A second real Transfer even if two requests race past the DB check |
| Lost insert-race | On `23505`, the losing request refunds its own extra deduction and replays the winner | Double-debiting on a race |
| Single in-flight withdrawal | `withdraw_balance()` uses `SELECT ... FOR UPDATE` | Two concurrent withdrawals reading a stale balance |
| Webhook replay | `stripe_events` upserted before processing; handlers additionally check `metadata.transfer_status`/`payout_status` before refunding | Double-refunding on redelivery |
| Retry vs. late webhook race | Optimistic-lock guard (`.eq('stripe_transfer_id', ...)` re-filtered before UPDATE) | An old transfer's failure event corrupting a newer in-flight retry |
| Reversal webhook vs. manual settlement | `handleTransferSetback()` checks `existingTx.status === 'manually_paid'` and returns early, before any status/balance mutation | A `transfer.reversed` event (triggered by `reverse_transfer`) resurrecting a balance that was already correctly settled outside the app — found live 2026-07-18 as a real gap before this guard existed; the fix is why `mark_externally_settled` must always precede `reverse_transfer` |

## Debugging checklist

1. **Verify deployed code matches git.** This project's edge functions have a documented history of direct out-of-band deploys causing real regressions. Fetch the deployed source (`get_edge_function` via the Supabase MCP, or `supabase functions download`) and diff against `git show HEAD:supabase/functions/<fn>/index.ts` (normalize CRLF first) before trusting `git log` for "what's live."
2. **Grep Edge Function logs** for `CRITICAL` (structured JSON as of this pass — `logCritical()` in each function) and `[connect/transfer]`/`[webhooks]` prefixes for stage-by-stage tracing.
3. **Cross-check Stripe directly** — Dashboard → Connect → [account] → Transfers/Payouts, or the Stripe MCP tools, for the ground truth on whether money actually moved.
4. **Run the reconciliation queries** (`scripts/reconcile_and_triage.sql` for the full manual set, or query `reconciliation_findings` for what the scheduled job already caught).

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `WITHDRAW_MIN_USD` | 10 | Minimum withdrawal |
| `WITHDRAW_MAX_USD` | 10000 | Maximum single withdrawal |
| `CONNECT_TRANSFER_RETIRED` | unset (false) | Staged kill-switch for the whole legacy withdrawal path, part of an in-progress Phase 2 migration (`supabase/functions/bounty-payments`) — off in production, don't assume it stays off without checking |

## CI

`.github/workflows/ci.yml` has a new `edge-functions` job (this pass) running `deno check` + `deno lint` against `connect`, `webhooks`, `wallet`, `admin-withdrawals` — the first automated check ever run against the actual production Edge Function source. Currently `continue-on-error: true` (visibility only) since this is a brand-new check with no prior clean-run history; promote to blocking once confirmed stable.
