# Stripe Connect Native Payout Architecture

**Status:** Implemented — flag-gated, not enabled in production
**Author:** Engineering
**Date:** 2026-07-26
**Supersedes payout portions of:** `WITHDRAWAL_SYSTEM_RUNBOOK.md`, `BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md`

---

## 1. Executive summary

Bounty has two incompatible wallet models. The legacy (v1) model treats `profiles.balance`
as the wallet: money lands in a platform-custodied ledger and is pushed to a hunter's
Stripe Connect account only at withdrawal time. The Phase 2 (v2) model, already built and
deployed but never enabled, moves money at *release* time directly into the hunter's
Connect account via `Transfer(source_transaction)`.

**The gap:** every withdrawal component still assumes v1. Under v2 a hunter's money is
real and sits in Stripe, but the app shows `$0`, Instant Cash Out refuses to spend it,
Withdraw refuses to spend it, and the only way it reaches a bank is Stripe's default
automatic payout schedule — which the app never configured, cannot see, and cannot
accelerate.

**The fix:** make the Connect account the authoritative source of withdrawable funds, and
reduce `profiles.balance` to a legacy drain-down ledger. This document covers the audit,
target architecture, the Stripe constraints that force specific design choices, the
migration plan, risks, and rollback.

### Live production state (verified 2026-07-26)

| Fact | Value |
|---|---|
| Bounties on v2 | **0** (all 87 are v1) |
| Rows in `bounty_payments` | **0** |
| Users with `profiles.balance > 0` | **2**, totalling **$6.65** |
| Total `balance_on_hold` | **$0.00** |
| Users with a Connect account | 5 |
| Users with `payouts_enabled` | 1 |
| `EXPO_PUBLIC_PAYMENT_ARCHITECTURE_VERSION` in prod build | **unset → defaults to `'1'`** |

The v2 pipeline is fully deployed and fully dormant. This is the ideal moment to fix the
architecture: there is no v2 money in flight to migrate, and only $6.65 of legacy balance.

---

## 2. Phase 1 — Audit: everything that depends on `profiles.balance`

### 2.1 Server: edge function endpoints

| Endpoint | File | Reads | Mutates | Why |
|---|---|---|---|---|
| `GET /wallet/balance` | `supabase/functions/wallet/index.ts:164-213` | `profiles.balance`, `balance_on_hold`, `payout_failed_at` | — | Sole balance source for the whole client. Explicitly documents `profiles.balance` as "sole source of truth"; deliberately does **not** reconcile against Stripe (a prior reconciliation attempt was removed 2026-07-18 because it resurrected drained balances). |
| `POST /wallet/deposit` | `wallet/index.ts:84-161` | — | `+balance` via `rpc('apply_deposit')` | Poster tops up custodial wallet. Idempotent on `stripe_payment_intent_id`. |
| `POST /wallet/escrow` | `wallet/index.ts:254-344` | `balance` | `-balance` via `rpc('apply_escrow')` | Poster funds a bounty from wallet. Raises `23514` on insufficient funds. |
| `POST /wallet/refund` | `wallet/index.ts:348-551` | — | `+balance` via `rpc('apply_refund_tx')` | Bounty cancelled → poster refunded. Has crash-recovery path for orphaned `pending` rows. |
| `POST /wallet/release` | `wallet/index.ts:554-888` | — | `+balance` (hunter) via `rpc('apply_release_tx')` | **The v1 earnings credit.** This is what v2 replaces with a Stripe Transfer. |
| `POST /connect/transfer` | `supabase/functions/connect/index.ts:835-1259` | `balance`, `balance_on_hold` | `-balance` via `rpc('withdraw_balance')`; refunds via `rpc('update_balance')` on Stripe failure | Withdrawal: debits ledger, then `stripe.transfers.create()` platform→Connect. Does **not** create a payout — relies on Stripe's automatic schedule to reach the bank. |
| `POST /connect/retry-transfer` | `connect/index.ts:1262+` | same | same | Retry of a failed withdrawal. |
| `POST /connect/instant-payout` | `connect/index.ts:1470-1900` | `balance`, `balance_on_hold` (`:1560-1564`) | `-balance` via `rpc('withdraw_balance')` (`:1752`) | **The core defect.** Hard-gates on `(balance - on_hold) < amount` → `insufficient_balance` (`:1739-1750`), then performs its *own* platform→Connect `stripe.transfers.create()` (`:1769-1793`) before `stripe.payouts.create()` (`:1835-1853`). It cannot spend a pre-existing Connect balance. |
| `POST /connect/verify-onboarding` | `connect/index.ts:766-831` | — | — | ✅ Balance-agnostic. Reads only Connect account state. No change needed. |

