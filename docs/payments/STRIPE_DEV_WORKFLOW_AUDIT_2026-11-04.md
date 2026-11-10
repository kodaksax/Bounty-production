# Stripe developer workflow + payment audit — 2026-11-04

Audit-first. Stripe **test mode only**; production was **read only** (SQL
SELECTs against `xwlwqzzphmmhghiqvkeu`; no live Stripe key was used, no live
object or setting was touched, nothing was deployed, no historical record was
changed). Setup guide: [`STRIPE_DEV_WORKFLOW.md`](./STRIPE_DEV_WORKFLOW.md).

## Verdict

| Scope | Classification |
| --- | --- |
| Stripe dev tooling (extension, CLI, local webhook debugging, reconcile) | **SAFE FOR DEVELOPMENT** — working, verified end to end |
| Code changes in this audit (F-2, F-3, F-4, F-8, F-9) | **READY FOR STAGING** — tsc clean, full suite green, not deployed |
| Production payment system as a whole | **BLOCKED for production review** until F-5 (v2 release confirmation) is fixed and the 8% client build ships |

> Merging to `main` **is** a production deploy: `.github/workflows/deploy-edge-functions.yml`
> deploys every changed edge function to `xwlwqzzphmmhghiqvkeu` on push to `main`.
> Nothing here is committed.

## 1. Payment architecture (from source and live schema, not docs)

Three architectures coexist. **v1 is the only one with a track record**; v3 has
never run (0 `bounty_v3_funding` rows in production).

| | v1 wallet ledger | v2 escrow (`bounty_payments`) | v3 (`bounty_v3_funding`) |
| --- | --- | --- | --- |
| Money in | `payments` fn creates PI (`purpose=wallet_deposit`) → `payment_intent.succeeded` → `apply_deposit` RPC (insert + balance, idempotent on PI) | `bounty-payments` creates PI (`purpose=bounty_escrow`) or Checkout (`fn_create_bounty_from_pending`) → `captured` on `payment_intent.succeeded` | `bounty-payments` manual-capture PI |
| Authoritative record | `wallet_transactions` + `profiles.balance` | `bounty_payments.status` | `bounty_v3_funding.state` |
| Release | `wallet` `/release`: internal ledger move, fee kept | `bounty-payments` `/release` → `stripe.transfers.create` → `release_pending`; **`released` only on `transfer.created`** | capture + transfer → `capturing`; **`released` only on `transfer.created`** |
| Money out | `connect` withdraw: Transfer → automatic/standard Payout; `completed` only on `payout.paid` (CHECK-enforced since 2026-08-15) | Transfer lands in hunter's Connect account | same |
| Production volume | 77 live deposits, 48 fee-bearing releases | 11 rows (4 captured, 5 refund_pending, 1 refunded, 1 release_pending) | 0 |

Stripe is initialised only server-side, in 9 edge functions (`webhooks`,
`payments`, `bounty-payments`, `wallet`, `connect`, `apple-pay`,
`admin-withdrawals`, `reconciliation`, `identity-create-session`), all pinned to
`apiVersion: '2023-10-16'`. The client only holds publishable keys.

Every Stripe write: `payments` (customers, PaymentIntents, SetupIntents);
`bounty-payments` (customers, PIs create/cancel/capture, transfers, refunds);
`apple-pay` (PIs); `connect` (accounts, account links, login links, transfers,
payouts); `admin-withdrawals` (transfers, payouts).

Webhook `webhooks/index.ts` handles 42 event types; signature checked against
every configured secret (constant-time), 5-minute replay window, atomic
`claim_stripe_event` dedupe, 500 on failure so Stripe retries, failures
recorded via `record_stripe_event_failure`.

## 2. Test evidence

**Automated.** Baseline before changes: 103/104 payment suites, 1,812 tests
passed. After changes: `tsc --noEmit` **0 errors**; full `jest`: **468 suites
passed, 2 skipped, 6,297 tests passed, 0 failed**. `deno check` clean for
`webhooks`, `wallet`, `bounty-payments`. New regression tests were confirmed to
**fail against the original code** (fee parity: 4 failing) before passing.

