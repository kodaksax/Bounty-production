# Withdrawal System — Architecture, State Machine & Operational Runbook

> **Last Updated:** 2026-07-18
> **Scope:** The hunter withdrawal path only (wallet balance → Stripe Connect → hunter's bank account). For deposits, escrow, and disputes, see `docs/FINANCIAL_FLOWS.md`.
> **Status:** Production. Live path uses `wallet_transactions` + `withdraw_balance()`/`update_balance()`. §7 documents a parallel, unused schema (`withdrawals`/`withdraw_balance_v2()`/`cancel_withdrawal()`) that was removed 2026-07-18 after this document's own audit — kept below as a historical record in case that context is needed again.

---

## 1. Architecture Overview

```
Mobile client (components/withdraw-with-bank-screen.tsx)
        │  POST /connect/transfer  { amount, currency: 'usd', idempotencyKey }
        │  Authorization: Bearer <JWT>, apikey: <anon key>
        ▼
supabase/functions/connect/index.ts  ("connect" edge function, verify_jwt=false, self-authenticates)
        │
        ├─ validateWithdrawalRequest()      — amount finite, whole-cent, $10–$10,000, USD
        ├─ idempotency replay check         — SELECT wallet_transactions WHERE (user_id, idempotency_key)
        ├─ stripe.accounts.retrieve()       — live payout-eligibility check (payouts_enabled)
        ├─ withdraw_balance() RPC           — atomic debit, FOR UPDATE row lock, checks hold + freeze
        ├─ stripe.transfers.create()        — platform balance → connected account (SYNCHRONOUS)
        └─ INSERT wallet_transactions       — status: 'completed' immediately (see §3)
        ▼
Stripe (async, hours–days later): sweeps the connected account's balance to the hunter's bank
        │
        ▼
supabase/functions/webhooks/index.ts  ("webhooks" edge function, verify_jwt=false, HMAC-verified)
        ├─ payout.paid    → notification only
        └─ payout.failed  → find matching 'completed' withdrawal (user+amount), refund via
                             update_balance(), mark 'failed', notify, set profiles.payout_failed_at
```

**Key files:**

| File | Role |
|---|---|
| `supabase/functions/connect/index.ts` | `/connect/transfer`, `/connect/retry-transfer`, onboarding routes |
| `supabase/functions/connect/withdrawal-validation.ts` | Pure validation/error-mapping helpers, unit-tested; **must be kept in sync** with the inlined copy in `index.ts` (Deno's bundler doesn't support local imports) |
| `supabase/functions/webhooks/index.ts` | `transfer.created`, `transfer.paid`, `transfer.failed`, `payout.paid`, `payout.failed`, `account.updated` |
| `components/withdraw-with-bank-screen.tsx` | The only withdrawal UI actually routed (from `app/tabs/wallet-screen.tsx`) |
| `supabase/migrations/20260410_harden_withdrawal_flow.sql`, `20260711_add_withdrawal_idempotency.sql` | Balance non-negative constraint, idempotency-key unique index |
| `scripts/reconcile_and_triage.sql` | Read-only reconciliation queries — balance drift, orphaned/stuck/duplicate transactions |

---

## 2. Why the Transfer Step Is Synchronous (read this before touching status logic)

`stripe.transfers.create({ destination: connectedAccountId })` moves money from the **platform's** Stripe balance into the **connected account's** Stripe balance. For this specific operation, Stripe executes it synchronously — by the time the API call returns without throwing, the funds have already moved. There is **no `transfer.paid` webhook delivered for this flow** (that event belongs to the legacy recipient-transfer API).

This means: **the withdrawal row must be inserted as `status: 'completed'` immediately**, in the same request that created the transfer. If it's ever inserted as `'pending'` instead, nothing will ever promote it — it is stuck forever, and the `payout.failed` webhook handler (which matches on `status = 'completed'`) will silently fail to find it, meaning a real bank-level payout failure will have **no refund path** for that row.

This exact regression happened in production on 2026-07-17 (deployed directly, not via git) and got a real withdrawal stuck. See `docs/payments/` git history / commit `f393e30a` for the fix. **If you ever see `status: 'pending'` being written in the `/connect/transfer` success path, that is a bug, not a stylistic choice** — revert it immediately.

The **payout** step (connected account balance → hunter's actual bank account) is a separate, genuinely asynchronous Stripe-managed sweep, surfaced via `payout.paid`/`payout.failed`. That's the step `payout.failed` refunds.

---

## 3. State Machine

`wallet_transactions.status` is a 3-value Postgres enum: `pending`, `completed`, `failed`. There is no `'reserved'` value in the live schema.

```mermaid
stateDiagram-v2
    [*] --> completed: /connect/transfer succeeds\n(Stripe Transfer is synchronous)
    [*] --> rejected_before_insert: validation fails,\nStripe transfer create() throws,\nor withdraw_balance() rejects\n(no row ever inserted; balance untouched or refunded inline)

    completed --> failed: payout.failed webhook\n(bank-level payout failed;\nbalance refunded via update_balance())
    completed --> [*]: payout.paid webhook\n(notification only, no status change)

    failed --> completed: /connect/retry-transfer\n(re-debits balance, new Stripe transfer,\nnew stripe_transfer_id)
    failed --> [*]: max retries (3) reached\n(permanently_failed in metadata;\nhunter must contact support)

    rejected_before_insert --> [*]
```

**Notes:**
- `pending` exists in the enum but a **correctly-behaving** `/connect/transfer` never writes it for a new withdrawal — see §2. It's retained in the schema for forward-compatibility and because `/connect/retry-transfer`'s failure paths reference it defensively.
- `permanently_failed` and `transfer_status: 'failed'/'paid'/'created'` are **not** separate enum values — they live in `wallet_transactions.metadata` (jsonb), because the `status` column only has 3 values. Always check `metadata.transfer_status` / `metadata.payout_status` for the fine-grained sub-state, not just `status`.
- A `failed` row can only be retried up to `MAX_TRANSFER_RETRIES = 3` times (`supabase/functions/webhooks/index.ts`). Beyond that, `metadata.transfer_status = 'permanently_failed'` and a "Withdrawal Failed" notification is sent; there's no further automated recovery.

---

## 4. Idempotency & Concurrency Guarantees

| Guard | Mechanism | Prevents |
|---|---|---|
| Client retry / double-tap | Stable `idempotencyKey` generated once per attempt (`idempotencyKeyRef` in the withdraw screen), replayed on retry | Duplicate submission of the same logical attempt |
| DB-level dedup | `idx_wallet_tx_withdrawal_idempotency` — unique on `(user_id, idempotency_key) WHERE type='withdrawal'` | Two rows for the same idempotency key even under a race |
| Stripe-level dedup | `stripe.transfers.create(..., { idempotencyKey: transfer_${userId}_${key}_${amountCents} })` | A second real Transfer being created even if two requests race past the DB check |
| Balance correctness under a lost insert-race | On unique-violation (`23505`), the losing request refunds its own extra `withdraw_balance()` deduction and replays the winner's transaction in its response | Double-debiting a user's balance when two concurrent requests share one idempotency key |
| One withdrawal in flight | `withdraw_balance()` uses `SELECT ... FOR UPDATE` on the profile row | Two concurrent withdrawals both reading a stale balance and both succeeding when only one should |
| Webhook replay | `stripe_events` upserted on `stripe_event_id` before processing; `transfer.failed`/`payout.failed` handlers additionally check `metadata.transfer_status`/`metadata.payout_status` before refunding | Double-refunding a user's balance on a redelivered webhook |
| Concurrent retry vs. late webhook | Optimistic-lock guard: `.eq('stripe_transfer_id', transfer.id)` on the UPDATE, re-selected after the initial read | A `transfer.failed` webhook for an old transfer ID corrupting a newer, in-flight `/connect/retry-transfer` row |

**Known gap:** there is currently no index limiting a user to *one pending withdrawal at a time* (an earlier version of this document assumed `idx_wallet_tx_one_pending_withdrawal` existed; it does not, per a live schema check on 2026-07-17). This is lower-risk than it sounds because the synchronous-completion design (§2) means a row is essentially never actually `pending` for more than the duration of one request — but if a future change reintroduces a genuinely async pending window, add this index before relying on it.

---

## 5. Security Model

- **Auth**: every route except `webhooks` calls `supabase.auth.getUser(token)` itself (`verify_jwt=false` at the gateway is not the same as unauthenticated — see `docs/FINANCIAL_FLOWS.md` §7.2).
- **Webhook auth**: manual HMAC-SHA256 verification of `Stripe-Signature` (constant-time compare, 5-minute timestamp skew), not gateway JWT.
- **RLS on `wallet_transactions`**: fully locked down — `SELECT` scoped to `sender_id`/`receiver_id`/`user_id = auth.uid()`; INSERT/UPDATE/DELETE are RESTRICTIVE `WITH CHECK (false)`. A client cannot forge a `'completed'` withdrawal row directly.
- **RLS on `profiles`**: **was** the weak point — see the critical finding below.
- **Server-side amount validation**: enforced identically in `withdrawal-validation.ts` and its inlined copy in `index.ts` — never trust a client-computed `amountCents`.
- **Live payout-eligibility check**: `stripe.accounts.retrieve()` is called on every withdrawal attempt (not cached), so an account that was onboarded in the past but has since become restricted is caught before the balance is touched.

### 5.1 CRITICAL finding fixed 2026-07-17: client-writable balance

`profiles`'s UPDATE RLS policies only checked `auth.uid() = id`, with no column restriction, and the table had a pre-existing table-wide `GRANT UPDATE` to `anon`/`authenticated`. **Any authenticated user could call `supabase.from('profiles').update({ balance: 999999 }).eq('id', self)` directly from the client SDK**, bypassing `withdraw_balance()`'s validation entirely — then withdraw the inflated balance through the legitimate `/connect/transfer` route for a real Stripe payout. Same exposure existed for `balance_frozen` (defeat dispute freeze), `risk_level`/`verification_status`/`account_restricted` (bypass fraud gating), and `role`.

**Fixed** via a `BEFORE UPDATE` trigger (`prevent_client_writes_to_protected_profile_columns`, migration `20260717_revoke_client_writes_on_sensitive_profile_columns.sql`) that rejects changes to ~35 financial/risk/verification/Stripe-Connect columns unless the request is `service_role`. A column-level `REVOKE` was tried first and found ineffective against the table-wide grant — **do not rely on column-level GRANT/REVOKE alone on this table; the table-wide grant wins.** Verified live: a simulated authenticated-role balance write was blocked with zero data change.

**Takeaway for future audits:** Supabase's own security advisor did **not** catch this — it checks RLS presence and obviously-permissive `USING (true)` patterns, but doesn't cross-reference column-level grants against row-level policies. Always check `information_schema.column_privileges` and `table_privileges` together with `pg_policies`, on every table holding money/risk/trust fields, not just the RLS policy text.

---

## 6. Operational Runbook

### 6.1 Monitoring withdrawals

There is no automated alerting or dashboard specific to withdrawals today. To check current state, run `scripts/reconcile_and_triage.sql` against the production Supabase project (read-only, safe to run anytime). It reports:
- Balance drift (`profiles.balance` vs. `SUM(completed wallet_transactions)`) — **expect false positives for users with an in-flight (rare, transient) pending withdrawal**, since the debit already happened but the row hasn't been marked completed yet. If a "drift" persists across multiple check-ins hours apart, that's real.
- Negative balances (should be impossible — DB `CHECK` constraint on `balance_on_hold`, though note `profiles.balance` itself currently has **no** non-negative `CHECK` constraint, only app-level enforcement in the RPCs).
- Orphaned transactions (user_id doesn't resolve to a profile).
- Stuck pending withdrawals (> 3 days old).
- Withdrawals with a null `stripe_transfer_id` (should never happen — a row is only inserted after the transfer already succeeded).
- Duplicate idempotency keys / duplicate `stripe_transfer_id` usage across rows (should be impossible given the unique indexes; a hit means a guard broke).
- Withdrawals whose `stripe_connect_account_id` no longer matches the user's current one (hunter disconnected/reconnected their bank between withdrawals).

**Log grep points** (Supabase Edge Function logs, `connect` and `webhooks`):
- `[connect/transfer]` — every stage of a withdrawal attempt is logged with `userId`, `amount`, `transferId`.
- `CRITICAL` (all-caps, always paired with `console.error`) — every place in the code that flags something needing **manual reconciliation**: a failed balance refund, a transfer that succeeded but whose history row failed to insert, a `transfer.failed` race the optimistic lock couldn't safely resolve. Grep for `CRITICAL` first when investigating any incident.

### 6.2 Investigating a specific withdrawal

Given a `wallet_transactions.id` or `stripe_transfer_id`:
1. Read the row: `status`, `metadata.transfer_status`/`metadata.payout_status`, `stripe_transfer_id`.
2. If `status = 'completed'` and no `payout_status` in metadata: the platform→connected-account Transfer succeeded; the connected-account→bank Payout hasn't resolved yet (normal, can take 1-2 business days) or hasn't been checked. Cross-reference in the Stripe Dashboard: Connect → the hunter's account → Payouts.
3. If `status = 'failed'`: check `metadata.transfer_status` (`failed` vs `permanently_failed`) or `metadata.payout_status` to know which failure path hit it, and `metadata.payout_failure_code`/`failure_reason` for why. The balance should already show as refunded (`update_balance` ran) — verify via `scripts/reconcile_and_triage.sql` §1.
4. If `status = 'pending'` and it's more than a few seconds old: **this should not happen** under the current code (see §2). Check whether the deployed `connect` function matches git (see §6.4) — this exact symptom is what the 2026-07-17 regression looked like.

### 6.3 Retrying a failed withdrawal

`POST /connect/retry-transfer { transactionId }` — user-facing, requires the transaction to belong to the caller and be `status = 'failed'`, capped at 3 retries (`metadata.retry_count`). There is no support-side/admin retry endpoint; support must ask the hunter to retry from the app, or a service-role script must call the same RPC path manually.

### 6.4 Verifying production matches git (do this first on any new session)

Production edge functions have been deployed directly (bypassing git) at least twice in the past week. **Do not assume `git log` reflects what's live.** Before relying on any assumption about current behavior:

```
mcp__claude_ai_Supabase__get_edge_function(project_id, "connect")
mcp__claude_ai_Supabase__get_edge_function(project_id, "webhooks")
```
...and diff the returned source against the local `supabase/functions/{connect,webhooks}/index.ts` (strip CRLF before diffing). If they differ and the difference isn't explained by an in-progress, known change, treat it as a live incident, not a git-sync task.

### 6.5 Reconciling stuck/failed state

There is no scheduled reconciliation job (`scripts/reconcile_and_triage.sql` is manual-run only — see Future Improvements). Run it manually:
- After any suspected incident.
- Before/after any `connect` or `webhooks` deploy.
- Periodically as a health check, until a scheduled job exists.

---

## 7. A Second, Unused Withdrawal Schema Existed — Removed 2026-07-18

**Historical record — this schema no longer exists; kept here in case the context is needed again.** The database used to also contain a `withdrawals` table plus `withdraw_balance_v2()` and `cancel_withdrawal()` RPCs, with a more mature `reserved/pending/paid/failed/canceled` lifecycle, proper idempotency-key-as-primary-guard, and configurable min/max ($1–$2,000 default — **different from the live $10–$10,000 range**). `supabase/functions/connect/index.ts` never called any of these. A 2026-07-18 follow-up audit confirmed it was never created by any git-tracked migration (across all three migration directories in this repo), held 0 rows, and had zero dependents anywhere — see §11.2 — and dropped it. If a v2 withdrawal rewrite is wanted in the future, design it fresh against the current live schema rather than resurrecting this attempt.

---

## 8. Troubleshooting Guide

| Symptom | Likely cause | Where to look |
|---|---|---|
| Withdrawal stuck at `status: 'pending'` indefinitely | Deployed `connect` function doesn't match git (see §6.4) and is writing `'pending'` instead of `'completed'` on the synchronous-success path | Diff deployed vs. git; if confirmed, this is the 2026-07-17-class regression — restore `status: 'completed'` and redeploy |
| Hunter reports balance debited but no payout | Check `wallet_transactions` for the row: if `status='completed'` with no failure metadata, the payout is likely just still in Stripe's normal 1–2 business day window — check Stripe Dashboard. If `status='failed'`, the refund should already be applied; verify via reconciliation script. | `scripts/reconcile_and_triage.sql` §1, §3b; Stripe Dashboard Connect → Payouts |
| `payout.failed` webhook fired but balance wasn't refunded | Either (a) no `'completed'` withdrawal row matched by `(user, amount)` — check for exact-amount collisions or a `'pending'`-stuck row (which the matcher won't find, since it filters `status='completed'`), or (b) the refund RPC itself failed twice (logged as `CRITICAL`) | Webhook logs for the specific `payoutId`; grep `CRITICAL` |
| Hunter can't withdraw: "Payouts are currently disabled on your account" | Their Stripe Connect account has a restriction (missing requirement, disabled by Stripe) — this is a live check, not cached | `stripe.accounts.retrieve(accountId).requirements` in Stripe Dashboard |
| Hunter can't withdraw: "Your balance is temporarily frozen" | An open Stripe chargeback dispute exists for a payment intent tied to their account (`profiles.balance_frozen = true`, set by `charge.dispute.created`) | `bounty_disputes` table, `charge.dispute.closed` should eventually clear it |
| Suspected balance manipulation / a balance that doesn't match any known deposit/earning history | Check whether this predates the 2026-07-17 RLS fix (§5.1) — a balance inflated via direct client write before the fix would show as `completed` ledger entries with no matching legitimate deposit/release transaction, or as a `profiles.balance` with no ledger backing at all | `scripts/reconcile_and_triage.sql` §1 (drift); compare against `wallet_transactions` history for that user |
| A user's "written-off" balance reappears | `GET /wallet/balance` auto-reconciles `profiles.balance` from the ledger whenever cached balance is exactly 0 — if a balance was zeroed by a direct SQL write-off without an offsetting `'completed'` ledger row, the next balance fetch will resurrect it from the stale ledger sum | `supabase/functions/wallet/index.ts` ~line 181; see §9 Future Improvements |

---

## 9. Future Improvements

1. **Scheduled reconciliation job.** `scripts/reconcile_and_triage.sql` is manual-run only. Wire it into `pg_cron` (already used elsewhere per `docs/database/CRON_SETUP_GUIDE.md`) on a daily cadence, alerting (e.g. via the existing `notifications`/Slack integration if one exists) on any non-empty result set.
2. ~~Resolve the balance-write-off vs. auto-reconcile conflict~~ — **Fixed 2026-07-18.** The unsafe auto-reconcile-on-zero logic was removed entirely from all three server surfaces rather than special-cased; see §11.1.
3. ~~Decide the fate of the unused `withdrawals`/`withdraw_balance_v2`/`cancel_withdrawal` schema~~ — **Fixed 2026-07-18.** Verified thoroughly unused (0 rows, zero references, zero dependents) and dropped; see §7 and §11.2.
4. ~~Remove `components/withdraw-screen.tsx`~~ — **Fixed 2026-07-18.** Dead code removed.
5. **Non-negative CHECK constraint on `profiles.balance` itself** — only `balance_on_hold` has one today; `balance` is only protected by app-level RPC logic. Cheap, high-value defense-in-depth given §5.1. Still open.
6. **Support-side/admin retry or refund tooling** for withdrawals stuck beyond the 3-attempt client retry cap, so "contact support" has an actual resolution path beyond a manual SQL fix. Still open.
7. **Reconcile the `auth.jwt()->>'role'` vs. `auth.jwt()->'app_metadata'->>'role'` inconsistency** across dispute-table RLS policies (found during this audit, adjacent to but not part of the withdrawal path) — depending on which claim your auth flow actually sets, some admin-gated policies may not work as intended. Still open.
8. ~~`dispute_audit_log` INSERT policy is `WITH CHECK (true)`~~ — **Fixed 2026-07-18.** See §11.4.
9. **`backup_bounty_requests_duplicates` DROP TABLE not yet applied** — RLS was enabled as an interim fix (closes the live exposure), but the table itself (whose one-time job finished in March 2026) should still be dropped; the DROP could not be executed this session. See §11.5.
10. **New, significant finding — `profiles` SELECT is broadly exposed independent of the `public_profiles` view.** Discovered while verifying §11.3 (`public_profiles`): the base `profiles` table has permissive SELECT RLS policies (`USING (true)`) alongside more restrictive ones — since RLS policies for the same command OR together, the net effect is **unrestricted SELECT on all 62 columns of `profiles` for any caller**, including `balance`, `stripe_connect_account_id`, `stripe_customer_id`, `risk_level`, `risk_score`, `balance_frozen`, `email`, `phone`, `e2e_public_key` — confirmed via `information_schema.column_privileges` showing SELECT granted to `anon`/`authenticated` on every column. This is the read-side counterpart to the write-side hole fixed 2026-07-17 (§5.1), and Supabase's advisor does not catch it either (it explicitly excludes `USING (true)` SELECT policies from its "RLS Policy Always True" check, treating that pattern as usually-intentional public-read design). **Not fixed this session** — restricting it safely requires first cataloging every legitimate place in the app that reads *other users'* profile fields (bounty listings, hunter/poster profile views, etc.), since a naive fix risks breaking core social/marketplace features. This needs its own dedicated audit pass, the same way the write-side fix required verifying every legitimate write path before acting.

---

## 10. Manual QA Checklist

No isolated test Supabase project or Stripe test-mode credential set exists for this app as of 2026-07-17 (confirmed: `list_projects` shows one ACTIVE production project only). The scenarios below therefore describe what to verify **conceptually against the code**, plus what to check live in production with extreme minimal-amount caution (do not execute a real withdrawal without the account owner's direct, live involvement):

- [ ] Successful withdrawal at exactly the minimum amount ($10) — confirm `status: 'completed'` immediately, `stripe_transfer_id` populated, balance debited exactly once.
- [ ] Duplicate request with the same `idempotencyKey` (simulate: call `/connect/transfer` twice with the same key before the first responds) — confirm only one Stripe Transfer is created and the second response has `duplicate: true`.
- [ ] Insufficient balance — confirm `insufficient_balance` error, no Stripe API call made, balance unchanged.
- [ ] Disconnected/restricted Stripe Connect account — confirm `payouts_disabled` error, balance unchanged (checked before debit).
- [ ] Invalid/malformed amount (negative, NaN, sub-cent, over max) — covered by `__tests__/unit/withdrawal-validation.test.ts` (run `npx jest withdrawal-validation`).
- [ ] Stripe API failure during transfer creation — confirm balance is refunded via `update_balance`, and if that refund itself fails, confirm the `transfer_failed_refund_failed` error is returned and a `CRITICAL` log line is emitted (this is the "manual reconciliation required" path — verify it's loud, not silent).
- [ ] `payout.failed` webhook for a real completed withdrawal — confirm balance is refunded exactly once even if the webhook is redelivered (idempotency guard on `metadata.payout_status`).
- [ ] `transfer.failed` webhook race against a concurrent `/connect/retry-transfer` — confirm the optimistic lock either applies to the right row or logs `CRITICAL` for manual review, never silently corrupts the newer retry's state.
- [ ] Retry a failed withdrawal 4 times — confirm the 4th is rejected with `maxRetriesReached: true`.
- [ ] Concurrent withdrawal requests for the same user (two different idempotency keys, enough balance for only one) — confirm the `FOR UPDATE` lock in `withdraw_balance()` serializes them and only one succeeds.
- [ ] (Post-2026-07-17 fix) Attempt a direct `supabase.from('profiles').update({ balance: <inflated> })` as an authenticated non-service-role user — confirm it's rejected with the `insufficient_privilege` error from `prevent_client_writes_to_protected_profile_columns`.
- [ ] (Post-2026-07-18 fix) Call `GET /wallet/balance` for a user with a legitimately-zero balance and completed-transaction history summing positive (e.g. after a debit) — confirm the response is `$0`, not a resurrected positive value, and confirm no `profiles.update` call occurs as part of the read.
- [ ] (Post-2026-07-18 fix) Insert into `dispute_audit_log` as an authenticated user, supplying a different user's ID as `actor_id` and `actor_type: 'admin'` — confirm the persisted row has your own `auth.uid()` and `actor_type: 'user'` instead.

---

## 11. Technical Debt Cleanup — 2026-07-18

A follow-up audit validated and resolved four findings from the 2026-07-17 session. All DB changes were verified against the live schema before acting (not assumed from prior notes) and, where the finding was a security hole, verified live with a rolled-back simulated-attack transaction, matching the methodology established in §5.1.

### 11.1 Legacy balance resurrection (`GET /wallet/balance`) — Fixed

**Confirmed live before fixing**: user `hunter`'s Phase 2 write-off (balance zeroed 2026-07-17 with no offsetting ledger row) had already been silently resurrected — `profiles.balance` had flipped back from `0.00` to `5.70` sometime after the write-off, exactly as the 2026-07-17 audit predicted.

**Root cause**: all three server surfaces (Supabase Edge Function, deprecated Express mirror, Fastify service) "reconciled" a cached `$0` balance by deriving `SUM(completed wallet_transactions)` and writing it back whenever positive — unsafe both for the write-off case and for a genuinely in-flight debit (e.g. a withdrawal whose row hadn't reached `'completed'` yet), the latter being a real double-spend vector, not just a display bug.

**Fix**: removed the reconcile logic entirely (not patched) from all three surfaces, since every balance-affecting operation (`apply_deposit`, `apply_escrow`, `apply_refund_tx`, `apply_release_tx`, `withdraw_balance`) is already atomic — there's no remaining scenario where `profiles.balance` should legitimately lag the ledger. Added regression tests asserting the pattern doesn't reappear in any of the three surfaces (`__tests__/unit/wallet-balance-no-resurrection.test.ts`). Commit `9a8feef4`.

**Not fixed**: `hunter`'s balance is still incorrectly at `$5.70` (should be `$0.00` per the write-off's intent) — this is stale *data*, not a code bug, and correcting a specific user's balance downward is a live-money decision outside this session's authorization. Flagged for the product owner.

### 11.2 Unused `withdrawals`/`withdraw_balance_v2()`/`cancel_withdrawal()` schema — Removed

Verified via full-repo grep and `git log --all -S` across all three migration directories: never created by any tracked migration, 0 rows of data, zero references anywhere in app code or scripts, zero dependents (no trigger/view/function referenced it), and `EXECUTE` was already restricted to `service_role`/`postgres`. Dropped. Commit `ad804778`. Full details, including the verbatim function bodies that existed, are preserved in this document's §7 and in git history for `supabase/migrations/20260718_drop_unused_withdrawals_v2_schema.sql`.

### 11.3 `public_profiles` view — Confirmed required, verified safe; adjacent finding surfaced

The view is **not** dead code — it's an active client-side fallback in `lib/services/auth-profile-service.ts` and `lib/services/userProfile.ts`. It bypasses RLS via view-owner privilege (owner `postgres`, `security_invoker` unset — this is what the advisor's "SECURITY DEFINER view" flag actually means for a view, as opposed to a function). Verified its column list (`id, username, display_name, avatar, location, about, verification_status, created_at` — 8 columns) exposes none of the sensitive fields protected by the 2026-07-17 fix. **No change needed or made.**

While verifying this, an adjacent, more significant issue surfaced: the base `profiles` table's own SELECT RLS is effectively unrestricted for anyone (see §9, item 10) — all 62 columns, including the sensitive ones, independent of what the view exposes. This is **not fixed** and needs its own dedicated audit before any restriction is attempted, since many legitimate app features read other users' profile data.

### 11.4 Forgeable `dispute_audit_log` — Fixed

Confirmed: the live INSERT policy was `WITH CHECK (true)` (drifted outside git history from the original migration's admin-only check), and `lib/services/dispute-service.ts`'s `logAuditEvent()` — a legitimate, actively-used client-side helper called from 9+ places — inserts directly into the table trusting whatever `actor_id`/`actor_type` the calling code passes, with no server-side verification.

**Fix**: a `BEFORE INSERT` trigger (`enforce_dispute_audit_log_actor`) overwrites `actor_id`/`actor_type`/`created_at` with server-derived values (`auth.uid()`/`auth.jwt()->>'role'`) on every non-`service_role` insert, regardless of what the caller supplied. This required **zero changes** to `dispute-service.ts` or any of its call sites — chosen specifically over an RPC-based redesign to avoid touching working, actively-used app code. Also dropped `log_dispute_audit_2(uuid, ...)`, a second, broken function overload (wrong parameter type against the live `integer` `dispute_id` column) with zero references anywhere. Verified live: a simulated authenticated insert claiming a different user's identity and `actor_type='admin'` had both fields silently overwritten to the real caller's identity. Commit `8268a7c1`.

### 11.5 `backup_bounty_requests_duplicates` RLS disabled — Interim fix applied, DROP still pending

Confirmed: a one-time pre-dedup safety backup from `database/migrations/20260322_dedupe_bounty_requests.sql`, job complete since March 2026, currently 0 rows, zero app references, RLS disabled with zero policies **and** full `anon`/`authenticated` table-wide grants (unlike some RLS-disabled tables, grants here did not limit the real exposure). Enabled RLS with zero policies (defaults to deny-all), closing the live exposure. The intended full fix — `DROP TABLE`, since the table's job is done and RLS-protecting a table nothing uses is pure overhead — could not be applied this session (see §9, item 9); the exact statement is documented in `supabase/migrations/20260718_lock_down_backup_bounty_requests_duplicates.sql` for a future session or the user to run directly.
