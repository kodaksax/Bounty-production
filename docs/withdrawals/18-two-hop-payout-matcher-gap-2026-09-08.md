# The two-hop payout matcher gap — 2026-09-08

Closes the third row left open by
[17-payout-webhook-gap-2026-09-01.md](./17-payout-webhook-gap-2026-09-01.md)
(`205beb22`, user `6fdeb6f5`, **$49.36**) and fixes the defect underneath it.

**Short version:** doc 17's §4a fix was real — Connect payout webhooks have
been arriving again since ~09-02. But a second, independent defect meant the
row still could not heal: the payout matcher can only find a withdrawal *by*
the payout id it is trying to write. The hunter had in fact been paid on
**2026-09-04**; only our ledger disagreed.

---

## 1. No money was ever stranded

Stripe payout `po_1UB2dyJpXfRe26ucsYZclZ4b`, from events already in our own
`stripe_events` table:

| Field | Value |
| --- | --- |
| status | `paid` (livemode) |
| amount | 4936c — exactly $49.36 |
| destination | `ba_1UApGBJpXfRe26uc2EdE9zOJ` — *identical* to the withdrawal's `metadata.destination_bank_account_id` |
| account | `acct_1UApAaJpXfRe26uc` — the user's `stripe_connect_account_id` |
| created / paid / arrival | 09-03 / 09-03 / **09-04** |

The user was even notified on 09-03 ("Payout Successful"; the notification row
carries the matching `stripe_payout_id`). For five days their wallet said
`pending` while their notifications said paid.

## 2. Why it could never self-heal — a circular dependency

`/connect` could not create the Payout itself: Stripe refuses API payout
creation on a connected account with an **automatic** payout schedule, and the
row records exactly that —
`metadata.payout_creation_failed = 'cannot_create_connect_standard_payouts_through_api'`.
So `stripe_payout_id` was NULL from birth and Stripe's own scheduled payout
settled days later.

`findCandidateWithdrawalTx` matches on `stripe_payout_id` **and nothing else**.
Both handlers that could have attached the id use it:

```ts
// payout.created, before this change
const candidateTx = await findCandidateWithdrawalTx(...);   // .eq('stripe_payout_id', payout.id)
if (candidateTx) {
  await supabase.from('wallet_transactions')
    .update({ stripe_payout_id: payout.id })
    .eq('id', candidateTx.id)
    .is('stripe_payout_id', null);        // <- excluded by the lookup above
}
```

To write the id it must first find a row that already has it, and then it
guards the write with `stripe_payout_id IS NULL`. **Both conditions can never
hold at once** — the backfill was unreachable dead code. `payout.paid` used the
same matcher, so it could never promote the row either.

The docstring's premise — "every withdrawal row created by /connect carries its
payout id from birth" — is true only for *instant* payouts, where `/connect`
creates the Payout itself. It has been corrected in place.

## 3. The latent P0 this uncovered — read before deploying

Migration `20260824010000_add_stripe_payout_status_column.sql` **had never been
applied to production**, yet the deployed `webhooks` function writes
`stripe_payout_status` in the `payout.paid` promotion. It had never fired only
because the matcher never returned a row:

```sql
-- zero rows, entire table history
SELECT count(*) FROM wallet_transactions WHERE metadata ? 'payout_paid_at';
```

**No withdrawal has ever been completed by `payout.paid`.** Every `completed`
withdrawal in this table got there some other way.

That inverts the deploy order. Shipping the matcher fix *alone* would have made
things worse: `payout.paid` would have started matching pending rows for the
first time, hit the missing column, thrown, and put the webhook into a Stripe
retry loop. **Migration first, then the function.** That is the order used on
2026-09-08.

## 4. The fix

`selectTwoHopWithdrawalMatch` in `_shared/payout-state.ts` (pure, unit-tested)
plus `findWithdrawalAwaitingPayoutId` in `webhooks/index.ts`, tried **only
after** the strict id match misses. Every one of these is required, and a miss
on any one yields no match:

