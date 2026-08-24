# Deferred bounty funding — "post first, pay at accept"

Status: **implemented, not yet enabled.** Ships inert; two deliberate switches
(one DB row, one PostHog flag) turn it on. See [Rollout](#rollout).

Related migration: `supabase/migrations/20260823120000_deferred_bounty_funding_pay_at_accept.sql`

---

## 1. The problem, and where the gate actually was

The payment gate was **not** in any screen, service, or edge function. It was a
database trigger:

```
trg_bounties_reserve_escrow  AFTER INSERT ON public.bounties
  -> fn_reserve_bounty_escrow()
       -> update_balance(poster, -amount)
            -> RAISE 23514 'Insufficient funds: new balance would be -X'
```

Because the trigger is `AFTER INSERT`, that exception rolls the `INSERT` back.
A poster with an empty wallet could not create a paid bounty **at all** — the
row never existed. Every client-side balance check
(`useBountyPublish`, `StepPay`, `PosterFundingScreen`) is a courtesy layer in
front of that trigger, not the gate itself.

Three pre-existing escape hatches bypassed it:

| Escape hatch | Mechanism | Live rows |
|---|---|---|
| `is_for_honor = true` | trigger returns before touching the wallet | 59 / 107 bounties (55%) |
| `amount <= 0` | same early return | included above |
| `payment_architecture_version = 2` | funded via `bounty_payments` + Stripe instead | 4 bounties |

### Canonical representations (verified against production, not docs)

| Concept | Source of truth |
|---|---|
| Escrow | `wallet_transactions` row with `type='escrow' AND status='completed' AND bounty_id=<id>` (56 live rows) |
| Wallet balance | `profiles.balance`, mutated only via `public.update_balance()` |
| Authoritative amount | `bounties.amount`. The poster escrows **exactly** `amount`; the platform fee (`PLATFORM_FEE_PERCENT`, default 5%) is taken out of the **hunter's** side at release. There is no poster-side fee to add. |
| Owner | `bounties.poster_id`; `bounties.user_id` is a legacy mirror. Everything `COALESCE`s them, matching `fn_reserve_bounty_escrow`. |
| Work entry | `bounties.status` `'open' -> 'in_progress'` |

`public.bounty_payments` (the Stripe-native v2 table) holds **4 rows**, so v1 —
the custodial wallet — is the production architecture. This work builds on v1
and leaves v2 routing untouched.

### Two competing acceptance RPCs

Both are live and granted to `authenticated`:

* `fn_accept_bounty_request(text)` — what the app calls
  (`lib/services/bounty-request-service.ts`).
* `accept_bounty_request(uuid)` — no caller in the repo, but callable.

Neither performed any funding check before this change. Both were patched.

### The RLS hole this change had to close

`bounties_update_own` is `auth.uid() = poster_id` with **no column
restriction**. A poster could therefore `PATCH /bounties?id=eq.X` with
`{"status":"in_progress","accepted_by":"<hunter>"}` and put a hunter to work
directly, bypassing every RPC. Under the old model that was harmless (the money
was already taken at insert). Under this one it would be a free-work exploit, so
the invariant is enforced by a **BEFORE UPDATE trigger**, not by the RPC.

---

## 2. New lifecycle

Real state names. Nothing new was added to `bounty_status_enum`; the new axis is
the `bounties.funding_mode` column, which is orthogonal to `status`.

### Legacy / control (unchanged)

```
INSERT bounties (funding_mode='at_post')
  └─ trg_bounties_reserve_escrow  → wallet_transactions{escrow, completed}
                                    profiles.balance -= amount
status='open'
  └─ fn_accept_bounty_request  → status='in_progress', accepted_by=<hunter>
status='completed'  → POST /wallet/release → wallet_transactions{release}
```

### Deferred (the experiment)

```
INSERT bounties (client asks funding_mode='at_accept')
  ├─ trg_bounties_normalize_funding_mode   (BEFORE INSERT)
  │     server re-decides; downgrades to 'at_post' unless GRANTED
  └─ trg_bounties_reserve_escrow           (AFTER INSERT)
        returns early for 'at_accept' → NO money moves

status='open', funding_mode='at_accept', no escrow row   ← POSTED, UNFUNDED
      ↓  discoverable, hunters apply (bounty_requests)
      ↓  amount + is_for_honor FROZEN once any request exists
poster selects a hunter
      ↓
fn_accept_bounty_request  ── ONE Postgres transaction ──┐
   1. lock bounty_requests row      FOR UPDATE          │
   2. lock bounties row             FOR UPDATE          │
   3. authz: poster_id = auth.uid(), assert_account_active
   4. fn_reserve_escrow_for_acceptance                  │
        lock profiles row           FOR UPDATE          │
        apply_escrow(...)  → escrow row + balance debit │
        on 23514 → RAISE 'insufficient_funds_for_escrow'│  ← rolls back ALL of it
   5. bounties.status = 'in_progress', accepted_by=…    │
      ├─ trg_bounties_enforce_funding_before_work verifies the escrow row
      │  exists (it does — step 4 was the same transaction)
   6. this request → 'accepted', competing requests → 'rejected'
                                                        ┘
status='in_progress' + escrow row exists                 ← FUNDED, work may start
      ↓
status='completed' → POST /wallet/release  (identical to legacy from here)
```

**Failure is a no-op, not a partial state.** If step 4 raises, steps 5–6 never
happen: the bounty is still `'open'`, the request still `'pending'`, competing
requests still `'pending'`, no escrow row, no balance change.

### Why no saga is needed

The external (Stripe) half of the money movement is the **wallet deposit**,
which happens *before* acceptance through the existing, already-idempotent,
webhook-driven top-up path. By the time acceptance runs the money is already
custodial, so escrow-reservation and acceptance are a single local transaction.
The wallet is the buffer that makes this genuinely atomic rather than
saga-shaped.

---

## 3. First-bounty gating

`public.fn_can_defer_bounty_funding(poster_id, amount)` is the single
authoritative decision. All of these must hold:

1. `payment_experiment_config.deferred_funding_enabled = true` (kill switch)
2. `amount > 0` and `amount <= deferred_funding_max_amount` (default **$250**)
3. not `is_for_honor`, and `payment_architecture_version = 1`
4. scope:
   * `'first_bounty'` (default) — `count(*) FROM bounties WHERE COALESCE(poster_id, user_id) = poster = 0`
   * `'all_bounties'` — always true

Plus a hard, race-proof backstop:

```sql
CREATE UNIQUE INDEX uq_bounties_one_deferred_per_poster
  ON bounties (poster_id) WHERE funding_mode = 'at_accept';
```

Two concurrent inserts cannot both win a grant — the index arbitrates after the
eligibility check.

### Why "first ever created bounty"

Chosen over *first funded* / *first completed* / *first successfully posted*
because it is:

* the moment the barrier actually bites — a poster who has never posted is
  exactly the population hitting the hard block;
* **monotonic and un-gameable** — true at most once per account, so the
  experiment cannot leak into repeat posters, and a poster cannot farm unfunded
  bounties by deleting them (the index covers deleted rows);
* independent of `wallet_transactions`, so it cannot disagree with the escrow
  state it is supposed to precede.

Note this excludes a poster whose only prior bounty was for-honor. That is
deliberate for the first read of the experiment; widening to that population is
a `deferred_funding_scope = 'all_bounties'` update plus a PostHog audience,
**not** a code change.

### Client asks, server grants

The PostHog flag decides whether the client *asks*. It is never the authority.
An ineligible request is **silently downgraded** to `'at_post'` rather than
rejected — so a poster who does have the balance just gets today's flow instead
of an error. `useBountyPublish` reads `funding_mode` back off the created row
and only shows the "you'll be charged later" copy when the server actually
granted it.

---

## 4. Payment safety

| Risk | Handling |
|---|---|
| Duplicate charge (double tap) | `bounty_requests` row is locked `FOR UPDATE`; the second attempt sees `status='accepted'` → `request_not_pending`. |
| Duplicate charge (retry after timeout that actually committed) | `apply_escrow` is idempotent on `(bounty_id, type='escrow', status='completed')` — it returns `applied=false` and the acceptance proceeds. |
| Two hunters selected at once | `bounties` row locked `FOR UPDATE`; the second sees `status='in_progress'` → `bounty_not_open`. |
| Two devices / stale client | Same row locks. The client's amount is never used; the locked row's is. |
| Client marks an unfunded bounty as funded / in_progress | `trg_bounties_enforce_funding_before_work` raises `bounty_not_funded` (23514) — enforced for **every** write path, including raw PostgREST. |
| Client flips `funding_mode` back to `at_post` to dodge the guard | `funding_mode` is immutable after insert (`bounty_funding_mode_is_immutable`). |
| Poster lowers `amount` after hunters applied | Frozen once any `bounty_requests` row exists (`bounty_amount_locked_by_applications`). Editable while nobody has applied. |
| Poster flips `is_for_honor=true` after hunters applied to get free work | Same freeze (`bounty_honor_flag_locked_by_applications`). |
| Poster manipulates `amount` after escrow | `bounty_amount_locked_by_escrow`. |
| Amount tampering via the client | The amount is read from the locked `bounties` row inside the RPC, and reported to the UI by `fn_get_bounty_funding_requirement`. No client value is ever used. |
| Failed payment leaves a falsely funded bounty | Impossible — the escrow row and the status change are the same transaction. |
| Unfunded bounty refunded into free money | `POST /wallet/refund` requires an existing completed escrow row and 404s without one. |
| Release on an unfunded bounty | Cannot reach `status='completed'` without escrow (the guard covers `completed` too). |
| Partial top-up | `useAcceptFunding.onTopUpComplete` re-reads the requirement **from the server**, never from the typed amount, and returns to the shortfall summary if still short. |
| Webhook/client ordering | Unchanged from today. Deposits are the only webhook-driven step and they precede acceptance; acceptance itself is synchronous and local. |
| Client believes it failed but it succeeded | Retry hits `request_not_pending` (no second charge) and `apply_escrow` would no-op anyway. |
| Retry loop hammering the money path | `useAcceptRequest` retries **exactly once** after a recovered failure. |

---

## 5. Analytics

Seven new events, chosen to fill the gaps the existing funnel cannot express —
because until now "published" and "funded" were the same instant. Existing
events are **reused, not replaced**, so current insights keep working.

| Requested funnel step | Event | New? |
|---|---|---|
| 1. `bounty_create_started` | `post_flow_started` / `post_started` | existing |
| 2. `bounty_posted_unfunded` | **`bounty_posted_unfunded`** | new |
| 3. `bounty_viewed_by_hunter` | `bounty_viewed` (join on `bountyId`) | existing |
| 4. `hunter_selected` | `bounty_claimed` + **`accept_funding_required`** | mixed |
| 5. `payment_started` | **`accept_funding_started`** | new |
| 6. `payment_requires_action` | `payment_sca_required` (deposit path) | existing |
| 7. `payment_succeeded` | `payment_completed` (deposit) + **`accept_funding_succeeded`** | mixed |
| 8. `payment_failed` | **`accept_funding_failed`** (+ existing `payment_failed`) | mixed |
| 9. `bounty_funded` | `escrow_funded` with `timing: 'at_accept'` | existing |
| 10. `bounty_work_started` | **`bounty_work_started`** | new |
| 11. `bounty_completed` | `bounty_completed` | existing |

Plus **`accept_funding_abandoned`** — the poster opened the pay gate and backed
out, which has no existing equivalent and is the metric that decides whether
this experiment worked.

### Properties

Every event in the block carries `variant` (`control`/`deferred`),
`fundingMode` (`at_post`/`at_accept`) and `firstBounty`, so the two arms are
separable without a join. Amounts are **bucketed** by `amountBucket()`
(`lt_25`, `25_49`, `50_99`, `100_249`, `gte_250`) — never exact. Failure causes
are bucketed by `classifyAcceptFundingError()` into a closed set
(`insufficient_funds`, `state_conflict`, `terms_locked`, `not_authorized`,
`account_inactive`, `network`, `unknown`) so no raw DB message — which
interpolates balances and user ids — can reach PostHog.

### Reading the experiment

* **Primary:** `post_published` ÷ `post_flow_started`, split by `variant`.
  The change is only worth shipping if the deferred arm publishes more.
* **The thing to actually watch:** `bounty_work_started` ÷ `post_published`,
  split by `variant`. Publishing more unfunded bounties that never get funded is
  a *worse* outcome than the status quo, and this ratio is the only place that
  shows up.
* **Escape-hatch displacement:** `post_switched_to_honor` and
  `post_funding_skipped_to_honor` should fall in the deferred arm. If they don't,
  the friction being removed was not the friction that mattered.
* **New failure surface:** `accept_funding_failed` by `reason`, and
  `accept_funding_abandoned` by `stage`.

`post_published.funded` now reports the **real** funding state rather than
assuming "paid bounty published == funded". Dashboards reading it keep working
and simply become correct.

---

## 6. Rollout

Ships inert. Both switches are required.

```sql
-- 1. Server side (the kill switch). Start here; without it the flag does nothing.
UPDATE public.payment_experiment_config
SET deferred_funding_enabled = true,
    deferred_funding_scope   = 'first_bounty',   -- keep conservative
    deferred_funding_max_amount = 250.00,
    updated_at = now();
```

2. **PostHog:** create a multivariate flag `post-first-pay-at-accept` with
   variants `control` / `test`, matching the shape of the existing
   `welcome-page-redesign` flag. `test` maps to the `deferred` arm
   (`lib/experiments/deferred-funding-variant.ts`). Roll out gradually.

### Kill switch

`UPDATE payment_experiment_config SET deferred_funding_enabled = false` stops
**new** deferred posts immediately, with no deploy. Bounties already granted
`at_accept` keep their own `funding_mode` and still fund correctly at
acceptance — they are not stranded.

### Expanding beyond the first bounty

`UPDATE payment_experiment_config SET deferred_funding_scope = 'all_bounties'`.
Note the unique index still caps one *concurrent* deferred bounty per poster;
lifting that cap is the one thing that needs a further migration.

---

## 7. Files

### Database

* `supabase/migrations/20260823120000_deferred_bounty_funding_pay_at_accept.sql`
  — the whole server-side change, with a commented DOWN block.

### Client

| File | Why |
|---|---|
| `lib/experiments/deferred-funding-variant.ts` | PostHog arm resolution, mirroring `first-screen-variant.ts` |
| `lib/services/bounty-funding-service.ts` | the only window onto the new RPCs; failure classification; amount bucketing |
| `hooks/useAcceptFunding.ts` | the pay-at-accept gate state machine |
| `components/accept-funding-gate.tsx` | its three screens (confirm / shortfall / top-up), reusing the posting flow's own funding screens |
| `hooks/useAcceptRequest.ts` | runs the gate **before** any optimistic UI; one bounded retry on recoverable failure; new funnel events |
| `app/screens/CreateBounty/useBountyPublish.ts` | requests the deferral, skips the balance gate and the post-time escrow when granted |
| `app/services/bountyService.ts` | `CreateBountyOptions.fundingMode` |
| `app/onboarding/details.tsx` | the onboarding poster surface — skips the funding step (and its for-honor link) when granted |
| `app/tabs/postings-screen.tsx`, `app/tabs/inbox-screen.tsx` | render the gate |
| `lib/services/bounty-request-service.ts` | maps funding failures to HTTP 402, distinct from the 409 state conflicts |
| `supabase/functions/accept-bounty-request/index.ts` | same 402 mapping for the API-mode path |
| `lib/services/analytics-service.ts`, `lib/services/database.types.ts` | new events, `funding_mode` type |

---

## 8. "For honor" — audited, deliberately kept

**What it does:** `is_for_honor = true` makes `fn_reserve_bounty_escrow` return
before touching the wallet. No escrow row, no balance change, no money, ever.
Release and refund both refuse (`/wallet/refund` 404s without an escrow row;
`/wallet/release` explicitly rejects `is_for_honor`). So it is *self-consistent*
— it does not create unpaid-but-expected-to-be-paid work, and there is no
integrity bug to fix.

**Why it is over-used:** it is also the app's de-facto payment bypass. 55% of
all bounties are for-honor, and both posting surfaces put the exit right under
the pay button:

* `app/onboarding/details.tsx` — "Post as For Honor instead", already
  instrumented as `post_funding_skipped_to_honor` and described in-repo as
  "the single sharpest known cause of $0 bounties".
* `app/screens/CreateBounty/quick/StepPay.tsx` — the honor toggle, instrumented
  as `post_switched_to_honor`.

**Decision: not removed, not touched.** It is a legitimate product feature ($0
favours) and 59 live bounties depend on its semantics. What this change does is
give the poster a *legitimate* low-friction alternative, so the honor path stops
being the only way past the wallet. Whether it is still load-bearing is an
empirical question the two escape-hatch events above now answer. Removing or
demoting the link should wait for that data.

---

## 9. Remaining risks

Stated plainly, because none of the following was validated end-to-end against a
real device + live Stripe:

1. **No real Stripe charge was exercised.** The deferred flow adds no new Stripe
   code — the top-up is the existing deposit path — but the specific sequence
   "post unfunded → hunter applies → top up → accept" has never run against
   live Stripe.
2. **`payment_sca_required` has never fired in this project** (confirmed absent
   from PostHog's event list). Step 6 of the funnel is therefore unobserved, and
   the 3DS/SCA branch of the top-up is instrumented but unproven.
3. **The migration is not applied.** It was validated by running the full DDL
   plus 17 behavioural assertions against the production schema inside a
   transaction that was then rolled back (production verified unchanged
   afterwards) — but it has not been committed to the live database.
4. **The PostHog flag does not exist yet**, so `useDeferredFundingVariant`
   currently resolves `'control'` for every device and the experiment is a no-op
   even after the migration lands.
5. **Deferred bounties have no expiry.** An unfunded bounty can sit open
   indefinitely attracting applications the poster may never fund. The existing
   `expire-bounties` function handles deadlines generally, but there is no
   deferred-specific "you have N days to fund this" nudge. Worth adding if
   `bounty_work_started ÷ post_published` comes out low.
6. **Hunter-side disclosure is unchanged.** A hunter browsing an `at_accept`
   bounty is not told it is unfunded. That is intentional for the first read
   (it keeps the arms comparable on the hunter side), but it is a product
   decision to revisit — hunters arguably should know.
7. **The v1/v2 split is untouched.** Deferred funding is v1-only by
   construction. If the Phase 2 Stripe-native path is ever switched on, it needs
   its own pay-at-accept design; the trigger refuses to defer v2 bounties rather
   than silently mixing the two.
8. **A pre-existing PostHog property type collision was found, not fixed.**
   `architecture` is Numeric project-wide (from `post_published` sending `1`/`2`)
   while `escrow_funded` sends `'v1'`/`'v2'` strings. The new `escrow_funded`
   emission follows the existing string convention for consistency with its
   sibling call rather than diverging. Worth cleaning up separately.
