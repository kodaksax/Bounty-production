# PR Prompts — Payment Flow Known Gaps & Risks

> Generated from **§ 8.2 Known Gaps and Risks** in [`FINANCIAL_FLOWS.md`](./FINANCIAL_FLOWS.md).  
> Each section is a self-contained, copy-paste–ready PR / Issue description that can be opened directly in GitHub.  
> Prompts are ordered by severity: **P0 (Critical) → P1 (High) → P2 (Medium) → P3 (Low/Info)**.

---

## Table of Contents

1. [GAP-01 · P0 · Implement `charge.dispute.created` / `charge.dispute.closed` Webhook Handlers](#gap-01--p0--implement-chargedisputecreated--chargedisputeclosed-webhook-handlers)
2. [GAP-02 · P0 · Audit & Enforce RLS on `wallet_transactions`](#gap-02--p0--audit--enforce-rls-on-wallet_transactions)
3. [GAP-03 · P1 · Complete Stripe Connect Onboarding Deep-Link Return Flow](#gap-03--p1--complete-stripe-connect-onboarding-deep-link-return-flow)
4. [GAP-04 · P1 · Push Notification on Balance Change](#gap-04--p1--push-notification-on-balance-change)
5. [GAP-05 · P1 · Dispute Wallet Freeze on Bounty Dispute](#gap-05--p1--dispute-wallet-freeze-on-bounty-dispute)
6. [GAP-06 · P2 · Consolidate Three Parallel Server Surfaces](#gap-06--p2--consolidate-three-parallel-server-surfaces)
7. [GAP-07 · P2 · Add Idempotency Guards to `charge.refunded` and Transfer Event Handlers](#gap-07--p2--add-idempotency-guards-to-chargerefunded-and-transfer-event-handlers)
8. [GAP-08 · P2 · `payout.failed` Recovery UI for Hunters](#gap-08--p2--payoutfailed-recovery-ui-for-hunters)
9. [GAP-09 · P2 · Enforce Retry Limit in `transfer.failed` Webhook Handler](#gap-09--p2--enforce-retry-limit-in-transferfailed-webhook-handler)
10. [GAP-10 · P3 · iOS SecureStore Key Format Migration](#gap-10--p3--ios-securestore-key-format-migration)

---

## GAP-01 · P0 · Implement `charge.dispute.created` / `charge.dispute.closed` Webhook Handlers

### PR Title
```
fix(payments): handle charge.dispute.created and charge.dispute.closed webhook events
```

### Problem

The `webhooks` Edge Function (`supabase/functions/webhooks/index.ts`) has no `case` for
`charge.dispute.created` or `charge.dispute.closed`. When a cardholder files a chargeback with
their bank:

- Stripe deducts the disputed funds from the platform account with no automated app-level response.
- The `bounty_disputes` table remains unlinked to the Stripe dispute.
- The poster's wallet balance is **not frozen**, so they can withdraw funds that are already under
  dispute.
- The platform has no evidence-submission path to contest the chargeback before Stripe's deadline.

This is the highest-risk financial gap in the current codebase.

### Acceptance Criteria

- [ ] `charge.dispute.created` handler in `supabase/functions/webhooks/index.ts`:
  - Looks up the original `wallet_transaction` via `stripe_payment_intent_id` (from `dispute.payment_intent`).
  - Upserts a row into `bounty_disputes` with `status = 'stripe_dispute'`, `stripe_dispute_id`, and `amount`.
  - Freezes the poster's wallet by setting `profiles.balance_frozen = true` (add column via migration if absent).
  - Inserts a `notifications` row for the poster: *"A payment dispute has been opened on your account. Your wallet has been temporarily frozen."*
  - Logs the event to `stripe_events` with `processed = true`.
- [ ] `charge.dispute.closed` handler in `supabase/functions/webhooks/index.ts`:
  - Resolves the `bounty_disputes` row: `status = 'resolved_won'` or `'resolved_lost'` based on `dispute.status`.
  - If `dispute.status === 'won'` — unfreeze `profiles.balance_frozen`.
  - If `dispute.status === 'lost'` — insert a negative `wallet_transaction` of type `'dispute_loss'` for the disputed amount, update `profiles.balance`.
  - Notifies the poster of the outcome.
- [ ] Add `balance_frozen` column migration: `supabase/migrations/<timestamp>_add_balance_frozen.sql`
- [ ] The `/connect/transfer` route must refuse withdrawals when `profiles.balance_frozen = true`.
- [ ] The `GET /wallet/balance` endpoints must surface `balance_frozen` so the mobile client can
  display a banner.
- [ ] Unit / integration tests for both handlers.
- [ ] Deploy `webhooks` Edge Function: `supabase functions deploy webhooks --no-verify-jwt`.

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/webhooks/index.ts` | Add `case 'charge.dispute.created'` and `case 'charge.dispute.closed'` |
| `supabase/functions/connect/index.ts` | Guard `/transfer` route against `balance_frozen` |
| `supabase/functions/wallet/index.ts` | Expose `balance_frozen` in balance response |
| `services/api/src/routes/payments.ts` | Mirror dispute handlers if Fastify is still used |
| `supabase/migrations/<ts>_add_balance_frozen.sql` | New migration |
| `lib/wallet-context.tsx` | Consume `balance_frozen` from balance response; surface warning |

### Reference

- `supabase/functions/webhooks/index.ts` — see `default:` case at line ~564; insert new cases before it.
- Stripe docs: [Responding to Disputes](https://stripe.com/docs/disputes/responding)
- `FINANCIAL_FLOWS.md` § 8.2 — "No `charge.dispute.created` / `charge.dispute.closed` webhook handlers"

---

## GAP-02 · P0 · Audit & Enforce RLS on `wallet_transactions`

### PR Title
```
security(db): audit and enforce RLS policies on wallet_transactions table
```

### Problem

The majority of DB writes to `wallet_transactions` are performed with the **service-role key**
(which bypasses Row Level Security). This is correct for backend operations, but it is currently
unclear whether RLS policies exist that would protect rows if the Supabase JS client is ever used
directly from the mobile app. If an unauthenticated or cross-user query is possible, a user could
read or modify another user's transaction history.

### Acceptance Criteria

- [ ] Run `SELECT * FROM pg_policies WHERE tablename = 'wallet_transactions';` against the production
  Supabase project and document the result.
- [ ] If policies are missing or insufficient, add a migration that enforces:
  - `SELECT`: `user_id = auth.uid()`
  - `INSERT`: disallow from client (service role only) — `USING (false)` or omit `INSERT` policy
    so no authenticated user can self-insert transactions.
  - `UPDATE` / `DELETE`: disallow from client.
- [ ] Add equivalent policies for `bounty_disputes` and `dispute_evidence` tables.
- [ ] Confirm `stripe_events` is not readable by end users (it should be service-role only).
- [ ] Add a RLS policy integration test (using a non-admin Supabase client) that asserts:
  - User A cannot read User B's transactions.
  - An authenticated client cannot INSERT directly into `wallet_transactions`.
- [ ] Document findings and applied policies in `supabase/ops/RLS_AUDIT.md`.

### Files to Change

| File | Change |
|------|--------|
| `supabase/migrations/<ts>_rls_wallet_transactions.sql` | New migration: `ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY; CREATE POLICY ...` |
| `supabase/migrations/<ts>_rls_bounty_disputes.sql` | New migration for `bounty_disputes` and `dispute_evidence` |
| `supabase/ops/RLS_AUDIT.md` | New doc: audit results and policy rationale |
| `__tests__/` or `tests/` | New integration test: cross-user read attempt should return empty |

### Reference

- `FINANCIAL_FLOWS.md` § 8.2 — "RLS policies for `wallet_transactions` not verified"
- `supabase/ops/INDEXING_README.md` — pattern for writing migration notes
- Existing RLS example: `supabase/migrations/20260413_fix_bounty_status_flow.sql` lines 84–110

---

## GAP-03 · P1 · Complete Stripe Connect Onboarding Deep-Link Return Flow

### PR Title
```
feat(connect): implement deep-link return flow after Stripe Connect KYC onboarding
```

### Problem

`POST /connect/create-account-link` generates a Stripe-hosted onboarding URL with:
```
return_url: `${appUrl}/wallet/connect/return`
refresh_url: `${appUrl}/wallet/connect/refresh`
```

After the hunter completes KYC on Stripe's website, they land on a browser page at that URL. There
is no mechanism to:
1. Return the hunter back to the mobile app.
2. Trigger `POST /connect/verify-onboarding` automatically to update `stripe_connect_onboarded_at`.
3. Show the hunter a success state inside the app.

The hunter is left in a dead browser tab with no path back to their wallet.

### Acceptance Criteria

- [ ] Register a universal link / app scheme for `<APP_URL>/wallet/connect/return` and
  `<APP_URL>/wallet/connect/refresh` using Expo's `expo-linking` module.
- [ ] Add a web fallback landing page at `docs/wallet/connect/return/index.html` and
  `docs/wallet/connect/refresh/index.html` (following pattern of `docs/auth/callback/index.html`).
  The page should detect the platform and either deep-link into the app or show a "Return to App"
  button.
- [ ] Add an Expo Router route `app/wallet/connect/return.tsx` that:
  - Calls `POST /connect/verify-onboarding` on mount.
  - Shows a loading spinner, then success/failure state.
  - On success: navigates to the wallet screen and triggers a balance refresh.
  - On failure / incomplete: shows "Continue setup" button that re-opens the account link.
- [ ] Add `app/wallet/connect/refresh.tsx` that re-fetches a new account link and opens it in
  `WebBrowser.openAuthSessionAsync`.
- [ ] Update `supabase/functions/connect/index.ts` to accept the app deep-link scheme as a valid
  `return_url` (e.g., `bountyexpo://wallet/connect/return`).
- [ ] E2E test: mock `verify-onboarding` returning `{ onboarded: true }` and assert navigation
  to wallet screen.

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/connect/index.ts` | Accept deep-link scheme in `return_url` |
| `app/wallet/connect/return.tsx` | New route |
| `app/wallet/connect/refresh.tsx` | New route |
| `docs/wallet/connect/return/index.html` | Web landing page (deep-link redirect) |
| `docs/wallet/connect/refresh/index.html` | Web refresh page |
| `app.config.js` | Register `bountyexpo` URL scheme or universal link entitlement |

### Reference

- `supabase/functions/connect/index.ts` lines 96–107 (account link creation with `return_url`)
- `docs/auth/callback/index.html` — pattern for web fallback pages
- `lib/services/auth-service.ts` lines 174–181 — password reset deep-link pattern to replicate
- `FINANCIAL_FLOWS.md` § 8.2 — "Stripe Connect onboarding UX is incomplete"

---

## GAP-04 · P1 · Push Notification on Balance Change

### PR Title
```
feat(wallet): send push notification when deposit is processed
```

### Problem

After `payment_intent.succeeded` triggers `apply_deposit`, the user's balance is updated in the DB
but the mobile app only learns about it the next time `refreshFromApi` is called (on screen focus or
auth events). There is no real-time notification that a deposit has been credited.

The `process-notification` Edge Function and `send-expo-push` Edge Function already exist and are
functional. Expo push tokens are stored on `profiles.expo_push_token`. The infrastructure is ready;
only the webhook handler needs to trigger it.

### Acceptance Criteria

- [ ] In `supabase/functions/webhooks/index.ts`, after `apply_deposit` succeeds in the
  `payment_intent.succeeded` handler, call `supabase.functions.invoke('process-notification', ...)` 
  (or `supabase.from('notifications').insert(...)`) with:
  - `type: 'payment'`
  - `title: 'Deposit Successful'`
  - `body: 'Your deposit of $X.XX has been credited to your wallet.'`
  - `data: { type: 'balance_update', newBalance: <derived balance> }`
- [ ] On the mobile side, `WalletContext` should handle an incoming push notification with
  `data.type === 'balance_update'` and call `refreshFromApi()` to sync the new balance without
  requiring the user to navigate away and back.
- [ ] Add a similar notification for `transfer.paid` (escrow release to hunter).
- [ ] Do not send a notification if `apply_deposit` fails or is a duplicate (idempotency rejection).
- [ ] Unit test: mock Supabase function invocation and assert notification is triggered after
  a successful `payment_intent.succeeded` event.

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/webhooks/index.ts` | Trigger notification after `apply_deposit` |
| `lib/wallet-context.tsx` | Handle `balance_update` push payload to auto-refresh |
| `hooks/useNotifications.ts` (if exists) | Route `balance_update` notification type |

### Reference

- `supabase/functions/webhooks/index.ts` lines ~466–506 (`payout.paid` notification — replicate pattern)
- `supabase/functions/process-notification/` — existing notification Edge Function
- `FINANCIAL_FLOWS.md` § 8.2 — "No push notification on balance change"

---

## GAP-05 · P1 · Dispute Wallet Freeze on Bounty Dispute

### PR Title
```
feat(disputes): freeze wallet balance when a bounty dispute is opened
```

### Problem

When a user opens an application-level dispute (creating a `bounty_disputes` row), there is no
mechanism to prevent the poster from withdrawing the disputed funds before the dispute is resolved.
The `/connect/transfer` route checks only `balance >= amount`; it has no concept of frozen funds.

This allows a bad-faith poster to:
1. Post a bounty.
2. Receive the work.
3. File a dispute to delay payment.
4. Simultaneously withdraw their wallet balance.

### Acceptance Criteria

> **Dependency:** This task requires the `balance_frozen` column from GAP-01. The column can be
> repurposed here if GAP-01 is not yet merged; alternatively, add a `balance_on_hold` numeric column
> that reserves a specific dollar amount without fully freezing all withdrawals.

- [ ] When `bounty_disputes` row is inserted (either via the Fastify API or Edge Function):
  - Increment `profiles.balance_on_hold` by the bounty amount.
- [ ] `/connect/transfer` and any other withdrawal endpoints must check:
  `profiles.balance - profiles.balance_on_hold >= requested_amount`
- [ ] When a dispute is resolved (status set to `resolved_poster_wins`, `resolved_hunter_wins`, or
  `cancelled`):
  - Decrement `profiles.balance_on_hold` by the held amount.
  - Adjust `profiles.balance` as appropriate (deduct on `resolved_hunter_wins`, restore on
    `resolved_poster_wins` / `cancelled`).
- [ ] Add migration: `supabase/migrations/<ts>_add_balance_on_hold.sql`
- [ ] Update `GET /wallet/balance` to return `balanceOnHold` so the UI can show an "On Hold" line.
- [ ] Update `lib/wallet-context.tsx` to display held amount in the wallet screen.
- [ ] Unit test: assert that a poster with $100 balance and $80 on hold cannot withdraw $30.

### Files to Change

| File | Change |
|------|--------|
| `supabase/migrations/<ts>_add_balance_on_hold.sql` | New migration |
| `supabase/functions/connect/index.ts` | Check `balance_on_hold` in `/transfer` route |
| `services/api/src/routes/payments.ts` | Mirror check in Fastify transfer route |
| `supabase/functions/wallet/index.ts` | Return `balanceOnHold` in balance response |
| `lib/wallet-context.tsx` | Display held balance |

### Reference

- `supabase/functions/connect/index.ts` lines 163–170 (balance check before transfer)
- `FINANCIAL_FLOWS.md` § 8.2 — "No dispute freeze UI"

---

## GAP-06 · P2 · Consolidate Three Parallel Server Surfaces

### PR Title
```
refactor(api): consolidate wallet and payment routes to Supabase Edge Functions; deprecate Express/Fastify mirrors
```

### Problem

Three server surfaces expose identical or near-identical routes:

| Route | Express (`server/index.js`) | Fastify (`services/api/`) | Edge Function (`supabase/functions/`) |
|-------|-----------------------------|---------------------------|---------------------------------------|
| `GET /wallet/balance` | ✅ | ✅ | ✅ |
| `GET /payments/methods` | ✅ | ✅ | ✅ |
| `POST /payments/create-payment-intent` | ✅ | ✅ | ✅ |

The active server is determined at runtime by which `API_BASE_URL` is resolved in
`lib/config/api.ts`. A misconfiguration (e.g., stale `EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL` env var)
can silently route traffic to the wrong surface, causing balance cross-checks to use different data
sources or different fee schedules.

### Acceptance Criteria

- [ ] **Phase 1 — Document:** Add a migration guide in `docs/SERVER_CONSOLIDATION.md` listing all
  duplicate routes and their canonical Edge Function equivalent.
- [ ] **Phase 2 — Deprecation flags:** Add `X-Deprecated: true` response header to all Express and
  Fastify wallet/payment routes. Log a warning in the mobile client when this header is detected.
- [ ] **Phase 3 — Client routing:** Update `lib/config/api.ts` to always prefer Edge Functions for
  `/wallet/*` and `/payments/*` routes when `EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL` is set; remove
  the fallback to Express/Fastify for these specific paths.
- [ ] **Phase 4 — Removal (separate PR):** After a soak period with telemetry showing zero traffic
  to Express/Fastify wallet routes, remove them and update `server/index.js` and
  `services/api/src/routes/payments.ts`.
- [ ] Ensure that `services/api/` routes required only by the Fastify server (admin, escrow
  management) are **not** removed — only the mirrors of Edge Function routes.
- [ ] Add an integration test that sets `EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL` and asserts all
  financial requests resolve to the Edge Function URL.

### Files to Change

| File | Change |
|------|--------|
| `lib/config/api.ts` | Prefer Edge Functions URL for financial routes |
| `server/index.js` | Add `X-Deprecated` header to wallet/payment routes |
| `services/api/src/routes/payments.ts` | Add `X-Deprecated` header to mirrored routes |
| `docs/SERVER_CONSOLIDATION.md` | New migration guide |

### Reference

- `lib/config/api.ts` lines 22–32 (URL resolution order)
- `FINANCIAL_FLOWS.md` § 1.1, § 8.2 — "Three parallel server surfaces"
- `FINANCIAL_FLOWS.md` § 9 — Recommendations P2

---

## GAP-07 · P2 · Add Idempotency Guards to `charge.refunded` and Transfer Event Handlers

### PR Title
```
fix(webhooks): add ON CONFLICT guards to charge.refunded and transfer event handlers
```

### Problem

`apply_deposit` uses a unique index on `stripe_payment_intent_id` for idempotency, making it
replay-safe. However, the `charge.refunded` and `transfer.created` handlers in
`supabase/functions/webhooks/index.ts` perform direct `INSERT` operations with no conflict guard:

```typescript
// charge.refunded handler (line ~341)
await supabase.from('wallet_transactions').insert({
  user_id: origTx.user_id,
  type: 'refund',
  amount: -(charge.amount_refunded / 100),
  // ← no unique field to prevent duplicate on replay
})
```

If Stripe retries a webhook (e.g., due to a 500 response from the function), a second refund
transaction is inserted, crediting the user's wallet twice.

### Acceptance Criteria

- [ ] Add a `stripe_charge_id` unique index on `wallet_transactions`:
  `CREATE UNIQUE INDEX CONCURRENTLY idx_wallet_tx_stripe_charge_id ON wallet_transactions(stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;`
- [ ] Change the `charge.refunded` `INSERT` to an `upsert` with `onConflict: 'stripe_charge_id'`
  and `ignoreDuplicates: true`.
- [ ] For `transfer.created`, the handler already does an `UPDATE` (not INSERT), so replay is safe.
  Verify and add a comment confirming this.
- [ ] For `payout.paid` and `payout.failed`, the handlers insert into `notifications`. Add a
  unique index or upsert on `(user_id, type, data->>'payoutId')` to prevent duplicate notifications.
- [ ] Add a migration: `supabase/migrations/<ts>_idempotency_guards_refund.sql`
- [ ] Unit test: feed the same `charge.refunded` event twice; assert only one transaction is created.

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/webhooks/index.ts` | Change `insert` to `upsert` in `charge.refunded` handler |
| `supabase/migrations/<ts>_idempotency_guards_refund.sql` | New migration |
| `services/api/src/routes/payments.ts` | Mirror fix if Fastify has an equivalent handler |

### Reference

- `supabase/functions/webhooks/index.ts` lines 329–370 (`charge.refunded` handler)
- `supabase/migrations/20260311_add_unique_idx_wallet_tx_stripe_payment_intent.sql` — pattern to replicate
- `FINANCIAL_FLOWS.md` § 8.2 — "Webhook replay risk beyond `stripe_event_id`"

---

## GAP-08 · P2 · `payout.failed` Recovery UI for Hunters

### PR Title
```
feat(wallet): add in-app recovery UI for failed payouts (payout.failed)
```

### Problem

When `payout.failed` fires, the webhook:
1. Inserts a `notifications` row (hunter receives a push).
2. Sets `profiles.payout_failed_at` to the current timestamp.

But the mobile app has no screen or banner that:
- Detects `payout_failed_at` is set.
- Tells the hunter what failed and why (Stripe `failure_code` / `failure_message`).
- Guides them to fix their bank account details in the Stripe Connect dashboard.
- Clears `payout_failed_at` once resolved.

### Acceptance Criteria

- [ ] `GET /wallet/balance` (all three surfaces) must return `payoutFailedAt` and
  `payoutFailureCode` from `profiles`.
- [ ] `lib/wallet-context.tsx` must expose `payoutFailed: boolean` and `payoutFailureCode: string | null`.
- [ ] Add a `PayoutFailedBanner` component (`components/ui/PayoutFailedBanner.tsx`):
  - Shown at the top of the wallet screen when `payoutFailed === true`.
  - Displays `failure_message` if available, otherwise a human-friendly mapping of `failure_code`
    (e.g., `account_closed` → "Your bank account has been closed.").
  - "Fix Payment Details" button opens `WebBrowser.openBrowserAsync` with a new Stripe Express
    Dashboard link (call `POST /connect/create-account-link` with `type: 'account_update'`).
- [ ] After the hunter fixes their details, `payout_failed_at` should be cleared. Implement via:
  - Polling `verify-onboarding` on app foreground after the browser session closes, OR
  - A new `POST /connect/clear-payout-failed` endpoint that sets `payout_failed_at = null` when
    `account.updated` confirms `payouts_enabled = true`.
- [ ] Add `'account_update'` account link type to `supabase/functions/connect/index.ts`.

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/wallet/index.ts` | Return `payoutFailedAt`, `payoutFailureCode` |
| `services/api/src/services/consolidated-wallet-service.ts` | Include payout failure fields in balance response |
| `lib/wallet-context.tsx` | Expose `payoutFailed`, `payoutFailureCode` |
| `components/ui/PayoutFailedBanner.tsx` | New component |
| `app/wallet/index.tsx` (or wallet screen) | Render `PayoutFailedBanner` at top |
| `supabase/functions/connect/index.ts` | Support `type: 'account_update'` in `/create-account-link` |

### Reference

- `supabase/functions/webhooks/index.ts` lines 509–561 (`payout.failed` handler)
- `FINANCIAL_FLOWS.md` § 8.2 — "Payout notification only on `payout.paid` event"

---

## GAP-09 · P2 · Enforce Retry Limit in `transfer.failed` Webhook Handler

### PR Title
```
fix(webhooks): enforce retry count limit in transfer.failed handler to prevent infinite retry loops
```

### Problem

`POST /connect/retry-transfer` reads a `retry_count` field and refuses to retry beyond a configured
maximum. However, the initial `transfer.failed` webhook handler sets `retry_count: 0` unconditionally:

```typescript
// supabase/functions/webhooks/index.ts ~ line 419
metadata: {
  transfer_status: 'failed',
  failure_reason: transfer.failure_code,
  retry_count: 0,   // ← always resets to 0 on each failure event
},
```

If a transfer fails, is retried, and fails again, the next `transfer.failed` event resets
`retry_count` to 0. This means the retry limit is never actually enforced by the webhook handler,
only by the manual retry endpoint — a gap if retries are triggered automatically.

### Acceptance Criteria

- [ ] In the `transfer.failed` handler, read the existing `retry_count` from the current
  `wallet_transaction` metadata before overwriting it:
  ```typescript
  const existing = await supabase
    .from('wallet_transactions')
    .select('metadata')
    .eq('stripe_transfer_id', transfer.id)
    .maybeSingle()
  const currentRetries = (existing?.data?.metadata as any)?.retry_count ?? 0
  ```
- [ ] Set `retry_count: currentRetries + 1` (not hard-coded `0`) in the update.
- [ ] Add a `MAX_TRANSFER_RETRIES = 3` constant. If `currentRetries + 1 >= MAX_TRANSFER_RETRIES`:
  - Set transaction `status = 'permanently_failed'`.
  - Insert a notification: *"Your withdrawal could not be completed after multiple attempts.
    Please contact support."*
  - Do **not** automatically refund the balance at this point (requires manual review).
- [ ] Mirror this logic in `services/api/src/routes/payments.ts` if a Fastify `transfer.failed`
  handler exists.
- [ ] Unit test: simulate 3 sequential `transfer.failed` events; assert `status = 'permanently_failed'`
  and no further retries are attempted.

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/webhooks/index.ts` | Read existing `retry_count` before incrementing |
| `services/api/src/routes/payments.ts` | Mirror fix if applicable |

### Reference

- `supabase/functions/webhooks/index.ts` lines 408–446 (`transfer.failed` handler)
- `FINANCIAL_FLOWS.md` § 8.2 — "`transfer.failed` retry count not consistently enforced"

---

## GAP-10 · P3 · iOS SecureStore Key Format Migration

### PR Title
```
fix(storage): migrate iOS SecureStore keys after colon-to-underscore sanitization
```

### Problem

`lib/utils/secure-storage.ts` sanitizes SecureStore keys by replacing `:` with `_` before passing
them to `expo-secure-store`. The four sensitive wallet keys are therefore stored under:

```
@bountyexpo_secure_wallet_balance         (displayed as @bountyexpo:secure:wallet_balance)
@bountyexpo_secure_wallet_transactions
@bountyexpo_secure_wallet_last_deposit_ts
@bountyexpo_secure_payment_token
```

Users who installed the app **before** this sanitization was applied wrote keys with `:` in them.
On these devices, `getSecureItem('wallet_balance')` will look for the sanitized key and find
nothing, returning `null` — even though the old key (with colons) exists in their Keychain. This
causes a silent balance loss on the client side until `refreshFromApi` succeeds.

### Acceptance Criteria

- [ ] Add a one-time migration function `migrateSecureStorageKeys()` in `lib/utils/secure-storage.ts`:
  - For each sensitive key, attempt to read the **unsanitized** (colon-containing) key name directly
    via `SecureStore.getItemAsync`.
  - If a value is found, write it under the sanitized key name and delete the old key.
  - Guard with an AsyncStorage flag (`@bountyexpo:keyMigrationV1Done`) so it only runs once.
- [ ] Call `migrateSecureStorageKeys()` in `WalletContext` initialization (before the first balance
  read from SecureStore).
- [ ] Add a unit test using the `SecureStore` mock in `__mocks__` that confirms old keys are
  migrated and deleted on first run.

### Files to Change

| File | Change |
|------|--------|
| `lib/utils/secure-storage.ts` | Add `migrateSecureStorageKeys()` |
| `lib/wallet-context.tsx` | Call migration on init |
| `__tests__/unit/secure-storage.test.ts` (or create it) | Migration unit test |

### Reference

- `lib/utils/secure-storage.ts` lines 21–29 (key sanitization logic)
- `FINANCIAL_FLOWS.md` § 8.2 — "iOS SecureStore key format"

---

## Quick-Reference Summary

| ID | Priority | Title | Severity |
|----|----------|-------|----------|
| GAP-01 | **P0** | `charge.dispute.*` webhook handlers | 🔴 Critical |
| GAP-02 | **P0** | RLS on `wallet_transactions` | 🔴 Critical |
| GAP-03 | **P1** | Connect onboarding deep-link return | 🟠 High |
| GAP-04 | **P1** | Push notification on balance change | 🟠 High |
| GAP-05 | **P1** | Dispute wallet freeze | 🟠 High |
| GAP-06 | **P2** | Consolidate 3 server surfaces | 🟡 Medium |
| GAP-07 | **P2** | Idempotency guards for `charge.refunded` | 🟡 Medium |
| GAP-08 | **P2** | `payout.failed` recovery UI | 🟡 Medium |
| GAP-09 | **P2** | Transfer retry limit enforcement | 🟡 Medium |
| GAP-10 | **P3** | iOS SecureStore key migration | 🔵 Low |
