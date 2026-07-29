# Reconciliation & Legacy Wallet Retirement

**Status:** Phase 8 built (undeployed) · Phase 7 Stage A gated, Stage B built, Stage C blocked
**Date:** 2026-07-27
**Companion to:** `CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md`

---

## 1. Governing rules

These are the invariants the reconciliation system is built to preserve. Every design
decision below follows from them.

1. **Stripe is the source of truth.** The ledger mirrors Stripe. Where they disagree,
   Stripe is right and the ledger is stale or wrong — never the reverse.
2. **Never silently repair.** A repair happens only when provably safe, only moves the
   ledger toward what Stripe already did, and is always recorded as a finding.
3. **Never fabricate.** No Stripe object is created by reconciliation, no money moves, and
   nothing is marked complete unless Stripe has already completed it.
4. **Always surface drift.** An inconsistency that cannot be safely resolved stays visible.
   Hiding it destroys the evidence needed to fix the underlying cause.

---

## 2. Where the money actually is

This is worth stating precisely, because the two architectures put money in **different
places**, and reconciliation has to handle both simultaneously during migration.

| | v1 (legacy — **currently live**) | v2 (Connect-native) |
|---|---|---|
| Poster funds | → platform balance, mirrored in `profiles.balance` | → platform balance via PaymentIntent |
| On release | `profiles.balance` credited to hunter | **`Transfer` into hunter's Connect account** |
| On withdrawal | debit `profiles.balance`, `Transfer` → Connect, then payout | **payout only** — funds already in Connect |
| Hunter's money lives in | the platform ledger | their Stripe Connect account |

Under v2 funds reach the connected account at **release**, not at withdrawal. Any statement
of the form "funds remain on the platform until withdrawal" describes v1 only. Reconciliation
therefore runs **per connected account**, not against the platform balance alone.

---

## 3. Phase 8 — Reconciliation

### 3.1 Scheduled job

`supabase/functions/reconciliation` · `POST { action: 'run' }` · every 15 minutes via
`pg_cron` → `net.http_post`, reusing the vault-secret pattern already established by
`stripe-balance-reconciliation-hourly` (one scheduling convention in this project, not two).

Each run looks back **72 hours** — deliberate overlap so nothing falls between runs — and
checks:

| Check | Classification |
|---|---|
| Stripe payout with no ledger row | `orphan_stripe_payout` — **CRITICAL** |
| Ledger row referencing a payout Stripe didn't return | `orphan_ledger_withdrawal` — **CRITICAL** |
| Amounts disagree | `amount_mismatch` — **CRITICAL**, never repaired |
| Ledger claims a state Stripe doesn't corroborate | `status_mismatch` — **CRITICAL** |
| Ledger lagging behind a terminal Stripe state | `ledger_status_repaired` — **INFO**, safely repaired |
| Payout pending > 24h / > 72h | **WARNING** / **CRITICAL** |
| Withdrawal pending with no payout id > 2h | **WARNING** / **CRITICAL** past 72h |
| Transfer fully reversed | **CRITICAL** |
| Connect account unreadable | **WARNING** — a coverage gap is not a clean pass |
| ≥1 / ≥5 failed webhooks in 24h | **WARNING** / **CRITICAL** |

### 3.2 Drift report

Persisted to `public.reconciliation_reports` every run:

```jsonc
{ timestamp, durationMs, reconciled, mismatched, orphanStripe, orphanLedger,
  stalePending, totalStripeAmountCents, totalLedgerAmountCents, deltaCents,
  safeRepairs, health, unreconciled[] }
```

Per-issue detail continues to go to the existing `reconciliation_findings` table. Both are
needed: findings answer *"what is wrong with this payout"*, reports answer *"was the system
in sync at 14:15"*. A problem that appears and clears between runs is invisible without the
run-level record — which is exactly the shape of a stuck-then-settled withdrawal.

**A report row is written even when the run throws.** A crashed job that leaves no row is
indistinguishable from a job that never ran, and both look like silence.

### 3.3 Safe automatic repairs

The only permitted repair: ledger row is still `pending`, Stripe has reached a **terminal**
state (`paid` / `failed` / `canceled`) → advance the ledger to match.

Refused, and left visible as drift:

- ledger already terminal and disagreeing → a real conflict; overwriting destroys evidence
- Stripe still in flight (`pending` / `in_transit`) → nothing to copy yet
- **any** amount disagreement → never a status question
- unknown Stripe status → we cannot know it is terminal

