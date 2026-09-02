# Connect payout webhook gap — 2026-09-01

Triage of the 2026-08-31 Daily Brief's "288 critical financial mismatches".

**Short version:** the 288 was a measurement artifact (3 problems counted 96
times). Underneath it sat one real defect: Bounty has received **no Connect
`payout.*` webhook since 2026-08-10**, so two hunters who Stripe actually paid
still show `pending` in our ledger.

---

## 1. The 288 was not a financial trend

| Day | orphan_stripe_payout rows | distinct payouts | reconciliation runs |
| --- | --- | --- | --- |
| 08-28 | (22 rows, all types) | — | 22 |
| 08-29 | 0 new | — | 96 |
| 08-30 | 182 | 2 | 91 |
| 08-31 | 192 | **2** | **96** |
| 09-01 | 158 | 2 | 79 |

```sql
SELECT count(*), count(DISTINCT details->>'payoutId'), count(DISTINCT run_at)
FROM reconciliation_findings
WHERE run_at >= '2026-08-31' AND run_at < '2026-09-01'
  AND finding_type = 'orphan_stripe_payout';
-- 192 | 2 | 96
```

Three compounding causes:

1. **Findings had no identity.** `supabase/functions/reconciliation/index.ts`
   persisted with a plain `.insert()`, so every run appended a fresh row for a
   problem it had already reported.
2. **The job runs every 15 minutes.** Production cron
   `stripe-payout-reconciliation-15min` = 96 runs/day. 96 × 2 orphans = 192;
   96 × 1 invariant rollup = 96; **192 + 96 = 288.** The "climb from ~22/day"
   is that job's first partial day on 08-28.
3. **A known backlog was re-raised as CRITICAL forever.** The
   `completed_withdrawal_without_payout_total` rollup covers 25 rows
   ($526.65) from the pre-2026-08-15 instant-payout fallback incident, which
   the DB CHECK constraint explicitly grandfathers. Its own note says so — and
   it still paged as CRITICAL 96 times a day.

Across the whole open backlog: **2,463 observations → 26 distinct problems.**

## 2. The real defect: Connect payout webhooks stopped arriving

```sql
SELECT event_type, count(*), max(created_at) FROM stripe_events
WHERE event_type LIKE 'payout%' OR event_type LIKE 'transfer%' GROUP BY 1;
--  payout.paid     7  2026-08-10
--  payout.updated 12  2026-08-10
--  payout.created  7  2026-08-09
--  payout.failed   2  2026-07-16
--  transfer.failed 2  2026-07-16
```

No `payout.*` or `transfer.*` event has been received in three weeks. The
endpoint is alive — `setup_intent`, `payment_intent`, `identity.*` and
`customer.*` events all landed on 08-31 and 09-01. **Only the Connect
payout/transfer event classes are missing.**

### Why that strands money in `pending`

A standard Bounty withdrawal is two Stripe hops:

| Hop | Object | Created by | Recorded on the ledger row |
| --- | --- | --- | --- |
| 1 | Transfer (platform → connected account) | `/connect` | `stripe_transfer_id`, at birth |
| 2 | Payout (connected account → hunter bank) | Stripe's automatic payout schedule | `stripe_payout_id`, **only by the `payout.created` webhook** |

`findCandidateWithdrawalTx` in `supabase/functions/webhooks/index.ts` matches
payout events **by `stripe_payout_id` and nothing else** — deliberately, since
amount-matching misfired on 2026-07-27. Its docstring asserts:

> Every withdrawal row created by /connect carries its payout id from birth.

**That premise is false for the standard two-hop path.** It holds only for
instant payouts, where `/connect` creates the Payout itself. For standard
withdrawals the id arrives later, via `payout.created` — and
`webhooks/index.ts` already flags the dependency:

> NOTE: requires 'payout.created' to be enabled on this webhook endpoint's
> subscribed events in the Stripe Dashboard.

So when Connect payout deliveries stop, the chain is:

