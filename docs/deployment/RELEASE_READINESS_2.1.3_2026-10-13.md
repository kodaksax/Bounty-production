# Release readiness: 2.1.3 (2026-10-13)

Branch `release/2.1.3-hardening`, 4 commits on top of `main` @ `b2be02ea`. Not pushed.
Production Supabase: `xwlwqzzphmmhghiqvkeu`. Staging: `gwumwpoomwvkjyibdmpj`.

## A. Summary

**Status: blocked until the approval steps in section E are done.** The code is ready and verified. Release needs these steps, in order:

1. Keep 2.1.2 builds iOS 103 and Android 86 out of users' hands. They crash.
2. Apply one migration to staging, then to prod.
3. Merge. The merge deploys `bounty-payments`.
4. Build new native binaries.

**A new native build is required.** OTA is not possible. The shipped 2.1.2 binaries crash. Their fingerprints (`7f5b35be…` iOS, `f468f727…` Android) also no longer match `main`, because PR #907 edited `eas.json`, which is a fingerprint input.

## B. Findings

| # | Sev | Finding | Evidence | Status |
|---|-----|---------|----------|--------|
| 1 | P0 | 2.1.2 binaries crash the tabs screen | Built from `d5b66161`. `FloatingTabBar` passes `speed`/`bounciness`, and the old `createSpring` also added `tension`/`friction`. RN 0.83's `SpringAnimation` throws an `invariant()` on mixed families in release builds as well. PostHog shows 0 users on 2.1.2, so it has not reached anyone yet. | Fixed on `main` (#906/#908). All 45 spring calls on `main` were scanned and none mix families. A new build is needed. |
| 2 | P0 | v2 release pays a client-chosen account | `bounty-payments/index.ts` `/release`: `hunterId = hunterIdInput \|\| bp.hunter_id \|\| accepted_by`. The only payee check is "payouts enabled". A poster could redirect captured escrow, or cash out a stolen-card charge, without anyone being accepted. On prod: 11 `bounty_payments` rows, 4 captured ($60), 0 rows with payee ≠ `accepted_by`. | **Fixed** (`0034d845`). The route now uses the existing `authorizeRelease` rule. Deploys on merge. |
| 3 | P1 | Any user can push a "security" notification to anyone | `send_system_notification` is executable by `authenticated` and does no caller check. On staging, a stranger sent `account_restricted` "Verify at http://evil.example" to another user. | **Migration written, NOT applied** (`20261013120000`). |
| 4 | P2 | Anyone, signed out, can bump any profile's withdrawal counter | `increment_withdrawal_counter` proacl contains `anon=X`. An earlier migration revoked PUBLIC and authenticated, but not anon. | Same migration. |
| 5 | P1 | Hired hunter is told "Another hunter was selected · Nothing is owed" | `resolveHunter` ignored `accepted_by === viewer` (trust re-audit N2). | **Fixed** (`b45a0ef2`). |
| 6 | P1 | Strangers can file completion submissions on any bounty; posters can rewrite any column of the accepted request | Prod policies: `completion_submissions_insert_hunter` = `auth.uid() = hunter_id` only. `Posters can update requests…` has no column limit. | Unchanged. The existing migration `20261002120000` fixes it. It was staging-verified earlier and has never been applied. |
| 7 | P1 | `bountyfinder.app` has no HTTPS | TLS handshake fails (`SEC_E_ILLEGAL_MESSAGE`). `app.json` uses it for `associatedDomains` and 4 `autoVerify` intent filters. | External infrastructure. Open since 2026-08-18. |
| 8 | P1 | Withdrawals marked `completed` before Stripe confirms | 3 September rows ($38.40) are `completed` with `stripe_pending`. There are no withdrawals in October. | Migration `20260911000100` exists and is unapplied. Needs Stripe-side reconciliation. |
| 9 | P2 | 8 live edge functions have no source in git | `bounty-checkout` (public website intake, `verify_jwt=false`), `go`, `marketing-metrics`, `marketing-brief`, `workflow-tracker`, `signed-image-proxy`, `stripe-setup`, `stripe-worker`. `bounty-checkout` accepts caller `successUrl`/`cancelUrl` (an open redirect after checkout) and rate-limits by email only. | Not changed. Check-in recommended. |
| 10 | P2 | Code calls RPCs that prod does not have | `fn_mark_poster_interacted` (best-effort; a message trigger covers the main case), `claim_marketing_attribution` (marketing-attribute returns 500 for attributed installs), `admin_trust_review_queue`/`admin_update_trust_review_item` (migration unapplied), `admin_user_stats`, `increment_user_stat` (both degrade). | Not changed. |
| 11 | P2 | CI never type-checks the root app | `npm run type-check` only runs the `packages/*` and `services/*` workspaces. | Not changed. |
| 12 | P2 | Supabase Auth leaked-password protection is off | Security advisor warning. | Dashboard toggle. |

Checked and found sound:
- Deployed `wallet`, `bounty-payments`, `webhooks`, `connect` and `payments` are byte-identical to `main`.
- Dispute escrow release and refund functions are admin-gated.
- Deposits credit Stripe's own `intent.amount`.
- Website checkout charges the stored amount. 8 checkouts were paid and all 8 created bounties. The 20 `pending_payment` rows were never paid.
- No live listings from suspended posters.
- No v2 bounty is completed with its payment unreleased.
- EAS production env targets the prod Supabase project, and `PAYMENT_ARCHITECTURE_VERSION=1`.
- The public app config contains no secrets.

## C. Code changes

