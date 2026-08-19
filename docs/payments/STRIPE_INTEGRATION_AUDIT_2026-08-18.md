# Stripe Integration Audit — 2026-08-18

Scope: full payment-infrastructure review of Bounty's Stripe integration.
Method: static review of the repo, plus live verification against the
production Supabase project (`xwlwqzzphmmhghiqvkeu`) and production Stripe
account (`acct_1PGppVJekUCspsfJ`).

**Status: audit only. No code, schema, Stripe configuration, or deployment was
modified.** Several findings need a decision before they can be fixed safely;
those are listed in §6.

---

## 1. Current Stripe architecture

### 1.1 Money-moving surface

| Function | Lines | Role |
|---|---:|---|
| `connect` | 4127 | Connect onboarding, transfers, standard + instant payouts |
| `webhooks` | 3280 | All Stripe event ingestion |
| `admin-withdrawals` | 1524 | Admin recovery, balance sync, transfer reversal |
| `reconciliation` | 1073 | Stripe↔ledger sweep |
| `payments` | 1068 | Customers, PaymentIntents, SetupIntents, payment methods |
| `wallet` | 901 | Escrow / release / refund ledger operations |
| `bounty-payments` | 843 | V2 funding path (PaymentIntent + transfer + refund) |
| `bounty-checkout` | ~380 | Public web Checkout Session (**not in git**) |
| `apple-pay` | 162 | Apple Pay PaymentIntents |

### 1.2 Principal flow

```
Poster funds bounty
  app → payments / bounty-payments → PaymentIntent
     → webhook payment_intent.succeeded → apply_deposit → profiles.balance
  app → wallet/escrow → wallet_transactions(type=escrow) → balance held

Work completed and approved
  → wallet/release → wallet_transactions(type=release) → hunter balance

Hunter withdraws
  → connect/transfer → stripe.transfers.create (platform → connected account)
                     → stripe.payouts.create   (connected account → bank)
                     → wallet_transactions(type=withdrawal, status=pending)
  → webhook payout.paid            → status=completed
  → webhook payout.failed/canceled → status=failed + balance refund
```

### 1.3 Source of truth (Phase 3)

The design is **Stripe-authoritative for withdrawals** and
**ledger-authoritative for the internal wallet**. That split is deliberate and,
for withdrawals, correctly enforced:

- `_shared/payout-state.ts` is a real state machine. `pending` is the only
  non-terminal state; `completed` / `failed` / `manually_paid` are absorbing.
- Only `payout.paid` maps to `completed` (`mapStripePayoutStatusToLedger`).
- DB constraint `wallet_transactions_completed_withdrawal_requires_payout`
  independently enforces "no completed withdrawal without a payout id".
  **Verified live: present, `convalidated = true`.**
- `idx_wallet_tx_stripe_payout_id_unique` stops one payout settling two rows.

This is good work and it holds. The `failed → completed` class of bug behind
the 2026-08-13 $275 incident is now blocked at two independent layers.

---

## 2. Critical findings

### P0-1 — A completed web checkout would charge the customer and create nothing

`bounty-checkout` creates Stripe Checkout Sessions and documents the flow as
"customer pays → Stripe → `webhooks` → account + bounty + escrow".

**`webhooks` does not handle `checkout.session.*` at all.** Searching
`supabase/functions/webhooks/index.ts` for `checkout.session`,
`pending_bounties`, or `client_reference_id` returns zero matches.

The `switch` ends in `default: console.log('Unhandled event type')`, then
unconditionally runs `UPDATE stripe_events SET processed = true` and returns
`200`. An unhandled event is recorded as successfully processed, Stripe never
retries, and nothing surfaces.

Live evidence that the deployed build also lacks it:

- 20 × `checkout.session.expired` received, all marked `processed = true`.
- All 17 `pending_bounties` rows are still `status = 'pending_payment'`; none
  were flipped to `expired`. A working handler would have flipped them.

**Why no money has been lost yet:** `checkout.session.completed` count is
**zero** — every web checkout so far expired unpaid. The bug is latent, not
active. The first customer who completes payment is charged and receives no
bounty, no ledger row, and no error anywhere.

Referenced doc `docs/payments/SINTRA_INTEGRATION.md` does not exist.

### P0-2 — Standard withdrawals cannot complete for existing Connect accounts

The one standard withdrawal attempted since the 2026-08-16 hardening is stuck:

```
id       1148dbe1-de6b-4925-b992-d781295d7c46
amount   -96.00      status pending      created 2026-08-17 08:02:28Z
transfer tr_1U5LV2JekUCspsfJ1ZbjsGiR     payout NULL
metadata payout_creation_failed = "cannot_create_connect_standard_payouts_through_api"
```

Mechanism:

1. `stripe.transfers.create` succeeds — $96 moves platform → connected account.
2. `stripe.payouts.create({stripeAccount})` is **rejected by Stripe**: that
   account is on Stripe's *automatic* payout schedule, and a platform cannot
   create manual payouts on such an account.
3. The code correctly refuses to complete (no payout id) and correctly refuses
   to refund (the transfer did happen). The row stays `pending`.
4. The new DB constraint now *prevents* completing it. Stripe's automatic sweep
   will deliver the money, but that payout is never matched to this row —
   `decidePayoutEventAction` deliberately does not guess by amount.

`CONNECT_MANUAL_PAYOUTS` sets `interval: 'manual'` on **newly created accounts
only**, by design and documented in code. Existing accounts keep the automatic
schedule. **Every existing hunter's standard withdrawal therefore sticks at
`pending` permanently.** Last successful completion: 2026-08-14.

The 2026-08-16 fix correctly closed the "marked paid without a payout" hole but
did not supply a working completion path for automatic-schedule accounts. The
error code `cannot_create_connect_standard_payouts_through_api` is handled
nowhere in the codebase.

### P0-3 — Eight deployed functions have no source in git

Deployed, absent from the repo: `bounty-checkout`, `go`, `marketing-brief`,
`marketing-metrics`, `signed-image-proxy`, `stripe-setup`, `stripe-worker`,
`workflow-tracker`.

`bounty-checkout` is a **payment** function with `verify_jwt: false`. Its source
**is** recoverable via the management API (unlike `stripe-setup` /
`stripe-worker`, still unrecoverable). Reviewed: it is sound — the charged
amount is read back from the DB rather than the request body, the Stripe
idempotency key is deterministic (`pending_bounty_<id>`), CORS is allowlisted,
and there is a per-email rate limit.

In git but **never deployed**: `admin-verifications-list`, `app-link`,
`expire-bounties`. `expire-bounties` is the bounty-expiry/refund path.

### P1-1 — Stripe idempotency is not deterministic, and its test proves nothing

`payout-state.ts` claims:

> These builders derive the key purely from the logical identity of the
> request, so a retry of the same withdrawal always replays rather than
> creating a second money movement.

**That is not what the code does.** Both builders interpolate
`hashClientKey(args.clientKey)`, and every production `clientKey` is
timestamp-derived:

```
withdraw-with-bank-screen.tsx:117  useRef(`withdraw_${uid}_${Date.now()}`)
instant-cash-out-screen.tsx:94     useRef(`instant_${uid}_${Date.now()}`)
use-connect-payout.tsx:85          `payout_${Date.now()}_${Math.random()…}`
```

Hashing a timestamp does not remove the timestamp. Live proof — the stuck row's
metadata:

```
idempotency_key = "withdraw_78c972ad-…-e82ebefb1eab_1786953898155"
```

The guarantee holds only for the lifetime of an in-memory React ref. Any
component remount, app restart, JS reload, OTA update, or crash yields a new
key, and Stripe-side idempotency never engages.

The unit test `'keys carry no timestamp, so a retry replays instead of paying
twice'` **passes while asserting nothing useful**: it feeds a hardcoded
`clientKey: 'key_abc'` and asserts `expect(key).not.toMatch(/\d{13}/)`. A
SHA-256 hex digest satisfies that regex regardless of input. The test validates
the property against an input that never occurs in production.

Mitigating factor: the atomic balance reservation is the real double-spend
guard and it is sound. The exposure is a duplicate *money movement* where the
balance was legitimately reserved (e.g. a retry after a network timeout that
actually succeeded server-side), not unlimited draining.

### P1-2 — No server-side idempotency fallback

In `connect`, both the DB replay check and the Stripe idempotency option are
gated on a **client-supplied** value:

```ts
idempotencyKey ? { idempotencyKey: build…(…) } : undefined
```

A caller that omits `idempotencyKey` gets no Stripe-side protection *and*
bypasses the DB replay check. `wallet` already implements the correct pattern
(``effectiveKey = idempotencyKey || `escrow_${bountyId}_${userId}` ``);
`connect` should adopt it.

### P1-3 — No systemic webhook replay guard

`stripe_events` is upserted with `processed: false` **on conflict**, which
*resets* the flag on redelivery, and nothing reads it before dispatch.
Deduplication is per-handler and ad hoc.

In practice the terminal state machine absorbs replays for payout events and
several handlers check explicitly, so this is a defence-in-depth gap rather
than live corruption. But there is no single choke point, so correctness
depends on every current and future handler independently remembering.

### P2-1 — Stuck-withdrawal detection can lag ~24h

`run_withdrawal_reconciliation()` flags `stuck_pending_withdrawal` only when
`created_at < run_at - INTERVAL '1 hour'`, and the job runs **once daily at
09:00 UTC**. The stuck withdrawal above was created 08:02:28; the 09:00 run
required `created_at < 08:00:00`. It missed by 2m28s and is not re-evaluated
until the next day.

