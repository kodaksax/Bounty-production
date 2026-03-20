Summary

This note documents recent hardening done to Stripe webhook processing and recommended client-side practices to avoid double-crediting, double-release, and UI/consistency issues when network failures occur.

Server-side changes (what I changed)

- Supabase Edge Function: `supabase/functions/webhooks/index.ts`
  - Added a pre-check to read `stripe_events` before inserting/upserting. If an event row already exists with `processed = true`, the function now returns immediately with `{ received: true, alreadyProcessed: true }`.
  - Replaced blind `upsert(..., { onConflict })` with a safe insert-or-update flow that avoids overwriting `processed: true`.
  - This prevents a retry from resetting `processed` to `false` and causing double-processing.

- Consolidated API webhook route: `services/api/src/routes/consolidated-webhooks.ts`
  - Tweaked the `logWebhookEvent` upsert to use `ignoreDuplicates: true` so retries won't reset `processed` to `false` if a processed row already exists.

Why this helps

- Webhook delivery from Stripe can be retried (network issues, timeouts, duplicate deliveries). Previously a blind upsert could accidentally set `processed=false` for an event that was already handled, enabling re-processing.
- Now the handler checks existing state and avoids resetting a processed flag. Combined with ledger-level idempotency (RPCs, `stripe_payment_intent_id` checks, and release/refund guards), this prevents double-credit / double-release.

Client-side guidance (recommended)

1) Always send an `idempotencyKey` for user-initiated wallet operations that change balances (release, refund, withdrawal).

- Example key patterns:
  - Release: `release_<bountyId>_<posterId>`
  - Deposit: `deposit_<userId>_<paymentIntentId>`
  - Withdrawal: `withdrawal_<userId>_<amount>_<destLast4>`

2) If the client loses connection while awaiting the API response, don't assume failure.

- Option A (recommended): Persist the outgoing request in the app's offline queue (`offlineQueueService.enqueue`) with the idempotencyKey and API payload. When online, process the queue. This avoids duplicate UI retries and ensures eventual consistency.

- Option B: If not queuing, generate a deterministic `idempotencyKey`, retry the request, and if you receive a 409 `duplicate_transaction` treat that as success (fetch latest transaction state).

3) Background reconciliation

- Periodically (or when the app reconnects) call a lightweight server endpoint to reconcile bounty/payment status. Example: `GET /payments/status?bountyId=...` that returns authoritative state (in_progress/completed/refunded) so the client can correct transient UI mismatches.

4) UI optimistic updates

- If you optimistically mark a bounty as `completed` after sending a release request, ensure the UI shows a pending indicator until successful acknowledgement or until reconciliation verifies the change. On conflict or error, roll back gracefully.

Quick client snippet (pseudo-code)

- Generate idempotency key and enqueue if offline:

```ts
const idempotencyKey = `release_${bountyId}_${posterId}`;
if (!navigator.onLine) {
  await offlineQueueService.enqueue('bounty', { bounty: { /* minimal payload */ }, tempId: 'temp-123' });
} else {
  // send request with idempotencyKey in body
  await fetch('/wallet/release', { method: 'POST', body: JSON.stringify({ bountyId, hunterId, idempotencyKey }) });
}
```

Next recommended work

- Add a DB migration to create `stripe_events` table (if not present) with a unique constraint on `stripe_event_id` and indexes on `processed` and `created_at`.
- Add a light reconciliation endpoint `GET /payments/status` to simplify client-side recovery when the app is uncertain about state.

If you want, I can:
- Create the DB migration for `stripe_events` (SQL) and a brief PR with the changes I made.
- Add a small client patch to include deterministic `idempotencyKey` in the release flow and enqueue it via `offlineQueueService`.


