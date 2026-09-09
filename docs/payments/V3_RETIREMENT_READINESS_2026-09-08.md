# Is there enough proof to retire v1/v2 for v3? — 2026-09-08

**No — not "not enough evidence yet." There is no evidence to weigh: v3 has
never carried a single bounty, deposit, or payout in production.** This is a
rollout question, not a migration question.

Related: [ADR 0001 §5.3](../adr/0001-payment-settlement-invariant.md#53-sunsetting-v1)
(the existing, narrower v1→v2 sunset gate), `docs/payment-hardening-audit-2026-09-02.md`.

---

## The numbers, checked live against Stripe-adjacent tables, not code

| | v1 (wallet) | v2 (`bounty_payments`) | v3 (`bounty_v3_funding`) |
|---|---|---|---|
| Bounties ever on this path | 128 | 8 | **0** |
| Ever completed / released to a hunter | 57 | **0** | **0** |
| Rollout switch | — (default) | `payment_architecture_version` per-bounty | `v3_rollout_config`: `enabled=false`, `rollout_percent=0`, `cohort_user_ids={}` |

```sql
select * from v3_rollout_config;
-- enabled=false, cohort_user_ids={}, rollout_percent=0

select count(*) from bounty_v3_funding;   -- 0
select status, count(*) from bounty_payments group by 1;
-- captured: 2, refund_pending: 5, refunded: 1   (never: released)
```

`ledger_entries` — the v3/shadow observability spine — carries **no v3-shaped
row at all**. Every entry is `leg IN ('payment','escrow_hold','capture_release',
'refund','payout')`, i.e. it is a mirror of v1's `wallet_transactions` via the
capture trigger from [[v3-phase1-shadow-ledger]], not evidence of a v3
transaction. v3's own schema (Phases 1–4, all four migrations applied live)
exists and appears correctly built, but nothing has ever run through it.

**v2** is not much further along despite being older and switched on for
new bounties by `payment_architecture_version=2`: 8 bounties total, all
either `open`, `archived`, `deleted`, or `cancellation_requested`; zero have
ever reached `bounty_payments.status='released'`. The Sept-2 hardening audit
independently flags v3's release path as still carrying a P1 (non-atomic
write of `bounty_v3_funding` + `ledger_entries` after the Stripe capture) —
i.e. even the untested path is known-incomplete, not just unexercised.

**The ADR's own gate for the easier question — retiring v1 in favor of v2 —
is payout-ready ≥ 60% of hunters who've accepted a bounty, sustained 2
weeks.** Live today: **3 of 30 (10%)**. Retiring v1/v2 for v3 is a strictly
harder bar than a gate we are at one-sixth of.

## What this means

- There's no data to found a "v1/v2 vs v3" comparison on — v3 has a 0-row
  sample size. Framing this as "do we have enough proof" undersells it: the
  experiment hasn't started.
- v1 is the only architecture that has ever actually paid a hunter (57
  bounties). It is not a legacy path limping along next to a proven
  successor; it is the only path with a track record at all.
- v2's near-total non-adoption (8 bounties, 0 releases, ~3 weeks live) is
  itself worth a separate look — either traffic never reached it, or
  something in its release path doesn't fire. Not diagnosed here.

## To get real evidence

1. Set `v3_rollout_config.cohort_user_ids` to a handful of known-good test
   accounts (e.g. the Stripe fixture account, [[stripe-test-fixture-account]])
   and post/accept/release one real v3 bounty end-to-end. Confirm
   `payment_intent.amount_capturable_updated` → `authorized`, capture +
   transfer, `transfer.created` → `released` + `ledger_entries.stripe_state
   = 'confirmed'`.
2. Fix the P1 the Sept-2 audit already found (non-atomic post-Stripe write)
   before that cohort, or the first real test is exercising a known gap.
3. Only after that: raise `rollout_percent` gradually, watching
   `reconciliation_findings` for anything v3-shaped.
4. Retiring v1 specifically also still needs the ADR §5.3 preconditions
   regardless of v3 — payout-ready hunter population is the long pole, and
   v3 doesn't relax it; a v3 release with a non-payout-ready hunter fails
   exactly as a v2 one does.

**Recommendation: do not plan a v1/v2 retirement date around v3 yet.** Next
step is turning v3 on for one cohort, not evaluating it against v1/v2 — there
is nothing yet to evaluate.
