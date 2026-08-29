# Payment Architecture Audit — v1 Ledger vs. Stripe Settlement

**Date:** 2026-08-24
**Scope:** Phase 1 of the "Walk my cat" forensic follow-up — root-cause mapping only.
**Status:** Documentation. No code, database, or deployment changes were made.
**Method:** Source reading of `supabase/functions/*`, `supabase/migrations/*`, `lib/services/*`,
`lib/wallet-context.tsx`, plus **read-only** `SELECT` queries against the production Supabase
project `xwlwqzzphmmhghiqvkeu` to verify the briefing's numbers. No writes were issued.

---

## 0. Executive summary

The briefing's central claim is correct and reproducible: **the v1 payment architecture is a
closed custodial ledger that never touches Stripe on either the escrow or the release side.**
A v1 bounty can go `open → in_progress → completed` with a `wallet_transactions` row of
`type='release', status='completed'` and there is no Stripe object anywhere in that path — not
because of a bug, but because the design has no Stripe call in it. "Completed" in v1 means
"one row in `profiles.balance` went down and another went up".

Three things make that structurally dangerous rather than merely legacy:

1. The hunter's credited balance is only *real money* if they can later withdraw it, and
   nothing in the v1 accept-or-release path checks whether they can (§5).
2. The user-facing vocabulary does not distinguish "credited to your in-app balance" from
   "paid" (§3).
3. The safety net that would catch the resulting divergence — the reconciliation invariant
   sweep — is not on a schedule and only writes to a table nobody is paged from (§6, §7).

**Verified against live production data (read-only, 2026-08-24):**

| Claim in briefing | Verified value | Match |
|---|---|---|
| 44 bounties ever `completed`, all v1 | 44 completed, 44 v1, 0 v2 | ✅ |
| v2 used by 4 bounties only | `bounty_payments` = 4 rows | ✅ |
| 25 completed withdrawals w/o payout id, $526.65 | 25 / $526.65 | ✅ |
| 953 `reconciliation_findings` rows | 953 | ✅ |
| 524 open `connect_account_balance_drift` | 470 info + 54 warning = 524 | ✅ |
| 416 open `platform_balance_drift` | 416 (severity `warning`, not critical) | ⚠️ severity differs |
| 2 stuck pending withdrawals | **1** (`1148dbe1…`, $96, since 2026-08-17) | ❌ see §7.3 |
| 2 orphan Stripe payouts | 2 open `orphan_stripe_payout` findings | ✅ |

Additional numbers not in the briefing: **20** `release` rows are `completed`, and **all 20**
have `stripe_transfer_id IS NULL`. **2 of 315** profiles have `stripe_connect_payouts_enabled
= true`.

**Three findings that are new** (not in the briefing, not in any existing doc I could find):

- **NEW-1 (§4.3):** the admin `force_retry` action in `admin-withdrawals` still writes
  `status: 'completed'` on the strength of a Stripe **Transfer** alone, with no
  `stripe_payout_id`. This is the exact bug class of the 2026-08-13 incident, still live, and
  the 2026-08-15 grandfathering cutoff in the DB constraint means it *succeeds silently* on
  legacy rows.
- **NEW-2 (§6.3):** the `reconciliation` Edge Function — which owns
  `completed_withdrawal_without_payout`, `orphan_stripe_payout` and the invariant sweep — is
  **not scheduled by any cron job**. Its last findings write was 2026-08-16 21:33 UTC, eight
  days ago, and appears to have been a manual invocation.
- **NEW-3 (§7.5):** a live **orphaned escrow** — bounty `bba5e784…` is `status='completed'` with
  an escrow debit, no hunter, and neither a release nor a refund. $1.00, self-posted test
  bounty, so the financial exposure is trivial — but it demonstrates §3.3 finding #14 (a bounty
  can be marked completed with no settlement check at all) as a real defect rather than a
  theoretical one. Added 2026-08-24 while closing out the §7.4 gap.

---

## 1. Which trigger creates the v1 "escrow" row, and does it call Stripe?

**Answer: `public.fn_reserve_bounty_escrow()`, fired by `trg_bounties_reserve_escrow`. It never
calls Stripe. It cannot — it is PL/pgSQL running inside Postgres.**