The `UPDATE` re-asserts `status = 'pending'` as a compare-and-set, so a concurrent webhook
that already advanced the row cannot be clobbered.

`in_transit` maps to `pending`, **never** `completed`. Treating in-flight money as settled is
the precise legacy bug this migration exists to remove; letting reconciliation do it would
certify the bug as correct.

### 3.4 Alerting

Routed through the existing structured-logging convention — `console.error` for CRITICAL
(surfaces as an error in the log drain), `console.warn` for WARNING — under the searchable
key `[reconciliation-alert]`.

### 3.5 Health

`GREEN` / `YELLOW` / `RED`, via `POST { action: 'health' }` (admin JWT or cron secret).

- **RED** — any CRITICAL finding, any orphan on either side, or any non-zero amount delta
- **YELLOW** — status mismatches or stale pending only
- **GREEN** — nothing found

**A stale job forces RED.** If reconciliation hasn't run in 45 minutes, GREEN would be a
claim we have no evidence for.

---

## 4. Phase 7 — Legacy retirement

### Stage A — Freeze `profiles.balance` · **GATED, DO NOT APPLY**

`supabase/migrations/20260727110000_freeze_profiles_balance_GATED.sql`

The migration is safe to apply because **the trigger is created `DISABLED`**. Arming it is a
separate explicit act:

```sql
ALTER TABLE public.profiles ENABLE TRIGGER trg_freeze_profiles_balance;
```

> ### ⚠️ Arming this today would take down all payments
>
> Production runs on `payment_architecture_version = 1`. The live v1 flow mutates
> `profiles.balance` through six SECURITY DEFINER RPCs — `apply_deposit`, `apply_escrow`,
> `apply_release_tx`, `apply_refund_tx`, `withdraw_balance`, `update_balance`. Arming the
> freeze makes every deposit, bounty posting, release, refund and withdrawal fail
> immediately, for real users.
>
> This has already happened once on this project: an untracked profile-guard trigger blocked
> all paid bounty, withdrawal and dispute writes in July 2026.

**Preconditions, all required:**

1. `EXPO_PUBLIC_PAYMENT_ARCHITECTURE_VERSION = 2` everywhere **and** verified in the shipped
   bundle — the EAS variable and the shipped build diverged once already
2. `CONNECT_NATIVE_PAYOUTS = true`, exercised in production
3. `migration_report` returns `retirementReady: true`
4. 15-minute reconciliation GREEN continuously for several days
5. No v1 wallet transactions in the preceding 48 hours

The freeze raises rather than no-ops deliberately: Stage A's whole purpose is to make
forgotten write paths announce themselves. A silent no-op would let them keep running.

An escape hatch exists for deliberate admin correction
(`set_config('app.allow_balance_mutation', 'on', true)` inside a transaction), which logs a
warning when used.

### Stage B — Migration report · **built, read-only**

`POST { action: 'migration_report' }` compares, per user, the legacy ledger balance against
money actually held in Stripe:

| Status | Meaning |
|---|---|
| **Clean** | legacy balance drained to zero — nothing to migrate |
| **Mismatch** | legacy balance remains, user *can* be paid out — actionable |
| **Needs Review** | legacy balance remains with no way to pay it out, or Stripe unreadable |

`retirementReady` is true only when Mismatch **and** Needs Review are both zero.

Note the two figures are **not expected to be equal**. They are different pots of money: the
legacy balance is custodied by the platform and has not been sent to Stripe. A user holding
balance in both places is mid-migration — that is the case needing a human.

**Known blocker:** as of 2026-07-26, user `hunter` holds $5.70 with **no Connect account**,
so it cannot be paid out programmatically. That single account blocks `retirementReady`, and
therefore blocks Stage A, until settled out of band.

### Stage C — Deletion · **BLOCKED**

No deletion has been performed. The dependency audit below is why.

**`profiles.balance` / balance-RPC references — 18 source files** (excluding tests, plus 25+
migrations):

`lib/wallet-context.tsx` · `hooks/use-wallet-deposit.ts` · `lib/services/dispute-service.ts` ·
`lib/moments/registry.ts` · `supabase/functions/{wallet,connect,webhooks,payments,admin-withdrawals}/index.ts` ·
`services/api/src/{routes/payments.ts,services/consolidated-wallet-service.ts}` · and the
Phase 6–8 files that reference it only to *avoid* it.

**Add Money / deposit surfaces — 10 files, including onboarding:**