**Stripe test events → deployed staging `webhooks`** (`acct_1SCOhHQu3TJHRHBb`):

| Test | Result |
| --- | --- |
| `stripe trigger` ×5 flows → 19 events (PI succeeded/failed, refund, dispute, escrow-tagged PI for a non-existent bounty) | 19/19 delivered, signature-verified, `processed`, 0 retries, ≤0.5 s |
| Escrow-tagged PI with no `bounty_payments` row | logged `no pending row to advance`; 0 rows changed |
| PI without `user_id` / deposit metadata | not credited; 0 `wallet_transactions` |
| `stripe events resend` of a processed event | `Duplicate delivery ignored`; `processed_at` unchanged |
| Forged signature / missing header / 2020 timestamp | HTTP 400 ×3, logged `no_match` / `malformed_header` / `timestamp_skew`; event never stored |
| Local `serve-webhooks` (real function under Deno) | unsigned POST → 400; forwarded flow: 2 processed locally, 3 deduped against the deployed function |

**Reconciliation (read-only).**

- *Staging*, Stripe API vs DB, 90 days: 31 PIs, 19 Bounty-tagged → 6 findings:
  1 is this audit's own orphan-escrow test PI; 5 succeeded `wallet_deposit`
  PIs ($1,031) have no wallet row and their payers no longer exist in staging
  (`profiles` FK is `SET NULL`, so the rows were removed, not orphaned). Cause
  not determinable from staging data; production has no equivalent (below).
- *Production*, signature-verified PI objects in `stripe_events` vs DB: **77/77
  live deposits credited, 0 amount mismatches**; the 59 "user mismatches" are
  all `user_id NULL` after account deletion. v2/Checkout escrow: 0 missing rows,
  0 status or amount mismatches.
- Production ledger: 0 negative balances, 0 pending withdrawals > 3 days,
  0 completed withdrawals without payout id since 2026-08-15, 0 webhook failures
  in 14 days.

Not done: comparing against **live** Stripe balances, transfers and payouts —
that needs the live key, which this mission excludes.

## 3. Defects

Severity: P0 money/trust now · P1 money path broken or latent loss · P2 ops/test gap · P3 minor.

| # | Sev | Finding | Where | Status |
| --- | --- | --- | --- | --- |
| F-1 | **P0** | **Production deducts 8%, app said 5%** | prod env `PLATFORM_FEE_PERCENT` | **Decided 8%, no refund — client + defaults set to 8 (code)** |
| F-2 | P1 | Chargebacks on v2/v3/Checkout-funded bounties silently dropped | `webhooks` `charge.dispute.created` | **Fixed (code)** |
| F-3 | P1 | Every chargeback insert fails in production (column drift) | `webhooks` + `bounty_disputes` | **Fixed (code)** |
| F-4 | P1 | Production processes test-mode events | `webhooks` | **Fixed (code)** |
| F-5 | P1 | v2/v3 releases can never confirm — production never receives `transfer.created` | prod Stripe endpoint config | **Open — needs live config approval** |
| F-6 | P2 | Test environments can't exercise Connect / v2 release | test endpoints + staging schema | Open (proposal) |
| F-7 | P2 | 7 paid withdrawals ($106.40) stuck `stripe_pending` | migration `20260911000100` unapplied | **Fixed — applied to staging + production 2026-11-04** |
| F-8 | P3 | Fee rounding differs between paths (float) | `wallet`, `bounty-payments`, client | **Fixed** |
| F-9 | P3 | Payment errors can show `[object Object]` | `lib/services/stripe-service.ts` | **Fixed** |
| F-10 | P3 | 2 profiles' balance below their ledger ($7.00, $2.85) | prod data | Open — investigate |
| F-11 | P3 | 16 critical reconciliation findings open since Jul/Aug, several stale | `reconciliation_findings` | Open — housekeeping |

### F-1 — production fee is 8%, every surface says 5% (P0, open)

