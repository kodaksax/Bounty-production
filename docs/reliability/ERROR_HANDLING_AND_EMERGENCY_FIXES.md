# Error Handling and Emergency Fixes

This runbook describes the production reliability contract for Bounty. It is intentionally short: during an incident, the goal is to classify the failure, find the owner, patch safely, and verify quickly.

## Error Taxonomy

All app and backend errors should be handled as one of these classes:

| Class                  | Examples                                                                         | User experience                                                                      | Retry policy                                                            |
| ---------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Recoverable            | Offline, timeout, temporary Supabase or Stripe outage                            | Say the account or funds are safe, offer Retry                                       | Bounded retry only for idempotent reads or explicitly idempotent writes |
| User-actionable        | Invalid input, incomplete onboarding, insufficient balance, unavailable bounty   | Tell the user what to fix next                                                       | Do not retry automatically                                              |
| Authentication/session | Expired JWT, sign-out during request, auth startup race                          | Ask the user to sign in again without looping navigation                             | Do not retry with the same token                                        |
| Payment-critical       | Deposit, funding, payout, escrow release/refund, webhook/reconciliation drift    | Never imply money moved until the backend or Stripe confirms the authoritative state | Retry only with an idempotency key or reconciliation check              |
| Unexpected/system      | Malformed API response, null state, unexpected enum, database constraint failure | Show a safe fallback and capture diagnostics                                         | Treat as retryable only if repeating cannot duplicate state             |

## Runtime Contract

The expected flow is:

1. Catch the error at the nearest useful boundary.
2. Normalize it into a stable code and user-safe message.
3. Log sanitized diagnostic context with the operation name, entity id, and request/correlation id.
4. Present a recovery action: Retry, Sign in, Manage payout methods, Return home, Contact support, or Continue later.
5. Keep financial and marketplace state in an explicit `processing`, `succeeded`, `failed`, `canceled`, or `unknown` state.

Do not expose raw Supabase, Postgres, Stripe, JavaScript stack traces, tokens, secrets, or unnecessary PII to clients.

## Payments Rule

Never report a financial operation as successful from a client-side assumption.

For withdrawals, a successful HTTP response must include a Stripe payout id. If a client receives a 2xx payout response without `payoutId`, it must treat the state as `unknown_payout_state`, keep the idempotency key, and retry only to reconcile the same request.

The Connect-native payout Edge Function includes an `X-Request-Id` header and `requestId` response field for the native payout paths. The shared `invokePayments` client helper also sends `x-request-id` on payment Edge Function calls and preserves backend `code`, `status`, and `requestId` on thrown API errors. Use those values to join user reports, PostHog events, Sentry events, Supabase function logs, payout audit rows, and Stripe objects.

For `/payments/create-payment-intent`, validation failures return stable codes such as `invalid_amount`, `invalid_currency`, `payment_method_required`, and `bank_verification_failed`. The outer payment handler returns sanitized failure copy with a request id; raw provider/database messages should stay in logs, not user-facing responses.

For `/bounty-payments/create`, `/bounty-payments/release`, and `/bounty-payments/cancel`, every in-handler response goes through the request-aware reply helper. PaymentIntent, Transfer, Refund, and ledger metadata include `request_id` where that operation writes metadata. Critical release/refund failures are retryable, sanitized for users, and leave the payment in a recoverable state rather than reporting settlement as complete.

## Adding a New Error

1. Pick a stable machine code, for example `connect_not_onboarded` or `malformed_payout_success_response`.
2. Decide retryability before wiring UI. If retrying could duplicate money or marketplace state, require idempotency first.
3. Return `{ error, code, requestId }` from APIs and Edge Functions. Add `stripeAttempted: true` only when Stripe was actually called.
4. Map the code to user-safe copy in the nearest reusable UI or hook.
5. Log sanitized context: `operation`, `code`, `requestId`, relevant ids, status, retryability, and whether provider calls were attempted.
6. Add a focused regression test for the classification and recovery path.

## Emergency Fix Path

1. Identify the owner: frontend UI/hook, API service, Supabase Edge Function, database/RLS/RPC, Stripe/webhook, auth, or build/config.
2. Reproduce with the narrowest command or test. Prefer a focused unit/contract test over a full suite while triaging.
3. Check mitigation flags before code changes. Current high-risk payment flags include `CONNECT_NATIVE_PAYOUTS`, `INSTANT_CASHOUT_ENABLED`, `CONNECT_TRANSFER_RETIRED`, and `CONNECT_MANUAL_PAYOUTS`.
4. If a payment state is ambiguous, mark it unknown/pending and reconcile with Stripe. Do not mark success manually unless Stripe confirms settlement or an admin manual-payment path records that proof.
5. Patch the smallest owning surface and add a regression test.
6. Run focused validation, then broader checks as time allows.
7. Deploy the relevant layer:
   - Mobile OTA: `npm run update:production:check`, then `npm run update:production`.
   - Supabase functions: `npm run deploy:functions:production`.
   - API packages: `npm run build` and the service deployment workflow for the hosting target.
8. Verify by request id, affected user id, entity id, Stripe object id, and analytics/error events.
9. Roll back with the fastest safe lever: disable a feature flag, restore the previous Edge Function/API deploy, or publish a previous known-good EAS update.

## Validation Commands

Use these in order during a production fix:

| Scope                            | Command                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Payout hook                      | `npx jest __tests__/unit/hooks/use-connect-payout.test.ts --runInBand`                                                                      |
| Connect payout contract          | `npx jest __tests__/unit/connect-native-payout-contract.test.ts --runInBand`                                                                |
| Payment helper and Edge contract | `npx jest __tests__/unit/services/stripe-internal.test.ts __tests__/unit/payments-edge-function-contract.test.ts --runInBand`               |
| Bounty payment Edge contract     | `npx jest __tests__/unit/bounty-payments-edge-function-contract.test.ts __tests__/unit/bounty-payment-settlement-state.test.ts --runInBand` |
| Unit suite                       | `npm run test:unit`                                                                                                                         |
| TypeScript                       | `npx tsc --noEmit`                                                                                                                          |
| Environment                      | `npm run env:check`                                                                                                                         |
| OTA guardrails                   | `npm run update:production:check`                                                                                                           |
| Supabase function deploy         | `npm run deploy:functions:production`                                                                                                       |

## Remaining High-Risk Audit Targets

- Standardize `{ error, code, requestId, retryable }` across all Supabase Edge Functions, not only Connect-native payouts.
- Add request IDs to `invokePayments` and API service calls so escrow/deposit/release paths can be traced end to end.
- Expand malformed-response checks for auth, bounty creation/claiming, messaging, and profile/onboarding fetches.
- Replace generic `Alert.alert('Something went wrong')` call sites in core flows with mapped error codes and preserved form state.
- Add contract tests for webhook duplication, delayed webhook reconciliation, and old mobile-client compatibility.
