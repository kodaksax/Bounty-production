# Stripe Connect Onboarding Troubleshooting Guide

This document provides guidance for troubleshooting Stripe Connect onboarding issues in BountyExpo.

## Overview

Stripe Connect is used to enable hunters (bounty workers) to receive payments directly to their bank accounts. The integration uses Stripe Express accounts for a streamlined onboarding experience.

## Common Onboarding Issues

### 1. "Service Unavailable" or "Stripe Connect not configured"

**Cause:** The `STRIPE_SECRET_KEY` environment variable is not set on the server.

**Solution:**
1. Ensure your `.env` file contains a valid Stripe Secret Key:
   ```bash
   STRIPE_SECRET_KEY=sk_test_your_key_here  # For development
   # Or for production:
   STRIPE_SECRET_KEY=sk_live_your_key_here
   ```
2. Restart the API server after adding the key.
3. Get your Stripe API keys from: https://dashboard.stripe.com/apikeys

### 2. "Account Already Exists"

**Cause:** A Stripe Connect Express account has already been created for this user.

**Solution:**
1. The user can continue to the Stripe dashboard to complete onboarding.
2. If the user needs to start fresh, the `stripe_account_id` in the users table can be cleared (admin operation).
3. Contact support to help reset the account if needed.

### 3. "Cannot open Stripe Connect URL"

**Cause:** The app cannot open the Stripe onboarding URL in the device browser.

**Solution:**
1. Check that the device has a default browser configured.
2. Try opening a regular URL to verify browser functionality.
3. On iOS, ensure the app has permissions to open external URLs.

### 4. Network/Connection Errors

**Cause:** Unable to reach the API server or Stripe servers.

**Solution:**
1. Check internet connectivity.
2. Verify the API server is running and accessible.
3. Check if Stripe services are operational: https://status.stripe.com/

### 5. Onboarding Incomplete

**Cause:** User didn't complete all required steps in Stripe's onboarding flow.

**Solution:**
1. The user can restart the onboarding process from the Withdraw screen.
2. Click "Connect Bank Account" to get a new onboarding link.
3. Complete all required fields in Stripe's flow.

## Environment Configuration

### Required Environment Variables

```bash
# Required for Stripe Connect
STRIPE_SECRET_KEY="sk_test_..." # or sk_live_... for production

# Optional but recommended
STRIPE_PUBLISHABLE_KEY="pk_test_..." # For client-side operations
STRIPE_WEBHOOK_SECRET="whsec_..." # For webhook verification
FRONTEND_URL="https://your-app.com" # Return URL after onboarding
```

### Deep Link Configuration

For mobile apps, configure deep links to handle onboarding returns:

```json
// app.json (Expo)
{
  "expo": {
    "scheme": "bountyexpo"
  }
}
```

Return URLs should be:
- `bountyexpo://wallet/connect/return` - After successful onboarding
- `bountyexpo://wallet/connect/refresh` - If user needs to retry

## API Endpoints

### Create Onboarding Link
```http
POST /connect/create-account-link
Authorization: Bearer <token>
Content-Type: application/json

{
  "returnUrl": "bountyexpo://wallet/connect/return",
  "refreshUrl": "bountyexpo://wallet/connect/refresh"
}

Response:
{
  "url": "https://connect.stripe.com/express/...",
  "expiresAt": 1704067200
}
```

### Verify Onboarding Status
```http
POST /connect/verify-onboarding
Authorization: Bearer <token>

Response:
{
  "onboarded": true,
  "accountId": "acct_xxx",
  "chargesEnabled": true,
  "payoutsEnabled": true,
  "requiresAction": false,
  "currentlyDue": []
}
```

### Check Connect Status
```http
GET /stripe/connect/status
Authorization: Bearer <token>

Response:
{
  "hasStripeAccount": true,
  "stripeAccountId": "acct_xxx",
  "detailsSubmitted": true,
  "chargesEnabled": true,
  "payoutsEnabled": true,
  "requiresAction": false,
  "currentlyDue": []
}
```

## Testing Onboarding

### In Test Mode (Recommended for Development)

1. Use test API keys (`sk_test_...`)
2. Stripe provides test data for onboarding
3. Use these test values:
   - SSN: Any 9 digits (e.g., 000-00-0000)
   - Phone: Any valid format
   - Address: Any valid US address
   - Bank Account: Use Stripe test bank account numbers

### Test Bank Account Numbers
| Routing | Account | Result |
|---------|---------|--------|
| 110000000 | 000123456789 | Success |
| 110000000 | 000111111116 | Declined |
| 110000000 | 000111111113 | Verification failure |

## Webhook Events (Optional)

To handle real-time onboarding updates, set up webhooks:

1. Create webhook endpoint in Stripe Dashboard
2. Subscribe to `account.updated` events
3. Set `STRIPE_WEBHOOK_SECRET` in your environment

```javascript
// Handle account.updated webhook
if (event.type === 'account.updated') {
  const account = event.data.object;
  if (account.details_submitted && account.payouts_enabled) {
    // User completed onboarding successfully
    console.log(`Account ${account.id} is fully onboarded`);
  }
}
```

## Support Resources

- Stripe Connect Documentation: https://stripe.com/docs/connect
- Stripe Express Accounts: https://stripe.com/docs/connect/express-accounts
- Stripe Status Page: https://status.stripe.com/
- BountyExpo Support: support@bountyexpo.com

## Logs and Debugging

Check server logs for detailed error messages:
```bash
# Look for Connect-related logs
grep -i "connect\|onboarding\|stripe" server.log
```

Common log patterns:
- `✅ Created Stripe Express account` - Success
- `Stripe error:` - Stripe API error
- `Error creating onboarding link:` - General failure
