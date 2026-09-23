# $1 Posting Service Fee — experiment runbook

**Status:** built, **not deployed**. Nothing is live until the steps in
[Deploy order](#deploy-order) are run, and nothing charges anyone until the
PostHog flag is created.

---

## What it does

In the treatment arm, publishing a bounty goes through a checkout first. One
Stripe charge collects **both**:

| Line | Amount | Where it goes |
| --- | --- | --- |
| Bounty reward | what the poster set | Credited to their wallet, then escrowed at insert. Still their money. |
| Posting service fee | **$1.00** | Platform revenue. Non-refundable. |

The bounty is created only after the server has verified the charge with
Stripe. Nothing further is charged when a hunter is hired.

Control is today's flow, untouched: publishing is free, and the reward is
escrowed when a hunter is accepted.

```
TREATMENT (20%)                      CONTROL (80%)
  compose → checkout                   compose → post
    reward   $50.00  charged now         (nothing charged)
    fee       $1.00  charged now
    ─────────────────                  bounty live, UNFUNDED
    total    $51.00                      ↓
  bounty live, FUNDED                  hunter accepted
    ↓                                    ↓
  hunter accepted → no charge          $50.00 escrowed
```

> **Note on scope.** The original brief asked to preserve deferred funding and
> charge only the $1. That was changed by product decision on 2026-09-21: the
> treatment arm now collects the full reward up front as well. Control still
> preserves deferred funding exactly. The consequence for analysis is that
> treatment differs from control by **two** things (a fee *and* up-front
> escrow), so a conversion drop cannot be attributed to the $1 alone.

---

## Feature flag

Uses the existing PostHog flag mechanism — the same one behind
`post-first-pay-at-accept`. No new flag system was introduced.

* **Key:** `posting-service-fee`
* **Type:** multivariate
* **Variants:** `test` → treatment (paid), `control` → control
* **Rollout:** 20% `test`, 80% `control`

**The flag does not exist yet. Until it is created, every device resolves
`control` and the feature is inert** — which is the intended safe default and
also the kill switch: set the rollout to 0% to stop any new poster entering the
checkout, with no deploy.

### Why assignment is stable

Two independent mechanisms, because this arm takes money:

1. PostHog's rollout hashing is a pure function of (flag key, distinct_id), so
   a given user lands in the same bucket on every evaluation, forever.
2. The resolved arm is persisted to `AsyncStorage`
   (`@bounty_posting_fee_variant`) on first resolution, so a flag-config change
   or a PostHog outage cannot move someone who has already seen one arm.

If flags never arrive, the device runs **control for that session without
persisting** — so it stays enrollable but is never charged on a guess.

*Source:* [`lib/experiments/posting-fee-variant.ts`](../lib/experiments/posting-fee-variant.ts)

### Eligibility

Treatment applies to paid posts on the main composer only. Excluded:
$0/honor posts, and any publish where the arm has not resolved yet.

---

## Duplicate-charge protection

The poster is never charged twice. This is structural, not best-effort — four
independent layers:

1. **`posting_attempt_id`** — one client-generated uuid per posting attempt,
   stable across retries, remounts and restarts. `UNIQUE` in the DB.
2. **Deterministic Stripe idempotency key** — derived from
   `(attempt id, total)`, so a retried intent request returns the *same*
   PaymentIntent. (Deliberately **not** `generateStripeIdempotencyKey()`, which
   is nonce-based by design and so cannot protect a lost response.)
3. **`alreadyPaid`** — the server returns this instead of charging when the
   attempt is already settled. This is the interrupted-checkout path: paid, app
   died, poster came back.
4. **`apply_deposit` idempotency** — dedupes on the PaymentIntent id, so the
   client settle and the webhook can run in either order.

A failed *publish* after a successful *payment* therefore costs nothing to
retry, and emits `posting_checkout_reused` — **that event is the
duplicate-charge canary. It should be rare, and should never co-occur with a
second `posting_checkout_succeeded` for the same attempt.**

---

## Analytics

Existing funnel events are reused with added properties; new events cover only
what the existing funnel cannot express.

| Funnel step | Event | Notes |
| --- | --- | --- |
| Posting flow entered | `composer_opened` | + `posting_fee_variant`. This is also the exposure event. |
| Publish committed | `bounty_submitted` | existing |
| Checkout displayed | `posting_checkout_shown` | **new** |
| Checkout initiated | `posting_checkout_started` | **new** |
| Payment succeeded | `posting_checkout_succeeded` | **new** |
| Payment failed | `posting_checkout_failed` | **new**, carries `stage` (`intent`/`confirm`/`settle`) + `reason` |
| Payment cancelled / abandoned | `posting_checkout_abandoned` | **new**, carries `trigger` (`sheet_dismissed`/`back`/`background`/`unmount`) |
| Already-paid reuse | `posting_checkout_reused` | **new** — the canary above |
| Bounty posted | `bounty_published` | + `posting_fee_variant`, `prepaid`, `posting_fee_cents` |
| Reward moved to escrow | `escrow_funded` | + `timing` (`at_post` vs `at_accept`) — the core behavioural difference |
| Bounty later accepted | `application_accepted` | existing |

### Cutting treatment vs control downstream

Acceptance and completion fire from screens this feature never touches. Rather
than threading a prop through them, the arm is written as a **person property**
`posting_fee_variant`, so every downstream event is filterable by arm with no
instrumentation on those paths.

* Checkout funnel → use the **event** property `variant` / `posting_fee_variant`.
* Post-publish funnel → use the **person** property `posting_fee_variant`.

No event ever carries a card, token, client secret, PaymentIntent id, customer
id or exact wallet balance.

---

## Deploy order

**Order matters.** The edge functions reference the table, and the trigger
references the new column.

1. **Apply the migration**
   `supabase/migrations/20260921120000_posting_checkout_service_fee.sql`
   It runs in one transaction; a partial apply would leave
   `fn_bounties_normalize_funding_mode` referencing a missing column and break
   **every** bounty insert, for both arms.
2. **Deploy `payments`** — adds `/posting-checkout/intent` and `/settle`.
3. **Deploy `webhooks`** — adds the `bounty_posting_checkout` branches.
4. **Verify the deploys actually landed** with `get_edge_function` (not
   `list_edge_functions` — it has reported stale functions as current here
   before).
5. **Ship the client build.**
6. **Only then create the PostHog flag** at 20%. Creating it before step 5 is
   harmless (old builds ignore it); creating it before steps 1–3 is not.

### Verifying it is really enforced

Do not treat "migration applied" as "guardrail active". Confirm each:

```sql
-- the prepaid claim is verified, not trusted
select pg_get_functiondef('public.fn_bounties_normalize_funding_mode'::regproc)
  like '%bounty_posting_checkouts%';           -- expect: t

-- anon cannot execute the consume RPC
select has_function_privilege('anon',
  'public.fn_consume_posting_checkout(uuid,uuid)', 'execute');  -- expect: f

-- one checkout per attempt
select indexdef from pg_indexes where indexname = 'uq_posting_checkouts_attempt';
```

A forged or stale `posting_checkout_attempt_id` must fall back to ordinary
pay-at-accept. Test it by inserting a bounty with a random uuid in that column
and checking `funding_mode` comes back `at_accept` and the column is `NULL`.

---

## Rollback

The flag is the kill switch — set `posting-service-fee` to 0% rollout. No
deploy needed, and no new poster enters the checkout.

To remove the mechanism, follow the `DOWN` block at the foot of the migration.
**Do not drop `bounty_posting_checkouts`**: it is the only record of money
collected from posters, and is needed for refunds, chargebacks, revenue
reconciliation and support long after the experiment ends.

---

## Known gaps

* **Never exercised against real Stripe.** All verification is unit/integration
  level with Stripe mocked. The web build stubs Stripe entirely, so the QA swarm
  cannot cover this either. A real card run in test mode is still outstanding.
* **No refund path for an orphaned checkout.** A poster who pays and never
  posts keeps a paid-but-unconsumed row, reused free on their next attempt.
  There is no automatic refund and no UI telling them they have a credit.
* **Amount changed after a charge landed.** Narrow case: settlement failed,
  then the poster edited the reward. The server refuses with
  `checkout_already_charged` rather than charging twice; recovery is to set the
  reward back to the original amount. No money is lost, but it is a dead end
  until they do.
* **Trust tier locks earlier in treatment.** `lock_trust_tier_after_funding`
  keys off funding, which for a treatment bounty is now at post rather than at
  accept. Consistent with the bounty being funded, but it is a behaviour change.
* **Offline publish.** A prepaid bounty queued offline carries its attempt id
  and is honoured when it flushes, but this path has not been exercised.
