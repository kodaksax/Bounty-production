Payments: webhook idempotency + queued releases + migration

Summary:
- Add server-side idempotency guards for Stripe webhooks (avoid resetting processed flags).
- Add client offline enqueue support for release operations (deterministic idempotency keys).
- Add DB migration: supabase/migrations/20260320_create_stripe_events.sql

Notes:
- Tests not included. Recommend running 
px tsc --noEmit and adding integration tests for queued operations and webhook idempotency.
