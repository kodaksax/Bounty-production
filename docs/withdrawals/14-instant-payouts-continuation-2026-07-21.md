# Instant Payouts — Continuation Session, Express Compatibility Audit, and Live Verification

> Written 2026-07-21. Picks up where [13-instant-cash-out.md](13-instant-cash-out.md) left off. Between that doc and this session, three more commits (`1fbf24ea`, `3a08b585`, `6defe3f8`) already landed the bulk of what this session was asked to build — this doc audits, deploys, and live-verifies that work rather than reimplementing it, and fixes one real bug found along the way.

## What this session actually did

The task asked for five things: unify payment/payout methods, fix "Manage Payout Methods" 404, validate the Instant Payout flow end-to-end, polish the UX, and produce a Stripe Express compatibility audit. All five were mostly already done by the time this session started (commits `1fbf24ea`/`3a08b585`/`6defe3f8`, all merged to `main` earlier the same day). This session's actual contribution:

1. **Root-caused and confirmed the fix for the "Not Found" bug is real and live** — it wasn't a routing 404, it was Stripe rejecting every write. See below.
2. **Found and fixed one real bug**: `add-bank-account-modal.tsx` told users a linked bank "can be used for both deposits and withdrawals" and is "reusable for deposits and payouts" — false as of the `1fbf24ea` fix, which made that exact reuse impossible via API. Corrected the copy.
3. **Closed a deploy-drift gap**: the deployed `connect` function (v37) was missing 2 lines present in git (`requirementsCurrentlyDue`/`disabledReason` in the `/verify-onboarding` response) — deployed v38, confirmed byte-identical to git.
4. **Ran the live Stripe test-mode integration suite** (`__tests__/integration/stripe/express-account-permissions.test.ts`) against the test fixture account (`acct_1TvYr7QupCkQqUm0`, [[reference_stripe_test_fixture_account]]) — all 9 tests pass, empirically reconfirming the Express restriction this whole feature is built around.
5. **Discovered a real gap in "validated end-to-end"**: no debit card has ever actually been linked to the test fixture account, so the "instant payout succeeds against a linked card" test has always silently skipped, not passed meaningfully. The actual instant-payout Stripe call has never been exercised. See "What's still not verified" below.
6. **Confirmed via Stripe documentation** (not just empirical testing) that the restriction is by design, not a bug on Stripe's end — see citations below.

Full test suite: 184 suites / 2597 tests, all green, before and after this session's one code change.

## Question 1 — Why "Manage Payout Methods" 404'd, and confirmation it's actually fixed

It was never a client-side routing dead end (`PayoutMethodsScreen` renders inline via local state in `withdraw-with-bank-screen.tsx`, no router path to 404 on). It was a **Stripe API permission error masquerading as a generic failure**: this app's Connect accounts are Express accounts with `controller.requirement_collection: "stripe"`, and the old implementation called `stripe.accounts.createExternalAccount` / `updateExternalAccount` / `deleteExternalAccount` directly from the platform to add/remove/default bank accounts and debit cards. Once an account completes onboarding, Stripe rejects all three of those calls unconditionally with a `403 StripePermissionError` — this app was surfacing that as a generic error, which read as "Not Found" to users.

**The fix** (already landed, this session verified it's live in production): every add/remove/default-account action now goes through `POST /connect/login-link`, which calls `stripe.accounts.createLoginLink(accountId)` and opens Stripe's own hosted Express Dashboard in the browser. The old direct-write endpoints are deprecated (return `410` with a `migrate_to` hint). Deployed `connect` version 38 is byte-identical to git as of this session, and includes the `/login-link` route.

## Question 2 — Unifying payment methods and payout methods

**Not possible via API, by Stripe's design — confirmed both empirically and in Stripe's own docs.**

- Empirical: `__tests__/integration/stripe/express-account-permissions.test.ts`, run live this session against a real onboarded test-mode Express account, shows `createExternalAccount` succeeds *before* onboarding and fails with `403 oauth_not_supported` *after* — i.e. for every account this app's withdrawal/payout screens can ever reach (they all require `payouts_enabled`, which requires onboarding).
- Documented: Stripe's own docs state plainly — *"For Express Connect accounts, you cannot add or delete External Bank accounts via API... Express accounts have `requirement_collection` set to `stripe`, so users must manage their bank accounts through their own dashboard."* (docs.stripe.com/connect/payouts-bank-accounts and Stripe's developer support channels, retrieved this session.)

