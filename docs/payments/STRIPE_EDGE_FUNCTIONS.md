# Stripe Connect Edge Functions

This project includes two Supabase Edge Functions for secure Stripe Connect onboarding and verification.

## Functions

### `create-stripe-connect`

Creates a Stripe Connect Express account when needed, persists the account id to `profiles.stripe_connect_account_id`, and returns an onboarding URL.

Idempotent behavior:
- If `profiles.stripe_connect_account_id` already exists, no new account is created.
- The function creates a new account link for the existing account.

**Request**
- Method: `POST`
- Auth: `Authorization: Bearer <supabase-access-token>`
- Optional JSON body:
  - `type`: `"account_onboarding"` (default) or `"account_update"`
  - `refreshUrl`: override refresh URL
  - `returnUrl`: override return URL

**Response**
```json
{
  "accountId": "acct_123",
  "onboardingUrl": "https://connect.stripe.com/...",
  "expiresAt": 1730000000000,
  "accountCreated": true,
  "refreshUrl": "https://example.com/wallet/connect/refresh?...",
  "returnUrl": "https://example.com/wallet/connect/return?...",
  "deepLinkReturnUrl": "bountyexpo://wallet/connect/return"
}
```

### `verify-stripe-connect`

Retrieves Stripe account status for a Connect account.

**Request**
- Method: `POST`
- Auth: `Authorization: Bearer <supabase-access-token>`
- Optional JSON body:
  - `accountId`: Stripe account id. If omitted, function reads it from `profiles.stripe_connect_account_id`.

**Response**
```json
{
  "accountId": "acct_123",
  "details_submitted": true,
  "capabilities": {
    "card_payments": "active",
    "transfers": "active"
  },
  "charges_enabled": true,
  "payouts_enabled": true,
  "requirements": {
    "currently_due": [],
    "eventually_due": [],
    "past_due": [],
    "pending_verification": [],
    "disabled_reason": null
  }
}
```

## Required Environment Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `APP_DOMAIN`
- `APP_DEEP_LINK_SCHEME`

Fallbacks:
- `APP_DOMAIN` falls back to `APP_URL`, then `EXPO_PUBLIC_API_URL`, then `http://localhost:8081`.
- `APP_DEEP_LINK_SCHEME` falls back to `EXPO_PUBLIC_DEEP_LINK_SCHEME`, then `bountyexpo`.

## Security Notes

- JWT validation is done in-function by calling:
  - `GET ${SUPABASE_URL}/auth/v1/user`
  - Header: `Authorization: Bearer <token>`
- Profile reads/writes use a Supabase client initialized with `SUPABASE_SERVICE_ROLE_KEY`.
- Stripe secret key is only used server-side in Edge Functions.

## Deploy

```bash
supabase functions deploy create-stripe-connect --no-verify-jwt
supabase functions deploy verify-stripe-connect --no-verify-jwt
```

Or deploy all functions:

```bash
supabase functions deploy
```

`verify_jwt = false` is also registered in Supabase TOML so the function handles auth itself.

## Client Example

```ts
const { data, error } = await supabase.functions.invoke('create-stripe-connect', {
  body: { type: 'account_onboarding' },
});

if (error) throw error;
await openUrlInBrowser(data.onboardingUrl);
```

```ts
const verify = await supabase.functions.invoke('verify-stripe-connect', {
  body: { accountId: data.accountId },
});
```
