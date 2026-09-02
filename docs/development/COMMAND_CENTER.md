# Founder Command Center

Operational observability for the Bounty marketplace: what is being posted,
applied for, accepted and completed; how much money is involved; whether the
money **actually moved**; and whether anything is broken.

This is an **observability layer only**. It does not change how payments work,
and nothing in it can move money. Repair actions stay where they already live
(Withdrawal Recovery, Balance Reconciliation, Disputes), so there is exactly
one audited path to settling a payout.

---

## The distinction the whole feature turns on

`bounties.status` is a **marketplace** fact. A bounty becomes `completed`
because a poster tapped a button. It says nothing about Stripe.

So every screen here carries two statuses:

| | Source of truth | Example |
|---|---|---|
| **Marketplace status** | `bounties.status` | `completed` |
| **Financial status** | derived, in `admin_bounty_financial_state` | `released_unverified` |

A bounty can be **COMPLETED + FINANCIAL VERIFICATION PENDING**, and the console
says so in those words rather than showing a green tick.

`stripe_confirmed` is true only when a **signature-verified Stripe webhook**
landed against the bounty, or a Stripe object id (`stripe_charge_id` /
`stripe_transfer_id`) is stored on its `bounty_payments` row. Our own
`wallet_transactions` row saying `completed` does **not** count — that is the
platform asserting money moved, not Stripe confirming it.

### Expect a large verified-GMV gap under v1

Under the v1 wallet architecture (which is what 111 of 115 production bounties
use) a *release* is an internal wallet move between two balances. No Stripe
object exists for it; the Stripe leg happens later, at withdrawal. So verified
GMV is legitimately far below completed GMV today. The Command Center states
this on the screen rather than hiding the number or quietly inflating it.

---

## Canonical event ledger: `public.bounty_events`

One append-only table that every other table feeds.

| Column | Meaning |
|---|---|
| `event_key` | **Idempotency key**, unique. Derived deterministically from the thing that happened. |
| `bounty_id` | Not a foreign key — an event whose bounty is gone is an anomaly we must be able to report. |
| `actor_id` | Who did it (nullable for system/Stripe events). |
| `event_type` | e.g. `bounty.posted`, `payment.released`, `stripe.payout.paid`. |
| `source` | Provenance. See below. |
| `correlation_id` | Ties an app action to its Stripe objects (payment intent / transfer / payout id). |
| `occurred_at` | When it happened, not when it was recorded. |
| `amount`, `currency`, `metadata` | Payload. |

### Provenance (`source`)

| Value | Rendered as | Means |
|---|---|---|
| `app` | APP EVENT | our tables recorded a user action |
| `system` | SYSTEM EVENT | a backend job acted |
| `stripe` | STRIPE EVENT | observed by reading the Stripe API |
| `webhook` | WEBHOOK CONFIRMATION | a signature-verified Stripe webhook |
| `inferred` | INFERRED STATE | reconstructed from surrounding state — **not** a confirmation |

`inferred` exists because the schema never recorded when a bounty was accepted
or cancelled. Those points are reconstructed from `updated_at` during backfill.
They are shown, because an operator needs the shape of the story, but they are
never presented as observed events and never as Stripe success. Unrecognised
provenance degrades to `inferred`, never to `webhook`
(`normalizeSource` in `lib/admin/commandCenterClient.ts`).

### Idempotency

Every producer derives `event_key` from the event itself, and the only writer
(`record_bounty_event`) is `ON CONFLICT (event_key) DO NOTHING`. Re-running the
backfill, replaying a webhook, or firing a trigger twice all insert exactly one
row. Verified in `scripts/verify-command-center-migration.js`.

### Safety of the producers

Triggers on `bounties`, `bounty_requests`, `completion_submissions`,
`wallet_transactions`, `bounty_payments`, `bounty_disputes` and `reports` write
to the ledger. **Every one of them swallows its own errors**
(`EXCEPTION WHEN OTHERS THEN RAISE WARNING … RETURN NULL`) and is an `AFTER`
trigger, so a ledger failure can never block a marketplace or money write. This
is deliberate: an untracked production trigger on `profiles` once blocked every
paid bounty, withdrawal and dispute write. That class of incident is
structurally impossible here.

### Unforgeability

`record_bounty_event` is `SECURITY DEFINER` with `EXECUTE` revoked from `anon`
and `authenticated`; only the (also `SECURITY DEFINER`) triggers and
`service_role` can reach it. `bounty_events` has a single admin-only `SELECT`
policy and **no** insert/update/delete policy at all, so the table is
append-only by construction. A previous audit found a forgeable
`dispute_audit_log`; this avoids the same shape.

---

## Reads (all admin-gated)

Every function begins with `admin_assert_role()`, which raises `42501` unless
`auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`. That is the authorization
boundary — the functions are `SECURITY DEFINER` and aggregate across all users
by design. (`profiles.role = 'admin'` is **not** used: it is NULL for every row
in production.)

