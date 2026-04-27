# ACH Bank Account Linking via Stripe Financial Connections

> **Status:** Implemented (US only).
> **Scope:** Replaces all manual routing/account number entry with Stripe
> Financial Connections. The same linked bank powers both deposits
> (`us_bank_account` PaymentMethod) and withdrawals (mirrored as a Connect
> external account) so users can save their bank once and one-tap repeat
> deposits afterward.

## Why

The previous flow required users to type their routing + account number into
the app and then verify via micro-deposits 1–2 business days later. That:

1. Pulled the app into NACHA / sensitive-data scope unnecessarily.
2. Added 1–2 days of friction on every new bank.
3. Forced us to maintain separate code paths for deposits (PaymentMethod on
   the Customer) vs. payouts (External Account on the Connect account).

Stripe Financial Connections solves all three: tokenized credentials, instant
verification when supported by the institution, and a single FC account that
can be projected onto both the Customer and Connect side.

## Architecture overview

```
┌───────────────────────────────┐         ┌──────────────────────────────┐
│  React Native App             │         │  Edge Function: payments     │
│                               │         │                              │
│  AddBankAccountModal          │  ──1──▶ │  POST /create-financial-     │
│  (single "Link with Stripe"   │         │       connections-session    │
│   CTA, no manual fields)      │ ◀──2─── │   ↳ creates fcsess_*         │
│                               │         │                              │
│  collectFinancialConnections  │  ──3──▶ │  Stripe FC native UI         │
│  Accounts(client_secret)      │         │  (Plaid-style auth, US only) │
│                               │         │                              │
│                               │  ──4──▶ │  POST /financial-connections-│
│                               │         │       complete               │
│                               │         │   ↳ for each linked account: │
│                               │         │     • paymentMethods.create  │
│                               │         │       (us_bank_account)      │
│                               │         │     • paymentMethods.attach  │
│                               │         │       (Customer)             │
│                               │         │     • tokens.create          │
│                               │         │       (FC → bank_account tok)│
│                               │         │     • accounts.createExternal│
│                               │         │       Account (Connect)      │
│                               │         │     • upsert payment_methods │
│                               │         │       row                    │
└───────────────────────────────┘         └──────────────────────────────┘
```

After linking, deposits flow:

```
App ──▶ POST /payments/create-payment-intent
        { amountCents, paymentMethodId, paymentMethodType: 'us_bank_account',
          confirm: true }
       ──▶ Stripe (PI confirmed server-side w/ mandate captured)
       ◀── status: 'processing' | 'requires_action' | 'succeeded'
```

Withdrawals continue to use the existing `/connect/transfer` route — it now
finds the user's bank via the same `payment_methods` row
(`stripe_external_account_id`).

## Database

`supabase/migrations/20260425_add_us_bank_account_columns.sql` extends
`payment_methods` with:

| Column                        | Purpose                                        |
| ----------------------------- | ---------------------------------------------- |
| `bank_name`                   | Friendly institution name (e.g. "Chase")       |
| `bank_last4`                  | Display masking                                |
| `account_type`                | `checking` \| `savings`                         |
| `fc_account_id`               | `fca_*` — source of truth for FC integration  |
| `stripe_external_account_id`  | `ba_*` mirrored on the Connect account        |
| `verification_status`         | `verified` / `pending_microdeposits` / `failed`|
| `mandate_id`                  | Captured on first ACH debit, reused thereafter |

Existing `card`-typed rows are unaffected. RLS already restricts each row to
its `user_id`.

## Edge Function additions (`supabase/functions/payments`)

- `POST /payments/create-financial-connections-session` — creates an FC session
  bound to the user's Stripe Customer with permissions `payment_method` and
  `balances` and a US-only filter.
- `POST /payments/financial-connections-complete` — body `{ sessionId, setAsDefault? }`.
  Retrieves the session, validates it belongs to this user's Customer, then
  for every linked account: creates+attaches the PaymentMethod, mirrors onto
  the Connect external account when present, and upserts the canonical row.
  Idempotent on `stripe_payment_method_id`.
- `POST /payments/create-payment-intent` — now branches on
  `paymentMethodType === 'us_bank_account'`:
  - Validates the saved bank belongs to the caller and is not `failed`.
  - Confirms the PI server-side with `verification_method: 'instant'` and a
    `financial_connections.permissions: ['payment_method']` fallback.
  - Captures online mandate data (IP + user-agent) and persists the resulting
    `mandate_id` on the row so subsequent off-session deposits reuse it.
- `POST /payments/create-setup-intent` — accepts
  `{ paymentMethodType: 'us_bank_account' }` to enable saving a bank for
  later one-tap deposits. (Cards continue to use the default branch.)
- `GET /payments/methods` — now returns both `card` and `us_bank_account`
  methods. Bank rows are read from the canonical DB row to expose
  `bank_name`, `last4`, `verification_status`, `is_default`.
- `DELETE /payments/methods/:id` — for `us_bank_account` rows it also
  detaches the mirrored Connect external account and removes the DB row.

## Deprecations

The previous manual-entry surfaces now return `410 Gone` with a migration
hint:

- `POST /functions/v1/connect/bank-accounts` (Edge Function)
- `POST /connect/bank-accounts` (services/api Fastify route)

Older clients that still POST raw routing/account numbers will surface a
clear error directing them to upgrade. Once mobile clients on the new build
have rolled out, these route handlers can be deleted entirely (tracked
separately).

> Per agreement: the manual-entry routes will be **fully removed** once the
> Edge Functions are confirmed as the single source of truth in production.

## Client surface

- `paymentMethodsService.linkBankWithFinancialConnections(authToken, { setAsDefault? })`
  drives the full link flow and returns `StripePaymentMethod[]` of newly
  linked banks (with `type === 'us_bank_account'` and a populated
  `us_bank_account` field).
- `paymentMethodsService.createAchDeposit({ amount, paymentMethodId, ... }, authToken)`
  initiates a one-tap deposit using a saved bank. Returns
  `{ paymentIntentId, status, requiresAction, nextAction }`.
- Both are re-exported on the `stripeService` facade.
- `StripePaymentMethod.type` widens to `'card' | 'us_bank_account' | string`
  with an optional `us_bank_account` block.
- `AddBankAccountModal` is now a single "Link Bank with Stripe" CTA. The
  legacy props (`onBack`, `onSave`, `embedded`) are preserved.

## Country support

US only for v1. Enforced server-side via the FC session
`filters: { countries: ['US'] }`. Adding additional countries is a single
config change on the session create call plus localized copy.

## Testing

- Unit tests for `linkBankWithFinancialConnections` (happy path,
  cancellation, no-account case, missing-SDK case) and `createAchDeposit`
  (valid params, microdeposit fallback, validation rejections) live in
  `__tests__/unit/services/payment-methods-service.test.ts`.
- `wallet-routes.test.ts` updated to assert the new `410` deprecation
  behavior on `POST /connect/bank-accounts`.
- All existing payment / wallet / escrow tests continue to pass.

## Roll-out checklist

1. Apply the migration (`20260425_add_us_bank_account_columns.sql`).
2. Deploy Edge Functions `payments` and `connect`.
3. Deploy services/api with the deprecated route returning 410.
4. Ship the mobile build with the rewritten `AddBankAccountModal`.
5. Monitor `ach_link_started` / `ach_link_completed` / `ach_link_failed`
   analytics for adoption.
6. Once mobile penetration is high enough, delete the deprecated
   `POST /connect/bank-accounts` handlers entirely.