**Reconciliation (read-only, no mutation):** `compareConnectAccountBalance()` in
`webhooks/index.ts:1034` and `admin-withdrawals/index.ts:317`; `comparePlatformBalance()`
in `webhooks/index.ts:927` and `admin-withdrawals/index.ts:232`. These already call
`stripe.balance.retrieve({stripeAccount})` — proof the plumbing works; it just was never
surfaced to users.

### 2.2 Client: hooks, providers, services

| Location | Reads | Mutates | Why |
|---|---|---|---|
| `lib/wallet-context.tsx:112-126` | `balance` state + `balanceRef` mirror | — | The client's single balance store. |
| `lib/wallet-context.tsx:172-364` `refreshFromApi()` | `GET /wallet/balance` | sets `balance` | Authoritative client fetch. **Contains an optimistic-deposit guard (`:227-246`) that deliberately keeps a *higher local* value over the server's** for up to 5 minutes — a legacy-model artifact that directly violates "no cached balance may overwrite the live Stripe balance." |
| `lib/wallet-context.tsx:128-142` `persist()` | — | writes `SecureKeys.WALLET_BALANCE` | Offline cache. |
| `lib/wallet-context.tsx:376-406` `refresh()` | SecureStore | sets `balance` | Cold-start cache read, no network. |
| `lib/wallet-context.tsx:585-610` `deposit()` | — | optimistic `+amount` + timestamp | Survives cold restart via `WALLET_LAST_DEPOSIT_TS`. |
| `lib/wallet-context.tsx:612-637` `withdraw()` | — | optimistic `-amount` | Clamped ≥ 0 inside the updater. |
| `lib/wallet-context.tsx:662-763` `createEscrow()` | — | sets from server `newBalance` | Also handles `409 duplicate_transaction`. |
| `lib/wallet-context.tsx:767-1002` `releaseFunds()` | — | sets from `posterBalance` | Then reconciles via `refreshFromApi()`. |
| `lib/wallet-context.tsx:1005-1104` `refundEscrow()` | — | optimistic `+refundAmount` | Then `refreshFromApi()`. |
| `lib/wallet-context.tsx:1113-1119` `setBalanceAndPersist()` | — | direct external setter | Exposed as `setBalance` — an unrestricted write path into the displayed balance. |
| `lib/wallet-context.tsx:436-498` auth listener | — | wipes to `0` on `SIGNED_OUT` | Correct; keep. |
| `lib/wallet-context.tsx:545-566` Realtime | — | triggers `refreshFromApi` | Subscribes to `postgres_changes` on `profiles`. **Under v2 this fires never**, because Stripe Transfers don't touch `profiles`. |
| `hooks/use-payout-methods.tsx:70` | `availableBalance` from `GET /connect/bank-accounts` | — | Server-computed `balance - holds`. |
| `hooks/use-payout-methods.tsx:48-61,82,114` | `instantAvailableCents` | — | Already reads the *real* Connect `instant_available` — but documented as display-only, explicitly **not** an eligibility gate. |
| `hooks/use-wallet-deposit.ts:28-74` | — | `POST /wallet/deposit` then `refreshFromApi()` | Deposit persistence with 3× backoff retry. |
| `hooks/use-connect-eligibility.tsx:48-103` | — | — | ✅ Balance-agnostic. Keep as-is. |
| `lib/services/profile-service.ts:143-146` `updateBalance()` | — | `profiles.balance = amount` | Generic unguarded setter. Appears unused by the wallet flow — **candidate for deletion** (see §8). |

### 2.3 Client: screens