```
payout.created never arrives  → stripe_payout_id stays NULL
payout.paid never arrives     → withdrawal never promoted to completed
                              → ledger row pending forever      [stale_pending_withdrawal]
                              → Stripe payout matches no row    [orphan_stripe_payout]
```

**One event, reported as two unrelated finding types with contradictory
causes.** That is why the backlog looked like two separate problems.

### Money actually affected

| Ledger row | User | Amount | Stripe payout | Stripe status | Ledger status |
| --- | --- | --- | --- | --- | --- |
| `f3e54ebd-44fe-4dea-89ae-f00acf954b2d` | `3220ed37…` | $10.00 | `po_1U9xBjJFI0kXpnUQzY82Ia2M` | **paid** | pending |
| `46bf9258-bd40-4e47-ae96-c81a2b52fc76` | `78c972ad…` | $28.00 | `po_1U9xAnJU6XUMJosI7DdcU55N` | **paid** | pending |
| `205beb22-6d9f-4a25-b8ff-49f7514b4f2d` | `6fdeb6f5…` | $49.36 | — (none yet) | — | pending (9h) |

Each row's connected account matches its payout's account and the amounts are
exact. **Two hunters have been paid $38.00 in total while our ledger still
says their withdrawal is in progress.**

This is the *safe* direction of error — we under-claim payment rather than
over-claim it, and no user was shown "paid" without being paid. The real risk
is operational: a withdrawal stuck `pending` for days is exactly what invites a
manual re-payment, which would be a **double payout**.

The third row ($49.36) is the same path, 9 hours in, and will land in the same
state unless webhook delivery is restored.

---

## 3. What was changed in code

| File | Change |
| --- | --- |
| `supabase/migrations/20260901140000_reconciliation_finding_identity.sql` | `finding_key` identity, `first_seen_at`/`last_seen_at`/`occurrence_count`, partial unique index on open findings, idempotent `record_reconciliation_finding()` RPC, `reconciliation_open_findings` view. Collapses existing duplicates by marking them `resolution = 'superseded_by_dedupe_20260901'` — **nothing is deleted, no financial record is touched**. |
| `supabase/migrations/20260901140100_track_reconciliation_cron_schedule.sql` | Brings the untracked production cron job under version control. |
| `supabase/functions/reconciliation/reconciliation-logic.ts` | `buildFindingKey`, `findingSubject`, `correlatePayoutToPendingWithdrawal`, `splitInvariantViolations`. |
| `supabase/functions/reconciliation/index.ts` | Persist via the idempotent RPC; correlate two-hop payouts into a single `payout_id_never_recorded` finding; suppress the duplicate stale-pending report; split grandfathered vs current invariant violations; **fix the health endpoint's severity comparison**. |
| `__tests__/unit/reconciliation-finding-identity.test.ts` | 22 tests. |

### The health endpoint was silently blind

```js
// before — severity is stored lowercase ('critical'), so this was ALWAYS 0
const criticalOpen = findings.filter(f => f.severity === 'CRITICAL').length;
```

`reconciliation_findings.severity` carries
`CHECK (severity IN ('info','warning','critical'))` and every writer lowercases
on the way in. The admin health summary compared those rows against uppercase
literals, so `criticalOpen` and `warningOpen` were **always zero** and health
could never escalate on an open finding. Same class of bug as the findings
INSERT that failed its CHECK constraint silently for a month (found
2026-08-16).

### `payout_id_never_recorded` is a report, not a repair

The new correlation requires *all* of: same user, exact cents, transfer-present
and payout-absent (the two-hop shape), withdrawal predating the payout, and a
**unique** match. Anything ambiguous stays an orphan with the candidates
listed. It writes no payout id and moves no ledger row — amount-matching was
removed from the *repair* path for good reason and is not being reintroduced.

---

## 4. What must happen next — REQUIRES HUMAN ACTION

### 4a. Fix webhook delivery first (root cause)

In the Stripe Dashboard, for the webhook endpoint pointed at
`/functions/v1/webhooks`:

