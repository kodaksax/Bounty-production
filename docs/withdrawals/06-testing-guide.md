# Withdrawal System — Testing Guide

> **Read this framing before anything else — corrected 2026-07-18.** Every prior version of this document (and the technical spec) claimed no isolated test environment exists. That was wrong, or became wrong without anyone noticing: **Bounty-expo has a persistent Supabase branch named "Staging" (project ref `gwumwpoomwvkjyibdmpj`) that is genuinely configured with a Stripe *test-mode* secret key** (`sk_test_...`, confirmed live via a new `stripe-mode-check` diagnostic function — see below) and its own webhook secret. This was found by actually listing Supabase branches instead of trusting prior documentation, per this project's now well-established pattern of docs drifting from reality. **However, Staging's code and database schema are stale** — its `connect`/`webhooks` functions predate every hardening pass back to mid-2026, and its migrations stop at 2026-07-17, ~2 days behind production as of this writing. It is not currently safe to treat as a working parity test environment without first syncing it. See "Staging environment: current state" below for exactly what that requires.

## Update 2026-07-18 (later same day): root cause of the failed rebase found

The two `rebase_branch` failures recorded below turned out not to be about Staging's specific drift at all — a **fresh** branch created directly from production's current schema (`create_branch`, no Staging history involved) hit the identical `MIGRATIONS_FAILED` status, stopping after only 7 of ~66 tracked migrations (`20251102_stripe_payments_integration`).

Root cause, confirmed by manually replaying each subsequent migration's SQL directly against the fresh branch via `execute_sql` until one errored: `supabase/migrations/20251117_safe_user_deletion.sql` contains `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY (user_id)` blocks against **`bounty_requests`** and **`messages`** — neither table has ever had a `user_id` column (`bounty_requests` uses `hunter_id`/`poster_id`, created by a *later* migration, `20251119_add_bounty_requests_table.sql`; `messages` uses `sender_id`). This is not a table-creation-ordering problem that reordering would fix — the referenced column doesn't exist under any order. Production has this migration tracked as "applied," which is only possible because of this project's established ad-hoc-application drift pattern (see the engineering runbook) — the exact SQL currently in git could not have executed successfully against the real schema, in production or anywhere else.