`components/add-money-screen.tsx` · `components/onboarding/PosterFundingScreen.tsx` ·
`app/onboarding/details.tsx` · `app/screens/CreateBounty/index.tsx` · `app/tabs/wallet-screen.tsx` ·
`app/tabs/postings-screen.tsx` · `hooks/{use-wallet-deposit.ts,useBountyForm.ts}` ·
`components/payment-element-wrapper.tsx` · `lib/services/analytics-service.ts`

Removing the deposit flow is **not** a contained cleanup — it reaches into the poster
onboarding funding step. Under v2 posters fund per bounty via PaymentIntent, so the flow does
become vestigial, but sequencing matters: retire it only after v2 funding is live and
onboarding has been reworked to route through it.

---

## 5. Deployment order

Nothing below has been deployed or applied.

| # | Step | Reversible |
|---|---|---|
| 1 | Apply `20260726120000_payout_audit_log.sql` | Yes — drop table |
| 2 | Apply `20260727100000_reconciliation_reports.sql` (creates table + 15-min cron) | Yes — drop table, `cron.unschedule` |
| 3 | Set vault secret `reconciliation_cron_secret` (reuse existing) and `RECONCILIATION_CRON_SECRET` on the function | Yes |
| 4 | Deploy `reconciliation` edge function | Yes — it only reads and writes its own tables |
| 5 | Deploy `connect` edge function (`/balance`, `/payouts`, `/payout`, native `/instant-payout`) | Yes — new routes are flag-gated |
| 6 | Observe reconciliation GREEN for several days | n/a |
| 7 | Run `migration_report`; settle Mismatch / Needs Review accounts | n/a |
| 8 | Enable `CONNECT_MANUAL_PAYOUTS` for new accounts | Yes — `accounts.update` |
| 9 | Enable `CONNECT_NATIVE_PAYOUTS`, then `walletBalanceSource=connect` for a cohort | Yes — flags |
| 10 | `PAYMENT_ARCHITECTURE_VERSION=2` + OTA (**use `APP_ENV=production`**) | Yes — flag + OTA |
| 11 | Apply Stage A migration (trigger arrives DISABLED) | Yes |
| 12 | Arm the freeze once preconditions hold | Yes — `DISABLE TRIGGER` |
| 13 | Stage C deletion | **No** — last |

> **`eas update` from a developer machine must be run as `APP_ENV=production …`.** Without it,
> `app.config.js` resolves to `development`, loads `.env.development` with `override: true`,
> and publishes an OTA pointing production users at the **dev Supabase project**. Local runs
> are not covered by the `isEasBuild` guard that protects cloud builds.

---

## 6. Rollback

| Symptom | Action |
|---|---|
| Reconciliation job misbehaving | `SELECT cron.unschedule('payout-reconciliation-15min')` — it only reads and writes its own tables |
| Alert noise | Raise thresholds in `reconciliation-logic.ts`; no data migration needed |
| Freeze blocking legitimate writes | `ALTER TABLE public.profiles DISABLE TRIGGER trg_freeze_profiles_balance` |
| Native payouts failing | `CONNECT_NATIVE_PAYOUTS=false` → legacy `/instant-payout` path returns, intact |
| Wallet showing wrong balance | `walletBalanceSource=ledger` |
| v2 funding problems | `PAYMENT_ARCHITECTURE_VERSION=1` + OTA; in-flight v2 bounties keep working from their own row |

**Point of no return:** Stage C only.

---

## 7. Remaining risks

| # | Risk | Severity |
|---|---|---|
| R1 | **No live-money verification.** No real payout has run through the native path. `net_available` mapping and destination resolution are unexercised against real Stripe. | High |
| R2 | `hunter`'s $5.70 with no Connect account blocks `retirementReady` indefinitely until settled out of band. | Medium |
| R3 | Reconciliation iterates accounts serially; fine at 5 Connect accounts, will need pagination/batching in the hundreds. | Medium |
| R4 | Stale-job detection depends on the cron actually firing. If `pg_cron` itself stops, health reads RED — correct, but the *cause* isn't distinguished from real drift. | Medium |
| R5 | `stripe_events.status` may not exist in every environment; that check is wrapped and skipped rather than failing the run — so webhook-failure alerting could be silently inactive. | Low |
| R6 | Stranded funds under manual payout schedule (idle-balance reminders still unbuilt). | Medium |
| R7 | `DATABASE_URL` stored in EAS with `PUBLIC` visibility. Not bundled into the app, but readable by anyone with project access. | Medium |