There's a second, independent reason auto-reuse isn't possible even setting the above aside: a card added for **deposits** (Add Money) is a `PaymentMethod` attached to a Stripe **Customer** object. A card added for **payouts** (Instant Cash Out) is an `external_account` on the **Connect account**. These are different Stripe resource types with no API bridge between them for any account type, Express included — Stripe's own support guidance confirms saved Customer payment methods can't be cloned onto a different account's external-account list without the customer/account explicitly re-entering it (the one documented exception, cross-Connect-account charge cloning, is for a platform sharing a payment method across multiple *connected accounts' Customers*, not converting a payment method into a payout destination).

**What's implemented instead — the closest supported UX**: Manage Payout Methods opens Stripe's own Express Dashboard, which is Stripe-owned UI. If a user has already linked a bank via Financial Connections for deposits, Stripe's own hosted dashboard *may* offer faster re-entry (Link, autofill) — but that's Stripe's UX decision at the dashboard layer, not something this app can control, guarantee, or bypass. This app cannot and must not attempt to auto-populate or duplicate the card/bank data locally to fake reuse — that would mean handling raw account/card numbers server-side, which breaks PCI scope and is exactly what Financial Connections/Stripe Elements exist to avoid.

**Bug found and fixed this session**: `add-bank-account-modal.tsx` (used only in the deposit-side Payment Methods flow) previously said *"The same linked bank can be used for both deposits and withdrawals"* and *"Reusable for deposits and payouts. Link once, use forever."* — directly contradicted by the accurate code comment two lines above it, and factually wrong per the above. Copy corrected to state it's for deposits only and point users to Manage Payout Methods, noting Stripe's dashboard may let them reuse the same bank there (no promise of automatic linking).

## Question 3 — End-to-end validation of the Instant Payout flow

**Verified:**
- Eligibility gating logic (account → onboarded → charges enabled → payouts enabled → instant-eligible card → `instant_available` balance > 0) — code-reviewed, matches Stripe's documented instant-payout requirements, unit-tested (`instant-payout-validation.test.ts`).
- The `instant_available` vs. plain `available` balance distinction is correctly implemented (the exact wrong-field bug the code comments call out as a common mistake) — confirmed by reading `connect/index.ts:1652-1655`.
- Card-type eligibility (`available_payout_methods` includes `'instant'`) — confirmed live: a credit card on the fixture account correctly does **not** report instant-eligible.
- Daily instant-payout limit (10/day) and per-payout ceiling ($9,999, tighter than the $10,000 standard max) — code-reviewed, unit-tested.
- Zero-instant-balance block — confirmed live against the Stripe test API this session (test passed on the actual code path, not just a mock).
- Webhook reconciliation (`payout.paid`/`failed`/`canceled`/`created`, `stripe_payout_id` matching, `reconcileInstantPayoutFee`) — confirmed present and byte-identical between deployed `webhooks` (v40) and git.
- Standard-payout non-regression: `default_for_currency` is never touched by any instant-payout code path (asserted by a source-scanning Jest contract test), and standard withdrawals remain a fully separate code path (`/transfer`, untouched by this work).
- Migration applied live: `wallet_transactions.payout_method` / `stripe_payout_id` / `instant_fee_amount` all exist in production (confirmed via direct SQL query this session).

**Not verified — and this is the one real gap left**: an actual `stripe.payouts.create({ method: 'instant' })` call against a linked debit card has never been exercised, live or in test mode, by any session including this one. The reason: creating that state requires linking a debit card to the test fixture account through Stripe's *hosted* Express Dashboard, which is a human-driven browser flow (Stripe explicitly disallows automating it, in test mode or live — confirmed in the test file's own setup comments). This session generated a fresh test-mode login link for the fixture account (`https://connect.stripe.com/express/acct_1TvYr7QupCkQqUm0/...`, single-use, already consumed by generation) but could not complete the browser-based card entry itself.

**Recommended next step, ~2 minutes of human time**: open a fresh login link for `acct_1TvYr7QupCkQqUm0`, add test card `4000056655665556` (Visa debit, instant-eligible) via "Payout details," then re-run:
```
RUN_STRIPE_INTEGRATION_TESTS=true STRIPE_SECRET_TEST_KEY=sk_test_... STRIPE_TEST_FIXTURE_ACCOUNT_ID=acct_1TvYr7QupCkQqUm0 npx jest __tests__/integration/stripe/express-account-permissions.test.ts
```
The "instant payout succeeds against the linked instant-eligible debit card" test will then exercise the real code path instead of silently skipping (`if (!instantCard) return;` — it reports as a pass either way, so a green checkmark alone doesn't prove this happened; check the test output doesn't take the skip branch, or temporarily change the guard to a hard failure for one run).

