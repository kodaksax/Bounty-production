# Server Consolidation Migration Guide

This document lists all duplicate routes exposed by three parallel server surfaces
(Express, Fastify, and Supabase Edge Functions) and defines the canonical Edge
Function path that clients must use going forward.

## Background

Three server surfaces currently expose identical or near-identical financial routes:

| Route | Express (`server/index.js`) | Fastify (`services/api/`) | Edge Function (`supabase/functions/`) |
|---|---|---|---|
| `GET /wallet/balance` | ✅ | ✅ (`services/api/src/routes/wallet.ts`) | ✅ (`supabase/functions/wallet`) |
| `GET /wallet/transactions` | ✅ | ✅ (`services/api/src/routes/wallet.ts`) | ✅ (`supabase/functions/wallet`) |
| `POST /wallet/deposit` | — | ✅ (`services/api/src/routes/wallet.ts`) | ✅ (`supabase/functions/wallet`) |
| `GET /payments/methods` | ✅ | ✅ (`services/api/src/routes/payments.ts`) | ✅ (`supabase/functions/payments`) |
| `POST /payments/methods` | ✅ | — | ✅ (`supabase/functions/payments`) |
| `DELETE /payments/methods/:id` | ✅ | ✅ (`services/api/src/routes/payments.ts`) | ✅ (`supabase/functions/payments`) |
| `POST /payments/create-payment-intent` | ✅ | ✅ (`services/api/src/routes/payments.ts`) | ✅ (`supabase/functions/payments`) |
| `POST /payments/create-setup-intent` | — | ✅ (`services/api/src/routes/payments.ts`) | ✅ (`supabase/functions/payments`) |
| `POST /payments/confirm` | ✅ | ✅ (`services/api/src/routes/payments.ts`) | ✅ (`supabase/functions/payments`) |

The active server is determined at runtime by which `API_BASE_URL` value is resolved
in `lib/config/api.ts`. A misconfiguration (e.g., stale `EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL`)
can silently route traffic to the wrong surface, causing balance cross-checks to use
different data sources or different fee schedules.

## Canonical Endpoints

All `/wallet/*` and `/payments/*` routes now have canonical implementations as
Supabase Edge Functions:

| Route | Canonical Edge Function | Function Directory |
|---|---|---|
| `GET /wallet/balance` | `<SUPABASE_FUNCTIONS_URL>/wallet` | `supabase/functions/wallet/` |
| `GET /wallet/transactions` | `<SUPABASE_FUNCTIONS_URL>/wallet` | `supabase/functions/wallet/` |
| `POST /wallet/deposit` | `<SUPABASE_FUNCTIONS_URL>/wallet` | `supabase/functions/wallet/` |
| `GET /payments/methods` | `<SUPABASE_FUNCTIONS_URL>/payments` | `supabase/functions/payments/` |
| `POST /payments/methods` | `<SUPABASE_FUNCTIONS_URL>/payments` | `supabase/functions/payments/` |
| `DELETE /payments/methods/:id` | `<SUPABASE_FUNCTIONS_URL>/payments` | `supabase/functions/payments/` |
| `POST /payments/create-payment-intent` | `<SUPABASE_FUNCTIONS_URL>/payments` | `supabase/functions/payments/` |
| `POST /payments/create-setup-intent` | `<SUPABASE_FUNCTIONS_URL>/payments` | `supabase/functions/payments/` |
| `POST /payments/confirm` | `<SUPABASE_FUNCTIONS_URL>/payments` | `supabase/functions/payments/` |

Routes that exist **only** on Fastify (admin, escrow management) are **not** being
removed and are not covered by this migration:

| Route | Server | Notes |
|---|---|---|
| `POST /payments/escrows` | Fastify | Escrow creation — no Edge Function mirror |
| `POST /payments/escrows/:escrowId/release` | Fastify | Escrow release — no Edge Function mirror |
| `POST /payments/bank-accounts` | Fastify | Bank account management |
| `POST /payments/webhook` | Fastify / Express | Stripe webhook receiver |

## Migration Phases

### Phase 1 — Documentation (this file) ✅

Catalogue all duplicate routes and their canonical Edge Function equivalents.

### Phase 2 — Deprecation flags ✅

All Express and Fastify mirrors of the Edge Function routes now return an
`X-Deprecated: true` response header. The mobile client logs a console warning
whenever it receives this header, allowing teams to monitor traffic via log
aggregation.

Detection in logs:
```
[API] Received X-Deprecated header on GET /wallet/balance — this server surface is deprecated. Please ensure EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL is set so requests route to the Supabase Edge Function.
```

### Phase 3 — Client routing ✅

`lib/config/api.ts` now exports `getFinancialApiUrl()` which **always** returns the
Edge Functions base URL for `/wallet/*` and `/payments/*` routes and never falls back
to Express/Fastify for these paths.

Callers in `lib/wallet-context.tsx` and `lib/services/stripe-service.ts` use
`FINANCIAL_API_BASE_URL` (resolved at module load) instead of the generic
`API_BASE_URL` for all wallet and payment calls.

### Phase 4 — Removal (separate PR)

After a soak period with telemetry confirming zero traffic to the Express/Fastify
wallet routes, remove the deprecated route handlers and update:

- `server/index.js` — remove `GET /wallet/balance`, `GET /wallet/transactions`,
  `POST /payments/create-payment-intent`, `GET /payments/methods`,
  `POST /payments/methods`, `DELETE /payments/methods/:id`, `POST /payments/confirm`
- `services/api/src/routes/wallet.ts` — remove `GET /wallet/balance`,
  `GET /wallet/transactions`
- `services/api/src/routes/payments.ts` — remove `POST /payments/create-payment-intent`,
  `POST /payments/create-setup-intent`, `GET /payments/methods`,
  `DELETE /payments/methods/:paymentMethodId`, `POST /payments/confirm`

## Required Environment Variables

To route financial calls to Edge Functions, at minimum one of the following must be set:

```
# Preferred — explicit Edge Function base URL
EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL=https://<project-ref>.supabase.co/functions/v1

# Alternative — the functions URL is derived automatically
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
```

Both are set in `.env.staging` and `.env.production`. See `docs/ENV_SETUP.md` for the
full variable reference.

## Verifying Traffic Routing

Run the integration test to assert that financial routes resolve to the Edge Function URL:

```bash
npx jest __tests__/integration/api/financial-route-resolution.test.ts
```
