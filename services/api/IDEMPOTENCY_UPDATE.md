# Idempotency & Stripe Safeguards Update

This document describes recent changes improving Stripe idempotency and safeguards.

What changed
- Added `services/api/src/services/stripe-safeguards.ts` — wrapper that reserves an idempotency key via the IdempotencyService before calling Stripe, removes the key on failure, and emits analytics events.
- Wrapped existing Stripe transfer calls in key places to use the wrapper:
  - `consolidated-wallet-service` (withdrawal & release flows)
  - `consolidated-stripe-connect-service` (retry transfer path)
  - `routes/wallet.ts` (`/connect/transfer` route)
  - `stripe-connect-service` (refunds)
- Added analytics tracking for reconciliation runs and Stripe call success/failure.
- Added a unit test: `src/__tests__/stripe-safeguards.test.ts`.

Developer notes
- The IdempotencyService uses Redis when configured and an in-memory fallback for single-instance development.
- Default idempotency TTL: 24 hours (configurable through code).
- For new Stripe calls, prefer `withStripeIdempotency(key, fn)` and persist the key in ledger metadata where applicable.

How to run tests
```
# from services/api
npm test
```

Monitoring
- Sentry and Mixpanel are used via `backendAnalytics` for key events (stripe_call_success, stripe_call_failed, reconciliation_run).
- Reconciliation cron logs mismatches and updates `wallet_transactions` accordingly; tune `RECONCILIATION_CRON` env var for schedule.

If you'd like, I can:
- Add outbox/event enqueueing so Stripe calls are executed asynchronously after DB commit
- Add more tests covering refunds and transfer retry flows
- Expand docs into a Design PR describing outbox/reconciliation architecture
