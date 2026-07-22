# Stripe ↔ Bounty Wallet Balance Synchronization

Status: implemented, not yet deployed to production. See "Deploy steps" below —
every step there requires separate explicit go-ahead before touching prod.

## What this closes

Prior to this change, `webhooks/index.ts` handled the core money-movement
events (deposits, transfers, standard/instant payouts, disputes) but had two
gaps:

1. **Missing webhook coverage**: `balance.available`, `topup.*`,
   `refund.created/updated/failed`,
   `charge.dispute.updated/funds_withdrawn/funds_reinstated`,
   `external_account.*` / `account.external_account.*`, `person.updated`.
2. **No real Stripe-vs-ledger reconciliation**. The existing daily
   `run_withdrawal_reconciliation()` cron job (`20260721_add_scheduled_
   reconciliation.sql`) is pure-SQL — it checks `profiles.balance` against
   `SUM(wallet_transactions)`, which can never catch a manual Stripe Dashboard
   payout, account adjustment, or a webhook Stripe delivered but this app
   never received.

## Newly handled webhook events (`supabase/functions/webhooks/index.ts`)

| Event | What it does |
|---|---|
| `balance.available` | Platform-scoped → `comparePlatformBalance()`. Connect-scoped (`event.account` present) → `compareConnectAccountBalance()`. No ledger mutation — detection only. |
| `charge.dispute.updated` | Syncs `bounty_disputes` status/reason. No balance effect. |
| `charge.dispute.funds_withdrawn` / `funds_reinstated` | Records a `dispute_funds_movement` finding (info) — gives `comparePlatformBalance` an explanation for the resulting Stripe balance change. No ledger mutation (dispute.closed already owns the win/loss ledger settlement). |
| `refund.created` / `refund.updated` | Observability only — `charge.refunded` already owns the idempotent `apply_refund` ledger mutation. |
| `refund.failed` | Reverts an optimistic `bounty_payments.status = 'refund_pending'` back to `'captured'` (funds never actually left) and logs CRITICAL. |
| `topup.created/succeeded/failed` | Records a `stripe_topup` finding (info) — platform-level treasury event, not tied to a user. |
| `external_account.created/updated/deleted`, `account.external_account.*` | Records an `external_account_change` finding + notifies the affected user (bank/card added/changed/removed outside the app). Both event-name families handled — see "Edge cases" below. |
| `person.updated` | Re-fetches the Connect Account and re-syncs via the existing `syncConnectAccountToProfile()` (same path as `capability.updated`). |

Also: `stripe_events.status/last_error/retry_count/last_retry_at` (added by
`20260115_enhance_webhook_tracking.sql` but never populated) are now written
on every handler failure via the new `record_stripe_event_failure()` RPC —
this backs the admin screen's "Failed Webhook Deliveries" list.

## Balance sync flow

**Platform balance** (`stripe.balance.retrieve()`, no `stripeAccount`) should
always be ≥ `SUM(profiles.balance)` — everything the DB has promised users
that hasn't left the platform yet.
- Stripe < ledger → **critical** (`platform_balance_drift`): the platform
  cannot currently honor every withdrawal on the books.
- Stripe > ledger → **warning**: an uninvestigated surplus (fees, topups,
  uncredited deposits).

**Per-connected-account balance** (`stripe.balance.retrieve({stripeAccount})`)
represents Transfers already sent to a user but not yet paid to their bank.
There's no exact DB-derivable expectation (Stripe controls the payout
schedule), so the comparison uses that user's own unresolved withdrawal rows
as a plausibility check, not an exact target:
- Unexplained surplus → **warning** (`connect_account_balance_drift`):
  possible manual Dashboard transfer or disabled payouts.
- Shortfall → **info**: usually just means a payout already landed before
  the DB caught up.

**Triggers**:
- Real-time: the `balance.available` webhook, per account, detection only.
- Periodic safety net: `stripe-balance-reconciliation-hourly` pg_cron job →
  `net.http_post` → `admin-withdrawals` `run_stripe_balance_sync` action,
  which also runs `attemptRecoverableRepair()` per connected account.

**Repair boundary** (deliberately narrow, matches
[04-automation-handler-guide.md](./04-automation-handler-guide.md)'s existing
rule — automation never self-corrects a bare balance-number mismatch):
`attemptRecoverableRepair()` only replays a specific missed webhook's own
idempotent effect — a `wallet_transactions` withdrawal row stuck `pending`
whose Stripe Transfer/Payout object shows an unambiguous terminal state
(`reversed`/`failed`/`canceled`) the DB never recorded. It calls the exact
same `update_balance()` RPC the real webhook handler would have, guarded by
the same `.eq('status','pending')` optimistic lock. Everything else — any
bare balance-number mismatch with no corresponding Stripe object evidence —
is written to `reconciliation_findings` with `auto_repaired=false` for a
human to review from the new admin screen.

## Remaining edge cases

- `lib/wallet-context.tsx`'s client-side optimistic balance cache is a
  separate, pre-existing transient-race risk between webhook-driven server
  updates and local optimistic mutation. Not touched by this change —
  architectural recommendation below.
