# Withdrawal System — Comprehensive Audit (2026-07-18)

> **Scope note before reading further.** `docs/withdrawals/01-11` already form a verified, current, 11-document set covering this system in depth — support runbook, engineering runbook, automation-agent decision tree, ops playbook, testing guide, and two design/strategy docs. This document does **not** replace them. It is a single, self-contained answer to a 17-question / 13-deliverable audit request, built by (a) re-reading 01-11 rather than trusting them blindly, and (b) independently re-verifying the load-bearing claims directly against live production — deployed Edge Function source byte-diffed against git, live RLS policies, live migration history, live cron job state, and live table contents — rather than re-stating what the docs say happened. Every fact below is either freshly verified in this pass (marked **[verified 2026-07-18]**) or explicitly sourced to one of the 01-11 docs. Where this pass found something 01-11 doesn't yet say, it's called out explicitly.
>
> Stripe Dashboard/API access was **not available** in this pass (the Stripe MCP connector requires interactive OAuth authorization, which isn't possible in this session) — everything Stripe-side below is verified from Bounty's own code and database records of Stripe's responses (webhook payloads, stored Transfer/Payout IDs, `admin-withdrawals`' `compare_stripe` action's own read-only Stripe calls as documented in code), not from live-querying Stripe directly. This is flagged wherever it matters.

> ### Addendum — re-verified 2026-07-19 (~07:47 UTC)
>
> This document was re-checked live rather than re-derived from scratch, since it was already independently verified less than a day earlier. Everything below still held: `connect` (v32) and `webhooks` (v36) remain byte-for-byte identical to git `main`; 88 profiles / 0 `payouts_enabled` is unchanged; the 2 `admin_action_log` entries are unchanged (still only the one resolved $38 incident). Two corrections to the record:
>
> 1. **§9/§11 item 1, downgraded — the reconciliation cron job is not broken, it just hasn't reached its first scheduled fire yet.** The `add_scheduled_reconciliation` migration created the job at `2026-07-18 17:22:09 UTC`, which is *after* that day's `0 9 * * *` UTC slot — so its first eligible run is `2026-07-19 09:00 UTC`, roughly 1h13m after this check. Zero rows in `cron.job_run_details` for `jobid=5` is exactly what's expected at this point, not evidence of a failure. This should be re-confirmed once that time passes; if it's still zero after `2026-07-19 09:05 UTC`, *then* treat it as the High-severity gap §11 originally described.
> 2. **§8/§14, corrected — `reconciliation_findings` is not empty, and that's a good sign, not a new problem.** It has 5 rows, all from a single `run_at = 2026-07-18 17:22:35 UTC` — an on-demand run (not the cron job, which has never fired), almost certainly executed as part of testing the migration that created it. All 5 are already `acknowledged_at`-stamped: 2 are the already-known Wallet-Phase-2 legacy-balance write-offs (product decided 2026-07-18 to leave at $0), 1 is a documented false positive in the original query (fixed same day), and 2 are the already-resolved $38 incident. **Net effect: this is stronger evidence of a clean ledger than §14 originally claimed** — the check has been exercised at least once, correctly flagged real historical issues, and every flag traces to something already understood and closed. §14's "treat reconciliation as manual-only until confirmed" recommendation still stands until the cron job proves it runs unattended, but the underlying ledger-integrity claim is now better-supported, not weaker.

---

## 1. Executive Summary

**Can a user withdraw money today? Yes, with limitations** (see §Q1 below for the precise reasoning — the honest answer has two layers: the *mechanism* works and is proven; the *current live population of eligible accounts* is very small).

The withdrawal system moves a hunter's internal ledger balance (`profiles.balance`) to their bank account via a two-hop Stripe Connect design: a synchronous **Transfer** (platform → connected account, which Bounty's code controls and waits for) followed by an asynchronous **Payout** (connected account → bank, entirely on Stripe's own schedule, invisible to Bounty except through webhooks). This two-hop split is the single most important fact about the system — `status: 'completed'` in the app means the Transfer succeeded, never that the money has reached the bank.

As of this pass:
- All four critical security migrations from the last hardening session are **confirmed applied to production** [verified 2026-07-18] (RLS anon-read hole closed, dispute-hold function re-secured, sensitive `profiles` columns column-REVOKEd, unauthenticated-callable RPCs locked down).
- The two most drift-prone Edge Functions, `connect` (v32) and `webhooks` (v36), are **byte-for-byte identical to the current git `main` branch** [verified 2026-07-18, full diff, CRLF-normalized] — the historical deploy-gap problem that caused the 2026-07-17 stuck-withdrawal incident is not currently present.
- The one previously-known stuck withdrawal ($38, from the 2026-07-17 connect deploy-drift incident) **is fully resolved** [verified 2026-07-18] — marked `manually_paid` then its Transfer reversed, both via the new admin recovery tool, both actions logged in `admin_action_log`.
- A **new operational gap was found in this pass**, not previously documented: the daily reconciliation cron job (`withdrawal-reconciliation-daily`) is registered and `active = true`, but has **zero recorded executions** in `cron.job_run_details` [verified 2026-07-18] — see §9 and §11 (Outstanding Risks).
- A second new finding: of 88 profiles in production, only 5 have any Stripe Connect account attached, and **zero currently have `stripe_connect_payouts_enabled = true`** [verified 2026-07-18]. Five historical withdrawals completed successfully in the past, so the mechanism is proven, but the live-eligible population right now is effectively zero — consistent with a pre-launch/limited-beta user base (total platform balance across all users: $19.65).

Automation is substantial but **not complete**: the withdrawal request itself, balance debit, Transfer creation, and all documented webhook-driven failure/refund paths are fully automated with no human in the loop. Recovery from a *stuck or ambiguous* state (permanently-failed retries, balance drift, externally-settled cases) requires a human operating the `admin-withdrawals` tool — by design, not by gap; see §3 and §10.

---

## 2. End-to-End Withdrawal Flow — Exact Sequence

```
Hunter's phone (withdraw-with-bank-screen.tsx)
   │  amount entered, bank account selected, confirmation dialog accepted
   │  ("This account will become your default payout account... 1-2 business
   │   days... can't be canceled once started")
   │  POST /connect/transfer  { amount, bankAccountId, idempotencyKey }
   ▼
Supabase Edge Function: connect (supabase/functions/connect/index.ts)
   1. Authenticate caller (Bearer JWT → auth.getUser)
   2. Validate amount: $10–$10,000 USD (server-side, WITHDRAW_MIN_USD/WITHDRAW_MAX_USD env vars)
   3. Idempotency replay check — unique index on (user_id, idempotency_key)
      WHERE type='withdrawal'; a retried request with the same key returns
      the original result, never double-processes
   4. Resolve destination bank account (resolveWithdrawalDestination()):
      list the connected account's Stripe external accounts, match the
      requested bankAccountId, promote it to default_for_currency if it
      isn't already — fail-closed (502) if Stripe doesn't confirm the
      promotion, before any balance is touched
   5. withdraw_balance(user_id, amount) RPC — SECURITY DEFINER, service_role
      only, row-locks the profile (SELECT ... FOR UPDATE), checks
      balance_frozen and balance - balance_on_hold >= amount, debits
      atomically. This is the actual point of no return.
   6. stripe.transfers.create({ amount, destination: connectedAccountId },
      { idempotencyKey }) — SYNCHRONOUS. The edge function's HTTP response
      to the client does not return until this call resolves.
      - On success → continue to step 7
      - On failure → update_balance() reverses the debit from step 5, the
        error is mapped to a client-safe code/message, no
        wallet_transactions row is inserted for a failure this early
   7. INSERT wallet_transactions: type='withdrawal', amount=-<amount>,
      status='completed' (never 'pending' — see the note below),
      stripe_transfer_id, idempotency_key, metadata (destination bank
      account id/last4/name, retry_count: 0)
   ◄──────────────────────────────────────────────────────────────
   200 { transferId, status: 'completed', newBalance }
   Client shows "Withdrawal Initiated" and refreshes the wallet balance
   from the server (refreshFromApi(), not the stale local cache)

   ... hours to days later, entirely Stripe-managed, invisible to the app
   except via webhooks ...

Stripe's own automatic payout schedule sweeps the connected account's
ENTIRE available Stripe balance to its default bank account
   │
   ▼
Supabase Edge Function: webhooks (supabase/functions/webhooks/index.ts)
   Routes 19 Stripe event types; withdrawal-relevant ones:
   - transfer.created   → backfills stripe_transfer_id if somehow missing
   - transfer.paid      → marks 'completed' (defensive; not normally
                           delivered for this Transfer type)
   - transfer.failed    → refunds balance, marks 'failed', 3-strike retry ladder
   - transfer.reversed  → refunds balance, marks 'failed', always CRITICAL-logged
                           (nothing in this codebase reverses a Transfer except
                           the admin reverse_transfer action on an already-
                           manually_paid row, which is guarded against re-
                           triggering this same refund path — see §8)
   - payout.paid        → notification only, no balance action
   - payout.failed      → refunds balance (Transfer succeeded, bank-level
                           Payout didn't), marks 'failed', notifies
   - payout.canceled    → same refund mechanics, distinct customer copy
   - payout.updated     → status-tracking only (metadata.payout_status)
   - account.application.deauthorized → clears Connect capability flags
                           immediately so the next attempt fails cleanly
```

**Ledger:** every state-changing step above is a real `wallet_transactions` row or `profiles.balance`/`balance_on_hold` mutation — there is no separate "ledger" system; `wallet_transactions` IS the ledger, and `profiles.balance` is the cached current-balance projection of it.

**Notifications:** webhook-driven balance events insert into the in-app `notifications` table (inbox), not the `notifications_outbox` push queue — a hunter will not necessarily get a push notification for a payout event, only an in-app one.

**Completion:** there is no separate "completion" step from Bounty's side — the withdrawal is "done" from the app's perspective the instant step 7 above commits. What happens after that (the actual bank deposit) is Stripe's payout leg, tracked only through webhook-driven status metadata, never through a Bounty-initiated "check if it arrived" poll.

Full line-level file/function references: [03-engineering-runbook.md](03-engineering-runbook.md). Full architecture diagram and state machine: [01-system-overview.md](01-system-overview.md).

---

## 3. Is the Withdrawal Process Fully Automated?

**No — and it is deliberately not fully automated for the failure/ambiguity tail, by design, not by omission.**

| Question | Answer |
|---|---|
| Does anything require manual action for the **happy path**? | No. Request → validate → debit → Transfer → ledger row is 100% automated, zero human touch. |
| Does anything require manual action for **standard failures**? | No. `transfer.failed`, `payout.failed`, `payout.canceled` all auto-refund the balance and mark the row `failed` via webhook handlers. Self-service retry (capped at 3) is also automated, hunter-initiated, zero human touch. |
| Does support ever intervene? | Yes — support cannot move money or alter balances directly; their role is triage, reassurance, and escalation per [02-support-runbook.md](02-support-runbook.md). Support has no write access to `admin-withdrawals`. |
| Does engineering/ops ever intervene? | Yes — via the `admin-withdrawals` Edge Function's admin-JWT-gated actions (`force_retry`, `manual_adjustment`, `mark_externally_settled`, `reverse_transfer`) whenever self-service retry is exhausted (`retry_count >= 3`), a reconciliation finding needs correction, or a withdrawal needs to be resolved outside Stripe's normal flow. Every such action is written to `admin_action_log` unconditionally. **[verified 2026-07-18]** exactly 2 such actions exist in production history — `mark_externally_settled_withdrawal` then `reverse_stripe_transfer`, both for the single historical stuck-$38 incident, both `result: 'success'`. |
| Does finance ever intervene? | No dedicated finance role exists in the codebase — the same admin-JWT gate covers whoever is authorized to use `admin-withdrawals`, whether that's engineering or a finance/ops person with admin credentials. There is no separate finance-specific tool or table. |
| Are any scripts run manually? | Yes — `scripts/reconcile_and_triage.sql` is a manual SQL script for ad hoc investigation (superset of the automated daily job's checks, plus a Stripe cross-check the daily job can't do because it has no live API access). This is a diagnostic tool, not a money-moving one. |
| Are payouts automatically initiated? | The Transfer leg: yes, automatically, as part of the withdrawal request itself. The Payout leg: **no** — that's entirely Stripe's own automatic sweep schedule, not something Bounty's code calls or schedules. Bounty never explicitly calls `stripe.payouts.create()` in the primary flow (only `admin-withdrawals`' `reverse_transfer` path touches a Transfer-adjacent Stripe write, and no code path calls `payouts.create` at all — see [07-manual-payouts-evaluation.md](07-manual-payouts-evaluation.md) for what switching to manual payouts would require). |
| Are payouts automatically reconciled? | Partially. `run_withdrawal_reconciliation()` runs (or is designed to run) daily via `pg_cron`, checking balance drift, stuck-pending rows, orphaned transactions, duplicate idempotency keys, and Connect-account mismatches — all DB-internal checks. It does **not** cross-check against live Stripe Payout state (that requires the `admin-withdrawals` `compare_stripe` action, which is on-demand/manual). **[verified 2026-07-18] — new finding: the cron job has never actually executed** (see §11). |