| Screen | Line | Behaviour |
|---|---|---|
| `app/tabs/wallet-screen.tsx:252-261` | Primary balance render | `formatCurrency(balance)`, skeleton while loading. |
| `app/tabs/wallet-screen.tsx:201` | Passes `balance` into `WithdrawWithBankScreen` | |
| `components/ui/wallet-balance-button.tsx:30,35` | Header pill | Uses raw `` `$${balance.toFixed(2)}` `` — **bypasses `formatCurrency`**, no thousands separator, hardcoded `$`. |
| `components/instant-cash-out-screen.tsx:88-94,119,272,286-288` | Eligibility + amount | `effectiveAvailable = availableBalance ?? balance`; checklist item `'Sufficient available balance', met: effectiveAvailable > 0`. **Under v2 this reads $0 and the checklist shows unmet while Stripe genuinely holds funds.** |
| `components/withdraw-with-bank-screen.tsx:68,75` | Amount cap/validation | `balance = propBalance ?? walletBalance`. |

### 2.4 Formatting

`lib/utils.ts:8-15` — `formatCurrency(amount, currency = 'USD')` wrapping
`Intl.NumberFormat('en-US', …)`. The only `Intl.NumberFormat` in the repo. Note it
**hardcodes the `en-US` locale**; the requirement to "format using the user's locale"
means this needs to take the device locale, not just the currency.

---

## 3. Critical Stripe constraints (these force design decisions)

Verified against Stripe documentation, 2026-07-26.

### 3.1 Manual payouts are all-or-nothing per account

> "If you set the value of `payouts.schedule.interval` to `manual`, we hold funds in the
> account holder's balance until you specify otherwise."

and, from Stripe support guidance:

> "…it will make all payouts manual and cannot be used in combination with automatic
> payouts. There is no way to have both automatic and manual payouts for specific payments."

Connect accounts are currently created at `connect/index.ts:561-570` and `:680-690` with
**no `settings.payouts.schedule`**, so Stripe's Express default (automatic daily) applies
by omission, not by choice. This is already documented as an unexamined default in
`docs/withdrawals/07-manual-payouts-evaluation.md:14`.

**Consequence:** with automatic daily payouts, an available balance is swept to the bank
within ~1 day. A "Withdraw Now" button would usually find `available ≈ $0`, and the wallet
would display near-zero most of the time — because the money genuinely isn't there, it's
already en route to the bank. For the Connect balance to behave as *the wallet* (a stable
number the user chooses when to draw down), accounts must be set to
`settings.payouts.schedule.interval = 'manual'`.

**Holding-period obligation:** under manual payouts the platform must pay out funds within
2 years (US), 90 days (most other countries). This is an obligation Bounty takes on.

### 3.2 Instant payout mechanics

- `stripe.payouts.create({ amount, currency, method: 'instant', destination: <card_id> }, { stripeAccount })`
- Draws on `instant_available`, which **includes pending card funds** — so instant payouts
  work even before funds settle into `available`.
- US limits: min **$0.50**, max **$9,999**, max **10 instant payouts/day**, 1.5% fee.
- Requires an instant-eligible external account (debit card, or a supported bank).

### 3.3 The `net_available` trap

Stripe flags this twice, in bold:

> "Application fees for Instant Payouts rely on the Balance object's
> `instant_available.net_available` property. Turning on Instant Payouts without using the
> `instant_available.net_available` property could break your API integration."

If we ever monetize instant payouts with an application fee, the spendable figure is
`instant_available[].net_available[].amount`, **not** `instant_available[].amount`. The
existing informational read at `connect/index.ts:1710-1712` already uses `net_available`
correctly — the new service must preserve that.

### 3.4 Payout lifecycle and webhooks

`pending → in_transit → paid | failed | canceled`. Events: `payout.created`,
`payout.updated`, `payout.paid`, `payout.failed`. All four are already handled in
`webhooks/index.ts` (`:1976`, `:2147`, `:2027`, `:2157`), plus `payout.canceled` at `:2166`.
The webhook surface for Phase 5 largely exists already.

---

## 4. Target architecture