## Question 4 — UX

- Light/dark theme: all touched/reviewed components (`payout-methods-screen.tsx`, `withdraw-with-bank-screen.tsx`, `instant-cash-out-screen.tsx`, `withdraw-method-select.tsx`) consume `useAppThemeContext()` / theme tokens throughout — no hardcoded colors found outside of intentional brand accents (green "instant" badge, standard error red).
- No dead ends: Instant and Standard are both always-visible, real choices (per `withdraw-method-select.tsx`'s own docstring, this replaced an earlier design where Instant silently disappeared when ineligible).
- Duplicate-request prevention: `isOpeningDashboard` / `isLoading` guards on the dashboard-open and submit actions.
- Stripe errors surfaced user-friendly: `withdrawal-result-screen.tsx` maps known error codes (`no_bank_account`, `no_debit_card`, `payouts_disabled`, `bank_account_not_default`, etc.) to plain-language copy and a direct "Manage Payout Methods" action instead of a generic "Try Again."
- Session expiry: `openPayoutDashboard()` requests a **fresh** single-use login link on every tap rather than caching one — login links are single-use and short-lived by Stripe design, so this is the correct pattern (no explicit "expired, regenerate" UI is needed because a stale link is never reused in the first place).

## Stripe Express compatibility audit summary

| Capability | Express support | This app's implementation |
|---|---|---|
| Add/remove/default a payout bank account (post-onboarding) | **Not supported via API** — `403` unconditionally | Stripe-hosted Express Dashboard via login link |
| Add/remove a payout debit card (post-onboarding) | **Not supported via API** — same restriction, applies to cards too | Stripe-hosted Express Dashboard via login link |
| Add/remove *before* onboarding completes | Supported via API | Not used — the app never has a code path that reaches an unonboarded account for payout-method writes |
| Instant payout to a debit card | Supported, standard Connect feature | Implemented (`POST /connect/instant-payout`), flag-gated |
| Instant payout to a bank account (ACH) | **Not supported** — Stripe has no instant-speed ACH product | Correctly not attempted; bank accounts stay standard-only |
| Auto-reusing a Customer PaymentMethod as a Connect external account | **Not supported** — different resource types, no bridge API | Not attempted; would require re-implementing raw card/bank number handling server-side, breaking PCI scope |
| Detecting/pre-filling a payout destination that matches an existing deposit method | Not directly controllable by the platform | Left to Stripe's own Express Dashboard UX (Link autofill, if the user is enrolled) — correctly not faked client-side |

**No architectural changes are recommended.** The current design (Stripe Express Dashboard as the single source of truth for all external-account writes, app-side as read-only display + login-link launcher) is the intended integration pattern for Express accounts once `requirement_collection` has transferred to Stripe — moving to Custom accounts would restore full API control but would also make this app legally/operationally responsible for KYC data collection and support, which is a materially larger undertaking than a payout-UX polish pass.

## Deploy state as of this session

| Component | State |
|---|---|
| `connect` edge function | v38, deployed this session, byte-identical to git |
| `webhooks` edge function | v40, instant-payout-related code confirmed byte-identical to git. **Unrelated drift found and left untouched**: deployed version is missing several Phase-2 bounty-escrow webhook handlers (`payment_intent.canceled`, escrow refund/transfer handling) present in git — out of scope for this task, flagged for a separate session. |
| `wallet_transactions` migration (`payout_method`/`stripe_payout_id`/`instant_fee_amount`) | Applied live, confirmed via direct query |
| `INSTANT_CASHOUT_ENABLED` flag | **Could not be checked** — no tool in this session's toolset reads Supabase project secrets. Per [13-instant-cash-out.md](13-instant-cash-out.md) it defaults to `false`; confirm/set directly in the Supabase dashboard before relying on the feature being live. |
| `add-bank-account-modal.tsx` copy fix | Committed to working tree, **not yet committed to git** — left for the user to review/commit alongside anything else from this session. |

## Recommendations, in priority order

1. Link a real test debit card to the fixture account and re-run the integration suite to get a genuine (non-skipped) pass on live instant-payout creation — the one remaining unverified path.
2. Confirm `INSTANT_CASHOUT_ENABLED` in the Supabase dashboard before assuming the feature is reachable in production.
3. Decide whether to also deploy the unrelated `webhooks` Phase-2 bounty-escrow drift — separate concern, flagged here only because it was surfaced by this session's diff.
4. Review and commit the `add-bank-account-modal.tsx` copy fix.
