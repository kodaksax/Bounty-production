# Instant Cash Out — Design, Implementation, and Rollout

> Written 2026-07-22, alongside the implementation itself. This is the 13th doc in the set — `01-12` describe the pre-existing standard-withdrawal system, all independently re-verified live earlier in this session (edge functions `connect` v32 / `webhooks` v36 byte-identical to git; 0 of 89 profiles `payouts_enabled`; total ledger balance $19.65). This doc describes what Instant Cash Out adds on top of that system, not a replacement for it.
>
> **Stale as of 2026-07-21 (`1fbf24ea`):** `POST`/`DELETE /connect/debit-cards` (line 23 below) and `components/add-debit-card-modal.tsx` (line 34) were removed — Stripe unconditionally rejects `createExternalAccount`/`deleteExternalAccount` for these Express accounts once onboarding completes, so direct API writes never actually worked. Card management is now Stripe-hosted only, via `POST /connect/login-link` (Express Dashboard), same as bank accounts. See [15-instant-payout-deploy-drift-fix-2026-07-21.md](15-instant-payout-deploy-drift-fix-2026-07-21.md).

## What changed, in one paragraph

Standard withdrawals are unchanged: hunter taps Withdraw → Bounty debits the internal ledger → `stripe.transfers.create()` moves funds platform→connected-account → Stripe's own automatic schedule sweeps the connected account's balance to its **bank account** on Stripe's timeline (1-2 business days). Instant Cash Out adds a second, parallel payout path: the same platform Transfer, immediately followed by an explicit `stripe.payouts.create({ method: 'instant' }, { stripeAccount })` call targeting a linked **debit card**, typically arriving within minutes for a fee the hunter pays. The two paths share the balance-debit step and the `wallet_transactions` ledger table; they diverge only at the payout leg.

## Why a debit card, not the bank account

Stripe's Instant Payouts product requires a `card`-type external account — there is no instant-speed equivalent for ACH bank transfers on this account type. The existing bank account remains the standard, free, no-new-UI destination; a debit card is purely additive, only used for Instant Cash Out.

## The one constraint that mattered most

A debit card added for Instant Cash Out must **never** become `default_for_currency` on the Connect account. Stripe's automatic payout sweep (driving every *standard* withdrawal) always pays out to whichever external account is currently default — if a card were ever promoted to default, standard withdrawals would silently start routing to it instead of the bank. Every new route that touches a card external account (`POST /connect/debit-cards`, `POST /connect/instant-payout`) is written to never pass or imply `default_for_currency: true`; this is asserted by a Jest contract test (`__tests__/unit/instant-payout-validation.test.ts`, "never promotes a debit card to default_for_currency") that scans the deployed route's source for the string.

## What's new

### Database (`supabase/migrations/20260722_add_instant_payout_columns.sql`)
`wallet_transactions` gains `payout_method` (`'standard'` default / `'instant'`), `stripe_payout_id`, `instant_fee_amount`. No new tables — debit cards, like bank accounts, are never cached locally; Stripe's `listExternalAccounts` is the live source of truth.

### Edge functions (`supabase/functions/connect/index.ts`)
- `GET/POST/DELETE /connect/debit-cards` — card external-account management. `POST` accepts a client-tokenized `tok_...` (never a raw card number).
- `POST /connect/instant-payout` — gated behind `INSTANT_CASHOUT_ENABLED` (env flag, default **off**, same convention as the pre-existing `CONNECT_TRANSFER_RETIRED`). Deliberately a fresh, independent implementation rather than a refactor of `/transfer`'s internals — nothing about the already-audited standard withdrawal path changed.
- **Bugfix, incidental to this work**: `GET /connect/bank-accounts` previously returned only `{ bankAccounts }`, but the withdraw screen has always read `minWithdrawal`/`maxWithdrawal`/`availableBalance` from that same response. Those fields were silently always `undefined`. Fixed by actually returning the values the function already computes elsewhere.

### Webhooks (`supabase/functions/webhooks/index.ts`)
`payout.paid`/`payout.failed`/`payout.canceled`/`payout.updated` now match the affected `wallet_transactions` row by `stripe_payout_id` first (exact, always known immediately for instant rows) before falling back to the pre-existing amount-based match (still the only option for standard rows until a webhook first names them). `payout.paid` additionally reconciles `instant_fee_amount` against the pre-submission estimate via a best-effort, non-throwing helper (`reconcileInstantPayoutFee`) — **the exact shape of a Payout's balance-transaction fee breakdown for Instant Payouts has not been exercised against a live/test-mode Stripe account as part of this change** (Stripe API access was unavailable this session); verify this in Stripe test mode before enabling the feature flag.