- `external_account.*` vs `account.external_account.*`: which event family
  Stripe actually sends depends on the pinned API version on the webhook
  endpoint (this project's Stripe client is `stripe@14`). Both are handled
  by the same case block, but only one will actually be delivered — verify
  which fires in Stripe test mode (see below) before relying on it.
- Two-way historical backfill is **not** automatic. `12-comprehensive-audit-
  2026-07-18.md` documented known pre-existing drift; the new sweep will
  surface it as findings on first run, not silently correct it.
- The hourly sweep pages through every `profiles` row with a Connect account
  making a live Stripe API call per account — at large user counts this may
  need batching/backoff tuning (currently a flat 200-row page, no rate
  limiting). Watch `errorCount` in the sweep's response after the first
  production runs.

## Deploy steps (each requires separate go-ahead)

1. **Apply migration** `supabase/migrations/20260721170000_stripe_balance_
   reconciliation.sql` (`apply_migration`).
2. **Generate and store the cron secret** (not committed to git):
   ```sql
   -- via execute_sql, NOT apply_migration
   select vault.create_secret('<random-256-bit-hex>', 'reconciliation_cron_secret');
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'edge_function_base_url');
   ```
3. **Set the same secret + PostHog config as Edge Function secrets**
   (`supabase secrets set` or the Supabase dashboard) — separate from the
   app's bundled `EXPO_PUBLIC_*` env, edge functions need their own:
   - `RECONCILIATION_CRON_SECRET` = the same value from step 2
   - `POSTHOG_PROJECT_API_KEY` = the project's PostHog key (public project
     identifier, safe to reuse from `EXPO_PUBLIC_POSTHOG_KEY`)
   - `POSTHOG_HOST` (optional, defaults to `https://us.i.posthog.com`)
4. **Deploy both Edge Functions**:
   `supabase functions deploy webhooks --use-api --no-verify-jwt` and
   `supabase functions deploy admin-withdrawals --use-api --no-verify-jwt`.
5. **Register the new event types on the Stripe Dashboard webhook
   endpoint(s)** — this repo's webhook signature verification only works for
   events Stripe actually sends; adding a `case` here does nothing until the
   Dashboard endpoint (both the platform endpoint and, for Connect-scoped
   events, the "Listen to events on Connected accounts" endpoint) is
   subscribed to the new event types listed above.
6. Confirm `cron.job_run_details` gets rows after the first hour — the prior
   daily job's execution was never actually confirmed; don't repeat that gap
   silently.

## Testing instructions (Stripe test mode)

Uses the existing fixture Connect account for anything account-scoped.

```
stripe trigger balance.available
stripe trigger charge.dispute.created
stripe trigger charge.dispute.updated
stripe trigger charge.dispute.funds_withdrawn
stripe trigger charge.dispute.funds_reinstated
stripe trigger refund.created
stripe trigger refund.failed
stripe trigger topup.created
stripe trigger person.updated
```
(`external_account.*` doesn't have a direct `stripe trigger` shortcut —
add/remove a bank account or card on the fixture Connect account via the
Dashboard or API instead, or use the Dashboard's "send test webhook" panel.)

For each: confirm a `stripe_events` row appears, the expected DB write
happens, and redelivering the same event (Dashboard → "Resend") does not
double-apply anything.

## Manual verification steps

- **Standard payout**: withdraw via the app, let it complete normally,
  confirm `wallet_transactions.status='completed'` and a `payout.paid`
  notification — unaffected by this change, verifies no regression.
- **Instant payout**: same, via a linked debit card — unaffected, regression
  check.
- **Failed payout**: fail a payout in test mode (e.g. use a test bank account
  number Stripe treats as failing); confirm the existing `payout.failed`
  refund still fires, and confirm `compareConnectAccountBalance` doesn't
  double-flag it once the refund lands.
- **Refund**: refund a captured bounty payment; confirm `charge.refunded`
  applies it as before, and confirm `refund.created`/`refund.updated` log
  without duplicating the ledger write.
- **Dispute**: trigger `charge.dispute.created` → confirm wallet freeze as
  before; trigger `charge.dispute.funds_withdrawn` → confirm an info finding
  appears with no balance change; close the dispute → confirm the existing
  win/loss settlement still works.
- **Manual Stripe Dashboard balance change**: in test mode, manually create a
  payout or balance transaction on the fixture account from the Dashboard
  (bypassing the app entirely). Run `run_stripe_balance_sync` from the new
  admin screen (`/(admin)/balance-reconciliation`) and confirm a drift
  finding appears with accurate `drift_cents`.

## Architectural recommendations

- Consolidate `lib/wallet-context.tsx`'s optimistic local balance cache to
  always defer to server state on any webhook-driven push (e.g. a realtime
  subscription on `profiles.balance`), rather than trusting client-side
  optimistic math indefinitely between reconciliations. Not implemented here
  — flagged for follow-up.
- Once the hourly sweep has run in production for a while, consider whether
  the existing daily `run_withdrawal_reconciliation()` DB-internal check and
  this new Stripe-comparison sweep should be merged into one report, since
  they currently write to the same `reconciliation_findings` table but run on
  different schedules via different mechanisms (plain pg_cron vs pg_cron+pg_net).
