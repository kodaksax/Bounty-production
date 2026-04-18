# PR Prompts — Withdrawal Fixes (Copy/Paste)

Use these prompts directly for focused pull requests. Ordered by launch risk.

---

## WF-01 · P0 · Unify withdrawal routing for bank account endpoints

### PR Title
```
fix(payments): align active backend with /connect/bank-accounts endpoints used by mobile
```

### Prompt
```md
Problem:
Mobile withdrawal screens call `/connect/bank-accounts*` but endpoint coverage differs between backend surfaces.

Scope:
- Confirm active runtime surface used by `lib/config/api.ts`.
- Ensure that same surface fully supports:
  - GET `/connect/bank-accounts`
  - POST `/connect/bank-accounts`
  - DELETE `/connect/bank-accounts/:bankAccountId`
  - POST `/connect/bank-accounts/:bankAccountId/default`
- Keep response shapes compatible with:
  - `components/withdraw-screen.tsx`
  - `components/withdraw-with-bank-screen.tsx`

Acceptance criteria:
- Bank account list/add/remove/default works end-to-end from app.
- No fallback dependency on inactive server surface.
- Add/update tests covering these routes on the active backend surface.
```

---

## WF-02 · P0 · Add transfer idempotency enforcement in Edge connect transfer flow

### PR Title
```
fix(payments): enforce idempotency for /connect/transfer in Edge function
```

### Prompt
```md
Problem:
Withdrawal requests include `idempotencyKey` from client, but transfer creation path does not currently enforce full idempotency.

Scope:
- Update `supabase/functions/connect/index.ts` transfer flow to read and apply `idempotencyKey`.
- Pass idempotency options through Stripe transfer creation.
- Store idempotency metadata in `wallet_transactions`.
- Ensure retries with the same key do not create duplicate transfers or duplicate debits.

Acceptance criteria:
- Replayed requests with same key return safe duplicate behavior.
- Only one transfer/debit effect per logical withdrawal attempt.
- Add regression tests for duplicate submission/retry behavior.
```

---

## WF-03 · P1 · Harden transfer failure rollback with durable refund markers

### PR Title
```
fix(payments): persist rollback-failure markers for failed withdrawal recovery
```

### Prompt
```md
Problem:
If Stripe transfer creation fails and balance rollback also fails, recovery is not reliably discoverable from transaction metadata in Edge transfer flow.

Scope:
- In `supabase/functions/connect/index.ts`, when rollback fails, persist metadata markers:
  - `needs_balance_refund: true`
  - `needs_balance_refund_amount`
  - `rollback_failed_at`
- Ensure metadata is queryable by reconciliation tooling.
- Align behavior with recovery expectations from `services/api/src/services/reconciliation-cron.ts`.

Acceptance criteria:
- Rollback failure leaves a durable repair marker.
- Reconciliation can detect and recover flagged records.
- Add tests for rollback-failure marking behavior.
```

---

## WF-04 · P1 · Make transfer ledger writes resilient and auditable

### PR Title
```
refactor(payments): make /connect/transfer ledger state transitions auditable under partial failures
```

### Prompt
```md
Problem:
Transfer and transaction write ordering can leave hard-to-debug states when one side succeeds and the other fails.

Scope:
- Refactor transfer pipeline to preserve an auditable transaction record across all failure points.
- Ensure transaction status transitions are explicit (`pending` -> `completed` / `failed`).
- Preserve Stripe transfer linkage and error metadata for support investigation.

Acceptance criteria:
- Every withdrawal attempt has a durable wallet transaction row.
- Support can trace any transfer ID to a transaction and user.
- No silent orphan states after induced DB/Stripe failure tests.
```

---

## WF-05 · P1 · Close payout.failed recovery loop in UX and APIs

### PR Title
```
fix(wallet): complete payout-failure recovery loop from webhook to app banner clear
```

### Prompt
```md
Problem:
Users may remain blocked/confused after payout failures unless profile flags, wallet API fields, and re-onboarding clear paths stay synchronized.

Scope:
- Verify/patch webhook handling in `supabase/functions/webhooks/index.ts` for `payout.failed`/`payout.paid`.
- Verify wallet balance response in `supabase/functions/wallet/index.ts` includes payout failure fields used by UI.
- Verify `POST /connect/verify-onboarding` in `supabase/functions/connect/index.ts` clears payout-failure flags when payouts are re-enabled.
- Validate UI behavior in `components/ui/PayoutFailedBanner.tsx`.

Acceptance criteria:
- payout failure shows actionable banner.
- successful re-onboarding clears banner-driving fields.
- regression tests cover stale-banner and clear-success paths.
```

---

## WF-06 · P2 · Add an explicit withdrawal incident test suite

### PR Title
```
test(payments): add withdrawal incident regression suite for edge failure scenarios
```

### Prompt
```md
Create a focused suite covering:
- duplicate withdrawal submission (same idempotency key)
- transfer creation failure with successful refund
- transfer creation failure with refund failure marker
- duplicate `transfer.failed` webhook delivery (no double refund)
- payout failure flag set/clear lifecycle

Use and extend existing suites where possible:
- `__tests__/unit/services/wallet-routes.test.ts`
- `__tests__/unit/routes/consolidated-webhooks.test.ts`
- `__tests__/unit/server/transfer-failed-webhook.test.ts`
- `services/api/src/__tests__/idempotency.test.ts`
- `services/api/src/__tests__/reconciliation.test.ts`
```