- **Evidence.** Fee recorded on every fee-bearing release in production:
  5.0% for 10 releases 2026-05-20 → 07-12; **8.0% for 38 releases 2026-07-12 →
  10-05** ($31.44 collected vs $19.65 at 5% — **$11.79** more than the app
  disclosed). The v2 release on 10-11 also recorded 8% ($0.40 on $5).
- **Root cause.** Code defaults to 5 (`Deno.env.get('PLATFORM_FEE_PERCENT') ?? '5'`
  in `wallet`, `bounty-payments`, `web-account`). The switch on 07-12 has no code
  change, so `PLATFORM_FEE_PERCENT=8` was set as a production function secret.
  `lib/constants/fees.ts` was aligned to "the server's 5" on 2026-09-05 without
  checking the live env, so since then the app quotes 5% and deducts 8%. Docs
  disagree too (5%, 10%).
- **Reproduce.** `SELECT round(100*(metadata->>'platform_fee')::numeric / ((metadata->>'platform_fee')::numeric + abs(amount)),1), count(*) FROM wallet_transactions WHERE type='release' AND metadata ? 'platform_fee' GROUP BY 1;`
- **Decision changed (2026-11-09): 5%, from the hunter's side** (the poster pays the
  listed price). Code defaults and the client constant are back to 5 (PR
  `fix/platform-fee-5`). **The production `PLATFORM_FEE_PERCENT` secret is still 8**
  and wins over every default until it is set to 5; set it when this ships.
  The 2026-11-04 entry below is kept for the record.
- **Decision (2026-11-04): 8%, no refund.** Done in code: `lib/constants/fees.ts`
  → 8 (FAQ, how-it-works, StepPay, payout and earnings screens all derive from
  it); server default `DEFAULT_PLATFORM_FEE_PERCENT = 8` in
  `_shared/platform-fee.ts`, used by `wallet` and `bounty-payments`;
  `web-account` and `services/api` defaults → 8; parity test pins all of them.
  The production secret is already 8, so server behaviour does not change.
  **Still needed:** ship the client (build/OTA) — until then installed apps
  keep quoting 5%. Older docs still say 5% or 10% (`docs/FINANCIAL_FLOWS.md`,
  `docs/payments/FINANCIAL_TRANSACTIONS_SPECIFICATION.md`,
  `docs/APP_STORE_REVIEW_NOTES.md`). Long-term: serve the fee from the server.

### F-2 — chargebacks on escrow-funded bounties were dropped (P1, fixed)

- **Root cause.** `charge.dispute.created` found the payer only via
  `wallet_transactions.stripe_payment_intent_id`, which exists only for v1
  deposits. In production **11/11** v2 PaymentIntents have no such row. A
  chargeback logged "logging only" and did nothing: no dispute row, no freeze,
  no admin review item — and the escrow stayed releasable to the hunter.
- **Reproduce.** `stripe trigger charge.dispute.created` against any PI that
  funded a `bounty_payments` row → log shows `no wallet_transaction found`.
- **Fix.** New `supabase/functions/_shared/stripe-dispute.ts`: payer resolved
  v1 → v2 (`bounty_payments.poster_id`) → v3 (`bounty_v3_funding` → bounty
  poster), by PI then charge id; lookup errors throw so Stripe retries. The row
  now carries `bounty_id`, so the trust review queue gets the bounty.
  **Deliberately not automated:** a *lost* v2/v3 chargeback no longer debits the
  wallet (that money never entered it). It is recorded `resolved_lost`, the
  account stays frozen, a `CRITICAL` log names it, and the user is told support
  will follow up. v1 deposit losses keep the existing automatic deduction.
- **Prod exposure so far:** 0 Stripe disputes ever, so nothing was missed.

### F-3 — every chargeback insert fails in production (P1, fixed)