**Classification of every manual step:** see the table in §10.

---

## 4. Expected Timelines

| Stage | Timeline | Who controls it |
|---|---|---|
| Initial request → validation → debit | Milliseconds, synchronous | Bounty |
| Stripe Transfer (platform → connected account) | Seconds, synchronous — completes before the app gets its response | Stripe API, called by Bounty |
| Stripe Payout (connected account → bank) | Stripe's own automatic schedule, not observable synchronously by Bounty | **Stripe**, not Bounty |
| Bank settlement (ACH) | Typically 1-2 business days after the Payout is created — this is the app's stated estimate, sourced from Stripe's typical ACH timing, **not an internally-measured SLA** | Banks / ACH network |
| Typical arrival (as communicated to users) | 1-2 business days from submission | — |
| Fastest possible arrival | Same-day is theoretically possible if Stripe's sweep happens to fire immediately and the receiving bank posts same-day ACH, but nothing in this system tries to make this happen or reports it as an option (no "instant payout" tier is implemented — see §5) | Stripe + bank, opportunistic only |
| Longest expected delay before it's a genuine investigation | Past the 1-2 business day window with no `payout.paid`/`payout.failed` webhook and no Payout object visible via `compare_stripe` — per [02-support-runbook.md](02-support-runbook.md), reassure within the window, treat as a real investigation past it | — |