**Fixed**: both broken blocks removed from `20251117_safe_user_deletion.sql` (commented out with the finding recorded inline, not silently deleted) — production is unaffected (it never had these constraints; nothing to roll back). This is a necessary but likely not sufficient fix: only the *first* blocking migration was found and fixed this pass. **A `handle_user_deletion_cleanup()` trigger function created by the same migration has a third, lower-severity instance of the same bug** (`UPDATE bounty_requests ... WHERE user_id = ...` inside the function body) — this doesn't block migration replay (plpgsql function bodies aren't validated against referenced tables until they execute), but means the trigger's bounty-request cleanup step has always silently no-op'd (caught by the function's own top-level `EXCEPTION WHEN OTHERS`) whenever a profile is actually deleted. Not fixed this pass — flagged here since it's a real, currently-live latent bug, low severity (fails safe, doesn't block the deletion) but worth a deliberate fix (likely swapping to `hunter_id`) rather than continuing to silently swallow it.

**Recommended next step for whoever continues this**: re-attempt `create_branch` (or `rebase_branch` against the existing Staging branch, project ref `gwumwpoomwvkjyibdmpj`) after this fix is committed and pushed to `main` — branch creation pulls migrations from the git repo, not the local working tree, so the fix must be on `main` first. If it fails again, the error message names the next offending table/column directly (same method used to find this one: reproduce via `execute_sql` against a scratch branch, migration-file-by-migration-file, starting from wherever the new failure stops). A non-persistent scratch branch (`Staging-v2`, project ref `xyowfvhijuhgdyptrldu`) was created during this session for this diagnosis and left in place (`MIGRATIONS_FAILED`, only 7 migrations applied) in case it's useful for continuing; it will likely auto-expire since it isn't marked persistent, or can be deleted once done with it.

## Update 2026-07-19: fix pushed, second failure found and fixed, third attempt in flight

The phantom-column fix above was committed (`bb2618b5`) and pushed to `main`. `rebase_branch` against the real Staging branch got further — past `20251117_safe_user_deletion` this time — but hit a **second, unrelated** `MIGRATIONS_FAILED`, on the migration tracked as `20260718004843` ("revoke_client_writes_on_sensitive_profile_columns"): `ERROR: column "balance_on_hold" of relation "profiles" does not exist (SQLSTATE 42703)`.

Root cause (confirmed via the branch-action logs, not guessed): `supabase/migrations/20260417_add_balance_on_hold_dispute_freeze.sql` — which adds `profiles.balance_on_hold`, `bounty_disputes.hold_amount`, and the `withdraw_balance`/`fn_open_dispute_hold`/`fn_close_dispute_hold` functions — **has no entry anywhere in production's tracked `schema_migrations` history**, despite the column being live on production today. It was applied out-of-band at some point, exactly like `public_profiles` (see `08-profiles-rls-migration-strategy.md`) but for a column instead of a view. A later migration that *is* tracked (the REVOKE) assumes the column already exists, so any from-scratch replay of tracked history hits this gap.

Fixed by applying `20260417_add_balance_on_hold_dispute_freeze.sql`'s content (already idempotent — `IF NOT EXISTS`/`CREATE OR REPLACE` throughout) directly against the Staging branch via `execute_sql`, then re-running `rebase_branch`. **This does not fully close the gap for future fresh environments**: backfilling this into *production's* tracked history necessarily gets a *today's-date* timestamp, sorting after the migrations that depend on it — the same ordering problem would resurface for any future from-scratch replay. Properly fixing this would require editing `schema_migrations` version numbers directly, which was judged too risky to attempt without a dedicated, explicit pass. **If a future Staging rebuild hits this exact `balance_on_hold does not exist` error again, apply `20260417_add_balance_on_hold_dispute_freeze.sql` directly to the target branch first, the same way.**

**Update, same session, restriction lifted**: the tool restriction cleared on its own. Checked `list_branches` — Staging was still `MIGRATIONS_FAILED`. The second rebase attempt had gotten past `balance_on_hold` but failed on the **next column in the same REVOKE statement**: `ERROR: column "balance_frozen" of relation "profiles" does not exist (SQLSTATE 42703)`. Same root cause, same class of bug: `20260414_add_stripe_dispute_columns.sql` (adds `balance_frozen`, plus `bounty_disputes.stripe_dispute_id`/`stripe_payment_intent_id`/Stripe-dispute indexes, plus `assert_profile_balance_not_frozen()`) was **also never tracked in production's migration history**, same pattern as `balance_on_hold`.

Applied directly to the Staging branch again (columns/indexes/function only — the file's own `bounty_disputes_status_check`/`wallet_transactions_type_check` CHECK-constraint rewrites were **skipped**, since they're narrower than the constraint the already-applied `20260417` migration puts in place, and Staging already has rows that only satisfy the broader, later version — reapplying the narrower one errored with `23514: check constraint ... is violated by some row`). Re-ran `rebase_branch` again; result not yet confirmed as of this doc update — check `list_branches`/`list_migrations` against `gwumwpoomwvkjyibdmpj` for current status.

**Pattern now confirmed across two instances**: any `profiles` column added via an out-of-band `ALTER TABLE` that a *later, properly-tracked* migration references (directly or via a broad `REVOKE`/`GRANT` on a column list) will break a from-scratch replay the same way. If a third instance appears, the fix is the same: read the branch-action error for the missing column name, `grep -rl` the migrations directory for whichever file adds it, apply that file's column/function-level statements (not necessarily its CHECK-constraint rewrites, if a later migration has already superseded them) directly against the target branch via `execute_sql`, then retry `rebase_branch`.

**Update 2026-07-19 (confirmed): Staging recovery is complete.** After one further round (a batch diff surfaced ~21 more never-tracked `profiles` columns beyond `balance_on_hold`/`balance_frozen`, applied the same way), `rebase_branch` succeeded. Verified independently, not assumed from the rebase's own return status: `list_branches` on `gwumwpoomwvkjyibdmpj` shows `status: "FUNCTIONS_DEPLOYED"`; `list_migrations` shows all 78 entries matching production's tracked history exactly (through `20260719004626_revoke_public_execute_on_get_my_profile`); `list_edge_functions` shows identical `ezbr_sha256` hashes on both projects for `connect`, `webhooks`, `wallet`, `admin-withdrawals`, `admin-profiles`, and `stripe-mode-check`. Re-verified again on 2026-07-19 (this session): `list_branches` still reports `FUNCTIONS_DEPLOYED` for Staging. Staging is now a genuinely usable, current, Stripe-test-mode parity environment — not just "exists," but confirmed current.

## Staging environment: current state (as of 2026-07-18)

| Check | Result |
|---|---|
| Isolated Supabase project | ✅ Yes — persistent branch, project ref `gwumwpoomwvkjyibdmpj`, parent `xwlwqzzphmmhghiqvkeu` |
| Stripe mode | ✅ **Test mode confirmed** (`sk_test_` prefix, `livemode: false` from a live `/v1/balance` call) |
| Stripe webhook secret configured | ✅ Yes (`STRIPE_WEBHOOK_SECRET` present) — **not verified** that the Stripe test-mode dashboard's webhook endpoint actually points at this project's `/webhooks` URL; check before relying on webhook-driven test scenarios |
| Edge function code parity with production | ❌ No — `connect` was at v19 vs. production's v32+, `webhooks` at v15 vs. v35+ at time of writing. Missing every fix from the last two hardening sessions (bank-account wiring, new webhook handlers, `manually_paid` status, the admin recovery tool, structured logging) |
| Database schema parity with production | ❌ No — migrations stop at `20260717052514`; missing everything from `harden_apply_dispute_loss_privileges` onward, including the `profiles.balance` floor constraint, `admin_action_log`, `reconciliation_findings`, `reconciliation_known_exceptions`, and the `manually_paid` enum value |
| Automated rebase (`rebase_branch` API) | ❌ Attempted twice this session, both failed (`MIGRATIONS_FAILED`) — consistent with this project's established pattern of live schema drifting from tracked migration history, which breaks in-order migration replay |

**The `stripe-mode-check` function** (`supabase/functions/stripe-mode-check/index.ts`) is now deployed to both Staging and production. It's a tiny, unauthenticated, read-only diagnostic — `GET /functions/v1/stripe-mode-check` returns `{configured, keyPrefix, livemode, webhookSecretConfigured}` with no financial data or secrets exposed. Use it on any environment before assuming its Stripe mode.

### What's needed to make Staging actually usable

1. **Redeploy current code** — `connect`, `webhooks`, `wallet`, `admin-withdrawals`, `stripe-mode-check` all need a fresh deploy from the current `main` branch source.
2. **Bring the schema current** — since the automated rebase failed, this needs either (a) investigating why the rebase failed (likely a specific migration conflicting with schema that was applied ad hoc, out of tracked order — check `MIGRATIONS_FAILED` branch logs if the Supabase dashboard exposes them) and retrying, or (b) manually replaying the missing migrations listed above against Staging directly, the same way most of this project's migrations have historically been applied (verify live schema state before each, per this document's own repeated lesson).
3. **Confirm the Stripe test-mode webhook endpoint** in the Stripe Dashboard (test mode toggle on) actually targets Staging's `/webhooks` URL, not production's.
4. **Re-run `stripe-mode-check` against Staging after any of the above** to confirm nothing regressed.

Until this is done, Staging is a real, safely-isolated environment in principle, but not a reliable one to test against yet.

> The paragraph below is preserved from the prior version of this document for historical context — it was the working assumption throughout every previous hardening pass, and is now known to have been incomplete rather than fully accurate:
>
> "There is no isolated test Supabase project and no Stripe test-mode credential set for this app. One production project, Stripe in live mode." Every scenario below is marked with what's actually automated today versus what requires manual, human-present, live-mode verification with real (minimal) amounts, or — once Staging is synced — safe test-mode verification. **No scenario in this document was executed live during this documentation pass** — this is a specification of how to test, not a report of tests run.

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

## What Staging still needs before it's fully usable (see also the section above)

- ~~A separate Supabase project (or branch) with its own schema, seeded with test profiles~~ — **exists** (Staging branch), schema is just stale
- ~~Stripe test-mode API keys~~ — **exists and confirmed live** via `stripe-mode-check`
- A test-mode Connect platform and test bank accounts — Stripe provides these for test mode; not yet exercised against Staging
- A way to point the deployed Edge Functions at test-mode credentials without touching production — **already true**, since Staging's secrets are project-scoped and independent of production's
- Stripe's test-mode tools for simulating payout failures — available once Staging is actually exercised; not yet used
- Current code and schema deployed to Staging (see above) — this is the actual remaining blocker, not environment existence

Until Staging is synced, this document remains the closest thing to a test plan — a checklist of what to verify and how, executed carefully and manually against production when necessary, or against Staging once it's brought current.