| Commit | Files | Why |
|--------|-------|-----|
| `0034d845` | `supabase/functions/bounty-payments/index.ts`, `__tests__/unit/bounty-payments-edge-function-contract.test.ts` | Finding 2 |
| `b45a0ef2` | `lib/utils/bounty-lifecycle.ts`, `__tests__/unit/utils/bounty-lifecycle.test.ts` | Finding 5 |
| `9fe86731` | `supabase/migrations/20261013120000_system_notification_caller_guard.sql`, `scripts/verify-system-notification-guard.js`, `supabase/security/rls-manifest.json` | Findings 3 and 4 |
| `306ef469` | `app.json` (2.1.2 → 2.1.3) | Finding 1 |

No dependency changes. Regression tests:
- New release-payee contract test: fails before the fix, passes after.
- New hired-hunter resolver test: fails before the fix, passes after.
- `verify-system-notification-guard.js`: 19/19 with the migration, 8/18 with `--baseline`.

## D. Verification

| Command | Result |
|---------|--------|
| `npx jest --ci` (before / after) | 396 suites both times. 5,303 → 5,305 tests pass, 0 fail. |
| `npx tsc --noEmit -p tsconfig.json` | 9 errors both before and after, identical. All 9 are local-environment: a stale `.expo/types/router.d.ts` and a missing local `@expo-google-fonts/inter`. |
| `deno check` + `deno lint` on `bounty-payments` | Pass |
| `npx eslint` on changed app files | Clean. Full local lint shows 3 errors from stale local `node_modules`; CI lint on `main` has 0 errors. |
| `npx expo-doctor` | 20/20 |
| `APP_ENV=production npx expo config --type public` | Version 2.1.3, fingerprint runtime policy, correct bundle IDs, no secret-shaped values |
| `npm run update:production:check` | BLOCKED on both platforms (fingerprint mismatch). `eas fingerprint:compare` shows only `eas.json` differs. |
| `node scripts/verify-system-notification-guard.js --insecure-tls` | 19/19, rolled back. Afterwards staging had 0 fixture rows and unchanged grants. |
| `node scripts/check-rls-policies.js --env staging` / `--env production` | 1 expected error each (anon counter grant). It clears once the migration is applied. |

Not run:
- Native builds (these cost money and need approval).
- Device smoke tests.
- Shoal swarm.
- A full-repo lint on a fresh install (CI will run it).

## E. Release steps (each needs your go)

0. **App Store Connect / Play Console.** If 2.1.2 (103 / 86) is in review or pending release, withdraw or reject it. Do not release it.
1. **Staging.** Apply `20261013120000` with a `schema_migrations` row under the file's version. Then run:
   - `node scripts/check-rls-policies.js --env staging` (expect pass)
   - `node scripts/verify-system-notification-guard.js --insecure-tls`
2. **Open the PR** from `release/2.1.3-hardening`. Wait for CI to be green.
3. **Prod.** Apply `20261013120000`. Then:
   - `node scripts/check-rls-policies.js --env production` (expect pass)
   - Confirm `has_function_privilege('anon','public.increment_withdrawal_counter(uuid,timestamptz)','EXECUTE')` is false.
4. **Merge.** The push-triggered "Deploy Supabase Edge Functions" run redeploys `bounty-payments`. Confirm the deployed source contains `authorizeRelease(` and matches git.
   - Do not merge before step 3. If you do, the prod RLS check fails and blocks the edge deploy.
5. **Build** from the merged `main` with a clean tree: `eas build --profile production --platform all`.
6. **Submit:** `eas submit --profile production --platform ios --latest`, then the same with `--platform android`. Use iOS phased release and a Play staged rollout at 20%.
7. **Smoke-test on both platforms:**
   - Cold start, then sign in, then the tabs screen with Reduce Motion both off and on.
   - Post a bounty, apply as a second account, accept.
   - Confirm the hunter sees the "in progress" state, not "Another hunter was selected".
   - Submit work and approve it.
   - For a v2 test bounty in Stripe test mode, release goes to `accepted_by`.
   - Open a dispute and confirm the other party gets the push.
8. **Afterwards:** `npm run update:production:check` should pass against the new builds, which re-enables OTA.

**Rollback:**
- Edge function: redeploy `bounty-payments` from `b2be02ea`.
- Migration: the header of `20261013120000` gives the rollback steps.
- Binaries: halt the phased or staged rollout. Users stay on 2.1.1.
- OTA cannot roll back native code.

## F. Remaining blockers and accepted risks

- **Decision needed:** what state 2.1.2 is in on each store.
- **Approval needed:**
  - Steps 1–6 above.
  - Unapplied migrations, in suggested order: `20261002120000` (finding 6), `20260911000100` (finding 8), `20261005010000`, `20261002120100`, and PR #909's `20261012120000` + `20261012120100`.
- **External:** HTTPS on `bountyfinder.app`. Google Maps keys are not in the EAS production env, so Android hides maps and iOS uses Apple Maps. That is a degraded experience but not a crash.
- **Accepted for this release:** findings 9–12.

## G. Next actions

1. Withdraw 2.1.2 from the stores if it is queued.
2. Apply `20261013120000` to staging and then prod, then merge (deploys the P0 payment fix).
3. Build and submit 2.1.3 with a staged rollout.
4. Apply `20261002120000` (stranger submissions).
5. Reconcile the 3 `stripe_pending` withdrawals against Stripe, then apply `20260911000100`.
6. Fix HTTPS on `bountyfinder.app`.
7. Check the shadow edge functions into git, starting with `bounty-checkout`, and drop its caller-supplied redirect URLs.
8. Add a root `tsc` step to CI.
