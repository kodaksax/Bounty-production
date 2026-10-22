# Payment reliability audit — 2026-10-21

Branch `fix/payment-reliability-2026-10-21` (off main `89800179`). Companion to
PR #939 (`fix/accept-funding-payment-failures`, the hire-sheet decline copy),
which this branch merges with cleanly. Evidence is from production, read-only:
`stripe_events` (Stripe's own payloads), `bounty_payments`,
`wallet_transactions`, `bounty_events`, PostHog. Real posters are named by
bounty-id prefix only.

## 1. Executive summary

- **What is working.** Webhook signatures are verified against every
  configured secret, and `claim_stripe_event` dedupes redeliveries atomically.
  Deposits are verified against Stripe before crediting and are idempotent on
  the PaymentIntent. The hire path cannot start work unfunded (DB trigger).
  The v2 `/bounty-payments/cancel` endpoint refunds idempotently. No duplicate
  charge or minted balance was found in the data.
- **What is fragile.** The money is right in Stripe, but Bounty's own record
  of it was wrong in three ways (all fixed on this branch, none deployed):
  1. Refunds Stripe completed were never recorded, because the webhook read a
     field that our pinned API version no longer sends.
  2. Cancelling or deleting a bounty paid on the **website** skipped the refund
     and told the poster they had not been charged.
  3. The hire sheet could ask for the same money twice if the deposit was slow
     to land.
- **Biggest risk to genuine transactions:** the hire step. In 45 days, three
  genuine posters reached "pay to hire" and none got through. The most recent
  (10-18) was turned away by a bank decline and then a Radar ZIP rule, and the
  app could not tell them why. That is PR #939's fix, plus a Radar decision only
  the owner can make (§7).
- **Money owed now:** $50 to three posters, sitting on cancelled or deleted
  bounties (§7). Refunding it moves real money and needs the owner's go.

## 2. Payment flow map (as deployed)

Live config: `payment_experiment_config.deferred_funding_enabled = true`
(scope `all_bounties`), `card_at_post_scope = 'off'`,
`posting_policy_config.honor_posts_enabled = false`, minimum $5, v3 disabled.

**App (iOS/Android): v1 custodial wallet, pay at hire**
1. Composer → StepPay ("You're charged when you accept a hunter") → INSERT
   `bounties`. `trg_bounties_normalize_funding_mode` stamps `at_accept`. No
   money moves and no card is required.
2. Poster taps Select → `useAcceptFunding.ensureFunded` →
   `fn_get_bounty_funding_requirement` → shortfall = amount − wallet balance.
3. Shortfall > 0 → hire sheet "Pay $X & hire" → `payments` create intent
   (`purpose=wallet_deposit`) → Stripe confirm (saved card / Apple Pay) →
   `/wallet/deposit` re-reads the PI from Stripe → `apply_deposit` (idempotent
   on PI). The `payment_intent.succeeded` webhook is the backstop.
4. Settle poll → `fn_accept_bounty_request` → escrow debited under the row
   lock. `trg_bounties_enforce_funding_before_work` refuses unfunded work.
5. Approve → `/wallet/release` (5% fee from the hunter's side) → hunter
   balance → Connect transfer + payout.
6. Cancel before hire → `planCancelRefund` → `/wallet/refund`
   (`fn_claim_owner_refund`) → delete.

**Website: v2 Stripe-native, pay at post**
1. `web_post` → `poster-web` → `pending_bounties` → Stripe Checkout
   (`purpose=bounty_escrow_checkout`) → `checkout.session.completed` →
   `fn_create_bounty_from_pending` → bounty + `bounty_payments` `captured`.
2. Release → `/bounty-payments/release` (transfer). Cancel →
   `/bounty-payments/cancel` (void or refund, key `bounty_refund_<bp.id>`) →
   `charge.refunded` webhook reflects it.

The two surfaces run **different money models**: the web charges the full
reward at post, the app at hire. Each screen's copy is accurate for its own
model. A poster who uses both meets both (§7).

## 3. Incident findings

**Most likely incident: bounty `cee867c2`, 2026-10-18, $20, iOS 2.1.3.**
Confidence: high on what happened; it cannot be confirmed that this is the
specific poster the brief refers to.

| UTC | Evidence |
|---|---|
| 18:11 | Bounty posted (at_accept). 5 applicants followed. |
| 21:18:22 | `accept_funding_required` (balance $0) |
| 21:18:31 | Saved card: Stripe `issuer_declined / insufficient_funds` |
| 21:18:46 | Apple Pay: Stripe `blocked`, rule `block_if_wrong_zip`, risk **normal**. PostHog recorded only `error_code: "Failed"`. |
| 21:18:55–21:19:24 | App backgrounded and returned 3× (likely a banking app); each logged `accept_funding_abandoned` |
| 21:19:26 | App relaunched; sheet reopened 21:19:44; left 21:19:53; never returned |

The bounty is still open with 5 applicants. The decline was genuine. The
second rejection was Radar's ZIP check on a wallet card at normal risk. The
app showed neither reason (PR #939 fixes that). There is no follow-up of any
kind after a failed hire.

**Second candidate: bounty `5e96aaed`, web, $35.** Paid via Checkout on
10-06; an admin status override cancelled it on 10-07 (a guard was added later,
in 20261012120100). The money is still `captured`, and the poster got **no**
notification. The poster came back 10-14, verified ID, saved a card in the app,
and never posted again. Trust in the money is a plausible factor; there is no
direct evidence of intent.

**Hire-step funnel, 45 days (production, internal excluded):** 3 genuine
posters reached `accept_funding_required`, 0 funded. Two left at the pay
sheet without paying (09-10 Android, 09-27 iOS); the third is `cee867c2`.
The other `accept_funding_*` traffic was banned scam accounts, card testers,
or internal accounts. Six $150–$200 "help me purchase online" bounties deleted
the same day were moderator scam removals, not payment losses.

**Evidence gaps.** Stripe could not be queried directly (the connector is
unauthenticated), so "no refund exists" rests on the webhook mirror. Old
events carry no `decline_code` (fixed in #939). `accept_funding_abandoned`
fires on every backgrounding (`trigger=background`), which inflates abandonment.

## 4. Findings

| # | Sev | Flow | Finding | Evidence | Status |
|---|---|---|---|---|---|
| 1 | P0 | Refunds (v1+v2) | `charge.refunded` read `charge.refunds?.data ?? []`; apiVersion 2023-10-16 never embeds it. v2 rows stuck `refund_pending` with no refund id; v1 deposit refunds skipped, so refunded money stayed on the balance. | Every stored `charge.refunded` lacks the key. 4 external v2 rows $61 (+2 internal) refunded by Stripe 09-03..05, still pending. 8 v1 deposits $210 refunded with no ledger row (accounts since deleted; nothing spendable today). | **Fixed** |
| 2 | P0 | Cancel/delete of a web-paid bounty | `already_funded` read only v1 wallet escrow, so a v2 bounty was "unfunded": no refund call, the bounty deleted, the poster told "You haven't been charged". | `060079f5`: $5 web Checkout 10-08 15:56, deleted in-app 15:59, still `captured`. Reproduced on a real staging row. | **Fixed** |
| 3 | P0 | Money owed | $50 held on terminal bounties for 3 external posters | `5e96aaed` $35 (admin cancel), `060079f5` $5 (#2), `213c13db` $10 (deleted 08-20; mechanism not traced) | **Needs go** (§7) |
| 4 | P1 | Hire sheet | A captured deposit not yet visible after the 9 s poll re-prompted "Pay $X & hire" for the **same** amount, under "Payment received. $X more is needed". A second tap = a second charge. | `hooks/useAcceptFunding.ts` `onPaymentSucceeded`; the old test asserted this as intended | **Fixed** |
| 5 | P1 | Cancel (v2) | `refund_pending` treated as failure: "Refund Failed, contact support", and the bounty could never be deleted, though the refund was issued | `bounty-payments-service.ts` `TERMINAL_CANCEL_STATUSES` | **Fixed** (poster path only) |
| 6 | P1 | Hire step | Radar `block_if_wrong_zip` blocks Apple Pay at normal risk; the decline reason was invisible | 10-18 incident | Copy: #939. Rule: **owner decision** |
| 7 | P1 | Hire step | No working payment method at the moment of hire for any of the 3 genuine posters; card-at-post (SBA-05) is built and switched off | `card_at_post_scope='off'` | **Owner decision** |
| 8 | P2 | Cancel/admin | Nothing server-side stops a status change to `deleted`/`cancelled` while v2 money is held | #2, #3 | Recommendation (§7) |
| 9 | P2 | Web vs app | Charged at post on the web, at hire in the app | §2 | Product decision |
| 10 | P2 | Telemetry | `accept_funding_abandoned` fires on background; the old Apple Pay failures read "Failed" | §3 | #939 fixes codes; filter `trigger` |

A test-quality note: the existing unit test *"refunds to the original payment
method for Stripe-native escrow"* mocked `alreadyFunded: true` for a v2 bounty,
which is exactly the answer production never gave. It passed while money was
being stranded.

## 5. Changes implemented

- `supabase/functions/_shared/refund-reflection.ts` (new): pure decisions.
  `resolveChargeRefunds` lists refunds from Stripe when the payload lacks
  them. `liveRefunds` covers the v1 debit (never failed/canceled refunds).
  `bountyPaymentRefundUpdate` sets v2 to `refunded` only when succeeded
  refunds cover the amount in cents.
- `supabase/functions/webhooks/index.ts`: `charge.refunded` uses the above.
  New `reflectRefundIntoBountyPayment` (CAS on captured/refund_pending,
  throws on DB error so Stripe retries). `refund.created/updated` advance a v2
  row once the refund succeeds (no wallet write there).
- `supabase/migrations/20261021120000_funding_requirement_counts_v2_escrow.sql`:
  `already_funded` also counts `bounty_payments` in `authorized`/`captured`.
  This fixes builds already on phones with no release. `requires_funding`,
  grants, the poster-only check and SECURITY DEFINER are unchanged.
- `supabase/migrations/20261021120100_reconcile_stripe_refunded_bounty_payments.sql`:
  `admin_reconcile_stripe_refunded_bounty_payments(p_dry_run DEFAULT true)` and
  `admin_revert_stripe_refund_reconciliation()`, service_role only, gated on a
  stored `charge.refunded` with `refunded=true` covering the amount. No money
  moves.
- `lib/services/bounty-cancel-refund.ts`: v2/v3 plans read the payment row
  first (`held`/`returning` → refund to card). `refund_pending` counts as done.
  `no_payment` (404) means nothing held. A voided authorization reports nothing
  refunded. The card-refund confirmation says banks take 5–10 business days.
- `lib/services/bounty-payments-service.ts`: `getBountyPaymentHoldState`
  (RLS `bounty_payments_select_participant`). `cancelBountyPayment(..., {
  allowRefundPending })` is opt-in, so dispute and publish-rollback callers are
  unchanged.
- `hooks/useAcceptFunding.ts`: an unreflected deposit closes the sheet with
  "Your payment went through … Nothing more will be charged. Try hiring <name>
  again in a minute." New reason `deposit_unconfirmed` on the existing
  `accept_funding_failed`.
- `supabase/security/rls-manifest.json`: `fn_get_bounty_funding_requirement`
  must stay authenticated-only (passes on staging and production today).

## 6. Test results

| Check | Result |
|---|---|
| Full jest suite | 443 suites, 5,916 tests passed, 0 failed |
| `npx tsc --noEmit` | 0 errors |
| `deno check webhooks/index.ts` | clean |
| New/changed suites (refund-reflection, webhooks-contract, bounty-cancel-refund, use-accept-funding) | pass; **9 fail against the old code** (guards verified to fire) |
| `scripts/verify-payment-reliability-pglite.mjs` | 42/42: defect reproduced on the real pre-fix body; fixed; idempotent re-apply; rollback; grants; reconciliation dry-run writes nothing; apply/no-op/exact revert (caught and fixed a NULL-metadata revert bug) |
| Staging, both migrations in a rolled-back transaction | 7/7: defect reproduced on a real held v2 row, then fixed; grants; dry run runs on real tables (0 candidates on staging) |
| `check-rls-policies --env staging/production` | OK on both |
| Merge with PR #939 | clean; 100/100 affected tests pass; tsc clean |

**Scenario coverage (brief §4):** 4 duplicate submissions (deposit re-prompt;
refund idempotency); 5 decline does not fund (existing + #939); 6 delayed and
repeated webhooks (refund CAS, claim dedupe, pending→succeeded via
refund.updated); 7 interrupted deposit; 8 provider errors (#939); 10 refunds
and cancellations; 11 legacy compatibility (old builds fixed by the server
change; v1 paths unchanged).

**Gaps:** no end-to-end run against Stripe test mode (the web build stubs
Stripe, so Shoal cannot reach payment). The webhook wiring is source-asserted,
not executed. Scenario 12 (web/app parity) is documented, not tested.

## 7. Outstanding risks and decisions

1. **$50 owed (needs go: real money).** Refund the PaymentIntents behind
   `5e96aaed` ($35), `060079f5` ($5) and `213c13db` ($10) from the Stripe
   Dashboard. Once this branch's webhook is deployed, each refund records
   itself. Notify the `5e96aaed` poster.
2. **Radar `block_if_wrong_zip` on wallets (owner).** It blocked a normal-risk
   Apple Pay charge. Scoping it to non-wallet cards trades fraud protection
   for conversion. Do not loosen the score rules: they are correctly stopping
   the known ring.
3. **Card-at-post (owner).** All three genuine hire-step losses had no working
   method at hire. SBA-05 is built and off: `card_at_post_scope`.
4. **Server guard (recommended next).** A BEFORE UPDATE trigger refusing
   client transitions to deleted/cancelled while `bounty_payments` is
   authorized/captured. First audit every path that changes status before
   refunding (cancellation requests, disputes).
5. **No recovery nudge after a failed hire.** `cee867c2` still has 5
   applicants and nothing invites the poster back.
6. Old builds keep the `refund_pending` → "Refund Failed" behavior until they
   update. A v1 refund that is pending and later fails is not re-credited
   (`refund.failed` pages). v3 is not counted (disabled, 0 rows).
   `stripe_events.event_data` stores PI client secrets in plaintext.

## 8. Deployment plan

No feature flag: these are corrections, and each server piece has a rollback
file. Each step names what must show new rows.

1. **Merge** (independent of #939 and of both migrations). CI deploys
   `webhooks`. Verify the deployed bundle contains `resolveChargeRefunds`.
   *Observed when:* the next Stripe refund leaves `bounty_payments.status =
   'refunded'` with `stripe_refund_id`, or a v1 `wallet_transactions` refund row.
2. **Apply 20261021120000 to production (go).** *Observed when:* as a poster
   of a held v2 bounty, `already_funded = true`; the next web-bounty cancel
   writes a refund. Rollback:
   `supabase/rollbacks/production/20261021120000_…down.sql`.
3. **Apply 20261021120100 (go), then the dry run.** Expect 6 rows (4 external
   $61, 2 internal $20). Apply only with a second go. *Observed when:* 6 rows
   `refunded`, plus `bounty_events` refund records. Undo:
   `admin_revert_stripe_refund_reconciliation()`.
4. **Client** ships with the next build or OTA (JS only). *Observed when:*
   `accept_funding_failed{reason=deposit_unconfirmed}` appears, or poster
   cancels of v2 bounties produce `escrow_refunded{architecture=v2}`.
5. After step 3, add `forbid_execute: [anon, authenticated, PUBLIC]` manifest
   entries for the two admin functions. Adding them before would turn the
   production RLS gate red and block edge deploys.

## 9. Success metrics (baseline 2026-10-21)

| Metric | Source | Baseline | Target |
|---|---|---|---|
| Hire funding success, genuine posters | PostHog `accept_funding_required` → `accept_funding_succeeded` per poster | 0 of 3 (45 d) | measure per cohort (no A/B at this volume) |
| Post completion | `composer_opened` → `bounty_published`, people | 26 of 355 (45 d) | track before/after |
| Payment failures by cause | `stripe_events` `charge.failed` `outcome` | 21 d: 2 genuine (1 issuer, 1 Radar ZIP); rest fraud/ring | genuine Radar blocks → 0 if §7.2 changes |
| Refund state divergence | reconcile dry-run (evidence query) | 6 rows | 0, and stays 0 after deploy |
| Stranded money on dead bounties | `bounty_payments` held on deleted/cancelled bounties | 3 external, $50 | 0 |
| Duplicate-charge risk | `accept_funding_failed{reason=deposit_unconfirmed}`; posters with ≥2 succeeded deposits for one hire within 10 min | 0 / 0 | 0 duplicates |
| Abandonment | `accept_funding_abandoned` with `trigger in (cancel, unmount)` per gate session; **exclude `background`** | 5 people (45 d), inflated by background | — |
| Open reconciliation findings | `reconciliation_findings` unresolved | 44 (2026-10-20) | trending down |