- Definition: [20260518_atomic_bounty_escrow_reservation.sql:36-118](../supabase/migrations/20260518_atomic_bounty_escrow_reservation.sql#L36-L118)
- Trigger: [20260518_atomic_bounty_escrow_reservation.sql:127-131](../supabase/migrations/20260518_atomic_bounty_escrow_reservation.sql#L127-L131) — `AFTER INSERT ON public.bounties FOR EACH ROW`

What it does, in order:

1. Skips honor / zero-amount bounties ([:57-59](../supabase/migrations/20260518_atomic_bounty_escrow_reservation.sql#L57-L59)).
2. `SELECT id FROM profiles WHERE id = poster FOR UPDATE` to serialize concurrent inserts ([:73-77](../supabase/migrations/20260518_atomic_bounty_escrow_reservation.sql#L73-L77)).
3. `INSERT INTO wallet_transactions (type='escrow', amount = -bounty.amount, status='completed', metadata.created_via='bounty_insert_trigger')` ([:86-102](../supabase/migrations/20260518_atomic_bounty_escrow_reservation.sql#L86-L102)).
4. `PERFORM update_balance(poster, -amount)` ([:113](../supabase/migrations/20260518_atomic_bounty_escrow_reservation.sql#L113)) — raises `23514` on insufficient funds, rolling back the whole bounty INSERT.

There is a second, now-vestigial entry point: `POST /wallet/escrow`
([wallet/index.ts:258-348](../supabase/functions/wallet/index.ts#L258-L348)) calling the
`apply_escrow` RPC ([same migration, :140-215](../supabase/migrations/20260518_atomic_bounty_escrow_reservation.sql#L140-L215)). Since the
trigger landed, this call always hits the idempotent "already exists" branch and exists only to
let the client resync its cached balance.

**Confirmation of "never calls Stripe":** both the trigger function and `apply_escrow` are
`LANGUAGE plpgsql SECURITY DEFINER` with `SET search_path = public`. Neither has an HTTP
extension call (`net.http_post`, `pg_net`, `http`), and there is no Stripe reference in either.
The `escrow` row is a pure ledger entry: the poster's money was already in
`profiles.balance` before the bounty existed, put there by a *separate*, genuinely
Stripe-backed deposit flow. Escrow moves nothing outside Postgres.

**Live confirmation** — the "Walk my cat" escrow row:

```
id=75c896ee…  user_id=78c972ad…(poster)  type=escrow  amount=-80.00
status=completed  stripe_transfer_id=NULL  stripe_payout_id=NULL
created_at=2026-08-24 01:24:01Z
```

---

## 2. Which function creates the "release" row on completion, and does it call Stripe for v1?

**Answer: `POST /wallet/release` in the `wallet` Edge Function. For a v1 bounty it makes zero
Stripe calls.**

### 2.1 The call chain

| Step | Location |
|---|---|
| Poster taps Approve | [components/poster-review-modal.tsx:323](../components/poster-review-modal.tsx#L323) and [app/postings/[bountyId]/review-and-verify.tsx:312](../app/postings/%5BbountyId%5D/review-and-verify.tsx#L312) |
| Orchestrator (release-before-approve) | [lib/services/completion-approval.ts:52](../lib/services/completion-approval.ts#L52) — `released = await releaseFn(...)` |
| `releaseFn` = wallet context | [lib/wallet-context.tsx:791](../lib/wallet-context.tsx#L791) — `releaseFunds` |
| Version routing | [lib/wallet-context.tsx:808-812](../lib/wallet-context.tsx#L808-L812) — `isPhase2Bounty()` → v2 goes to `bountyPaymentsService.releaseBountyPayment`; **everything else falls through to v1** |
| v1 server call | [lib/wallet-context.tsx:899](../lib/wallet-context.tsx#L899) — `POST ${FINANCIAL_API_BASE_URL}/wallet/release` |
| Server handler | [supabase/functions/wallet/index.ts:558](../supabase/functions/wallet/index.ts#L558) |
| Local ledger mirror | [lib/wallet-context.tsx:1002-1012](../lib/wallet-context.tsx#L1002-L1012) — `type: 'release', status: 'completed'` |

### 2.2 What the server handler does

[wallet/index.ts:558-905](../supabase/functions/wallet/index.ts#L558-L905), in order:

1. `resolveReleasePayee()` — authorization gate; derives `hunterId` from `bounties.accepted_by`
   server-side, never from the request body ([:580-598](../supabase/functions/wallet/index.ts#L580-L598)).
2. Double-settlement guard: refuses if a `release`/`refund` row already exists ([:604-703](../supabase/functions/wallet/index.ts#L604-L703)).
3. Resolves the escrow amount, back-filling an escrow row via `apply_escrow` if none exists ([:711-798](../supabase/functions/wallet/index.ts#L711-L798)).
4. Computes `platformFee` from `PLATFORM_FEE_PERCENT` and inserts
   `type='release', status='pending'` ([:820-843](../supabase/functions/wallet/index.ts#L820-L843)).
5. Calls the `apply_release_tx` RPC, which atomically credits `profiles.balance` and promotes
   the row to `completed` ([:854-858](../supabase/functions/wallet/index.ts#L854-L858)).
6. Returns `message: "$X released to hunter."` ([:911](../supabase/functions/wallet/index.ts#L911)).

**Confirmation of "never calls Stripe for v1":** the `wallet` function does not import the
Stripe SDK at all. Grepping the whole file for `stripe` yields only two kinds of hit —
`stripe_payment_intent_id` read from an existing row to label a transaction's `method`
([:245](../supabase/functions/wallet/index.ts#L245)), and prose comments. There is no
`stripe.transfers.create`, no `stripe.payouts.create`, no HTTP call to `api.stripe.com`.

The only Stripe touchpoint on the client side of `releaseFunds` is
[lib/wallet-context.tsx:857](../lib/wallet-context.tsx#L857), gated on
`bountyData.payment_intent_id` being present — i.e. legacy Stripe-escrow bounties. For a plain
v1 bounty that field is null and the branch is skipped.

**Live confirmation** — the "Walk my cat" release row:

```
id=061237dd…  user_id=6fdeb6f5…(hunter)  type=release  amount=+73.60
status=completed  stripe_transfer_id=NULL  stripe_payout_id=NULL
created_at=2026-08-24 01:40:37Z
```

$80.00 escrowed − 8% ⇒ $73.60 credited. The bounty flipped to `status='completed'` three
minutes later ([completion-service.ts:806-810](../lib/services/completion-service.ts#L806-L810)).
Zero Stripe objects exist for this bounty.

### 2.3 Contrast: the v2 path does require Stripe

[bounty-payments/index.ts:431-700](../supabase/functions/bounty-payments/index.ts#L431-L700).
`POST /bounty-payments/release` creates a real `stripe.transfers.create` and moves
`bounty_payments.status` to `release_pending`; **only** the `transfer.created` webhook promotes
it to `released`
([_shared/bounty-payment-settlement-state.ts](../supabase/functions/_shared/bounty-payment-settlement-state.ts),
tested in [__tests__/unit/bounty-payment-settlement-state.test.ts](../__tests__/unit/bounty-payment-settlement-state.test.ts)).
v2 already has the shape v1 lacks.

---

## 3. Where status is exposed as "completed"/"paid" without checking for Stripe evidence

Every site below reaches the user (or an admin) with a settlement claim that is not
conditioned on `stripe_transfer_id` / `stripe_payout_id` / `stripe_charge_id`.

### 3.1 Server responses

| # | Location | What it says | Why it overclaims |
|---|---|---|---|
| 1 | [wallet/index.ts:246](../supabase/functions/wallet/index.ts#L246) | `status: tx.status ?? 'completed'` | A **null** ledger status is rendered as `completed`. The default should be the most conservative value, not the most reassuring one. Compare the deliberate opposite choice at [connect/index.ts:3027-3028](../supabase/functions/connect/index.ts#L3027-L3028): *"Never default to 'completed': an unknown status is not a settled one."* |
| 2 | [wallet/index.ts:904](../supabase/functions/wallet/index.ts#L904) | `"$73.60 released to hunter."` | True in the ledger sense, but the word carries a settlement connotation the v1 path cannot back. No Stripe check precedes it. |
| 3 | [wallet/index.ts:698-704](../supabase/functions/wallet/index.ts#L698-L704) | `"Escrow already released for this bounty"` | Same. |
| 4 | [admin-withdrawals/index.ts:914-928](../supabase/functions/admin-withdrawals/index.ts#L914-L928) | writes `status:'completed'` | Writes the ledger's strongest claim after a Transfer only. See §4.3 — this is finding NEW-1. |

### 3.2 Client rendering

| # | Location | What it says |
|---|---|---|
| 5 | [components/transaction-detail-modal.tsx:155](../components/transaction-detail-modal.tsx#L155) | `released: 'Funds have been released to the hunter.'` |
| 6 | [components/transaction-detail-modal.tsx:143](../components/transaction-detail-modal.tsx#L143) | `"Escrowed funds for "X" were released to <hunter>."` |
| 7 | [components/transaction-detail-modal.tsx:187](../components/transaction-detail-modal.tsx#L187) | Detail row labelled **`Paid to`** for `bounty_completed` transactions |
| 8 | [components/transaction-detail-modal.tsx:174-180](../components/transaction-detail-modal.tsx#L174-L180) | Renders `transaction.details.status` verbatim — i.e. the `?? 'completed'` default from #1 — next to a green check-circle icon |
| 9 | [components/transaction-history-screen.tsx:144](../components/transaction-history-screen.tsx#L144) | `"Completed Bounty: <title>"` |
| 10 | [components/ui/bounty-workflow-guide.tsx:119](../components/ui/bounty-workflow-guide.tsx#L119) | `"Once approved, payment is released to your wallet automatically"` — the onboarding promise that sets the expectation |
| 11 | [lib/wallet-context.tsx:979, 996, 1010, 1127](../lib/wallet-context.tsx#L996) | Local optimistic ledger writes `status: 'completed'` immediately after a successful HTTP 200, before any settlement exists |

### 3.3 Bounty-level status

| # | Location | Note |
|---|---|---|
| 12 | [lib/services/completion-service.ts:806-810](../lib/services/completion-service.ts#L806-L810) | `approveSubmission` sets `bounties.status='completed'` + `completed_at`. Guarded only by `approveAndRelease` having returned a truthy release ([completion-approval.ts:52-58](../lib/services/completion-approval.ts#L52-L58)) — which for v1 means "a row was written", not "money moved". |
| 13 | [app/postings/[bountyId]/payout.tsx:162, 236](../app/postings/%5BbountyId%5D/payout.tsx#L162) | Second and third completion paths, same shape. |
| 14 | [app/(admin)/bounty/[id].tsx:150](../app/%28admin%29/bounty/%5Bid%5D.tsx#L150) | Admin can set a bounty to `completed` directly, with no settlement check at all. |

### 3.4 What is already correct (do not "fix" these)

- [components/payout-history-section.tsx](../components/payout-history-section.tsx) renders the
  **Stripe payout lifecycle** (`paid` / `failed` / `canceled` / in-transit) and surfaces a
  reconciliation warning when `reconciled === false || statusMatchesLedger === false`
  ([:142](../components/payout-history-section.tsx#L142)). This is the model the rest of the UI
  should follow.
- [connect/index.ts:3027](../supabase/functions/connect/index.ts#L3027) and
  [:1131-1146](../supabase/functions/connect/index.ts#L1131-L1146) both fail closed on unknown
  status.

---

## 4. Why 25 historical withdrawals were `completed` with no payout id

### 4.1 The mechanism

A withdrawal in this system is **two hops**:

```
platform balance --Transfer--> connected account balance --Payout--> hunter's bank
      hop 1 (synchronous)                    hop 2 (1-2 business days, webhook-confirmed)
```

The pre-fix code treated **hop 1 as the completion event**. `stripe.transfers.create()` returns
synchronously with a `tr_…` id, so the code wrote `status: 'completed'` with a
`stripe_transfer_id` and **no `stripe_payout_id`**, on the theory that Stripe's automatic payout
schedule would sweep the connected-account balance out eventually.

Two variants of that mistake existed:

1. **`/connect/transfer` (standard withdrawals)** — stopped after hop 1 and wrote `completed`,
   reasoning that no `transfer.paid` webhook exists to promote a pending row. Documented in the
   current code's own comment: [connect/index.ts:2340-2349](../supabase/functions/connect/index.ts#L2340-L2349).
2. **`/connect/instant-payout` fallback** — when `stripe.payouts.create({method:'instant'})`
   threw, the `catch` block inserted `status: 'completed'` because the Transfer had already
   landed. Documented at [connect/index.ts:3466-3484](../supabase/functions/connect/index.ts#L3466-L3484).

Per [_shared/payout-state.ts:41-53](../supabase/functions/_shared/payout-state.ts#L41-L53), the
instant failures that triggered variant 2 were:

- `cannot_create_connect_instant_payouts_through_api` — platform not approved for API-created
  Instant Payouts on Express accounts; **fails 100% of the time**; 4 of the 13 rows in the
  2026-08-13 incident.
- `instant_payouts_limit_exceeded` — per-account daily ceiling; the other 9.

A null `stripe_payout_id` then removed those rows from **every** downstream control at once,
because `payout.paid`, `payout.failed` and the reconciliation sweep all key off that column.

### 4.2 Is it still reachable? — **No for the two original paths; they were patched 2026-08-16.**

| Path | Current behaviour | Evidence |
|---|---|---|
| `/connect/transfer` | Creates the standard Payout itself after the Transfer; writes only `stripe_payout_id` and leaves status `pending`. If the payout creation throws, it logs `logCritical` and stays `pending` with no payout id. | [connect/index.ts:2350-2405](../supabase/functions/connect/index.ts#L2350-L2405) |
| `/connect/instant-payout` fallback | Creates a standard Payout as fallback for recoverable errors; explicitly `// NOT 'completed'. Only payout.paid may promote this row.` | [connect/index.ts:3466-3595](../supabase/functions/connect/index.ts#L3466-L3595) |
| Native payout route | Inserts `status: 'pending'` with the payout id from the start | [connect/index.ts:1131-1146](../supabase/functions/connect/index.ts#L1131-L1146) |
| Shared rule | `mayCompleteWithdrawal()` requires a payout id *and* a `paid` Stripe status | [_shared/payout-state.ts:161-171](../supabase/functions/_shared/payout-state.ts#L161-L171) |
| Storage-level backstop | `CHECK` constraint `wallet_transactions_completed_withdrawal_requires_payout` | [20260816120100_enforce_completed_withdrawal_requires_payout.sql](../supabase/migrations/20260816120100_enforce_completed_withdrawal_requires_payout.sql) |

The 25 rows were deliberately **grandfathered**, not repaired, because deciding whether each
hunter was actually paid is a human call. The escape clause is
`OR created_at < TIMESTAMPTZ '2026-08-15 00:00:00+00'`.

### 4.3 🔴 NEW-1 — the bug class is still live in the admin recovery tool

**`admin-withdrawals` `action: 'force_retry'` reintroduces exactly this state.**

- Handler entry: [admin-withdrawals/index.ts:707](../supabase/functions/admin-withdrawals/index.ts#L707)
- Eligibility: rows with `status = 'failed'` only ([:725-733](../supabase/functions/admin-withdrawals/index.ts#L725-L733))
- Money movement: **`stripe.transfers.create` only** ([:874-885](../supabase/functions/admin-withdrawals/index.ts#L874-L885)). No `stripe.payouts.create` anywhere in this handler.
- Ledger write: `{ stripe_transfer_id: transfer.id, status: 'completed' }` ([:914-928](../supabase/functions/admin-withdrawals/index.ts#L914-L928)) — **`stripe_payout_id` is never set.**

Two separate problems follow:

1. **It violates the documented state machine.** `failed` is terminal —
   `ALLOWED_TRANSITIONS.failed = []` ([payout-state.ts:143-148](../supabase/functions/_shared/payout-state.ts#L143-L148)).
   `failed → completed` is not a legal transition, and this handler performs it without
   consulting `canTransition()` or `mayCompleteWithdrawal()`.
2. **The grandfathering cutoff makes it fail *silently* on exactly the rows it targets.** The
   CHECK constraint's escape clause tests the **row's own `created_at`**, not the update time.
   A `failed` withdrawal created before 2026-08-15 satisfies the exemption, so the UPDATE
   commits and produces a fresh `completed`-without-payout row. A row created after the cutoff
   would instead raise a constraint violation the handler does not catch — it would surface as
   an opaque 500 rather than a clear refusal.

**Live exposure today:** exactly one `failed` withdrawal exists (created 2026-07-13), and it is
grandfathered. So the tool would silently succeed on it. Every *future* failed row lands in the
unhandled-error branch instead.

Admin UI entry point: [app/(admin)/withdrawal-recovery.tsx](../app/%28admin%29/withdrawal-recovery.tsx).

**Ambiguity flagged:** I have not determined whether any of the 25 historical rows were produced
by `force_retry` rather than by the two `/connect` paths. `admin_action_log` records
`force_retry_withdrawal` entries and could answer this, but attributing individual rows is a
data-analysis task I am deferring to Phase 5 rather than guessing at here.

---

## 5. Does anything check `stripe_connect_payouts_enabled` before a hunter accepts or is paid?

**Answer: only the v2 release path. Nothing in v1, and nothing at accept time in either
architecture.**

| Flow | Checks `payouts_enabled`? | Evidence |
|---|---|---|
| `accept-bounty-request` Edge Function | ❌ No | [accept-bounty-request/index.ts](../supabase/functions/accept-bounty-request/index.ts) — the entire 139-line file. It authenticates the caller, verifies `bounty_requests.poster_id === callerId`, then calls `fn_accept_bounty_request`. No profile lookup, no Connect fields read. |
| `fn_accept_bounty_request` RPC | ❌ No | [20260421_fix_fn_accept_bounty_request.sql](../supabase/migrations/20260421_fix_fn_accept_bounty_request.sql) — no `stripe_connect%` reference in the function body. |
| v1 `POST /wallet/release` | ❌ No | [wallet/index.ts:558-905](../supabase/functions/wallet/index.ts#L558-L905) — the authorization gate is [_shared/release-authorization.ts](../supabase/functions/_shared/release-authorization.ts), which resolves *who* the payee is (bounty ownership, payee identity) and never *whether they can be paid*. |
| v1 `approveAndRelease` orchestrator | ❌ No | [lib/services/completion-approval.ts](../lib/services/completion-approval.ts) — 96 lines, no Connect reference. |
| **v2 `POST /bounty-payments/release`** | ✅ **Yes** | [bounty-payments/index.ts:517-540](../supabase/functions/bounty-payments/index.ts#L517-L540) — returns `hunter_not_onboarded` if no `stripe_connect_account_id`, `hunter_payouts_disabled` if `stripe_connect_payouts_enabled !== true`. |
| Withdrawal (`/connect/instant-payout`) | ⚠️ Partial | [connect/index.ts:3067-3075](../supabase/functions/connect/index.ts#L3067-L3075) gates on `stripe_connect_account_id && stripe_connect_onboarded_at` — **not** on `payouts_enabled`. Per [BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md:240](payments/BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md), `onboarded_at` is set once and never cleared, so a since-restricted hunter passes this gate. `payouts_enabled` is the live-synced field ([webhooks/index.ts:177](../supabase/functions/webhooks/index.ts#L177)). |

### 5.1 The "Walk my cat" instance, verified live

```
bounty  53656a8b…  "Walk my cat"  status=completed  amount=80.00
        payment_architecture_version=1   completed_at=2026-08-24 01:43:42Z
hunter  6fdeb6f5…  stripe_connect_account_id = NULL
                   stripe_connect_payouts_enabled = false
                   balance = 73.60
```

The hunter has **no Stripe Connect account at all**. The $73.60 in their balance cannot be
withdrawn by any code path in the system — `/connect/instant-payout` and `/connect/transfer`
both require `stripe_connect_account_id`. The ledger says paid; the money is structurally
immobile. Nothing warned anyone, at accept time or at release time.

### 5.2 Population scale

**2 of 315** profiles have `stripe_connect_payouts_enabled = true`. Any v1 release to any of the
other 313 produces the same structurally-unwithdrawable credit. (This is a deterioration from
the 1-of-116 figure recorded in
[V2_FUNDING_MIGRATION_SCOPE.md](payments/V2_FUNDING_MIGRATION_SCOPE.md) on 2026-08-01 — the user
base tripled and the payout-ready count went from 1 to 2.)

### 5.3 Prior art

[docs/payments/V2_FUNDING_MIGRATION_SCOPE.md §2](payments/V2_FUNDING_MIGRATION_SCOPE.md) already
scopes an accept-time Connect gate — but explicitly **for v2 bounties only**, on the reasoning
that v1 fails *before* work starts (poster can't fund) while v2 fails *after*. That reasoning is
incomplete: v1 does not fail before work starts for the *hunter*. It never fails at all — it
silently produces an unwithdrawable balance. The v1 case belongs in that gate too.

---

## 6. What happens today when a `critical` reconciliation finding is inserted?

**Answer: nothing reaches a human. It is written to a table and, at most, printed to an Edge
Function log.**

### 6.1 There is no database-side hook

No trigger exists on `reconciliation_findings`. Searching every migration for
`ON public.reconciliation_findings` returns only index and RLS statements
([20260721_add_scheduled_reconciliation.sql:29-33](../supabase/migrations/20260721_add_scheduled_reconciliation.sql#L29-L33)).
There is no `AFTER INSERT` trigger, no `pg_notify`, no `net.http_post`.

The table is service-role-only (RLS enabled, **no policies**), so nothing client-side can even
observe it, and Supabase Realtime is not configured on it.

### 6.2 The application-side "alert" is a console call

[reconciliation/index.ts:188-201](../supabase/functions/reconciliation/index.ts#L188-L201):

```ts
function alert(severity: Severity, findingType: string, details: Record<string, unknown>): void {
  const payload = JSON.stringify({ severity, findingType, ...details });
  if (severity === 'CRITICAL') {
    console.error(`[reconciliation-alert][CRITICAL] ${findingType}`, payload);
  } else if (severity === 'WARNING') { … } else { … }
}
```

The function's own doc comment is candid: *"Emits an alert through the project's existing
structured-logging convention… The `[reconciliation-alert]` prefix is the searchable key."* It
is a **searchable** key, not a **routed** one. Someone has to go looking.

Every critical finding type routes here and nowhere else:
`orphan_stripe_payout` ([:536](../supabase/functions/reconciliation/index.ts#L536)),
`amount_mismatch` ([:573](../supabase/functions/reconciliation/index.ts#L573)),
`status_mismatch` ([:692](../supabase/functions/reconciliation/index.ts#L692)),
`transfer_fully_reversed` ([:721](../supabase/functions/reconciliation/index.ts#L721)),
`orphan_ledger_withdrawal` ([:772](../supabase/functions/reconciliation/index.ts#L772)),
`completed_withdrawal_without_payout` ([:807](../supabase/functions/reconciliation/index.ts#L807)),
`completed_withdrawal_without_payout_total` ([:899](../supabase/functions/reconciliation/index.ts#L899)),
`reconciliation_run_failed` ([:1069](../supabase/functions/reconciliation/index.ts#L1069)).

The DB-side function `run_withdrawal_reconciliation()` does not even have a `console` — it
inserts rows and returns a count
([20260718181000_reconciliation_known_exceptions_and_hardening.sql:60-198](../supabase/migrations/20260718181000_reconciliation_known_exceptions_and_hardening.sql#L60-L198)).

### 6.3 🔴 NEW-2 — the invariant sweep is not scheduled

Live `cron.job` contents (read-only):

| jobid | name | schedule | command |
|---|---|---|---|
| 1 | `daily-risk-assessment` | `0 2 * * *` | `SELECT run_periodic_risk_assessments()` |
| 5 | `withdrawal-reconciliation-daily` | `0 9 * * *` | `SELECT public.run_withdrawal_reconciliation();` |
| 6 | `stripe-balance-reconciliation-hourly` | `0 * * * *` | `net.http_post(… '/admin-withdrawals', body: {"action":"run_stripe_balance_sync"})` |
| 7 | `drain-notifications-outbox` | `* * * * *` | — |
| 8 | `drain-analytics-person-outbox` | `* * * * *` | — |

**No job invokes the `reconciliation` Edge Function.** Job 6 targets `admin-withdrawals` with
the balance-sync action, which produces `platform_balance_drift` /
`connect_account_balance_drift` only. The Edge Function that owns
`completed_withdrawal_without_payout`, `orphan_stripe_payout`, `status_mismatch`,
`orphan_ledger_withdrawal` and the invariant sweep runs **only when invoked by hand**.

Its most recent findings write is `2026-08-16 21:33:40 UTC` — eight days ago, and consistent
with a manual run during the withdrawal-payout-invariant work. Meanwhile jobs 5 and 6 have run
successfully every scheduled interval, most recently `2026-08-24 09:00` and `19:00`.

Net effect: **a new `completed`-without-payout row, or a new orphan Stripe payout, would not be
detected at all today** — not late, not silently-logged, but never.

### 6.4 Why the findings table looks frozen

`max(run_at) = 2026-08-18 09:00`, yet job 5 succeeded again on 2026-08-19 … 2026-08-24. This is
**by design, not a failure**: the 2026-07-18 hardening added a dedup predicate to every insert —

```sql
AND NOT EXISTS (
  SELECT 1 FROM public.reconciliation_findings f
  WHERE f.finding_type = 'stuck_pending_withdrawal'
    AND (f.details->>'transaction_id') = wt.id::text
    AND f.acknowledged_at IS NULL
)
```

([:120-129](../supabase/migrations/20260718181000_reconciliation_known_exceptions_and_hardening.sql#L120-L129), and the same shape on all eight checks).

An unacknowledged finding suppresses re-detection forever. That is correct for noise control and
**actively harmful as a health signal**: the table cannot distinguish "job ran, nothing new" from
"job never ran". `reconciliation_reports` is the table that would answer that, and nothing
surfaces it either.

### 6.5 Notification infrastructure that already exists (for Phase 2 option C)

Do not invent a new channel. Available today:

| Mechanism | Location | Suitability |
|---|---|---|
| `notifications_outbox` → `process-notification` | [docs/notifications/NOTIFICATIONS_FEATURE_OVERVIEW.md](notifications/NOTIFICATIONS_FEATURE_OVERVIEW.md); drained by cron job 7 every minute | Delivers **both** an in-app bell entry and a push. Service-role-only insert — a `SECURITY DEFINER` trigger can write to it. Requires a recipient `user_id`, so it needs a designated admin account. |
| `send-notification-email` Edge Function | [supabase/functions/send-notification-email](../supabase/functions/send-notification-email) | Direct email. Needs a recipient address. |
| `net.http_post` from pg_cron/triggers | already used by cron job 6 | The only currently-proven path from Postgres to an HTTP endpoint. Vault secrets `edge_function_base_url` and `reconciliation_cron_secret` already exist. |
| Slack | **none found** | No `SLACK_WEBHOOK`, no Slack client, no Slack reference anywhere in the repo. A Slack destination would be genuinely new infrastructure. |

---

## 7. Divergences from the briefing

### 7.1 `platform_balance_drift` is `warning`, not `critical`

416 open rows, severity `warning`. Its last write was **2026-08-08** — 16 days ago — even
though cron job 6, which produces it, has run hourly and succeeded every time since. Same dedup
explanation as §6.4 most likely, but I have not confirmed that the balance-sync handler in
`admin-withdrawals` uses the same `acknowledged_at IS NULL` predicate. **Flagged as unresolved.**

### 7.2 `connect_account_balance_drift` splits across severities

524 open = 470 `info` + 54 `warning`. None are `critical`. Whatever alerting Phase 4 adds for
`severity = 'critical'` will not touch these 524 — worth stating explicitly so nobody expects it
to.

### 7.3 There is **one** stuck pending withdrawal, not two

Live query returns exactly one row:

```
id=1148dbe1-de6b-4925-b992-d781295d7c46   user_id=78c972ad…   amount=-96.00
status=pending   payout_method=standard
stripe_transfer_id=tr_1U5LV2JekUCspsfJ1ZbjsGiR
stripe_payout_id=NULL
created_at=2026-08-17 08:02:28Z
```

Withdrawal status distribution overall: 27 `completed`, 1 `manually_paid`, 1 `pending`,
1 `failed`.

This is the textbook hop-1-succeeded/hop-2-never-created state: $96 sits in the connected
account with no Payout object. It is exactly the case
[connect/index.ts:2377-2385](../supabase/functions/connect/index.ts#L2377-L2385) says should be
left `pending` for reconciliation to surface — and it was surfaced, on 2026-08-18, into a table
nobody is paged from.

Whether a second stuck withdrawal existed and was since resolved, I cannot say without an audit
of historical status transitions. **Flagged.**

Note also that this user (`78c972ad…`) is the **poster** of "Walk my cat" — the same account is
simultaneously the subject of the stuck $96 withdrawal and the counterparty of the
unwithdrawable $73.60 release.

### 7.4 ~~Only 20 release rows for 44 completed bounties~~ — RESOLVED 2026-08-24

**Closed.** The gap is honor bounties, and it is not a defect. Verified breakdown of the 44:

| | Count |
|---|---|
| `is_for_honor = true` (amount $0.00 — nothing to release) | 26 |
| Paid (`is_for_honor = false`) | 18 |
| …of which have a completed `release` row | 17 |
| …of which have **neither** a release nor a refund | **1** — see §7.5 |

26 + 17 = 43 correctly-settled; the 44th is the orphaned escrow below. (The count of 20
completed `release` rows platform-wide exceeds 17 because three attach to bounties that are not
currently `status='completed'`.)

All 20 releases have `stripe_transfer_id IS NULL`, which is consistent with §2: v1 releases
cannot have one.

### 7.5 🔴 NEW-3 — one live orphaned escrow: `bba5e784…` ($1.00)

A second real instance of settlement failure, distinct in mechanism from "Walk my cat":

```
bounty  bba5e784-4a80-4f04-ad90-de5a27bfcc59  "Dispute flow prod test case 2"
        amount=1.00   is_for_honor=false   payment_architecture_version=1
        status=completed   completed_at=NULL   accepted_by=NULL
        poster_id = user_id = 8a8e1e87-2548-45e4-a0c4-27f4a0281b43
        created_at=2026-05-20 19:11:02Z

wallet_transactions for this bounty — exactly one row:
        3ddeaf97…  type=escrow  amount=-1.00  status=completed  2026-05-20 19:11:02Z
```

**This is the opposite failure to "Walk my cat", not a smaller copy of it.** The distinction
matters because the remediation differs:

| | "Walk my cat" (`53656a8b…`) | This row (`bba5e784…`) |
|---|---|---|
| Escrow debited | yes, $80 | yes, $1 |
| Release row | yes, $73.60 to hunter | **none** |
| Refund row | n/a | **none** |
| Hunter | assigned, cannot withdraw | **never assigned** |
| Money is | credited but unspendable | **stranded in nobody's hands** |
| Correct remedy | hunter completes Connect onboarding | **refund the poster** |

With `accepted_by IS NULL` there was never a payee, so a release was impossible and a refund was
the only correct settlement. Neither happened, and the bounty was still marked `completed`. The
$1.00 remains debited from `8a8e1e87…` with no offsetting row.

**Probable cause — inference, not confirmed.** `completed_at IS NULL` alongside
`status='completed'` rules out `completionService.approveSubmission()`, which always sets both
([completion-service.ts:806-810](../lib/services/completion-service.ts#L806-L810)). The path
that sets status without `completed_at` is the admin bounty screen
([app/(admin)/bounty/[id].tsx:150](../app/%28admin%29/bounty/%5Bid%5D.tsx#L150)) — audit finding
**#14** in §3.3, which performs no settlement check whatsoever. That makes #14 a **demonstrated**
defect rather than a theoretical one. 8 of the 18 paid completed bounties share this
`completed_at IS NULL` fingerprint.

**Scale and severity, stated honestly.** This is a $1.00 self-posted test bounty
(`poster_id == user_id`, title "Dispute flow prod test case 2") from dispute-flow testing on
2026-05-20. No third party is owed money. 17 of the 18 paid completed bounties are $1–$5 test
posts; only "Walk my cat" ($80) and "Social Media Marketer" ($20) represent real activity. So the
*financial* exposure here is one dollar — but the *code path* is live, unguarded, and would
behave identically on a real bounty of any size.

**Belongs in Phase 5** alongside the other historical rows, with "refund the poster" as the
proposed resolution. Because the escrow is `ledger_only` and no Stripe object exists, this one is
resolvable entirely inside the ledger and needs no Stripe lookup.

---

## 8. Open questions for Phase 2

1. **Should v1 be given an honest label or be stopped?** Option A in the Phase 2 brief
   (`settlement_state`) makes v1's behaviour truthful. It does not make a hunter with no Connect
   account able to spend the money. Relabelling and gating are complementary, not alternatives.
2. **Where does the accept-time gate belong?** `accept-bounty-request` is poster-initiated
   (poster accepts a hunter's *request*). There may be a separate hunter-initiated apply path.
   I have not traced `hooks/useAcceptRequest.ts` / `lib/services/bounty-request-service.ts` in
   this pass — [V2_FUNDING_MIGRATION_SCOPE.md §2](payments/V2_FUNDING_MIGRATION_SCOPE.md) names
   those as the intended gate location, and the ADR should confirm the full set of entry points
   before picking one.
3. **NEW-1 fix shape.** Should `force_retry` create a Payout (making it a real two-hop retry),
   or should it be reduced to "create the Transfer, leave the row `pending`, let `payout.paid`
   finish it"? The second matches the state machine and is smaller. Either way the
   `failed → completed` transition must go through `canTransition()`.
4. **NEW-2 fix shape.** Adding a `reconciliation` cron job is a one-line `cron.schedule`, but it
   will immediately re-detect the 25 grandfathered rows plus the 2 orphan payouts on every run.
   Scheduling and the dedup/acknowledgement story have to be designed together, or Phase 4's new
   alerting will fire a known-backlog storm on its first run.
5. **Severity taxonomy.** Phase 4 targets `severity = 'critical'`. Today that set is:
   `balance_drift`, `negative_or_inconsistent_balance`, `stuck_pending_withdrawal`,
   `duplicate_idempotency_key`, `multiple_pending_withdrawals`, `duplicate_transfer_id`
   (DB function) plus the eight Edge Function types in §6.2. It does **not** include the 940 open
   drift findings. Confirm that is intended.

---

## 9. What was NOT done

Per the Phase 1 instruction: no code changed, no migration written, no function deployed, no
production row modified, no `reconciliation_findings` row acknowledged or resolved, no Stripe
object created or inspected via the Stripe API (the Stripe MCP connector is unauthenticated in
this session — see §10).

Read-only `SELECT` statements were issued against production to verify the briefing's figures,
because several of them turned out to be materially different from what the briefing stated
(§7). Every query is reproduced inline above.

## 10. Tooling note

The `stripe` MCP connector is **not authorized** in this session, so no Stripe-side lookups were
possible. Phase 5 requires them (current Stripe state per row, searching for a matching payout).
That connector needs to be authorized from claude.ai connector settings before Phase 5 can be
done properly; without it, any Stripe-state column in the Phase 5 proposal would be guesswork.
