# Production readiness audit — 2026-10-20

Baseline: `main` @ `19ef4d1a` (PR #936 merge). Production Supabase project `xwlwqzzphmmhghiqvkeu`, staging `gwumwpoomwvkjyibdmpj`.

**Verdict: READY WITH LIMITATIONS for code/OTA; payment reconciliation items below remain open and are not fixed by any deploy.**

## What changed in production (2026-10-20, with owner approval)

### Migrations applied (staging first, then production)

Each file ran in its own transaction (the CONCURRENTLY file statement-by-statement, with index validity checked) and its **git file version** was recorded in `supabase_migrations.schema_migrations`.

| Version | What it does | Precondition checked on prod |
|---|---|---|
| 20260824010400 | settlement_state evidence CHECKs | 0 violating rows |
| 20260902213000 | payment idempotency unique indexes | 0 duplicate live payments / transfer / refund / ledger legs |
| 20260918032000 | contact-info gate at the DB (same rule as `lib/utils/bounty-validation.ts`) | update path re-checks only when title/description change |
| 20261002120000 | assignment + completion-submission guards | — |
| 20261002120100 | 72h review window, trust review queue, cron `completion-review-window` | rollout_at = apply time (no retroactive burst) |
| 20261005010000 | paid bounty can't be completed by a client without release evidence | 1 of 46 historical paid completions lacked evidence (bba5e784, 09-13) |
| 20261019210000 | `search_bounties_nearby(p_include_online)` | old 7-arg PostgREST call verified 200 after apply |
| 20261020140000 | server `signup_completed` queue | `process-analytics-person` v24+ already tolerant (deployed first) |

Staging: a rolled-back dry run of the whole set passed first, and the RLS manifest check passed against that dry-run state. Afterwards `node scripts/check-rls-policies.js --env production` and `--env staging` both print `OK: live policies match the manifest`. The "RLS Policy Check" and "Deploy Supabase Edge Functions" workflows on main had been red on every push since 2026-10-19 20:04 UTC. Both reruns (runs 39368729929 and 39368729926) are green.

### Edge functions

All 38 functions with source in this repo were byte-compared with what is deployed (46 deployed in total; the other 8 are the shadow functions below) (`supabase@2.121.0 functions download --use-api`, then a per-function bundle diff; `process-notification` via the Management API bundle since it imports `lib/`; `bounty-ranking` spot-checked only, for the same reason). The only real drift was `auth` (v50, 2026-09-18, missing the username `_`/`%` ilike escape). It was redeployed from `19ef4d1a` and re-verified as a byte match. `admin-withdrawals`, `bounty-payments` and `wallet` carry an older `_shared/connect-account-operations.ts`. The only difference is two new exports that only `connect` uses, so behavior is the same; they pick up the new copy on their next deploy.

## Pipeline defects fixed in this PR

1. **`_shared` changes never deployed.** The push-path target list dropped everything under `supabase/functions/_*`. Now each changed shared module expands to every function importing it, including transitively through other shared modules.
2. **Failed deploys were never retried.** A push diffed only its own commits, so functions changed in a push whose deploy failed (auth and process-notification on 10-19) never shipped. Now the diff starts at the last successful run's head SHA, falling back to `before`.
3. **The app was never type-checked in CI.** `npm run type-check` covers only the workspaces. A real TS2769 (`editable={boolean|null}` in `instant-cash-out-screen.tsx`) was on main. The fix is in this PR, plus a CI step running `npx tsc --noEmit -p tsconfig.json`.

Regression test: `__tests__/unit/deploy-edge-functions-targets.test.ts` runs the real workflow step against a throwaway repo. It fails 3/5 against the old step and passes 5/5 against the new one.

## Open blockers (not fixed; need a human decision, none move money automatically)

| Severity | Issue | Evidence | Next action |
|---|---|---|---|
| P0 money | 10 v2 `bounty_payments` stuck for 9–41 days: 4 `captured` ($60) on terminal/open bounties incl. 5e96aaed $35 (admin-cancelled), 5 `refund_pending` ($71), 1 `release_pending` ($5, in_progress bounty 59879908) | read-only query 2026-10-20 | Reconcile each against Stripe (PaymentIntent/refund/transfer state) before any repair; repair via a reviewed, reversible migration with dry-run counts |
| P0 money | 2 withdrawals `completed` but `stripe_payout_status='in_transit'` since 09-16/09-17 (ac50b23f $10, e589b243 $18.40); 7 completed withdrawals at `stripe_pending` total | read-only query | Check the two payouts in Stripe. If paid, the `payout.paid` stamping missed them. Until resolved, `20260911000100` **cannot apply** (its CHECK would reject these rows) |
| P1 money | 44 open reconciliation findings incl. 6 `stuck_pending_withdrawal`, 2 `orphan_stripe_payout`, 6 `balance_drift`, 9 `connect_account_balance_drift` | `reconciliation_findings` | Triage; several carry resolution notes but were never marked resolved |
| P1 | 7 `payment_intent.succeeded` events from Feb–Mar 2026 still `pending` in `stripe_events` | read-only query | Confirm they are legacy test events, then mark them handled |
| P1 security | Shadow edge functions with no source in git (workflow-tracker, signed-image-proxy, stripe-setup, stripe-worker, go, marketing-metrics, marketing-brief, bounty-checkout); `bounty-checkout` is public (verify_jwt=false) | `list_edge_functions` | Bring into git or delete. Needs an owner decision |
| P2 | Repo/prod drift: 48 prod ledger rows have no file in git, and several prod function bodies are newer than the repo (e.g. `admin_approve_bounty_cancellation`, `fn_compute_bounty_quality_score`, `fn_reconciliation_finding_key`, `is_username_available`); `hunter_meets_bounty_id_requirement` on prod lacks the repo's `auth.uid()` self-check; `fn_reject_pending_requests_on_bounty_close` on prod lacks the repo's accepted-request exclusion | `fndrift` comparison | Write capture migrations from live `pg_get_functiondef`; review the two repo-newer bodies before re-applying |
| P2 | Not on prod by design or still pending: `20260911000100` (blocked above), `20260913000000`'s `fn_mark_poster_interacted` (useAskApplicant RPC fails silently) | probes | Separate migration for `fn_mark_poster_interacted` |
| P3 | `npm audit`: 4 critical / 110 high, essentially all in build/test tooling (expo CLI, metro, jest, tar, shell-quote) or server-only deps (proxy-addr, protobufjs). None ship in the app bundle | `npm audit --omit=dev` | Schedule a tooling upgrade. Don't `audit fix --force` |
| Infra | `bountyfinder.app` HTTPS (unchanged since 08-18) | earlier audits | Infrastructure |

## Release gates

- Typecheck: workspaces exit 0; app `tsc` exit 0 after the fix. A local `.expo/types/router.d.ts` from 09-14 produces 8 false route errors; delete it or run `expo start` to regenerate it.
- Lint: CI on main is green. Local lint shows 2 errors that CI doesn't, from stale local `node_modules`.
- Jest: 438/440 suites passed (2 skipped), 5,865 tests, exit 0, plus the new suite at 5/5.
- OTA: `npm run update:production:check` reports iOS and Android **compatible** with the latest production builds (2.1.3, commit 50a7ad14). No OTA was published in this audit.
- Not verified: device-level payment flows (Shoal stubs Stripe on web), and the first `analytics_signup_events` row (no signups since the apply). Observe both before claiming done.

## Rollback

- Each migration is additive (functions, triggers, CHECKs, indexes, one table, one cron). Revert = `DROP TRIGGER` / `DROP CONSTRAINT` / `DROP INDEX` for the specific object, plus `select cron.unschedule('completion-review-window')`. The rollback SQL for `20261020140000` is in its header. No data was rewritten.
- `auth`: the source previously live (v50) is byte-identical to `f80ad324^:supabase/functions/auth/index.ts`; redeploy that with `--no-verify-jwt`.