**Correction to an earlier read:** reconciliation is *not* dead. The hourly
balance sync returns `200 {accountsChecked: 10, repairsApplied: 0}`. The drop
in daily finding volume is the intended dedup — findings are suppressed while
an unacknowledged one already exists.

The real problem is that **nobody acknowledges findings**, so they accumulate
invisibly:

| finding_type | severity | unresolved |
|---|---|---:|
| `connect_account_balance_drift` | info | 470 |
| `platform_balance_drift` | warning | 416 |
| `connect_account_balance_drift` | warning | 54 |
| `balance_drift` | critical | **6** |
| `orphan_stripe_payout` | critical | **2** |
| `completed_withdrawal_without_payout` | critical | **1** |

### P2-2 — `.env` (development) contains a live Stripe secret key

`.env` and `.env.production` both set `STRIPE_SECRET_KEY=sk_live_…`. Both are
correctly gitignored and **never committed** (verified). But `.env` is the
default local file and is already known to point at the wrong Supabase project,
so local work can transact against live Stripe.

### P2-3 — Client-supplied amounts

`connect/index.ts:104`, `wallet/index.ts:96,272` read `body.amount`. These are
validated and, for withdrawals, bounded by the reserved balance — not currently
exploitable. Noted because `bounty-checkout` demonstrates the stronger pattern
(re-read the authoritative amount from the DB after insert).

### P2-4 — `profiles.balance` column grants remain broad

`anon` and `authenticated` both hold `UPDATE` on `profiles.balance`. The
`trg_prevent_client_writes_to_protected_profile_columns` trigger blocks the
write (verified live, enabled, covers `balance` + ~40 other columns), so this is
**not** an open hole. Hardening note: the bypass is
`current_setting('app.bypass_profile_guard') = 'on'`, a settable custom GUC; a
service-role-only check would remove the theoretical path.

### P2-5 — `services/api/` is a second payment implementation

A full API service (routes, services, db, payment + wallet + escrow logic) is
built by `npm run build` but has no discoverable deployment target. Likely dead,
but it compiles in CI and contains competing payment code.

---

## 3. Verified live

- Constraint `…_completed_withdrawal_requires_payout` — present, validated.
- 25 grandfathered completed withdrawals with no payout id ($526.65) — still
  unresolved, as the migration's GRANDFATHERING note intended.
- 1 stuck pending withdrawal, $96 — new, post-hardening (P0-2).
- 17 `pending_bounties`, $545, none created; 20 expired / 0 completed sessions.
- Cron: 5 jobs active, balance sync healthy.
- 57 × HTTP 401 "Unregistered API key" in 3 days from an unidentified caller.
- 37/37 `payout-state-machine` unit tests pass.

## 4. Not verified

Direct Stripe API reads (transfer state, the connected account's payout
schedule, whether the automatic sweep already delivered the $96) were
**blocked**: the CLI keys expired 2026-05-24, and the sandbox classifier
declined to read `STRIPE_SECRET_KEY` from `.env.production`. Completing
`stripe login` unblocks this.

## 5. Recommended target architecture

1. **Detect the payout schedule before choosing a completion strategy.** For
   automatic-schedule accounts, do not attempt `payouts.create`. Record the
   transfer, and settle the withdrawal from the connected account's automatic
   payout — matched via the payout's balance transaction, never by amount.
2. **Add a `checkout.session.completed` handler** (and `.expired`) that creates
   the bounty + escrow from `pending_bounties`, idempotent on session id.
3. **Fail closed on unhandled events.** Do not mark `processed = true` for event
   types with no handler; record them as `unhandled` so they are visible.
4. **Derive idempotency keys server-side** from logical identity
   (`user_id + amount + purpose + reservation id`), never from client input.
5. **Single webhook replay choke point** that reads `processed` before dispatch.

## 6. Decisions needed before implementation

1. **P0-2 fix strategy** — detect-and-adapt per account, or backfill all
   existing accounts to a manual payout schedule? The latter changes when every
   existing hunter's money arrives and is not reversible per-account.
2. **The stuck $96** — needs a Stripe read to confirm whether the automatic
   sweep already paid it, then either `manually_paid` or a re-issued payout.
3. **25 legacy rows ($526.65)** — still awaiting the per-row human decision the
   migration documented.
4. **`checkout.session.completed` handler** — confirm the intended flow
   (auto-create account from email? escrow immediately?) since
   `SINTRA_INTEGRATION.md` is missing.
5. **Ungitted functions** — commit recovered sources? Delete the dead ones?
6. **`services/api/`** — confirm dead, then remove from the build.
