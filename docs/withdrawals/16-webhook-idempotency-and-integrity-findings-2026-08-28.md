# Financial findings — Command Center audit, 2026-08-28

Isolated from the Command Center observability work (see
`docs/development/COMMAND_CENTER.md`). Nothing in the payment architecture was
rewritten; these are the defects and open exposures that building the
observability layer surfaced.

---

## Finding 1 — `stripe_events` never actually deduped webhooks (FIXED)

**Severity:** high (latent — no confirmed money loss)
**Status:** fixed in this change; **not yet deployed**

### What was wrong

`supabase/functions/webhooks/index.ts` opened every request with:

```ts
await supabase.from('stripe_events').upsert(
  { stripe_event_id: event.id, event_type: event.type,
    event_data: event.data.object, processed: false },
  { onConflict: 'stripe_event_id' }
);
```

…and then ran the handler unconditionally. Two consequences:

1. **No deduplication.** A Stripe redelivery of an event that had already been
   processed re-entered the full handler. `stripe_events` looked like a dedupe
   table (it has a `UNIQUE (stripe_event_id)` constraint and a `processed`
   flag) but nothing ever read `processed` before doing work.
2. **The health signal was corrupted.** Because the upsert set
   `processed: false` on conflict, a redelivery *reset* an already-processed
   event back to unprocessed. Any monitoring built on `processed` — including
   the `webhook_unprocessed` detector added in this change — would be reading a
   flag the endpoint itself was flipping backwards.

### Why this did not lose money

Every money-moving handler carries its own idempotency key, independently of
the table:

- deposits → `apply_deposit` RPC, idempotent on a `stripe_payment_intent_id`
  unique constraint;
- refunds → `apply_refund` RPC, `ON CONFLICT DO NOTHING` on a
  `stripe_refund_id` unique partial index;
- v2 escrow capture → a status-gated update
  (`.in('status', ['pending_payment','authorized'])`) that a replay cannot
  re-apply;
- payout notifications → insert-then-update against a partial unique index.

So the exposure is **latent, not active**: correctness rested entirely on every
individual handler remembering to be idempotent, with no backstop. The next
handler added without its own key would double-apply on the first Stripe
redelivery, and Stripe redelivers routinely (any 5xx, any timeout).

### The fix

New `claim_stripe_event(p_stripe_event_id, p_event_type, p_event_data)`:

```sql
INSERT INTO stripe_events (...) VALUES (...)
ON CONFLICT (stripe_event_id) DO UPDATE
  SET status = 'processing', last_retry_at = now(),
      retry_count = COALESCE(stripe_events.retry_count, 0) + 1
  WHERE stripe_events.processed IS DISTINCT FROM true
RETURNING id;
```

Returns true only when the caller won the claim. Two concurrent deliveries of
the same event serialise on the conflicting row, so exactly one can proceed;
an already-processed event returns no row and the endpoint responds
`{ received: true, duplicate: true }` without re-entering the handler.

The webhook now also **fails closed**: if the claim itself errors, it returns
500 so Stripe retries, rather than guessing and processing.

Verified in `scripts/verify-command-center-migration.js`
("claim_stripe_event claims once, refuses the redelivery" — `first=true
second=false`).

### Deployment order matters

`claim_stripe_event` must exist before the new function code runs, and the
function now fails closed on a claim error. **Apply the migration first, then
deploy `supabase/functions/webhooks`.** Deploying in the other order would 500
every webhook until the migration lands.

---

## Finding 2 — 25 withdrawals marked successful with no Stripe payout id (OPEN)

**Severity:** medium (legacy)
**Status:** open; reported by `payout_success_without_stripe_confirmation`

25 of 27 `completed` withdrawals, totalling **$526.65**, carry no
`stripe_payout_id` and have no matching payout webhook. They predate payout-id
capture, so this is almost certainly a recording gap rather than money that
never arrived — but the platform cannot currently *prove* those payouts
happened from its own records. This is the same backlog noted in
`project_withdrawal_payout_invariant_2026-08-16`.

The detector ages severity down past 90 days precisely so this known backlog
does not mask a fresh occurrence.

**Recommended:** reconcile against the Stripe payout list once and either
backfill the ids or record a `reconciliation_known_exceptions` row per
withdrawal. Not done here — it is a data-repair task, not observability.

---

## Finding 3 — 18 completed bounties with no Stripe confirmation (EXPECTED, but worth stating)

**Severity:** informational under v1
**Status:** open by design; reported by `completed_without_stripe_confirmation`

18 completed bounties, **$170.00**, were released in our wallet ledger with no
Stripe object of any kind. Under the v1 architecture this is correct: a release
is an internal balance move and the Stripe leg happens later, at withdrawal.

It is reported anyway because the platform cannot distinguish "v1 release,
Stripe not expected" from "v2 release, transfer missing" without knowing the
bounty's `payment_architecture_version` — and once v2 carries real volume, this
detector is the one that will catch a genuinely missing transfer. The
`release_without_transfer` detector is scoped to v2 only for the same reason.

---

## Finding 4 — $18.90 of escrow stranded on 4 finished bounties (OPEN)

**Severity:** high
**Status:** open; reported by `escrow_held_on_terminal_bounty`

Four bounties are `cancelled` / `archived` / `deleted` while still holding a
net **$18.90** in escrow that was never released to a hunter nor refunded to
the poster. Small in absolute terms, but it is real user money sitting in a
state no flow will ever resolve on its own, and the shape generalises.

**Not fixed here.** Refunding it moves money and belongs on the Withdrawal
Recovery / Balance Reconciliation path with its own audit trail.

---

## Finding 5 — 7 Stripe events received over an hour ago and never completed (OPEN)

**Severity:** high
**Status:** open; reported by `webhook_unprocessed`

Seven rows in `stripe_events` have `processed = false` and are more than an
hour old. Given Finding 1, these are **not trustworthy as a diagnosis**: some
may be genuinely unprocessed, and some may be processed events whose flag was
reset by a later redelivery. This can only be assessed properly after the
Finding 1 fix is deployed and the flag becomes meaningful.

---

## Observation, not a finding

The one long-stuck pending withdrawal ($96) that
`project_payout_failed_taxonomy_fix_2026-08-24` recorded was moved to
`manually_paid` at 2026-08-28 18:49 UTC, during this session, by something
outside this work. `payout_pending_too_long` now returns zero. Noted so the
change is not mistaken for an effect of this migration — the migration has
never been applied and every verification run was rolled back.

---

## Explicitly not done

- No change to charge, capture, transfer, payout or refund logic.
- No change to how escrow is reserved or released.
- No repair of any of Findings 2–5. They are reported, not remediated; the
  Command Center is read-only and adding a "fix" button to it would create a
  second, unaudited path to moving money.