**No code-level handling exists for weekends/holidays** — any delay attributable to bank/ACH non-business-days is expected, not a bug, per [05-operations-playbook.md](05-operations-playbook.md)'s "known accepted risks."

---

## 5. When Should Money Appear? (Per Scenario)

| Scenario | What actually happens |
|---|---|
| Debit card destination | **Not supported for withdrawals.** Only bank accounts (ACH via Stripe Connect external accounts) are wired as withdrawal destinations — `GET/POST/DELETE /connect/bank-accounts`. There is no debit-card-payout code path in `connect/index.ts` or `withdraw-with-bank-screen.tsx`. |
| Checking account | The standard and only path — standard ACH payout timing (1-2 business days), per above. |
| "Instant payout" | **Not implemented.** No `payouts.schedule.interval` override, no instant-payout fee logic, no UI option for it. If asked, the honest answer is "not currently offered," not "check your bank." |
| Standard payout | The only implemented tier — Stripe's default automatic schedule on the connected account (no `controller`/`settings.payouts.schedule` override at account creation, per [07-manual-payouts-evaluation.md](07-manual-payouts-evaluation.md)). |
| Weekend | No special handling; expect the payout/bank leg to simply take longer, since ACH doesn't move on non-business-days. Not a bug. |
| Holiday | Same as weekend — no code-level awareness of banking holidays anywhere in this system. |
| Failed payout | `payout.failed` webhook → balance refunded automatically, row marked `failed`, hunter notified in-app. Self-service retry available if `retry_count < 3`. |
| Returned payout | Handled identically to `payout.canceled`/`payout.failed` by the webhook handler — Bounty's code does not distinguish "returned by the bank after initially accepted" from "canceled before settlement" at the product-copy level beyond the `payout.canceled` vs `payout.failed` event type Stripe sends. |
| Account review (Stripe holds/reviews the connected account) | Not a distinct code path — this surfaces as `charges_enabled`/`payouts_enabled` flipping to `false` on the connected account, which `POST /connect/verify-onboarding` reflects live. A withdrawal attempted against such an account would fail the pre-check or the Transfer call itself. |
| New Stripe account (freshly onboarded) | `stripe_connect_onboarded_at` is set once and never cleared; `charges_enabled`/`payouts_enabled` are checked live on every relevant call, not cached from onboarding time — a brand-new account with incomplete requirements will show `payouts_enabled: false` until Stripe clears it. **[verified 2026-07-18]: currently 0 of 88 profiles have `payouts_enabled = true`** — every hunter today is, as of this snapshot, in this "new/incomplete" bucket from the system's point of view, whether or not they've started onboarding. |

---

## 6. Withdrawal Statuses

`wallet_transactions.status` is a 4-value enum **[verified 2026-07-18 via `information_schema`/live data]**: `pending`, `completed`, `failed`, `manually_paid`.

| Status | What causes it | How long it should last | Who changes it | Automatic? |
|---|---|---|---|---|
| `pending` | **Should never be written for a new withdrawal** by correctly-behaving code — the synchronous design writes `completed` directly. Its presence in the enum is defensive/forward-compatible only. | Zero — any `pending` row older than a few minutes is itself the alert. | N/A under normal operation | N/A — its appearance at all is the anomaly |
| `completed` | The Transfer step succeeded (step 6-7 in §2) | Permanent, unless a later webhook demotes it to `failed` | `connect` function (on success), or `admin-withdrawals` `force_retry` (on a successful retry) | Yes |
| `failed` | `transfer.failed`, `transfer.reversed`, `payout.failed`, or `payout.canceled` webhook; or a Transfer attempt that failed before ever reaching Stripe successfully | Until self-service retry (< 3 attempts) or admin `force_retry` | `webhooks` function (automatic, on the relevant event) | Yes |
| `manually_paid` *(added in the last hardening pass)* | An admin explicitly resolved the withdrawal outside Stripe's normal transfer/payout flow via `mark_externally_settled` | Permanent — this status never auto-transitions again | `admin-withdrawals` only, human-initiated | No — deliberately terminal and human-only |