- **Root cause.** The handler wrote `bounty_disputes.stripe_payment_intent_id`.
  Production has **no such column**: its version of migration
  `20260414_add_stripe_dispute_columns` was applied out of band as
  `payment_intent_id` and never reached the migration ledger. Staging has both.
  PostgREST rejects the unknown column on insert *and* on the update fallback →
  webhook 500 → Stripe retries for days → dispute never recorded, wallet never
  frozen, **including v1 deposits**. In staging the PI landed in a column no DB
  function reads (`fn_release_wallet_escrow_for_dispute` and
  `trg_bounty_events_from_disputes` read `payment_intent_id` in both envs).
- **Fix.** Write `payment_intent_id` (exists in both environments; no migration
  needed). Follow-up, not done: reconcile the schema drift and add `20260414` to
  the ledger deliberately.

### F-4 — production processes test-mode events (P1, fixed)

- **Evidence.** Production `stripe_events` holds 19 `livemode=false` events
  (15 `payment_intent.succeeded` Feb–Mar 2026; `payout.failed` ×2 and
  `transfer.failed` ×2 on 2026-07-16), all processed.
- **Root cause.** Stripe: *"your production webhook URLs receive both live and
  test webhooks … We recommend that you check the `livemode` value"*
  (docs.stripe.com/connect/webhooks). Nothing checked it. A test-mode
  `payment_intent.succeeded` with `purpose=wallet_deposit` and a real user id
  would credit real balance.
- **Fix.** `eventModeMatchesKey()` in `_shared/webhook-signature.ts`; after
  signature verification and before the claim, an event from the other mode is
  acknowledged `200 {ignored:'livemode_mismatch'}` and not processed.

### F-5 — v2/v3 releases can never confirm in production (P1, open)

- **Evidence.** v2/v3 `released` is written only by the `transfer.created`
  handler (by design: an API 200 is not confirmation). Production has **never**
  stored a `transfer.created` (only 2 test-mode `transfer.failed`). One live row
  is stuck: `bounty_payments e52fb798…` (bounty `59879908…`, $5, fee $0.40,
  transfer `tr_3UPBElJek…`) in `release_pending` since 2026-10-11, bounty still
  `in_progress`. The transfer exists, so the hunter was very likely paid.
- **Root cause (inferred).** The production platform endpoint is not subscribed
  to `transfer.*`. Could not be confirmed directly: reading live endpoint config
  needs the live key.
- **Fix (needs your approval — live config).** Subscribe the production
  platform endpoint to `transfer.created` and `transfer.reversed`, then resend
  the transfer's event (or reconcile that one row from Stripe) after verifying
  the transfer in the Dashboard.

### F-6 — test environments can't exercise Connect or v2 release (P2, open)

- Neither test platform has a Connect endpoint; staging's endpoint lacks
  `account.updated`, `transfer.*`, `payout.*`. Development's `webhooks` endpoint
  has 5 events, and its other endpoint points at `/functions/v1/stripe-webhook`,
  which has no source in the repo. Staging's disabled endpoint targets `/webhook`.
- Staging's `bounty_payments_status_check` lacks `release_pending` (production
  has it), so a v2 release would violate the constraint in staging.
- **Proposal:** add a Connect endpoint plus `transfer.*`/`payout.*`/`account.updated`
  to the staging platform endpoint (test mode, but still a change — not done
  without a go), and align staging's CHECK. Until then, use local
  `serve-webhooks`, which forwards Connect events.

### F-7 — 7 paid withdrawals ($106.40) never reach `stripe_settled` (P2, open)

`9c2b8e05, 74cf1f81, f3e54ebd, ac50b23f, d164ae8b, e589b243, 46bf9258`:
`status=completed`, payout id present, and a signature-verified `payout.paid`
stored for **every one** — Stripe paid them. `stripe_payout_status` was never
set to `paid`, so `settlement_state` stays `stripe_pending`. The forward fix is
on `main` (webhook stamps settlement on already-completed rows); the backfill
`20260911000100_withdrawal_settlement_evidence.sql` was in git but not in the
production ledger.

