# Withdrawal System — Operations Playbook

> Day-to-day operation: health checks, reconciliation, monitoring, incident response, deploy/rollback, and verification checklists. Audience: whoever owns on-call / platform ops for this system.

## Daily health check

1. **Check unacknowledged reconciliation findings:**
   ```sql
   SELECT finding_type, severity, count(*) FROM reconciliation_findings
   WHERE acknowledged_at IS NULL GROUP BY finding_type, severity ORDER BY severity DESC;
   ```
   Any `critical` row needs same-day triage. `warning`/`info` can be batched weekly unless the count is climbing.

2. **Confirm the reconciliation job actually ran today:**
   ```sql
   SELECT * FROM cron.job_run_details
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'withdrawal-reconciliation-daily')
   ORDER BY start_time DESC LIMIT 5;
   ```
   If the last run is >36h old, the cron job may have stopped — check `pg_cron` extension status and the job's `active` flag.

3. **Grep Edge Function logs for `CRITICAL`** (structured JSON as of this pass) across `connect`, `webhooks`, `admin-withdrawals` for the last 24h. Any hit is a manual-reconciliation-required case that hasn't necessarily been caught by the daily job yet (the job runs once a day; a CRITICAL log is real-time).

4. **Spot-check webhook delivery** in the Stripe Dashboard (Developers → Webhooks → your endpoint → recent deliveries) for failures/retries.

## Triage: acknowledging a reconciliation finding

Once investigated and resolved (or confirmed benign):
```sql
UPDATE reconciliation_findings
SET acknowledged_at = now(), acknowledged_by = '<your admin user id>'
WHERE id = '<finding id>';
```
Don't acknowledge without action on `critical` findings — `balance_drift` and `stuck_pending_withdrawal` in particular represent real money discrepancies, not noise.

## Webhook verification

**Subscribing to an event type in code does not enable delivery.** Each event must be separately enabled in the Stripe Dashboard's webhook endpoint config. After any deploy that adds a new `case` to `webhooks/index.ts`'s switch statement, confirm in the Dashboard that the event type is actually checked. As of this pass, verify all of:

- `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.requires_action`
- `setup_intent.succeeded`, `setup_intent.setup_failed`
- `charge.refunded`
- `transfer.created`, `transfer.paid`, `transfer.failed`, **`transfer.reversed`** *(new)*
- `account.updated`, `capability.updated`, **`account.application.deauthorized`** *(new)*
- `payout.paid`, `payout.failed`, `payout.canceled`, **`payout.updated`** *(new)*
- `charge.dispute.created`, `charge.dispute.closed`

The four bolded events were added in this hardening pass — **explicitly confirm these four are checked in the live Stripe Dashboard config**, since past sessions have found code-level additions that were never actually enabled Stripe-side (this happened previously with `payout.canceled`).

## Stripe verification

- Confirm the platform account is in the expected mode (live, `acct_1PGppVJekUCspsfJ` per the tech spec) before any Stripe-touching change.
- After any change to `connect/index.ts` or `webhooks/index.ts`, spot-check a handful of recent real Transfers/Payouts in the Dashboard against their corresponding `wallet_transactions` rows to confirm the mapping still holds.

## Incident response

**If you see a `'pending'` withdrawal older than a few minutes:**
1. Treat as active incident — this should be structurally impossible (see System Overview).
2. Diff the deployed `connect` function against git (`get_edge_function` + compare, normalize CRLF) — this exact bug class has shipped via undocumented direct deploys before.
3. If drift is found, that's the root cause — redeploy from git and verify byte-for-byte match.
4. If no drift, escalate for deeper investigation; do not assume it will resolve on its own.

**If a CRITICAL log line appears for a failed refund:**
1. This means a Stripe/DB double-failure occurred — the automated retry-once-then-log pattern already tried and failed.
2. Pull the full context from the log line (now a single structured JSON blob per `logCritical()`, containing `userId`/`amount`/`transactionId` as available).
3. Manually verify via Stripe whether the original charge/transfer actually succeeded before deciding whether to credit or debit.
4. Use `admin-withdrawals` `manual_adjustment` to correct, with a reason string documenting the incident — this creates both an audit log entry and a real ledger row.

**If balance drift is found for a specific user:**
1. Pull their full `wallet_transactions` history and manually walk through it against `profiles.balance`.
2. Common causes: a `pending` row never resolved (see above), a refund RPC that failed silently before this pass's improved logging, or a legitimate historical `admin_adjustment` made before this table existed.
3. Correct via `manual_adjustment` only once the cause is understood — don't paper over drift without knowing why it happened, since the same cause will recur.

## Deployment checklist

Before deploying any change to `connect`, `webhooks`, `wallet`, `admin-withdrawals`, or `stripe-mode-check`:

1. `npx tsc --noEmit` clean
2. `npm run lint` — 0 errors, no new warnings
3. Full `npx jest` suite green
4. Syntax-check the specific Deno file(s) with `npx esbuild <file> --bundle --platform=neutral --format=esm --external:https://* --external:npm:*` (no local Deno CLI in most dev environments)
5. Manual line-by-line diff review of the change
6. Deploy
7. **Immediately verify**: fetch the deployed source and diff byte-for-byte against the git commit just deployed (normalize CRLF) — do not trust the deploy call's success response alone
8. For any new/changed DB object: verify live via direct SQL (`information_schema`, `pg_constraint`, `pg_enum`, etc.) rather than assuming the migration file's intent matches reality — this project has repeated history of git/prod schema drift in both directions
9. Safe HTTP smoke test: no-auth and garbage-auth requests against any new/changed endpoint, confirming 401/400/405 as expected — never a real authenticated request with live data unless explicitly authorized by a human present for that step

## Rollback checklist

1. Identify the last known-good deployed version (`list_edge_functions` shows version history per function).
2. Redeploy that exact prior source — pull from git history if the working tree has since moved on, not from memory.
3. For a migration that needs reverting: write and apply an explicit down-migration; do not attempt to hand-edit live schema state without a corresponding git-tracked file, or you reproduce the exact drift problem this system has been repeatedly bitten by.
4. Re-run the deployment checklist's verification steps against the rolled-back state.
5. Document the rollback and root cause before considering the incident closed.

## Support escalation

Support staff should escalate per the [Support Runbook](02-support-runbook.md)'s escalation section. When an escalation lands with ops/engineering, the minimum required context is: `wallet_transactions.id`, `stripe_transfer_id` (if present), user ID, and exact timestamps — if a ticket arrives without these, get them before starting investigation rather than guessing at which transaction is in question.

## Recovery tooling (as of 2026-07-18)

`admin-withdrawals` now supports, all JWT-gated to `role=admin` and fully audited in `admin_action_log`:

| Action | Purpose | Guardrail |
|---|---|---|
| `force_retry` | Bypass the 3-attempt client retry cap | None beyond admin auth — original behavior |
| `manual_adjustment` | Credit/debit a balance directly, writes a real `admin_adjustment` ledger row | Capped at $10,000/adjustment |
| `mark_externally_settled` | Mark a `pending`/`failed` withdrawal as `manually_paid` (paid outside the app) | Requires `confirmedNoStripePayout: true` explicitly — fails closed. Idempotent. |
| `reverse_transfer` | Reverses the Stripe Transfer, pulling funds back from the connected account before Stripe's automatic payout can sweep them | **Only works on a `manually_paid` row** — calling it on anything else is refused. This ordering is load-bearing (see `webhooks/index.ts`'s `handleTransferSetback` guard). |
| `run_reconciliation` | On-demand version of the daily job, read-only | None needed — read-heavy, no balance/Stripe writes |
| `compare_stripe` | Read-only Stripe-vs-ledger comparison for one transaction, including live Payout status on the connected account | None needed — read-only |

**The `manually_paid` status** is a new terminal `wallet_transactions.status` value (alongside `pending`/`completed`/`failed`) for withdrawals resolved outside Stripe's normal transfer/payout flow. A `manually_paid` row is permanently excluded from retry and from the webhook refund logic — never expect one to change state again except via `reverse_transfer` updating its metadata.

**Correct order for settling a stuck/problem withdrawal externally:** always `mark_externally_settled` *before* `reverse_transfer`. Reversing first risks the resulting `transfer.reversed` webhook finding the row still in its old status and re-triggering the refund-and-fail path, which would resurrect the balance — the exact double-payment risk this tooling exists to prevent.

## Known accepted risks (not incidents if observed)

- Payouts taking slightly longer than 1-2 business days near a weekend/holiday — no code-level handling exists for this, and none is planned; it's Stripe's own scheduling.
- Two withdrawals with different bank-account selections landing before the same Stripe payout sweep still get swept together to whichever account is default at sweep time — documented architectural limitation, not a bug to chase. See [07-manual-payouts-evaluation.md](07-manual-payouts-evaluation.md) for what fixing this properly would take.
- **Some historical balance-drift findings are intentional, not bugs.** A small number of accounts had their balance zeroed by a documented "Wallet Phase 2" write-off with no offsetting ledger row by design — these are recorded in `reconciliation_known_exceptions` so the daily job stops re-flagging them. Before ever "fixing" a balance-drift finding by crediting money back, check this table first; a write-off resurrected by mistake once already (see the historical incident in `WITHDRAWAL_SYSTEM_RUNBOOK.md` §11.1) and had to be corrected back down.
- A genuinely isolated test environment (Staging) exists and is confirmed to be on Stripe test mode, but its code/schema are currently stale relative to production — see the [Testing Guide](06-testing-guide.md) for exact status. Until synced, live-money-path verification still requires either careful read-only probing or a deliberate, human-present, minimal-amount live test against production.
