# Payment Flow Testing & Troubleshooting

This document describes the payment API endpoints, how to test them manually, and how to resolve common errors.

---

## API Quick Reference — Supabase Edge Functions

All payment routes are served by the **`payments`** Edge Function. When `EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL` is set in your `.env`, the mobile app routes all requests through:

```
https://<project-ref>.supabase.co/functions/v1/payments/<sub-path>
```

| Method   | Sub-path                    | Description                                         |
|----------|-----------------------------|-----------------------------------------------------|
| `GET`    | `/payments/methods`         | List saved payment methods for the current user     |
| `POST`   | `/payments/methods`         | Attach an existing payment method to the customer   |
| `DELETE` | `/payments/methods/:id`     | Detach (remove) a payment method from the customer  |
| `POST`   | `/payments/create-payment-intent` | Create a Stripe PaymentIntent               |
| `POST`   | `/payments/create-setup-intent`   | Create a Stripe SetupIntent (save card without charge) |
| `POST`   | `/payments/confirm`         | Confirm a PaymentIntent                             |

> **Important:** All endpoints require an `Authorization: Bearer <access_token>` header carrying the user's Supabase JWT access token.

---

## Environment Setup

```bash
# .env (copy from .env.example)

# Required – routes mobile app through Supabase Edge Functions
EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL="https://<project-ref>.supabase.co/functions/v1"

# Required – for Supabase auth and direct DB access
EXPO_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co"
EXPO_PUBLIC_SUPABASE_ANON_KEY="<anon-key>"

# Required – publishable key for the Stripe SDK
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

If `EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL` is **not** set the app falls back to the legacy `EXPO_PUBLIC_API_URL` (Node server). Ensure you set it when testing with Edge Functions.

---

## Manual cURL Testing

Replace `<project-ref>`, `<access_token>`, and payload values with real values.

### List payment methods
```bash
curl -X GET \
  "https://<project-ref>.supabase.co/functions/v1/payments/methods" \
  -H "Authorization: Bearer <access_token>"
```

Expected response (no saved methods):
```json
{ "paymentMethods": [] }
```

### Attach a payment method
```bash
curl -X POST \
  "https://<project-ref>.supabase.co/functions/v1/payments/methods" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethodId": "pm_card_visa"}'
```

### Detach a payment method
```bash
curl -X DELETE \
  "https://<project-ref>.supabase.co/functions/v1/payments/methods/pm_card_visa" \
  -H "Authorization: Bearer <access_token>"
```

### Create a SetupIntent (save card)
```bash
curl -X POST \
  "https://<project-ref>.supabase.co/functions/v1/payments/create-setup-intent" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"usage": "off_session"}'
```

### Create a PaymentIntent
```bash
curl -X POST \
  "https://<project-ref>.supabase.co/functions/v1/payments/create-payment-intent" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"amountCents": 1000, "currency": "usd"}'
```

---

## Troubleshooting

### `405 Method Not Allowed` when listing payment methods

**Symptom:** `[StripeService] Error fetching payment methods: {"code":"405","message":"Payment methods request failed (405): Method not allowed","type":"api_error"}`

**Causes & fixes:**

1. **`EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL` is not set** – The app falls back to the legacy Node server which may no longer be running.  
   Fix: add `EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL="https://<project-ref>.supabase.co/functions/v1"` to your `.env`.

2. **Wrong base URL format** – If the URL includes `/payments` as part of the base (e.g., ends with `/functions/v1/payments`), requests will be double-routed.  
   Fix: the URL must end with `/functions/v1` and **not** include the function name.

3. **Edge Function not deployed** – If the `payments` function has not been deployed, Supabase returns a gateway error.  
   Fix: `supabase functions deploy payments`

### `401 Unauthorized`

The user's access token is missing or expired. Ensure `session?.access_token` is passed to `listPaymentMethods` / `attachPaymentMethod`.

### `404 Not Found` on `/payments/create-setup-intent`

This route was added to the Edge Function in the fix for this issue. If you see 404, redeploy the `payments` function:
```bash
supabase functions deploy payments
```

### UI shows "Connection failed" instead of the actual error

This was a bug where the error message "Failed to fetch payment methods: ..." was incorrectly matched as a generic network failure. It has been fixed in `lib/services/stripe-service.ts`. The UI now shows the actual HTTP status and error message (e.g., "Payment methods request failed (405): Method not allowed").

---

## Running Unit Tests

```bash
# Run stripe-service unit tests
npx jest --testPathPatterns="stripe-service.test" --no-coverage

# Run all payment-related tests
npx jest --testPathPatterns="payment" --no-coverage
```

## Deploying Edge Functions

```bash
# Deploy the payments function after code changes
supabase functions deploy payments
```
