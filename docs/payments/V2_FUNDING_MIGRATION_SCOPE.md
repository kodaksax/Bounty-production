# v2 Funding Migration — Scope & Trigger

**Status:** Scope only. Nothing in this document is built or deployed.
**Date:** 2026-08-01
**Companion to:** `CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md` (payout/withdrawal side, fully spec'd
already), `RECONCILIATION_AND_LEGACY_RETIREMENT.md` (reconciliation + Stage A–C retirement)

This document does not re-derive what those two already cover in detail — it only adds the
pieces specific to *funding* (not payout) that neither one scopes, and defines when this
migration stops being optional.

---

## 0. Why this exists

The current P0 for the funded-post-rate problem is a v1 wallet top-up (see project decision
2026-08-01): cheap, ships fast, proves whether posters will fund at all before any larger
architecture change. v1 fails **before** a hunter starts work — a poster who can't fund never
publishes. That is an acceptable, honest failure mode for a first test.

v2 (charge-at-post via PaymentIntent, already built, `bounty-payments` edge function v8,
never enabled) is very likely the right end state — it removes the "wallet must already hold
a balance" requirement entirely, which is the harder half of the funding problem. But v2 has
a failure mode v1 doesn't: it can fail **after** a hunter has completed the work, at release,
if the hunter isn't Stripe Connect payout-ready (`stripe_connect_payouts_enabled = true`).
Live count today: **1 of 116 profiles.** Flipping v2 on for funding without also closing that
gap trades a pre-work failure for a post-work failure — worse for trust, not better.

This document scopes what has to be true before v2 funding can go live, and defines the
metric threshold at which it stops being a "nice to have someday" and becomes the next P0
automatically.

---

## 1. Scope item: in-flow card linking (funding side — new, not covered elsewhere)

Neither companion doc scopes this because both are written from the payout side. The funding
side has the identical structural gap v1 has.

**Current state:** [`CreateBounty/index.tsx:155`](../../app/screens/CreateBounty/index.tsx#L155)
reads `paymentMethods[0]?.id` and throws `'No payment method available. Please add a payment
method first.'` if empty. There is no UI in the create flow to add a card — same shape of gap
as the v1 wallet-balance problem this week's P0 fixes, just for a different resource (a saved
card instead of a wallet balance).

**Required build:**
- A card-link step inside `StepCompensation` (or a new step) that opens `PaymentMethodsModal`
  when `paymentMethods.length === 0`, mirroring the pattern the v1 top-up P0 is establishing.
- No wallet balance check at all under v2 — the gate is "does a payment method exist," not
  "is there enough balance." Simpler than v1 in that respect.
- Confirmation UX: the amount charged must be shown before the card is charged (Stripe requires
  this contextually; also a trust requirement — charging a card silently at Publish is a much
  bigger surprise than debiting an existing balance).

**Files in scope:** `app/screens/CreateBounty/index.tsx`, `app/screens/CreateBounty/StepCompensation.tsx`,
`app/screens/CreateBounty/StepReview.tsx` (add a "you'll be charged $X now" line), `components/payment-methods-modal.tsx` (reuse, no changes expected).

---

## 2. Scope item: hunter Connect gating (new — prevents the post-work failure)

Existing docs check `payouts_enabled` **at release time** (`bounty-payments/index.ts`
`/release` route already returns `hunter_not_onboarded` / `hunter_payouts_disabled` if not
ready — this is correct and already built). What's missing is a check **earlier**, so the
failure surfaces before work starts, not after it's done.

**Required build:**
- At the point a hunter accepts a bounty request (`hooks/useAcceptRequest.ts`, backed by
  `bounty-request-service.ts` `acceptRequest`), for **v2 bounties only** (`bounty.payment_architecture_version === 2`), check the hunter's `stripe_connect_payouts_enabled`.
- If not ready: block the accept with a clear message and a direct link into Connect
  onboarding, not a generic error. The hunter should never reach "I did the work" before
  learning they need to onboard.
- v1 bounties are unaffected — this check only applies where `isPhase2Bounty()` is true, matching the existing per-bounty routing convention (`lib/utils/payment-architecture.ts`).
- Decide whether to also *nudge* Connect onboarding earlier — e.g. at signup or at first
  "browse bounties" — so the gate at accept-time is rarely the first time a hunter hears about
  it. Not required for correctness, but avoids a first-time hunter losing a bounty they wanted
  to accept and had no path to fix before.

**Files in scope:** `hooks/useAcceptRequest.ts`, `lib/services/bounty-request-service.ts`,
whatever screen renders the accept action (bounty detail / applicant flow).

---

## 3. Scope item: withdrawal rewrite — already fully spec'd, referenced not repeated

`CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md` §5 (Phases 2–6) is the complete spec for this: new
`GET /connect/balance` endpoint, `useConnectBalance()` hook, wallet UI switched off
`profiles.balance`, `/instant-payout` rewritten to gate on Connect `instant_available` instead
of the ledger, new `/connect/payout` standard-payout route, transaction history reconciled
against Stripe. Nothing to add here — v2 funding cannot go live before this ships, because a
hunter paid via v2 with the old withdrawal UI would see `$0` for real money sitting in their
Connect account (documented there as risk R2, "High").

**Sequencing dependency:** this migration's steps 1–5 (Phase 2–5, flag-gated, additive) must
be deployed and verified in Stripe test mode *before* step 8 (`PAYMENT_ARCHITECTURE_VERSION=2`
for new bounties) in that doc's own migration table (§6). That ordering already accounts for
the funding side — it does not need to change for this document's additions, it just also now
needs items 1–2 above completed first.

---

## 4. Scope item: legacy v1 release path for in-flight bounties — already correct, verified

Both companion docs already establish and this repo's code already implements the invariant
that matters here: release/cancel/refund routing reads **each bounty's own**
`payment_architecture_version` via `isPhase2Bounty()`
(`lib/utils/payment-architecture.ts`), never the global funding flag. Confirmed by reading
`lib/utils/payment-architecture.ts` directly — the comment there is explicit that this must
never change:

> "release/cancel/refund routing for an existing bounty must always read its own
> `payment_architecture_version` (via `isPhase2Bounty`) rather than this flag, since the
> flag's value can change after the bounty was created."

**Consequence for this migration:** flipping `PAYMENT_ARCHITECTURE_VERSION` (either direction)
is safe with respect to in-flight bounties by construction — no migration/backfill work is
needed for this specific concern. The only thing to verify before go-live is that this
invariant is covered by a test (it does not appear to be, based on the test files found for
this area) — add one: create a v2 bounty, flip the global flag back to 1, confirm the
existing bounty still releases via the v2 path.

**Files in scope:** a new test in `__tests__/unit/services/` (or alongside
`completion-approval.test.ts` / `approve-and-release.test.ts`, which already exist) asserting
routing-by-row survives a global flag flip.

---

## 5. Proposed automatic migration trigger

The two metrics that matter for "is v2 worth the hunter-gating work yet":

| Metric | What it tells you | Source |
|---|---|---|
| **Funded posts per week** | Whether posters are actually funding at all — the thing v1-top-up P0 exists to test. If this stays near zero even after top-up ships, the bottleneck isn't the payment architecture and v2 wouldn't help. | `bounties` table, `count(*) where not is_for_honor and amount > 0 and created_at > now() - interval '7 days'`, segmented to exclude the flagged seed/test accounts (`$internal_or_test_user` cohort). |
| **Platform balance in flight** | Whether v1's custodial-wallet model is starting to hold enough real money that its absence of Connect-native protections (no reconciliation against Stripe balance, `profiles.balance` documented as deliberately *not* reconciled) becomes a real risk rather than a theoretical one. | `sum(profiles.balance)` live. |

**Proposed thresholds — v2 becomes the next P0 when *either* holds for 2 consecutive weeks:**

- Funded posts/week ≥ **15** (organic, non-seed) — evidence posters will fund once given a
  working path, meaning the friction v2 removes (no pre-funding required) is now worth the
  hunter-gating build cost.
- Platform balance ≥ **$500** — the point at which an un-reconciled custodial ledger holding
  real money stops being a rounding error and starts being an operational risk worth retiring
  on its own merits, independent of the funding-rate question.

**Current baseline (2026-08-01, for reference):** funded posts/week ≈ 0 (organic; all real
paid activity is seed/founder accounts), platform balance = $5.70. Both thresholds are
nowhere close — which is exactly why v1-top-up ships first as the cheap test, not v2.

**What "becomes P0" means in practice:** re-run this document's four scope items as an
implementation plan, in the order in §3's sequencing dependency (withdrawal rewrite lands
first, funding-side items 1–2 land alongside `PAYMENT_ARCHITECTURE_VERSION=2` going live).

---

## 6. What this migration does *not* have to solve

To keep scope honest: this document is funding-side only. It does not repeat or change
anything in `RECONCILIATION_AND_LEGACY_RETIREMENT.md` §4 (Stage A freeze / Stage B migration
report / Stage C deletion) — those stay gated on their own preconditions (notably the
`hunter` $5.70 no-Connect-account blocker in that doc's §3.3) regardless of when funding-side
v2 goes live. Legacy retirement and funding-side migration are sequenced independently; the
only hard dependency is the one already stated in §3.