```
POSTER PAYS                        PLATFORM                    HUNTER
-----------                        --------                    ------
PaymentIntent(transfer_group) ──▶  platform balance
                                        │
                    on release          │  Transfer(source_transaction)
                                        └──────────────────▶ Connect account balance
                                                                    │
                                                    payouts.create()│ (instant | standard)
                                                                    ▼
                                                              Bank / Debit card
```

Four clean roles:

| Concern | Owner |
|---|---|
| Marketplace events, escrow state, disputes, accounting history | Platform ledger (`bounty_payments`, `wallet_transactions`) |
| **Withdrawable money** | **Stripe Connect account balance — authoritative** |
| Money → bank/card | Stripe Payouts (`payouts.create`) |
| Drift detection between ledger and Stripe | Reconciliation service (§8) |

`profiles.balance` retains exactly one job: **draining down legacy v1 balances**. It is
never credited again once v2 is enabled.

---

## 5. Implementation phases

### Phase 2 — Connect balance service *(additive, no behaviour change)*

New endpoint `GET /connect/balance` in `connect/index.ts` returning the caller's own
Connect balance:

```jsonc
{
  "available":        1250,   // cents, usd
  "pending":           500,
  "instantAvailable":  750,   // net_available — see §3.3
  "currency":         "usd",
  "lastUpdated":      "2026-07-26T18:04:11.000Z",
  "hasConnectAccount": true,
  "payoutsEnabled":    true
}
```

- Auth: caller's JWT → own account only (never accepts an `accountId` parameter).
- Returns `hasConnectAccount: false` with zeros rather than erroring when unonboarded.
- Client hook `useConnectBalance()` mirroring the established shape of
  `use-connect-eligibility.tsx`: `{ available, pending, instantAvailable, currency, lastUpdated, isLoading, isRefreshing, error, refresh }`.

### Phase 3 — Wallet UI

All balance displays consume `useConnectBalance()`. Explicit states: **loading**
(skeleton), **refreshing** (keep last value, subtle indicator), **error** (message +
Retry), **no Connect account** (onboarding CTA rather than `$0`).

Removals: the optimistic-deposit guard (`wallet-context.tsx:227-246`), `setBalanceAndPersist`
as a public setter, and the SecureStore balance cache as a *display* source — permitted
only as a dimmed placeholder while the first live fetch is in flight.

`formatCurrency` extended to take the device locale (`expo-localization`) rather than
hardcoded `en-US`. `wallet-balance-button.tsx` switched off its raw `toFixed(2)`.

Refresh triggers: screen focus, pull-to-refresh, app foreground, and after any
payout/transfer/refund completes. Stripe is authoritative on every one.

### Phase 4 — Rewrite `/instant-payout`

```
  BEFORE                              AFTER
  gate on profiles.balance            gate on Connect instant_available.net_available
  rpc('withdraw_balance')  ─ delete
  transfers.create()       ─ delete
  payouts.create(instant)             payouts.create(instant)
```

The route becomes: verify `payouts_enabled` → resolve instant-eligible destination card →
read `instant_available.net_available` → `payouts.create({method:'instant'})` → record in
`wallet_transactions` for history. **No ledger debit, no platform transfer.** Supports
partial and full payouts, destination selection, and falls back to standard payout when
instant is unavailable (behaviour the current catch block already implements).

### Phase 5 — Standard "Withdraw Now"

New `POST /connect/payout` — `payouts.create({ method: 'standard', destination })` against
`available`. Requires §3.1's `interval: 'manual'` decision to be meaningful.

### Phase 6 — Transaction history

Surface per-payout: status (`initiated → in_transit → paid | failed`), `stripe_payout_id`,
`stripe_transfer_id`, `arrival_date`, and the earnings side (`pending` vs `available`).
Reconciled directly against Stripe rather than inferred from the ledger.

### Phase 7 — Legacy teardown

Per-site disposition of every `profiles.balance` reference from §2 — becomes Connect
balance / stays platform ledger / deleted. Migration report deliverable.

### Phase 8 — Reconciliation

Extend the existing `compareConnectAccountBalance()` machinery to cover
Transfers ↔ Balances ↔ Payouts ↔ ledger ↔ history, writing to `reconciliation_findings`
with alerting on drift.

---

## 6. Migration strategy