1. Confirm the endpoint is configured to receive **Connect events** (events on
   connected accounts), not only account-scoped platform events.
2. Confirm these event types are subscribed: `payout.created`, `payout.paid`,
   `payout.failed`, `payout.canceled`, `payout.updated`, plus `transfer.created`
   / `transfer.failed`.
3. Check the endpoint's delivery-failure log for 08-10 onward — an endpoint
   auto-disabled after repeated failures presents exactly this way.

Until this is fixed, **every standard withdrawal will strand in `pending`.**
This is the single highest-value action in this document; the repair below is
cleanup, this is the leak.

### 4b. Then repair the stranded rows — one at a time, with evidence

**Do not run this as a batch. Do not run it before 4a.** There is no existing
safe completion RPC (`fail_legacy_withdrawal` and `retry_failed_withdrawal`
exist; no committed counterpart does), so this is a direct, audited statement.

For **each** row, first confirm in the Stripe Dashboard that the payout listed
in §2 is genuinely the settlement of that withdrawal:

- open the payout on the connected account,
- confirm `status = paid` and the arrival date,
- confirm its amount and that it is funded by the transfer id on the ledger row,
- confirm no *other* pending withdrawal for that user could claim it.

Only then:

```sql
-- REVIEW BEFORE RUNNING. One row per execution. Substitute real ids.
-- Guarded so it is a no-op unless the row is still in the exact expected
-- state: re-running it cannot double-apply, and it cannot touch a row that
-- something else has already resolved.
BEGIN;

UPDATE public.wallet_transactions
SET stripe_payout_id = :payout_id,
    status           = 'completed',
    completed_at     = COALESCE(completed_at, now()),
    metadata         = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'payout_status',            'paid',
      'payout_id',                :payout_id,
      'manual_reconciliation',    'payout_webhook_gap_2026-09-01',
      'reconciled_by',            :operator_user_id,
      'stripe_evidence_checked',  true
    )
WHERE id = :transaction_id
  AND type = 'withdrawal'
  AND status = 'pending'          -- refuses if already resolved
  AND stripe_payout_id IS NULL    -- refuses if an id already landed
  AND stripe_transfer_id = :expected_transfer_id;

-- Expect exactly 1. If 0, STOP: the row is not in the state you verified.
-- Inspect, then COMMIT or ROLLBACK deliberately.
COMMIT;
```

Then resolve the matching findings:

```sql
UPDATE public.reconciliation_findings
SET resolved_at = now(),
    resolution  = 'payout confirmed in Stripe; id backfilled — webhook gap 2026-09-01'
WHERE resolved_at IS NULL
  AND finding_key IN (
    'payout_id_never_recorded:' || :payout_id,
    'orphan_stripe_payout:'     || :payout_id,
    'stale_pending_withdrawal:' || :transaction_id
  );
```

### 4c. Do not do these

- Do **not** mark a withdrawal completed because reconciliation *correlated* a
  payout to it. Correlation is a hint for a human; the Stripe Dashboard is the
  evidence.
- Do **not** resolve the 25 grandfathered `completed_withdrawal_without_payout`
  rows to clear the dashboard. They are real records asserting payment we hold
  no evidence for and still need a per-row decision.
- Do **not** re-pay a stuck `pending` withdrawal without checking Stripe for an
  existing payout on that connected account first. That is the double-payment
  path this gap creates.

---

## 5. Deployment order

1. `20260901140000_reconciliation_finding_identity.sql`
2. `20260901140100_track_reconciliation_cron_schedule.sql`
3. Deploy the `reconciliation` Edge Function (it calls the new RPC — deploying
   it *before* the migration means every findings write fails).
4. Fix the Stripe webhook subscription (§4a).
5. Repair the stranded rows (§4b).

Verify after step 3:

```sql
SELECT finding_type, count(*) AS open_problems, max(occurrence_count) AS times_seen
FROM public.reconciliation_open_findings GROUP BY 1 ORDER BY 2 DESC;
```

`open_problems` should now be single digits per type, with `times_seen`
climbing instead of the row count.
