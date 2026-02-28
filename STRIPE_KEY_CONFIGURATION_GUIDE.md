# Stripe Key Configuration Guide

## Overview

This guide explains how to properly configure Stripe keys to avoid payment method errors. The most common issue is a **mode mismatch** between the secret key (backend) and publishable key (frontend/mobile app).

## Understanding Stripe Key Modes

Stripe provides two sets of keys for each account:

### Test Mode Keys
- **Secret Key**: `sk_test_...` (used on backend)
- **Publishable Key**: `pk_test_...` (used on frontend/mobile app)
- Purpose: For development and testing without real money
- Sandbox: Uses test credit cards (e.g., 4242 4242 4242 4242)

### Live Mode Keys  
- **Secret Key**: `sk_live_...` (used on backend)
- **Publishable Key**: `pk_live_...` (used on frontend/mobile app)
- Purpose: For production with real transactions
- Real money: Charges actual credit cards

## Common Error: Mode Mismatch

### What It Looks Like

When you see this error:
```
No such setupintent: 'seti_1XXX...'; a similar object exists in live mode, 
but a test mode key was used to make this request.
```

Or:
```
Payment configuration error: Your payment keys are in different modes.
```

This means **your backend and frontend are using keys from different modes**.

### Why It Happens

- Backend (API server) uses `sk_live_...` (live mode)
- Frontend (mobile app) uses `pk_test_...` (test mode)

OR vice versa:
- Backend uses `sk_test_...` (test mode)  
- Frontend uses `pk_live_...` (live mode)

When the backend creates a SetupIntent or PaymentIntent in one mode, the frontend can't access it using a key from a different mode.

## Configuration Steps

### 1. Choose Your Mode

**For Development/Testing:**
- Use test mode keys
- No real charges
- Can use test credit cards

**For Production:**
- Use live mode keys
- Real charges
- Use real credit cards only

### 2. Configure Backend (.env or environment variables)

```bash
# For TEST mode (development)
STRIPE_SECRET_KEY="sk_test_YOUR_TEST_SECRET_KEY"
STRIPE_PUBLISHABLE_KEY="pk_test_YOUR_TEST_PUBLISHABLE_KEY"

# For LIVE mode (production) - NEVER commit these to git!
STRIPE_SECRET_KEY="sk_live_YOUR_LIVE_SECRET_KEY"
STRIPE_PUBLISHABLE_KEY="pk_live_YOUR_LIVE_PUBLISHABLE_KEY"
```

**Location**: `/services/api/.env` or your backend environment configuration

### 3. Configure Frontend/Mobile App (.env)

```bash
# For TEST mode (development)
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_YOUR_TEST_PUBLISHABLE_KEY"

# For LIVE mode (production)
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_YOUR_LIVE_PUBLISHABLE_KEY"
```

**Location**: `/.env` (root of mobile app)

### 4. Verify Configuration

The backend will log the detected mode on startup:

```
[payments] Stripe configured in test mode
```

If you see a warning like this:
```
[payments] KEY MODE MISMATCH: Secret key is in live mode but publishable key is in test mode
```

**Fix it immediately** by ensuring both keys are from the same mode.

## Getting Your Keys

### From Stripe Dashboard

1. Log in to [Stripe Dashboard](https://dashboard.stripe.com)
2. Click **Developers** in the left sidebar
3. Click **API keys**
4. Toggle between **Test mode** and **Live mode** using the switch at the top
5. Copy the appropriate keys:
   - **Publishable key** → goes in `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`
   - **Secret key** → click "Reveal test/live key" → goes in `STRIPE_SECRET_KEY`

### Security Notes

- **NEVER** commit live keys to git
- Use `.env` files and add them to `.gitignore`
- In production, use environment variables from your hosting platform
- Rotate keys if they're accidentally exposed

## Testing Your Configuration

### 1. Start the Backend

```bash
cd services/api
npm run dev
```

Check the logs for:
```
[payments] Stripe configured in test mode
```

### 2. Start the Mobile App

```bash
npx expo start
```

### 3. Try Adding a Payment Method

1. Open the app and go to Wallet
2. Click "Manage" under Linked Accounts
3. Click "Add New Card"
4. Try adding a card

**Expected behavior (correct configuration):**
- Card input form appears
- No configuration errors

**Incorrect configuration:**
- Error: "Payment configuration error: Your payment keys are in different modes"
- Stripe SDK initialization fails

### 4. Test Cards (Test Mode Only)

Use these test cards in test mode:

| Card Number | Result |
|-------------|--------|
| 4242 4242 4242 4242 | Success |
| 4000 0000 0000 0002 | Card declined |
| 4000 0027 6000 3184 | Requires 3D Secure authentication |

**Note:** Real cards will NOT work in test mode.

## Bank Accounts

The bank account endpoint (`/payments/bank-accounts`) requires:

1. Backend running and accessible
2. Stripe configured (same requirements as cards)
3. Valid authentication token

If you see "Not Found":
- Check that the backend server is running
- Verify the API_BASE_URL in your mobile app .env
- Check backend logs for any errors

## Troubleshooting

### Issue: "Stripe not configured on this server"

**Cause**: Backend doesn't have `STRIPE_SECRET_KEY` environment variable

**Fix**: Set `STRIPE_SECRET_KEY` in backend `.env` file

### Issue: "Payment service not available on this platform"

**Cause**: Stripe React Native SDK not installed or not available in current environment

**Fix**: 
```bash
npm install @stripe/stripe-react-native
```

### Issue: "Failed to initialize payment setup"

**Possible causes**:
1. Backend not running
2. Network connectivity issues
3. Invalid authentication token
4. Key mode mismatch (see above)

**Debug steps**:
1. Check backend logs
2. Verify network connectivity
3. Check authentication status
4. Verify key modes match

## Environment-Specific Configuration

### Development
```bash
# Backend (.env)
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_PUBLISHABLE_KEY="pk_test_..."
NODE_ENV=development

# Frontend (.env)  
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
EXPO_PUBLIC_API_URL="http://localhost:3001"
```

### Staging/QA
```bash
# Backend
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_PUBLISHABLE_KEY="pk_test_..."
NODE_ENV=production  # Still use test keys!

# Frontend
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
EXPO_PUBLIC_API_URL="https://api-staging.yourdomain.com"
```

### Production
```bash
# Backend (use secrets manager, not .env file!)
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_PUBLISHABLE_KEY="pk_live_..."
NODE_ENV=production

# Frontend (use EAS secrets)
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_..."
EXPO_PUBLIC_API_URL="https://api.yourdomain.com"
```

## Additional Resources

- [Stripe API Keys Documentation](https://stripe.com/docs/keys)
- [Stripe Testing](https://stripe.com/docs/testing)
- [Stripe React Native SDK](https://stripe.com/docs/payments/accept-a-payment?platform=react-native)

## Quick Reference

| Environment Variable | Where | Mode | Example |
|---------------------|-------|------|---------|
| `STRIPE_SECRET_KEY` | Backend | Test: `sk_test_...`<br>Live: `sk_live_...` | Used to create PaymentIntents |
| `STRIPE_PUBLISHABLE_KEY` | Backend | Test: `pk_test_...`<br>Live: `pk_live_...` | Optional, for validation |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Frontend | Test: `pk_test_...`<br>Live: `pk_live_...` | Used by Stripe SDK in app |

**Golden Rule**: All keys must be from the same mode (all test OR all live).