**Applied 2026-11-04 (owner approved).** The migration as written would have
failed on production: it added the CHECK *before* the backfill, and two
stranded rows (`ac50b23f`, `e589b243`) are post-cutoff and carried
`stripe_payout_status='in_transit'`, which the `IS NULL` match skipped — so the
constraint rejected them and the whole block rolled back. Corrected (backfill
first; match NULL/`pending`/`in_transit` only when `payout.paid` is stored and
no `payout.failed`/`payout.canceled` exists), applied to staging (0 rows,
constraint added), then production: **7 rows stamped, $106.40**, constraint
`wallet_transactions_completed_withdrawal_requires_settlement` added, ledger
row `20260911000100` recorded under the file's own version. Post-check query
returns 0; `stripe_settled` 2 → 9; balances and statuses unchanged.
`reconciliation`'s safe repair now stamps `stripe_payout_status='paid'` with
`completed` (code, not deployed) — until it is deployed that repair is
rejected by the new constraint and logged as `safe_repair_failed`, while the
`payout.paid` webhook (which already stamps correctly) completes the row.

### F-8 — fee rounding differed between paths (P3, fixed)

v1/v2 computed `Math.round(((amount*pct)/100)*100)/100` in float dollars; v3 and
the web receipt used integer cents. 286 amounts in $0.01–$1,000 disagreed
(e.g. $11.50: $0.57 deducted vs $0.58 on the receipt); the client estimate
disagreed on 102. All paths now use `supabase/functions/_shared/platform-fee.ts`
(cents, half-up, fee + net = amount exactly); the client uses the same
arithmetic. Effect: the fee changes by 1¢ only on half-cent amounts.

### F-9 — `[object Object]` in payment errors (P3, fixed)

`parseStripeError` fell back to `error.toString()`; a plain object (edge-function
JSON body) rendered `[object Object]` in `add-card-modal` and
`payment-element-wrapper`. It now reads nested `error.message` / `error`
strings and never returns the bare object tag.

### F-10, F-11 — ledger hygiene (P3, open)

- Profiles `8a8e1e87…` (balance 0.00, ledger 7.00) and `69395303…` (0.00 vs
  2.85). Balance is *below* the ledger, so the safe direction, but the users may
  be owed $9.85 or the ledger is missing negative rows. The reconciliation job's
  `balance_drift` findings were last seen 2026-08-14 while this drift exists
  now — check the detector still runs that check.
- 16 open critical findings (`balance_drift` ×6, `stuck_pending_withdrawal` ×6,
  `orphan_stripe_payout` ×2, `bounty_location_not_geocoded` ×2), most last seen
  in Jul/Aug; e.g. there are now 0 pending withdrawals, so the
  `stuck_pending_withdrawal` ones look stale. Triage, don't auto-close.

### Remaining risk, not a defect yet

Release paths (`wallet`, `bounty-payments`) do not check for an open Stripe
dispute on the bounty. With F-2 fixed, a chargeback now freezes the poster and
queues review, but nothing stops a release to the hunter while it is open.
Design decision.

## 4. Known-risk investigation (Phase 6)

| # | Item | Status 2026-11-04 | Evidence |
| --- | --- | --- | --- |
| 1 | Apple Pay Add Money failures | **Unresolved (owner decision)** | 1 failure in 30 days: `apple_pay/incorrect_zip` (Radar `block_if_wrong_zip`, see 10-21 audit). 0 deposits in 30 days |
| 2 | Express login link / payout method | Not re-verified | needs a hosted-onboarded test account; none reachable with the repo's test keys |
| 3 | Instant payout failures | Not reproducible | 0 instant withdrawals in 60 days; live flag not readable without prod env access |
| 4 | False-completed payouts | **Resolved going forward**; 7 legacy rows open (F-7) | 0 completed-without-payout since 08-15; 25 pre-08-15 `ledger_only` grandfathered ($526.65) |
| 5 | $275 / 13-transaction issue | Resolved 2026-08-16 | no money lost; CHECK constraint prevents recurrence |
| 6 | `apply_deposit` balance inflation | **Resolved** | prod EXECUTE: anon=false, authenticated=false (also `apply_escrow`, `update_balance`); 77/77 deposits match Stripe |
| 7 | `[object Object]` | **Fixed** (F-9) | |
| 8 | Connect onboarding at acceptance | Working as designed | 16 accepted paid bounties (30 days) with hunter lacking a Connect account; v1 still credits, payout waits on onboarding |
| 9 | Webhook delivery / reconciliation gaps | Partly resolved | 0 failures in 14 days; `payout.*` flowing (last 10-30); `transfer.*` never (F-5); test-mode leakage (F-4) |
| 10 | Displayed balance vs Stripe | Internal ledger: 2 drifts (F-10) | live Stripe balances not compared (no live key by design) |