- same user (resolved from the payout's connected account),
- `status = 'pending'` and `stripe_payout_id IS NULL`,
- `stripe_transfer_id` present — the two-hop shape,
- amount equal **to the cent**,
- `metadata.destination_bank_account_id` = the payout's `destination`,
- withdrawal predates the payout,
- and the match is **unique** — two candidates means no match.

This is not a return to the amount-matching removed on 2026-08-16. That
heuristic took "most recent completed withdrawal with this amount" and attached
a dashboard payout to a row eleven days older. Destination identity and
uniqueness are what it lacked.

Exact-cents matching is also what keeps Stripe's sweep behaviour safe: an
automatic payout drains the account's whole balance, so a sweep covering two
withdrawals equals neither and correctly matches nothing.

### The load-bearing safety rule

**`handleUndeliveredPayout` (payout.failed / payout.canceled) must never use
the fallback.** Those paths credit real balance back to the hunter; a wrong
match there hands out money for a withdrawal that was already delivered — the
only money-losing direction of this bug. They keep matching by id alone, and
stay correct for standard withdrawals anyway because `payout.created` now
attaches the id first. A test in `withdrawal-payout-integrity.test.ts` pins it.

## 5. What was executed (2026-09-08, authorized per-step)

1. Migration `20260824010000` applied, and recorded under **its own repo
   version** so prod's ledger matches the file. Verified by probe: both CHECKs
   actually reject bad writes.
2. `webhooks` deployed via CLI — **v81 to v84**. Verified from the deployed
   bundle, not the API response: the fallback is present, and absent from
   `handleUndeliveredPayout`.
3. Row `205beb22` repaired by guarded UPDATE (1 row). Balance untouched at
   $0.00 and equal to the completed-ledger sum. **0 pending withdrawals remain
   platform-wide.** 146 duplicate findings resolved.

Moved no money — Stripe had already paid.

## 5a. Addendum, same day: `20260824010100`/`010200`/`010300` applied

The remaining ADR 0001 §2 chain — the `settlement_state` column, its
derivation trigger on both `wallet_transactions` and `bounty_payments`, and
the backfill — turned out to have an unapplied **prerequisite** the original
`docs/withdrawals/17` scope missed: `20260824010100_add_settlement_state.sql`
creates the enum and column that `010200`'s trigger writes and `010300`'s
backfill re-derives. Neither could run without it.

All three were dry-run in a transaction and rolled back first (both of
`010300`'s hard invariant checks — no settled release without a transfer id,
no settled withdrawal without a payout id — passed silently, confirming the
gate that matters actually fires), then applied for real and re-verified
live: column, both triggers, and all three migration rows are present, and a
probe update confirmed the trigger genuinely overrides a direct attempt to
set `settlement_state` rather than merely defaulting to it.

No Edge Function redeploy was needed — the column is derived in the database
only; no application code writes it. The `wallet` function already read it
behind a `??` fallback, so it was never actually erroring despite the column
missing for two weeks.

Live backfill result: 25 withdrawals `ledger_only` (the known historical
set), 5 `stripe_pending`, and exactly 1 `stripe_settled` — the row repaired
in §4 above, self-consistently confirming this doc's own fix.

## 6. Still open

- **Doc 17 §5 step 3 was never done.** `reconciliation_findings.finding_key`
  and `occurrence_count` are still NULL/1 on live rows, so the dedupe RPC is
  not in the deployed `reconciliation` function — which is why closing one
  problem resolved 146 rows.
- The 25 grandfathered `completed_withdrawal_without_payout` rows ($526.65)
  still need a per-row decision.
- Accounts differ in payout schedule: `3220ed37`'s withdrawals now succeed at
  API payout creation while `6fdeb6f5`'s do not. Worth deciding deliberately
  rather than leaving it to per-account Stripe settings.