| Function | Used by |
|---|---|
| `admin_marketplace_overview(p_since)` | Command Center headline numbers |
| `admin_activity_feed(limit, before, before_id, sources, types, bounty_id, actor_id)` | Live activity feed (keyset-paginated) |
| `admin_financial_anomalies(limit)` | Financial Integrity queue |
| `admin_bounty_detail(bounty_id)` | Bounty detail — both statuses in one round trip |
| `admin_bounty_timeline(bounty_id, limit)` | Lifecycle timeline |
| `admin_suspicious_listings()` / `admin_suspicious_applications()` | Trust & safety counts |

---

## Anomaly detection

`admin_financial_anomalies()` reports, it never repairs.

| Anomaly | Severity | Rule |
|---|---|---|
| `completed_without_financial_record` | critical | completed, paid, no escrow/release/payment row |
| `completed_without_stripe_confirmation` | high | released in our ledger, Stripe never confirmed |
| `financial_record_without_bounty` | critical | ledger or payment row points at a missing bounty |
| `release_without_transfer` | critical | **v2 only** — see note below |
| `payout_success_without_stripe_confirmation` | critical / medium | withdrawal `completed`, no payout id, no payout webhook. Aged down past 90 days so the known legacy backlog does not drown out a fresh one. |
| `stripe_payout_failure` | critical | Stripe reported a failed payout/transfer |
| `payout_pending_too_long` | critical | withdrawal pending > 72h |
| `escrow_held_on_terminal_bounty` | high | cancelled/archived/deleted, escrow never released or refunded |
| `escrow_amount_mismatch` | high | escrowed ≠ bounty amount |
| `webhook_processing_failure` | critical | `stripe_events.status = 'failed'` |
| `webhook_unprocessed` | high | received > 1h ago, never finished |
| `duplicate_financial_record` | critical | two identical completed ledger rows for one bounty within 60s |

**Deliberately not flagged:** a v1 release with no Stripe transfer. Under v1 no
transfer is ever expected at release time. Flagging those would report all 21
production releases as broken and train the operator to ignore the screen. Only
bounties with `payment_architecture_version >= 2` (or a `bounty_payments` row)
are held to the transfer expectation.

### Suspicious activity

Built only from signals the database actually carries; every row names the rule
that fired, so an operator can disagree with the rule rather than with an
opaque score.

*Listings:* an open report; a poster who is suspended/banned/restricted or
`risk_level = 'high'`; ≥ $200 posted within 24h of signup; 3+ identical titles
from one poster inside 24h.

*Applications:* a suspended/banned/restricted hunter; applying to your own
bounty (should be structurally impossible); 10+ distinct bounties applied to
inside 24h.

---

## Screens

| Route | File |
|---|---|
| `/(admin)/command-center` | `app/(admin)/command-center.tsx` |
| `/(admin)/anomalies` | `app/(admin)/anomalies.tsx` |
| `/(admin)/bounty/[id]/timeline` | `app/(admin)/bounty/[id]/timeline.tsx` |
| `/(admin)/bounty/[id]` (extended) | financial-status panel + timeline link |

Both new destinations are linked from the existing dashboard under a new
**Overview** group.

---

## Tests

**DB level** — `node scripts/verify-command-center-migration.js`

Applies the migration inside a transaction against the real schema, exercises
the feature, and always rolls back. 31 checks: bounty creation, application,
acceptance, completion, financial events, ledger idempotency, webhook
claim/dedupe, payout failure, missing payment record, mismatched financial
state, orphan-record handling, overview/feed/detail/timeline, RLS, and
unauthorized access to all six admin functions.

Needs `DATABASE_URL` in `.env.production`. The direct `db.<ref>.supabase.co`
host is IPv6-only; the script routes through the session-mode pooler and tries
both shards. Override with `PG_POOLER_HOST`.

**Unit level** — `npx jest __tests__/unit/command-center-client.test.ts`

33 tests over the mapping and labelling logic, concentrated on the rule that
our ledger is never presented as a Stripe confirmation.

---

## Known limitations

- **The migration is written but not applied to production.** It has only ever
  been run inside a rolled-back transaction. Until it is applied, every
  Command Center screen will show the "migration may not have been applied"
  error state.
- **The webhook function change is not deployed.** `supabase/functions/webhooks`
  must be redeployed for `claim_stripe_event` and ledger recording to take
  effect. Deploying it *before* the migration is applied would break every
  webhook, because `claim_stripe_event` would not exist and the handler now
  fails closed on a claim error. **Apply the migration first, then deploy.**
- **Verified GMV will read near zero** until v2 (Stripe-native) payments carry
  real volume. This is accurate, not a bug — see the v1 note above.
- Backfilled acceptance/cancellation timestamps are `inferred`, because the
  schema never recorded them. Ordering within the same `updated_at` is
  approximate for those rows only.
- Anomaly detection is computed live on each request. At current volume
  (115 bounties, 195 ledger rows, 872 webhook events) that is fine; past
  roughly 10⁵ rows the detectors should move to a scheduled run writing into
  `reconciliation_findings`, which already exists for the payout-side checks.
- `admin_marketplace_overview` calls the anomaly and suspicious-activity
  functions inline, so its cost grows with theirs.
- Suspicious-activity thresholds are constants in SQL, not operator-tunable.