**Statuses named in the audit request that do not exist as distinct states here:** "Processing," "Canceled" (user-initiated — withdrawals cannot be canceled once submitted, per the confirmation dialog's own copy), "Reversed" (modeled as `failed` with `transfer.reversed` in metadata, not a separate status), "Needs action" (no such state — a blocked withdrawal simply never gets a row inserted; the error surfaces synchronously to the client). A dead `withdrawals`/`v2` schema with a `reserved` status existed in the database at one point and was dropped after confirmation it was unused — ignore any reference to it.

---

## 7. What Can Cause a Withdrawal to Fail?

| Failure mode | Handled? | Where |
|---|---|---|
| Insufficient balance | Yes — double-checked: a pre-check plus `withdraw_balance()`'s own atomic check | `connect/index.ts`, `withdrawal-validation.ts` |
| Negative/inconsistent balance | Prevented structurally — live `CHECK (balance >= 0)` constraint (`check_balance_non_negative`) | DB constraint |
| Below minimum / above maximum | Yes — server-side `WITHDRAW_MIN_USD`/`WITHDRAW_MAX_USD` env-configured limits, NaN-safe (an invalid env value doesn't silently disable the check) | `withdrawal-validation.ts` |
| Stripe API failure (transfer) | Yes — try/catch around `stripe.transfers.create()`, balance reversed via `update_balance()`, mapped to a client-safe error code | `connect/index.ts` |
| Stripe connection/outage | Yes — `StripeConnectionError`/`api_connection_error` specifically mapped to `503 stripe_unreachable` | `connect/index.ts` |
| Transfer failure (post-creation) | Yes — `transfer.failed` webhook, auto-refund, 3-strike retry ladder | `webhooks/index.ts` |
| Payout failure | Yes — `payout.failed` webhook, auto-refund | `webhooks/index.ts` |
| Webhook delivery failure | **Partially.** Bounty's code correctly processes any webhook it receives, idempotently. If Stripe never delivers the event (dashboard misconfiguration, endpoint downtime), nothing in Bounty's code detects the *absence* of an expected webhook — this is a real gap, closed only by the daily reconciliation job's stuck-pending/missing-transfer-id checks, which **[verified 2026-07-18] have never actually run** (see §11). | Structural gap, partially mitigated |
| Disconnected/deauthorized Connect account | Yes — `account.application.deauthorized` webhook clears capability flags immediately so the next attempt fails cleanly instead of hitting a stale account | `webhooks/index.ts` |
| Missing bank account | Yes — `resolveWithdrawalDestination()` returns a clean `no_bank_account` error before any balance touch | `connect/index.ts`, `withdrawal-validation.ts` |
| KYC/onboarding incomplete | Yes — live `charges_enabled`/`payouts_enabled` check via `verify-onboarding`; **[verified 2026-07-18] currently true for 0 of 88 profiles** | `connect/index.ts` |
| Restricted Stripe account | Surfaces as `payouts_enabled: false` / a Stripe error on the Transfer call itself; no distinct "restricted" code path beyond that | `connect/index.ts` |
| Database transaction failure | Row-locked atomic RPC (`SELECT ... FOR UPDATE`); a DB-level failure during the debit aborts before any Stripe call is made | `withdraw_balance()` RPC |
| Timeout | Client-side 20s `AbortController`; idempotency key is preserved (not rotated) across a timeout-triggered retry so a server-side-completed-but-client-never-saw-it request is safe to retry | `withdraw-with-bank-screen.tsx` |
| Duplicate request (double-tap) | Three independent layers: stable per-mount idempotency key, DB unique index on `(user_id, idempotency_key)`, Stripe-level `idempotencyKey` on the `transfers.create` call itself | Client + DB + Stripe |
| Race condition (concurrent withdrawals) | `withdraw_balance()`'s row lock (`FOR UPDATE`) serializes concurrent attempts against the same profile; a DB-unique-index race is handled by the losing request refunding its own extra deduction and replaying the winner's result | `withdraw_balance()` RPC, `connect/index.ts` |
| Network interruption | Client timeout + preserved idempotency key (see Timeout above) | Client |

Idempotency/concurrency guarantee table (7 distinct guards, exact mechanism per guard): [03-engineering-runbook.md](03-engineering-runbook.md#idempotency-and-concurrency-guarantees).

---

## 8. What Happens If Stripe Succeeds but Bounty Fails?

This is the scenario the last two hardening passes were most focused on closing. Current state **[verified 2026-07-18]**:

- **Partial failure (balance debited, Transfer call throws):** `update_balance()` reverses the debit synchronously in the same request. If the reversal itself fails, that's a `CRITICAL`-prefixed structured log line (`logCritical()`) for manual reconciliation — not a silent loss, but also not self-healing; a human must act on the log line or wait for the daily reconciliation job (whose execution status is itself now in question, see §11).
- **Orphaned withdrawal (Transfer succeeds, DB insert fails):** not explicitly modeled as a distinct recovery path in the code — this would produce a Stripe-side Transfer with no corresponding `wallet_transactions` row, detectable only via the reconciliation job's cross-checks or manual Stripe-vs-ledger comparison (`admin-withdrawals` `compare_stripe`). No automated recovery exists for this specific case today; it would need a human to notice and use `admin-withdrawals` to reconcile.
- **Stuck pending:** structurally should be impossible under current code (the synchronous design writes `completed`, never `pending`, on the success path) — but this is exactly the failure mode that *did* happen historically (2026-07-17, an out-of-band deploy regressed this behavior). **The one such incident on record is fully resolved** [verified 2026-07-18]: `mark_externally_settled` (marks the row `manually_paid`, requires explicit `confirmedNoStripePayout: true`) followed by `reverse_transfer` (pulls the Transfer back from the connected account before Stripe's sweep could pay it out), both actions logged with `result: 'success'` in `admin_action_log`, both dated 2026-07-18.
- **Duplicate transfers:** prevented by the idempotency-key chain described in §7; no known instance of this occurring.
- **Ledger mismatch (balance drift):** the daily reconciliation job's `balance_drift` check compares `profiles.balance` against `SUM(wallet_transactions.amount)` for `completed`/`manually_paid` rows. **[verified 2026-07-18] zero unacknowledged findings exist in `reconciliation_findings`** — but this is not strong evidence of a clean ledger, since the job that would populate this table has never recorded a run (see §11). A manual spot-check (§14) is the more trustworthy signal for right now.
- **Double payouts / lost payouts:** no code path in this system can cause a double payout (Bounty never calls `stripe.payouts.create()` at all — the payout leg is 100% Stripe's automatic sweep, entirely outside Bounty's control to duplicate). A "lost" payout (Stripe says paid, hunter says nothing arrived) is a bank-side question, investigated via `compare_stripe`'s live Payout-status read, not resolvable purely from Bounty's own tables.

**Recovery mechanism, precisely:** `mark_externally_settled` must always be called *before* `reverse_transfer` — calling `reverse_transfer` first risks a `transfer.reversed` webhook finding the row still in its pre-settlement status and re-triggering the automatic refund-and-fail path, which would resurrect a balance that was already correctly paid out through another means (a real double-payment risk this ordering exists specifically to prevent — confirmed guarded in code via `handleTransferSetback()`'s check for `existingTx.status === 'manually_paid'`).

---

## 9. Automation Inventory

| Component | What it automates |
|---|---|
| `connect` Edge Function | Withdrawal request validation, destination resolution, balance debit, Transfer creation, self-service retry (capped at 3) |
| `webhooks` Edge Function | All 19 subscribed Stripe event types; withdrawal-relevant: transfer/payout success/failure/reversal handling, balance refunds, capability-flag sync, notification writes |
| `wallet` Edge Function | Balance/transaction reads (not withdrawal-initiating, but the balance the withdrawal flow reads/debits) |
| `admin-withdrawals` Edge Function | Human-initiated but tool-automated recovery actions (see §10) — not autonomous, but removes the need for raw SQL |
| `withdraw_balance()` / `update_balance()` DB RPCs | Atomic, row-locked balance debit/credit — the actual money-movement primitive everything else calls |
| `run_withdrawal_reconciliation()` DB function | Balance drift, stuck-pending, orphaned-transaction, duplicate-key, and Connect-mismatch checks; writes to `reconciliation_findings` |
| **`withdrawal-reconciliation-daily` pg_cron job** | Scheduled (`0 9 * * *` UTC) trigger for the above. **[verified 2026-07-18] registered and `active`, but zero recorded runs in `cron.job_run_details`** — its actual operation is currently unconfirmed, not just undocumented. See §11. |
| `stripe_events` table + upsert-before-process pattern | Webhook replay/dedup protection |
| `notifications` inbox writes | In-app (not push) notification on withdrawal/payout events |
| CI `edge-functions` job (`deno check`/`deno lint`) | Type/lint validation only on `connect`/`webhooks`/`wallet`/`admin-withdrawals` before merge — `continue-on-error: true` (visibility only, not yet a blocking gate) |

**Explicitly does not exist:** a CI/CD deploy pipeline for Edge Functions (every deploy is a manual, per-function action — this is the root cause of the historical `payments`/`apple-pay` version-drift and the 2026-07-17 stuck-withdrawal incident); an automated Stripe-vs-ledger cross-check (only the on-demand `compare_stripe` admin action does this, and only per-transaction); a background worker/queue system (everything is either a synchronous edge-function call or a `pg_cron` scheduled SQL job — no separate worker process exists).

---

## 10. What Still Requires Human Intervention

| Task | Who | When | Why | Automatable? | Risk if forgotten |
|---|---|---|---|---|---|
| Force-retry a `permanently_failed` (`retry_count >= 3`) withdrawal | Admin (via `admin-withdrawals` `force_retry`) | Hunter exhausts 3 self-service retries | Deliberate — blindly auto-retrying into a still-broken destination/account is worse than pausing for judgment | Not recommended to fully automate — judgment call by design | Hunter's money stays undelivered indefinitely; support escalation builds up |
| Manual balance adjustment | Admin (`manual_adjustment`) | Reconciliation finding needs correction, or a historical/edge-case discrepancy | Requires understanding *why* the drift happened before correcting it, per [05-operations-playbook.md](05-operations-playbook.md) | No — correcting the wrong cause just relocates the bug | Balance stays wrong, possibly compounds on the next automated event |
| Mark a withdrawal externally settled | Admin (`mark_externally_settled`) | A withdrawal is resolved outside Stripe's flow (e.g., paid by another means after confirming no Stripe payout landed) | Requires explicit human confirmation Stripe didn't already pay it — the tool fails closed rather than trusting an implicit default | No — this is inherently "a human confirmed something Stripe's API alone can't prove" | Double-payment risk if skipped and a payout later lands anyway |
| Reverse a Stripe Transfer | Admin (`reverse_transfer`), only after `mark_externally_settled` | Pulling back funds before Stripe's automatic sweep pays them out a second time | Real Stripe money-movement, deliberately gated to admin-only, deliberately ordered after settlement-marking | No — this is exactly the kind of action this audit's "never trigger real transfers autonomously" boundary exists for | Stripe pays out twice for the same withdrawal |
| Run reconciliation on demand | Admin (`run_reconciliation`), or wait for the daily job | Investigating a specific ticket faster than the daily cadence | Read-only, low-risk to automate further, but currently manual-triggered | Yes, trivially — could run on every ticket escalation automatically | Delayed detection of a real issue |
| Compare Stripe vs. ledger for one transaction | Admin (`compare_stripe`) | Any escalation where the local row's status is in doubt | Needs a live Stripe API call scoped to a connected account — currently only this endpoint can do it | Could be exposed to support tooling directly (read-only), not currently | Support can't self-serve this class of ticket, must escalate |
| Deploy an Edge Function change | Engineer, manual `deploy_edge_function` call or Supabase dashboard/CLI | Any code change to `connect`/`webhooks`/`wallet`/`admin-withdrawals` | **No CI/CD deploy pipeline exists at all** for Edge Functions — this is a structural gap, not a policy choice | Yes — see §12 (Recommendations) | A fixed bug stays un-deployed indefinitely (this exact thing happened twice: `payments`/`apple-pay`, and the 2026-07-17 `connect` regression) |
| Verify deployed source matches git | Engineer, manual `get_edge_function` + diff | Before trusting any "is this fix live" question, after any deploy | No automated post-deploy verification step exists | Yes — trivial to automate as a CI post-deploy check | False confidence that a fix is live when it isn't |
| Confirm a new webhook event type is enabled in the Stripe Dashboard | Engineer, manual dashboard check | After any code change that adds a `case` to the webhook switch statement | Subscribing in code does not enable delivery — this has bitten the project before (`payout.canceled`) | Partially — could be checked via Stripe API read, not currently automated | A handled-in-code event type never actually fires, silently |
| Acknowledge a reconciliation finding | Whoever owns ops/on-call | Daily triage | Needs human judgment on whether a finding is a real issue or a known exception | Partially — `reconciliation_known_exceptions` already automates the "don't re-flag a reviewed case" part | Findings pile up unacknowledged, real issues get lost in noise |
| Confirm the reconciliation cron job is actually running | Whoever owns ops/on-call | Daily health check, per [05-operations-playbook.md](05-operations-playbook.md) | **[verified 2026-07-18] this check has apparently never been performed** — the job has zero recorded runs | Yes — should alert automatically, not rely on someone remembering to check | Silent monitoring blind spot — exactly the situation found in this pass |

---

## 11. Outstanding Risks

Ranked by severity, incorporating both the residual items already tracked in 01-11 and the two new findings from this pass's live verification.

### Critical
- **None currently open.** The four previously-CRITICAL items (anon-readable `profiles`, `fn_close_dispute_hold` privilege drift, unauthenticated-callable balance-unfreeze RPC, unrevoked sensitive-column SELECT) are all **confirmed applied and verified live** [verified 2026-07-18]. The one historical stuck-withdrawal incident is fully resolved.

### High
1. **The daily reconciliation cron job has no confirmed execution history.** [New finding, verified 2026-07-18] `withdrawal-reconciliation-daily` is registered (`0 9 * * *` UTC, `active: true`) but `cron.job_run_details` has zero rows for it, despite the table actively logging ~298K rows for other jobs (`daily-risk-assessment`, `drain-notifications-outbox`). This means the system's only automated drift/stuck-withdrawal detector is **unverified to actually work**, not just "hasn't found anything yet." Until this is confirmed running, treat the "zero unacknowledged reconciliation findings" fact in §8/§14 as *absence of evidence*, not evidence of a clean ledger.
2. **Zero webhook-delivery-absence detection.** If Stripe never delivers an expected event (dashboard misconfiguration, endpoint downtime during a deploy), nothing proactively detects the gap — the only backstop is the (currently unverified-as-running) reconciliation job's stuck-pending/missing-transfer-id checks.
3. **No CI/CD deploy pipeline for Edge Functions.** Root cause of two prior real incidents (stale `payments`/`apple-pay`, the 2026-07-17 `connect` regression). Fully documented design for a fix exists ([11-final-hardening-session-2026-07-19.md](11-final-hardening-session-2026-07-19.md) §6d) but is not implemented.
4. **Commingled Stripe payout sweep.** Two withdrawals with different bank-account selections landing before the same Stripe automatic sweep still get paid to whichever account is default *at sweep time*, not whichever was selected per-withdrawal. Accepted, documented, not causing active incidents per [07-manual-payouts-evaluation.md](07-manual-payouts-evaluation.md), but a real correctness gap if a hunter has multiple bank accounts and withdraws close in time to a bank-account change.

### Medium
5. **No live-money-path automated test coverage.** The actual Deno Edge Functions (`connect/index.ts`, `webhooks/index.ts`) have zero behavioral test coverage — Jest tests cover pure logic extracted from them and a separate/legacy Express mirror, not the functions themselves [confirmed current, [06-testing-guide.md](06-testing-guide.md)].
6. **Staging environment usability is unconfirmed as of this pass's writing in 06** (the doc claims full parity was reached 2026-07-19, but this pass did not independently re-verify that claim against live Staging state — out of scope for this session, flagged as unverified rather than assumed).
7. **`profiles_select_authenticated` RLS policy remains broader than ideal** — any authenticated user can read any row (though sensitive columns are now column-REVOKEd, closing the practical exposure). A full remediation plan exists ([08-profiles-rls-migration-strategy.md](08-profiles-rls-migration-strategy.md)) but step 5 (the column REVOKE — already done) was the last *implemented* step; the underlying row-level breadth itself is accepted as low-risk given the column protection, not further tightened.
8. **Current live-eligible user population is effectively zero.** [New finding, verified 2026-07-18] 0 of 88 profiles have `stripe_connect_payouts_enabled = true`. This isn't a code defect, but it means the "can a user withdraw today" answer is currently more theoretical than operational — worth confirming this matches actual product/launch expectations (pre-launch state) rather than assuming it's a monitoring gap.

### Low
9. Orphaned-Transfer recovery (Stripe succeeds, DB insert fails) has no dedicated automated detection path beyond the general reconciliation checks.
10. No "instant payout" tier — not a defect, but worth confirming against product expectations if users are told to expect one.
11. `users` legacy table (2 rows, zero code references) still has the same "true for everyone" RLS pattern as the fixed `profiles` policies — low stakes given zero data/usage, flagged for hygiene.

---

## 12. Recommendations for Full Automation

1. **Highest priority: confirm the reconciliation cron job actually fires**, then wire an alert (not just a manual daily-check habit) for "last run > 36h ago" or "job inactive." This closes the biggest gap found in this pass with the least effort — it's a monitoring/confirmation task, not new engineering.
2. **Build the CI/CD Edge Function deploy pipeline** already designed in [11-final-hardening-session-2026-07-19.md](11-final-hardening-session-2026-07-19.md) §6d — push-to-main triggered, dynamically discovers every function directory (so this exact gap can't silently recur for a newly-added function), with a post-deploy source-diff verification step. This is the single highest-leverage fix for the recurring "code fixed, never deployed" failure class.
3. **Add a scheduled Stripe-vs-ledger cross-check** beyond the currently on-demand-only `compare_stripe` — even a daily batch job comparing recent Transfer IDs against Stripe's own records would close the "webhook silently never arrived" blind spot without needing a new architecture.
4. **Consider Stripe manual payouts** to close the commingled-sweep gap — evaluated in depth in [07-manual-payouts-evaluation.md](07-manual-payouts-evaluation.md), recommended as future work, not urgent, given it's not currently causing active incidents.
5. **Give support tooling direct, read-only access to `compare_stripe` and `run_reconciliation`** (via an admin-panel UI, not raw endpoint calls) so more tickets are self-serve without an engineering escalation for what's fundamentally a read operation.
6. **Add behavioral test coverage for the actual Deno Edge Functions**, not just the extracted pure-logic modules — closes the biggest test-coverage gap and would have caught the 2026-07-17 regression before deploy if it had existed then.
7. **Automate "last known-good deployed source" tracking** (e.g., tag each deploy with the git SHA) so "what's live right now" is answerable without a manual audit session — this exact question has needed a dedicated investigation multiple times across this project's history.

None of these are prerequisites for the system to be safe as currently operated (the human-gated recovery tooling is a reasonable, deliberate safety boundary, not a gap) — they're leverage for reducing how often a human needs to be pulled in, and for closing the monitoring blind spot found in this pass.

---

## 13. Success Criteria

For this system to be considered fully validated for scaled production use (beyond its current small/pre-launch population), the following should be true and independently re-verified, not just documented:

- [ ] The reconciliation cron job has a confirmed, alerted execution history (not just `active: true`).
- [ ] At least one full withdrawal lifecycle (request → Transfer → Payout → bank arrival) has been observed end-to-end against a real bank account and cross-checked via `compare_stripe`, with the actual elapsed time recorded (the "1-2 business days" figure is currently Stripe's general guidance, not an internally-measured number for this specific platform's accounts).
- [ ] An Edge Function deploy pipeline exists such that "what's on `main`" and "what's live" can never silently diverge again.
- [ ] Deployed source for `connect`/`webhooks`/`wallet`/`admin-withdrawals` is verified to match git as part of every deploy, automatically, not via an ad hoc audit session.
- [ ] A real Stripe test-mode payout failure/cancellation has been exercised (in Staging, once its parity is independently re-confirmed) and observed to produce the expected refund + notification, not just read as code.
- [ ] `reconciliation_findings` has a track record (weeks, not zero) of either staying empty or being triaged same-day for `critical` severity — establishing the daily job is both running and being watched.
- [ ] The live-eligible population (`payouts_enabled = true`) reflects actual product expectations for the current launch phase, confirmed with product/business, not just observed as a database fact.

---

## Cross-references

| Deliverable requested | Where it lives |
|---|---|
| Executive Summary | §1 above |
| End-to-End Flow Diagram | §2 above; full ASCII architecture diagram + Mermaid state machine in [01-system-overview.md](01-system-overview.md) |
| User Journey Documentation | [User Journey](#user-journey) below |
| Customer FAQ | [Customer FAQ](#customer-faq) below |
| Support Runbook | [02-support-runbook.md](02-support-runbook.md) (independently re-read this pass, still accurate as of 2026-07-18 live verification) |
| Engineering Runbook | [03-engineering-runbook.md](03-engineering-runbook.md) (independently re-read and spot-verified against live deployed source this pass) |
| Operational Checklist | [05-operations-playbook.md](05-operations-playbook.md) + §10 above |
| Security Assessment | [Security Assessment](#security-assessment) below |
| Financial Reconciliation Guide | [Financial Reconciliation](#financial-reconciliation) below |
| Launch Readiness Report | [Launch Readiness](#launch-readiness) below |
| Outstanding Risks | §11 above |
| Recommendations for Full Automation | §12 above |
| Success Criteria | §13 above |

---

## User Journey

| Step | What the user sees | What happens behind the scenes | Expected wait | Possible errors shown |
|---|---|---|---|---|
| Available Balance | Balance shown on the Wallet tab, sourced from `GET /wallet/balance` (server-authoritative, not purely local cache) | `wallet` function reads `profiles.balance`, with a self-healing cross-check against summed completed transactions if the cached value reads as exactly 0 | Instant | — |
| Withdraw button | Opens `WithdrawWithBankScreen` | Loads live min/max limits, bank account list (live from Stripe, not cached locally), Connect onboarding status | Instant to ~1s (live Stripe list call) | Blocked with a clear message if email isn't verified, or Stripe Connect onboarding isn't complete |
| Select amount | Numeric entry, "Max" shortcut fills `min(balance, maxWithdrawal)` | Client-side validation against live min/max before submission is even attempted | Instant | "Minimum Withdrawal," "Maximum Withdrawal," "Invalid Amount," "Insufficient Balance" — all checked client-side first, then re-checked server-side |
| Select destination | Bank account picker, sourced live from Stripe's external-accounts list for the connected account | No local bank-account table exists — this list is never stale relative to Stripe, but also has no offline fallback | Instant to ~1s | "Bank Account Required" if none exist |
| Confirmation | Native confirm dialog: *"Withdraw $X to your [account]? This account will also become your default payout account for future withdrawals. This typically arrives in 1-2 business days and can't be canceled once started."* | Nothing yet — this is the last no-op checkpoint before the irreversible step | Instant | User can back out here with zero effect |
| Processing | Brief loading state while `POST /connect/transfer` is in flight | The full §2 sequence executes synchronously — debit, destination promotion, Stripe Transfer call, ledger insert | Typically well under the client's 20s timeout | Any of the failure modes in §7 — surfaced with client-safe error copy, balance is guaranteed untouched on failure (or auto-reversed if it was touched) |
| "Completed" (app's perspective) | "Withdrawal Initiated" alert, balance refreshed from server | `wallet_transactions` row exists with `status: 'completed'`, Stripe Transfer object exists | Immediate | — |
| Bank deposit | Nothing in-app changes further unless a failure webhook arrives (in which case an in-app notification appears and balance is restored) | Entirely Stripe + bank-side; Bounty has no further active role unless something fails | 1-2 business days, typically | If it fails: in-app notification, balance restored automatically |

**Can a user cancel a withdrawal?** No — the confirmation dialog explicitly states this, and it's true structurally: the Transfer call is synchronous and the app's response depends on it, so by the time the user could "cancel," it's already either succeeded or failed.

**Can a user change bank accounts?** Yes, any time before submitting — the picker is live. Each new withdrawal can select a different account, though see the commingled-sweep caveat in §11 item 4 for what that does and doesn't guarantee if two withdrawals land close together.

---

## Customer FAQ

**How do withdrawals work?**
You request a withdrawal from your Bounty balance to your linked bank account. The money leaves your Bounty balance immediately — that's what "completed" means in the app. It then takes your bank 1-2 business days (standard bank transfer timing) to actually deposit it.

**How long do they take?**
Typically 1-2 business days from when you submit, similar to a standard bank transfer. This can take longer around weekends or bank holidays, since banks don't process transfers on non-business days.

**Why is my withdrawal "pending"?**
It shouldn't be — a healthy withdrawal shows "completed" immediately. If you see "pending" for more than a few minutes, contact support; this is not expected behavior and gets escalated as a priority issue.

**When will I receive my money?**
Within 1-2 business days of submitting, in the large majority of cases. If it's been longer, contact support with your withdrawal date and amount.

**Can I cancel a withdrawal?**
No. Once you confirm, it's submitted immediately and can't be undone from the app. Double-check the amount and destination account before confirming.

**Can I change bank accounts?**
Yes — you can select a different linked bank account for each withdrawal. Add or remove bank accounts any time from your payout settings.

**What if my payout fails?**
Your Bounty balance is automatically restored — no funds are lost. You'll see a notification and can retry the withdrawal from the app. If it fails repeatedly, contact support.

**What happens on weekends?**
Nothing moves through the banking system on weekends or bank holidays — a withdrawal submitted right before one will simply take a bit longer to arrive. This is normal.

---

## Security Assessment

Independently re-verified against live production state **[all items verified 2026-07-18]**, not assumed from prior docs.

| Area | Finding |
|---|---|
| Authentication | All withdrawal-touching endpoints require a valid Supabase JWT, checked via `auth.getUser(token)`; `admin-withdrawals` additionally requires `app_metadata.role === 'admin'` or `roles` containing `'admin'`. |
| Authorization | `withdraw_balance()`/`update_balance()` RPCs are `service_role`-only — confirmed via live grants, not client-callable directly even with a valid user JWT. A `BEFORE UPDATE` trigger additionally blocks any non-service-role write to `balance` and ~34 other sensitive `profiles` columns regardless of RLS/grants. |
| Idempotency | Three independent layers (client key, DB unique index, Stripe `idempotencyKey`) — see §7. |
| Replay protection | `stripe_events` upserted on `stripe_event_id` before processing; handlers additionally re-check status/metadata before acting, so even a theoretical `stripe_events` gap wouldn't cause a double-refund. |
| Duplicate withdrawals | Prevented at the DB level by a unique partial index limiting one `pending` withdrawal per user (defense-in-depth; shouldn't be reachable given the synchronous design writes `completed` directly) and the `(user_id, idempotency_key)` unique index. |
| Race conditions | Row-level lock (`FOR UPDATE`) in `withdraw_balance()`; a DB-unique-index race is resolved by the losing request refunding its own extra deduction. |
| SQL safety | All balance-touching logic is parameterized RPC calls, not string-built SQL, from what was read in this pass. |
| RLS | `profiles` RLS is now free of the previously-live anon-readable `USING (true)` policies [verified this pass — `pg_policies` query shows only `auth.uid() = id`-scoped policies plus the tracked, authenticated-only, row-broad-but-column-restricted `profiles_select_authenticated`]. `admin_action_log`, `reconciliation_findings`, `reconciliation_known_exceptions`, `stripe_events` all have RLS enabled with **no policies** — by design, service-role-only access, confirmed intentional (flagged as `INFO`, not `ERROR`, by the security advisor). |
| Privilege separation | `admin-withdrawals` runs as service_role internally but gates every action behind the caller's admin JWT claim first — confirmed by reading the live deployed source. |
| Service role usage | Confined to Edge Functions (server-side), never exposed to any client. |
| Audit logging | Every `admin-withdrawals` action call — success or failure — writes to `admin_action_log`; **[verified live]** exactly 2 real entries exist, both for the one resolved historical incident, both `result: 'success'`. If the audit-log write itself fails, that's separately `CRITICAL`-logged rather than silently dropped. |
| **Security advisor summary** | 89 total findings **[verified 2026-07-18]**: 1 `ERROR` (`public_profiles` view's `SECURITY DEFINER` property — already known and deliberately not "fixed" per [08-profiles-rls-migration-strategy.md](08-profiles-rls-migration-strategy.md), since the linter's default remediation would break the view's intended purpose), 7 `INFO` (RLS-enabled-no-policy on the service-role-only tables listed above — intentional), 81 `WARN` (overwhelmingly `SECURITY DEFINER` functions executable by `anon`/`authenticated` across the **whole app**, not withdrawal-specific — most are broadcast/notification trigger functions with no sensitive side effects; the withdrawal-relevant ones, `get_my_profile`, `fn_close_dispute_hold`, `assert_profile_balance_not_frozen`, all carry their own internal authorization checks per prior audits and are intentional, not overlooked). **No new withdrawal-specific security finding was surfaced by this pass's advisor check** beyond what 01-11 already document. |

---

## Financial Reconciliation

**Can money ever become inconsistent?** Yes, structurally possible (any distributed system moving money across two independent ledgers — Bounty's DB and Stripe's — can drift), and it has happened once historically (the resolved $38 case). The system has both automated and manual reconciliation mechanisms, but this pass found the automated one **unverified as actually running** (§11).

| Check | Automated? | Verified working? |
|---|---|---|
| `profiles.balance` vs. `SUM(wallet_transactions)` | Yes, in `run_withdrawal_reconciliation()` | **Unconfirmed** — job has no recorded runs [verified 2026-07-18] |
| Stuck-pending withdrawals | Yes, same function, 1-hour threshold | Same caveat |
| Duplicate idempotency keys / reused transfer IDs | Yes, same function, belt-and-suspenders (unique indexes should already prevent these) | Same caveat |
| Live Stripe Transfer/Payout vs. ledger, per-transaction | Manual only (`admin-withdrawals` `compare_stripe`) | Working — code reads live and correctly, per this pass's source review |
| Balance write-offs / known exceptions | Manually curated allowlist (`reconciliation_known_exceptions`), checked automatically by the (unconfirmed-running) daily job | Table and check logic exist; can't confirm it's being exercised until the cron confirmation above is done |

**A manual spot-check performed this pass** (not a substitute for the automated job, but a data point): summing `wallet_transactions` by status for `type = 'withdrawal'` shows 5 `completed`, 1 `failed` (pre-hardening, 2026-07-13), 1 `manually_paid` (the resolved incident) — 7 total, zero currently `pending`. This is consistent with a healthy, small-volume ledger at this snapshot, but is not a substitute for confirming the automated check actually runs going forward.

**How reconciliation is performed today, honestly:** primarily manual (`scripts/reconcile_and_triage.sql`, or the `admin-withdrawals` on-demand actions), with an automated daily layer that exists in code and configuration but has not yet been confirmed to execute. **Recommendation: treat reconciliation as manual-only until the cron job's execution is confirmed and given a track record.**

---

## Launch Readiness

**Can Bounty safely launch withdrawals today?** For the current small/pre-launch scale (88 profiles, $19.65 total balance, 0 currently payouts-eligible accounts), yes — the mechanism is sound, the critical security gaps are closed, and the one historical incident was fully and correctly recovered using the tooling built for exactly that purpose. **Before scaling to meaningfully more volume**, the reconciliation-job execution gap (§11 item 1) should be confirmed and the CI/CD deploy pipeline (§11 item 3) should exist — both are the direct root cause of every real incident this system has had so far, and neither is expensive to fix relative to the risk of a repeat.

**Would you trust this system with real users?** At current, small scale: yes, with the caveat that "the daily safety net's execution is unconfirmed" should be resolved first — it's a same-day fix (confirm the job runs, or find out why it doesn't) with outsized risk-reduction value. At larger scale, additionally close the CI/CD deploy gap before assuming further code changes will actually reach production reliably.

**What remaining risks exist?** See §11, ranked.

**What should be completed before launch (at meaningful scale)?**

| Priority | Item |
|---|---|
| Critical | Confirm the reconciliation cron job executes and alerts on failure to run |
| High | Build the Edge Function CI/CD deploy pipeline with post-deploy source verification |
| High | Add a scheduled (not just on-demand) Stripe-vs-ledger cross-check |
| Medium | Add behavioral tests for the real Deno edge functions, not just extracted logic |
| Medium | Independently re-confirm Staging's claimed parity before relying on it for future testing |
| Low | Evaluate whether the commingled-sweep limitation needs fixing before scale, given multi-bank-account usage patterns |