## 5. Security review

- No secret keys or webhook secrets in the client, git history or working tree
  (`git log -S sk_live_` hits were placeholders/redactions only); `.env*` with
  real keys are git-ignored. Note `.env` holds a **live** secret key locally.
- No client-side privileged Stripe calls; no client-trusted payment status — the
  server credits only from signature-verified webhooks or a server-side PI
  retrieve.
- Edge functions log missing env var *names*, never values.
- Signature verification: constant-time compare, multi-secret, replay window,
  fail-closed (probed live on staging, all three negative cases 400).
- New: mode guard (F-4). Remaining: release-during-dispute (above).

## 6. Implementation summary (uncommitted)

| File | Change |
| --- | --- |
| `supabase/functions/_shared/stripe-dispute.ts` | **new** — payer resolution v1/v2/v3, dispute row builder, loss decision (F-2, F-3) |
| `supabase/functions/_shared/platform-fee.ts` | **new** — integer-cents fee split (F-8) |
| `supabase/functions/_shared/webhook-signature.ts` | `eventModeMatchesKey` (F-4) |
| `supabase/functions/webhooks/index.ts` | mode guard; dispute created/closed use the shared module |
| `supabase/functions/wallet/index.ts`, `bounty-payments/index.ts` | shared fee split |
| `lib/constants/fees.ts` | cents arithmetic for the estimate |
| `lib/services/stripe-service.ts` | `parseStripeError` object handling (F-9) |
| `lib/constants/fees.ts`, `_shared/platform-fee.ts`, `web-account/logic.ts`, `services/api/.../completion-release-service.ts` | fee rate 8% everywhere (F-1 decision) |
| `supabase/functions/reconciliation/index.ts` | safe repair stamps `stripe_payout_status='paid'` (F-7 follow-up) |
| `supabase/migrations/20260911000100_withdrawal_settlement_evidence.sql` | corrected ordering/match — **applied to staging + production** |
| `scripts/stripe-dev.mjs` | **new** — test-mode CLI wrapper, local webhook server, reconcile |
| `.vscode/settings.json`, `tasks.json`, `launch.json`, `extensions.json` | extension profile, tasks, debug configs |
| `docs/payments/STRIPE_DEV_WORKFLOW.md` | **new** — setup and daily use |
| Tests (new) | `stripe-dispute.test.ts` (19), `platform-fee-parity.test.ts` (8), `webhook-livemode-guard.test.ts` (9), +2 in `stripe-service.test.ts` |

**Deploy order when approved:** no further migration is required. Deploy `webhooks`,
`wallet`, `bounty-payments`, `reconciliation`, `web-account` to **staging** first; trigger `charge.dispute.created`
against a staging bounty_payments PI and confirm a `bounty_disputes` row with
`payment_intent_id` and `bounty_id`. The client change (`fees.ts`,
`stripe-service.ts`) ships with the next build/OTA. Settle F-1 before shipping
the client, or it will keep quoting 5%.

## 7. Approvals needed from you

1. ~~F-1~~ decided: 8%, no refund. Ship the client build.
2. **F-5:** subscribe the production platform endpoint to `transfer.created` /
   `transfer.reversed`, then repair `bounty_payments e52fb798`.
3. ~~F-7~~ applied 2026-11-04.
4. **F-6:** add Connect + transfer/payout subscriptions to the **staging** test
   endpoints; align staging's `bounty_payments` CHECK.
5. Deploy this change set to staging, then production.