**Ordering matters — the payout path must exist before v2 earnings can be created.**

| Step | Action | Reversible? |
|---|---|---|
| 1 | Deploy Phase 2 balance service (additive, unconsumed) | Yes — nothing reads it |
| 2 | Ship Phase 3 UI behind `EXPO_PUBLIC_WALLET_BALANCE_SOURCE=connect\|ledger`, default `ledger` | Yes — flag |
| 3 | Ship Phases 4–5 payout routes behind `CONNECT_NATIVE_PAYOUTS=false` | Yes — flag |
| 4 | Set `settings.payouts.schedule.interval='manual'` on **new** accounts only | Yes — per-account update |
| 5 | Verify end-to-end in Stripe **test mode** with the fixture account | n/a |
| 6 | Enable flags for an internal cohort; run a real low-value bounty | Yes — flag |
| 7 | Backfill `interval='manual'` on existing accounts | Yes — per-account update |
| 8 | Flip `EXPO_PUBLIC_PAYMENT_ARCHITECTURE_VERSION=2` for new bounties | Yes — flag; existing bounties keep their own `payment_architecture_version` |
| 9 | Drain the $6.65 legacy balance (§7), then retire v1 write paths | No — do last |

Existing bounties are unaffected at every step: release/cancel/refund routing reads each
bounty's own `payment_architecture_version` (`isPhase2Bounty()`), never the global flag.

### The $6.65 legacy balance

| User | Balance | Connect account | Disposition |
|---|---|---|---|
| `jordan` | $0.95 | ✅ payouts enabled | Can drain via existing v1 `/transfer`. Below the $10 withdrawal minimum — needs a manual sweep or a minimum waiver. |
| `hunter` | $5.70 | ❌ none | Cannot be transferred. Requires onboarding, or an off-platform settlement. |

This is real user money and cannot be zeroed. It does **not** block the v2 rollout — keep
the v1 read/withdraw path alive until drained. Recommend contacting both users.

---