### Admin (`supabase/functions/admin-withdrawals/index.ts`)
`compare_stripe` now also returns linked debit cards and each recent payout's `method`, so a support/ops investigation can see instant vs. standard payouts without a separate tool.

### Client
- `components/add-debit-card-modal.tsx` — first use of `@stripe/stripe-react-native`'s `CardField` + `createToken()` in this app (PaymentSheet/SetupIntent, used everywhere else, produces a PaymentMethod attached to a Customer — not the bare token `createExternalAccount` needs).
- `components/instant-cash-out-screen.tsx` — exact-reason eligibility checklist (connected account → identity details submitted → charges enabled → payouts enabled → eligible card → sufficient balance), fee/net-amount display before confirmation, graceful fallback messaging if the instant call itself fails (see below).
- `components/payout-methods-screen.tsx` — bank + card destination management in one place.
- `components/withdraw-with-bank-screen.tsx` — Available/Pending balance breakdown, a prominent Instant Cash Out entry point (shown only once an eligible card is actually linked), a Manage Payout Methods link, and withdrawal history segmented into Pending/Failed/Completed.

## Failure semantics unique to Instant Cash Out

The platform Transfer (platform→connected account) and the instant Payout (connected account→card) are two separate Stripe calls. If the Transfer succeeds but the instant Payout call fails, **the funds are not lost and must not be refunded** — they are already sitting in the connected account's Stripe balance and will still go out via Stripe's normal automatic sweep to the bank account regardless. Refunding the balance in this case would let the hunter double-collect once that sweep pays out. The route instead records the row as a completed **standard** withdrawal (`payout_method: 'standard'`, `metadata.instant_payout_attempted_but_fell_back: true`) and tells the hunter plainly that their money is still on its way via standard transfer. There is deliberately no separate instant-specific retry ladder — a failed instant attempt either falls back as above, or the hunter can start a fresh Instant Cash Out attempt.

## Fee

The hunter pays Stripe's instant-payout fee (confirmed decision this session). Pre-confirmation UI shows an *estimate* (1% / $0.50 minimum, matching Stripe's typical US rate — configurable via `INSTANT_PAYOUT_FEE_PERCENT`/`INSTANT_PAYOUT_FEE_MIN_USD`). The authoritative fee is whatever Stripe actually charges, reconciled post-hoc via the `payout.paid` webhook (see the verification note above).

## Rollout status

**Not live.** `INSTANT_CASHOUT_ENABLED` defaults to `false`; the debit-card routes are harmless to deploy inert (they simply won't be reachable from the app's UI in any meaningful way without a linked card, and the main route 503s while the flag is off). Before flipping the flag on in production:

1. Apply the migration.
2. Deploy `connect`, `webhooks`, `admin-withdrawals` and confirm deployed source matches git (per the existing deploy-verification discipline in `05-operations-playbook.md`).
3. Exercise a full Instant Cash Out end-to-end against Stripe **test mode** (Staging, per `06-testing-guide.md`): add a test debit card, confirm `available_payout_methods` includes `'instant'`, run a payout, confirm the webhook updates the row and reconciles the fee correctly.
4. Re-confirm a **standard** withdrawal still routes to the bank account, never the card, after a card has been linked — this is the direct verification of the `default_for_currency` constraint above.
5. Only then set `INSTANT_CASHOUT_ENABLED=true` in production.

None of this is implemented against a live population that currently benefits from it — as of this session, 0 of 89 profiles have `payouts_enabled = true` at all (see `12-comprehensive-audit-2026-07-18.md`), so Instant Cash Out is being built ahead of, not in response to, live demand. That's a product-timing observation, not a defect.

## Explicit non-goals

- The standard-withdrawal commingled-sweep limitation (`07-manual-payouts-evaluation.md`) is unrelated and unfixed by this work — Instant Cash Out sidesteps it entirely for its own path via an explicit destination, but standard withdrawals still rely on Stripe's default-account sweep as before.
- `stripe-setup` and `stripe-worker` — two edge functions found live in production with zero git history during this session's investigation — remain uninvestigated. Both the Supabase MCP tool and `supabase functions download --legacy-bundle` failed identically with an `InvalidV2` bundle error (a genuine corrupt/non-standard deployment, not a transient glitch); neither shows any invocation in the most recent 24h of edge-function logs. Flagged for the user to pursue via the Supabase Dashboard directly — unrelated to withdrawals as far as this session could determine.
