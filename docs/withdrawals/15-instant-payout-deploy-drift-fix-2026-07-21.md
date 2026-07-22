# Instant Payout — Prod Deploy Drift Found and Fixed, Client Flag Gap Closed

> Written 2026-07-21, same day as [13](13-instant-cash-out.md) and [14](14-instant-payouts-continuation-2026-07-21.md). Triggered by a task describing a suspected architecture bug ("instant payout doesn't transfer funds to the connected account first"). That bug does not exist in this codebase — the audit below explains what's real instead.

## The task's premise vs. what's actually in the code

The task assumed `POST /connect/instant-payout` calls `stripe.payouts.create` without first creating a Stripe Transfer to fund the connected account, so the connected account always has $0 available. Read directly from `git log`/`git show` history on `supabase/functions/connect/index.ts`, not just the current file: **this ordering was never wrong.** The Transfer-then-Payout sequence has been present since the feature's first commit (`7fdd7386`, 2026-07-20):

1. Debit the Bounty wallet balance (`withdraw_balance` RPC).
2. `stripe.transfers.create({ destination: connectedAccountId, ... })` — platform balance → connected account.
3. `stripe.payouts.create({ method: 'instant', destination: cardId, ... }, { stripeAccount: connectedAccountId })` — connected account → debit card.
4. Transfer failure → refund the debited balance. Payout failure (after Transfer succeeded) → deliberately does **not** refund, since the money is legitimately in the connected account already and will pay out via Stripe's automatic sweep instead; records `fellBackToStandard: true`.

## The real bug, and why it looked like the task's premise

A *different* bug did exist, and did produce the same visible symptom ("Instant Cash Out permanently locked/broken"): an eligibility pre-check (`checkInstantBalance()`, added in commit `3a08b585`) compared the requested amount against the connected account's **pre-transfer** `balance.instant_available`. That balance is structurally always ~$0 for any first-time instant payout, because money only enters the connected account during step 2 above — the check was reading a snapshot from before the money that would satisfy it had even moved. Every first-time instant cash-out failed this gate before ever reaching the real Transfer/Payout logic.

Commit `c8920178` (2026-07-21, same day as this doc) removed the check with a detailed inline explanation (`connect/index.ts`, comment above the `/instant-payout` eligibility block). [14-instant-payouts-continuation-2026-07-21.md](14-instant-payouts-continuation-2026-07-21.md)'s Question 3 was written describing the *pre-fix* state as verified-correct — a case of the doc and the final code landing in the same commit without the narrative being reconciled. See the correction note now at the top of that doc.

## What this session found: the fix was committed but never deployed

Diffed the **deployed** `connect` function (v44) against `git HEAD` at session start. They were not identical — the deployed version still contained the removed `checkInstantBalance()` function and the pre-transfer balance check. **Production was running the broken pre-check, live, despite the fix already being in git.** `webhooks` (v44), by contrast, was byte-identical to git — no drift there.

This matches the established deploy-drift pattern on this project (see prior incidents in `docs/withdrawals/` and memory). Root cause each time is the same: this repo has no CI/CD pipeline that deploys on merge, so "committed" and "live" can silently diverge indefinitely until someone explicitly diffs them.

**Fixed:** redeployed `connect` via `supabase functions deploy connect --project-ref xwlwqzzphmmhghiqvkeu --use-api --no-verify-jwt`, confirmed byte-identical to git afterward (v45).

## Gap closed: client never checked whether the feature was enabled at all

`INSTANT_CASHOUT_ENABLED` (server env flag, default off) was only ever checked inside `POST /connect/instant-payout` itself. No route exposed it to the client, and no client code read it. Consequence: a user with a valid instant-eligible card could fully fill out and submit Instant Cash Out even in an environment where the flag was off, discovering it was unavailable only from a `503` after a real network round trip.

**Fixed:**
- `GET /connect/debit-cards` now also returns `instantCashOutEnabled: boolean` (both the early-return "no connected account" branch and the main response).
- `hooks/use-payout-methods.tsx` reads it into new `instantCashOutEnabled` state (default `true` — the field is only ever load-bearing once a card exists, which is already gated by `hasInstantEligibleCard`, so an optimistic default can't cause a false-positive UI state before the first fetch resolves). `canInstantCashOut` is now `hasInstantEligibleCard && instantCashOutEnabled`.
- `withdraw-with-bank-screen.tsx`'s method selector now shows "Instant Cash Out is not available right now" (flag off) as a distinct reason from "Add a debit card to unlock" (no card).
- `instant-cash-out-screen.tsx`'s eligibility checklist gained an explicit "Instant Cash Out available" row, checked first, so a disabled flag reads as an obvious checklist failure rather than a late error after tapping Cash Out.

Redeployed `connect` again (v46) with this additive change, verified byte-identical to git. Both deploys, plus the four touched client/server files, committed together (`2818739b`).

## Still open (unchanged from doc 14 — not addressed this session)

- **No session has ever exercised a real `stripe.payouts.create({ method: 'instant' })` call against an actual linked debit card**, test mode or production. This remains the single biggest unverified risk before relying on the feature. Requires linking a test card to the Stripe test fixture account (`acct_1TvYr7QupCkQqUm0`) via Stripe's hosted Express Dashboard — a ~2 minute human browser step that cannot be automated (Stripe-enforced).
- Live value of `INSTANT_CASHOUT_ENABLED` in production is still unconfirmed — no tool available in this session reads Supabase project secrets directly.
- `webhooks` deploy drift (missing Phase-2 bounty-escrow handlers, unrelated to instant payouts) flagged in doc 14, still untouched.

## How to apply

Before trusting any "this is fixed" claim about an edge function in this repo, diff deployed vs. git directly (`get_edge_function` + a local git checkout, character-range read since these files are too large for line-based tools) — do not infer deploy state from commit history or doc claims alone. This is now the second time in this feature's short life that a real fix sat committed-but-undeployed in prod; there is still no CI step that would catch this automatically.