## 7. Risk analysis

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Stranded funds under manual payouts** — user earns, never taps Withdraw, money sits in Stripe indefinitely | **High** | Balance reminder notifications; auto-sweep job for balances idle > N days; monitor aggregate held balance. Holding-period obligation per §3.1. |
| R2 | Wallet shows $0 for a hunter with real money (the defect this fixes) if UI ships before the payout path | High | Enforce migration ordering; never enable v2 funding before Phases 4–5 are live. |
| R3 | Double-spend: legacy `/transfer` and new `/payout` both draw on the same money | High | v1 debits `profiles.balance`; v2 spends Connect balance. Disjoint by construction. Assert no v2 route ever calls `withdraw_balance`. |
| R4 | Stripe API outage → wallet unusable (no cached fallback by design) | Medium | Explicit error + Retry; allow the stale cached value as a clearly-labelled placeholder only. |
| R5 | `instant_available.amount` used instead of `net_available` | Medium | §3.3. Enforce in code review + a unit test asserting the `net_available` path. |
| R6 | Rate limits from per-screen-focus balance fetches | Medium | Debounce; 10–15s min interval between refetches; reuse in-flight promise. |
| R7 | Instant payout min $0.50 / max $9,999 / 10-per-day rejections surfacing as generic errors | Medium | Pre-validate client-side; map Stripe error codes to specific copy. |
| R8 | Negative Connect balance from a refund/dispute after payout | Medium | Reconciliation alerting (Phase 8); Stripe reserves are on by default post-2017. |
| R9 | Realtime `profiles` subscription is dead under v2 (Transfers don't touch `profiles`) | Medium | Replace with webhook-driven push or focus/interval refresh. Do not leave the UI silently non-updating. |
| R10 | Existing accounts flipped to `manual` stop receiving automatic payouts — users who relied on it see money stop arriving | **High** | Backfill (step 7) only after the Withdraw UI is live and users are notified. Consider leaving legacy accounts automatic. |
| R11 | Currency assumptions — code paths hardcode `usd` | Low | Service returns `currency`; UI formats from it. Multi-currency deferred, not designed out. |

---

## 8. Rollback plan

Every step through 8 is flag-reversible with no data migration:

| Symptom | Rollback |
|---|---|
| Balance display wrong/broken | `EXPO_PUBLIC_WALLET_BALANCE_SOURCE=ledger` → instantly reverts to `GET /wallet/balance` |
| New payout routes failing | `CONNECT_NATIVE_PAYOUTS=false` → routes 410; legacy `/transfer` + `/instant-payout` still live |
| v2 funding causing problems | `EXPO_PUBLIC_PAYMENT_ARCHITECTURE_VERSION=1` → new bounties fund via v1. **In-flight v2 bounties keep working** — they carry their own `payment_architecture_version`. |
| Manual schedule causing stranded funds | `stripe.accounts.update(id, {settings:{payouts:{schedule:{interval:'daily'}}}})` → Stripe resumes automatic sweeps within a day |

**Point of no return:** step 9 (retiring v1 write paths). Do not execute until v2 has run
clean in production for a meaningful period.

Because the legacy code is retired behind `CONNECT_TRANSFER_RETIRED` rather than deleted,
full reversion to v1 remains possible until that flag is removed from the codebase.

---

## 9. Decisions

### Resolved (2026-07-26)

1. **`interval: 'manual'` on Connect accounts — YES, new accounts only.**
   New accounts are created with a manual payout schedule so the balance holds until the
   user withdraws; existing accounts keep their automatic schedule until a deliberate,
   separately-approved backfill (§6 step 7), so no current user's payouts silently stop.
   Accepts risk R1 (stranded funds) and the 2-year US holding obligation.
   *Implemented behind `CONNECT_MANUAL_PAYOUTS`, default off.*

2. **Retire the "Add Money" deposit flow — YES.**
   Under v2 posters fund each bounty directly via PaymentIntent, so a custodial top-up
   wallet has no remaining purpose. Retiring it is what prevents `profiles.balance` from
   ever being credited again and the two-wallet problem returning.
   *Not yet implemented — scheduled with Phase 7.*

### Still open

3. **Monetize instant payouts with an application fee?** Changes the spendable figure to
   `net_available` (§3.3) and needs the Platform Pricing tool configured. The balance
   service already reads `net_available`, so this is safe to decide later.
4. **How to settle `hunter`'s $5.70** with no Connect account.
5. **Instant-payout minimum.** Stripe's floor is $0.50; the app currently enforces a $10
   withdrawal minimum. Confirm the intended product minimum under the new model.

---

## 10. Test plan (Phase 9)

Unit/integration (no live money):
- `getConnectBalance()` maps `available` / `pending` / `instant_available.net_available` correctly
- returns `hasConnectAccount:false` cleanly for unonboarded users
- balance service never reads `profiles.balance`
- new payout routes never call `withdraw_balance` / `update_balance`
- UI renders loading / refreshing / error / no-account / zero states
- cached value never overwrites a successful live fetch
- locale formatting across locales and currencies

Stripe **test mode** against the fixture account `acct_1TvYr7QupCkQqUm0`:
- transfer in → balance reflects it → instant payout → remaining balance updates
- standard payout path
- partial payout leaves the correct remainder
- payout failure → status + user-visible error
- webhook sync for `payout.created/paid/failed`

**Live-money verification is explicitly gated on written authorization** and must use a
minimal-value real bounty with a known internal account. Per project policy, no real
transfers are executed without that sign-off.

---

## 11. Appendix — files in scope

**Server:** `supabase/functions/connect/index.ts` (balance route, instant-payout rewrite,
standard payout, account creation settings) · `supabase/functions/wallet/index.ts` (legacy;
read-only after cutover) · `supabase/functions/webhooks/index.ts` (payout lifecycle,
reconciliation) · `supabase/functions/bounty-payments/index.ts` (v2 funding — unchanged)

**Client:** `lib/wallet-context.tsx` · `hooks/useConnectBalance.ts` *(new)* ·
`hooks/use-payout-methods.tsx` · `app/tabs/wallet-screen.tsx` ·
`components/instant-cash-out-screen.tsx` · `components/withdraw-with-bank-screen.tsx` ·
`components/ui/wallet-balance-button.tsx` · `lib/utils.ts` (locale formatting)
