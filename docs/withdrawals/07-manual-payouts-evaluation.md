# Withdrawal System — Stripe Manual Payouts Migration Evaluation

> Written 2026-07-18. This evaluates replacing Stripe's automatic Connect payout schedule with manual, per-withdrawal payouts (`stripe.payouts.create({ destination })`). **Not implemented in this pass** — this is an architectural recommendation for a future session, consistent with every prior audit's conclusion that this is a real but non-trivial change.

## Current architecture (verified against live code)

Withdrawals are two hops, only the first of which Bounty's code controls:

1. **Transfer** (`supabase/functions/connect/index.ts:850-863` for the primary path, `:1149-1159` for retry) — `stripe.transfers.create()` moves money from the platform's Stripe balance to the hunter's connected Express account balance. Synchronous, our code's response to the client depends on it succeeding.
2. **Payout** — Stripe's own automatic schedule sweeps the connected account's *entire available balance* to the hunter's default bank account. Asynchronous, unscheduled by us, and — critically — not scoped to a single Transfer. The code's own comment (`withdrawal-validation.ts:230-242`, duplicated at `connect/index.ts:731-735`) already states this plainly: closing the gap "would require switching the connected accounts to Stripe's manual payout schedule."

The only lever the app has today is `stripe.accounts.updateExternalAccount(..., { default_for_currency: true })` (`connect/index.ts:762-766`, `:1096-1100`, `:1313-1315`) — promoting the hunter's selected bank account to Stripe's default *before* transferring. This is fail-closed (a 502 if Stripe doesn't confirm the promotion, `:773-783`) but it's a proxy for payout destination, not a guarantee: if two withdrawals with different bank selections land before one payout sweep, both get swept to whichever account is default *at sweep time*, not whichever was default when each transfer happened.

Connected accounts are created (`connect/index.ts:387-396`, `:449-459`) with no `controller`/`settings.payouts.schedule` override — Stripe's default automatic schedule applies by omission, not by explicit choice.

## What manual payouts would change

Switching a connected account's `settings.payouts.schedule.interval` to `'manual'` stops Stripe's automatic sweep entirely. The platform would then call `stripe.payouts.create({ amount, destination: <specific bank account id> }, { stripeAccount: <connected account id> })` explicitly, once per withdrawal, with an explicit destination.

### Advantages

- **Precise destination selection** — a payout targets a specific bank account by ID, not "whatever's currently default." Directly closes the commingled-sweep limitation (`01-system-overview.md`'s documented known limitation #1).
- **Multiple bank accounts genuinely usable** — today, having 2+ bank accounts on file is really "which one is currently promoted," since only one can be default at a time. Manual payouts let a hunter's *next* withdrawal go to a different account without disturbing an in-flight one.
- **Safer payout control** — the platform can inspect connected-account balance/requirements immediately before issuing the payout call, rather than trusting Stripe's own schedule to fire correctly.
- **Easier support workflows** — "did this payout go out yet" becomes a direct question answerable by whether `stripe.payouts.create()` was called and what it returned, not "check whether Stripe's sweep happened to catch it."
- **Improved reconciliation** — a payout ID can be captured and stored on the `wallet_transactions` row at creation time (today, `payout.updated`/`payout.paid`/`payout.failed` handlers all *match by amount* post-hoc, per `handleUndeliveredPayout()`'s own docstring — a real ambiguity source when two withdrawals share an exact amount).

### Disadvantages / risks

- **Real architectural change to a live, working system** touching every completed-withdrawal state transition, not a bugfix.
- **New failure surface**: the manual `stripe.payouts.create()` call itself can fail (insufficient available balance on the connected account, account restrictions, currency mismatches) — needs the same try/refund/CRITICAL-log discipline already built for `stripe.transfers.create()`, essentially doubled (two API calls per withdrawal that can each independently fail, instead of one).
- **Timing change for hunters**: today, Stripe's automatic schedule (daily, in most Bounty accounts observed) fires on its own; a manual system needs the platform to decide *when* to call `stripe.payouts.create()` — immediately (loses any benefit of batching/timing) or on a scheduled job (adds an entirely new cron-driven component with its own failure modes: what happens if the job doesn't run, runs twice, or runs mid-deploy).
- **No test-mode verification path was exercised for this pass** — Staging is confirmed to be genuinely on Stripe test mode (see the Testing Guide), but the current Staging code/schema are stale, so this evaluation is based on static code + Stripe documentation, not a live manual-payout trial.
- **Existing commingled-sweep limitation is a documented, accepted risk, not an active incident** — no user complaint or reconciliation finding in this audit was actually caused by it. Fixing an accepted-but-unrealized risk carries its own opportunity cost against the unfixed items that *did* surface real findings this session (the historical stuck withdrawal, the balance-drift cases).

### Migration effort (rough shape, not a full plan)

1. New connected accounts: set `settings.payouts.schedule.interval: 'manual'` at creation (`connect/index.ts:387-396`/`:449-459`).
2. Existing connected accounts: a one-time `stripe.accounts.update()` pass to flip existing hunters to manual schedule — needs care, since any balance already staged for automatic sweep needs to either clear first or be handled by the cutover logic.
3. New `stripe.payouts.create()` call, either inline after the Transfer succeeds or via a new scheduled job — inline is simpler but couples payout timing to transfer timing (no batching); scheduled is more flexible but is new infrastructure.
4. Rework `handleUndeliveredPayout()` to match by the payout ID captured at creation time instead of `(user, amount)` — this actually *simplifies* that handler once the ambiguity source is gone.
5. Full regression pass against every payout-related webhook handler (`payout.paid`, `payout.updated`, `payout.failed`, `payout.canceled` — all 4 confirmed present and handling distinct cases in `webhooks/index.ts`).
6. This is exactly the kind of change that needs a real test-mode environment exercised end-to-end before touching production — see the Testing Guide's Staging findings.

## Recommendation

**Recommended as future work, not urgent.** The current commingled-sweep design is a real, documented limitation, but it is not causing active incidents — every stuck-withdrawal and balance-drift finding surfaced in this session's audit had a different, unrelated root cause. Manual payouts would close a real gap and meaningfully improve reconciliation precision, but the migration effort is comparable in size to the entire withdrawal-system hardening pass already completed, and doing it well requires the isolated test environment (Staging, now confirmed to be genuinely Stripe test-mode) to actually be exercised end-to-end first — which it currently is not, since its code and schema are stale relative to production (see the Testing Guide).

**Suggested sequencing if pursued:** (1) bring Staging's code/schema to parity with production first (a prerequisite for safely testing *any* payout-flow change, not specific to this one), (2) prototype manual payouts against Staging's Stripe test-mode account, (3) only then plan a production cutover with an explicit account-migration step for existing hunters.
