# Production Deployment Guide: Payment & Authentication Integrations

This guide provides step-by-step instructions to bring Apple Pay, Apple Authentication, and Google Sign-in integrations to production level.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Apple Pay Setup](#apple-pay-setup)
3. [Apple Authentication Setup](#apple-authentication-setup)
4. [Google Sign-in Setup](#google-sign-in-setup)
5. [Configuration & Testing](#configuration--testing)
6. [Deployment Checklist](#deployment-checklist)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts

- ✅ Apple Developer Account ($99/year) - Required for Apple Pay and Apple Authentication
- ✅ Google Cloud Platform Account - Free tier available for Google Sign-in
- ✅ Stripe Account - For payment processing
- ✅ Supabase Project - For authentication backend

### Required Tools

```bash
# Install Stripe CLI for webhook testing
brew install stripe/stripe-cli/stripe

# Install EAS CLI for building
npm install -g eas-cli

# Login to EAS
eas login
```

---

## Apple Pay Setup

### Step 1: Apple Developer Portal Configuration

#### 1.1 Create Merchant ID

1. Go to [Apple Developer Portal](https://developer.apple.com/account)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Click **Identifiers** → **+** button
4. Select **Merchant IDs**
5. Fill in:
   - Description: `BOUNTY Wallet`
   - Identifier: `merchant.com.bountyexpo.wallet`
6. Click **Continue** → **Register**

#### 1.2 Enable Apple Pay for Your App ID

1. In Identifiers, find your App ID (`com.bounty.BOUNTYExpo`)
2. Click to edit
3. Enable **Apple Pay Payment Processing**
4. Click **Configure** and select your Merchant ID
5. Click **Continue** → **Save**

#### 1.3 Create Payment Processing Certificate

1. Go back to your Merchant ID
2. Click **Create Certificate** under Payment Processing Certificate
3. Follow Stripe's instructions to generate CSR:
   - Go to [Stripe Dashboard](https://dashboard.stripe.com)
   - Navigate to Settings → Apple Pay
   - Click **Add New Certificate**
   - Download the CSR file
4. Upload CSR to Apple Developer Portal
5. Download the certificate
6. Upload certificate to Stripe Dashboard

### Step 2: Stripe Configuration

#### 2.1 Enable Apple Pay

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Settings** → **Payment methods**
3. Enable **Apple Pay**
4. Add and verify your domain:
   - Domain: `bountyfinder.app`
   - Follow domain verification steps

#### 2.2 Get Production Keys

1. Go to **Developers** → **API keys**
2. Switch to **Production** mode (toggle in top left)
3. Copy:
   - Publishable key (starts with `pk_live_`)
   - Secret key (starts with `sk_live_`)
4. Add to your environment:

```bash
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
```

⚠️ **Security**: Never commit these keys to version control!

#### 2.3 Configure Webhooks

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Set endpoint URL: `https://bountyfinder.app/webhooks/stripe`
4. Select events:
   - ✅ `payment_intent.succeeded`
   - ✅ `payment_intent.payment_failed`
   - ✅ `charge.refunded`
   - ✅ `payment_intent.canceled`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)
7. Add to environment:

```bash
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

### Step 3: Update App Configuration

Edit `app.json`:

```json
{
  "expo": {
    "ios": {
      "entitlements": {
        "com.apple.developer.in-app-payments": [
          "merchant.com.bountyexpo.wallet"
        ]
      }
    }
  }
}
```

### Step 4: Test Apple Pay

#### On iOS Simulator

1. Open Wallet app in simulator
2. Add a test card:
   - Card: `4242 4242 4242 4242`
   - Any future expiry
   - Any CVC
3. Build and run your app:

```bash
eas build --profile development --platform ios
```

4. Test payment flow in Add Money screen

#### On Physical Device

1. Enable Sandbox mode:
   - Settings → Developer → Sandbox (if available)
2. Add test card to Wallet
3. Install development build
4. Test with Face ID/Touch ID

---

## Apple Authentication Setup

### Step 1: Create Service ID

#### 1.1 Register Service ID

1. Go to [Apple Developer Portal](https://developer.apple.com/account)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Click **Identifiers** → **+** button
4. Select **Services IDs**
5. Fill in:
   - Description: `BOUNTY Sign In`
   - Identifier: `com.bountyexpo.service`
6. Click **Continue** → **Register**

#### 1.2 Configure Sign In with Apple

1. Click on your new Service ID to edit
2. Enable **Sign In with Apple**
3. Click **Configure**
4. Set domains and return URLs:
   - **Domains and Subdomains**: `bountyfinder.app`
   - **Return URLs**: `https://bountyfinder.app/auth/callback`
5. Click **Next** → **Done** → **Continue** → **Save**

### Step 2: Create Sign In Key (Optional for Server Validation)

1. Go to **Keys** → **+** button
2. Name: `BOUNTY Sign In with Apple Key`
3. Enable **Sign In with Apple**
4. Click **Configure** and select your primary App ID
5. Click **Continue** → **Register**
6. Download the key file (`.p8` file)
7. **Important**: Save this file securely - you can only download it once!

### Step 3: Update Environment Variables

Add to your `.env`:

```bash
EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID=com.bountyexpo.service
EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI=https://bountyfinder.app/auth/callback
```

### Step 4: Test Apple Sign In

#### On iOS

1. Go to Settings → Sign in to your iPhone
2. Make sure you're signed in with your Apple ID
3. Build and run app
4. Test Apple Sign In button
5. Verify authentication works

#### On Android

1. Build and run app
2. Tap Apple Sign In button
3. Should open browser for OAuth flow
4. Verify redirect works

---

## Google Sign-in Setup

### Step 1: Google Cloud Console Setup

#### 1.1 Create Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project or select existing
3. Project name: `BOUNTY App`

#### 1.2 Enable Google+ API

1. Navigate to **APIs & Services** → **Library**
2. Search for "Google+ API"
3. Click **Enable**

### Step 2: Create OAuth Credentials

#### 2.1 Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. User type: **External**
3. Click **Create**
4. Fill in:
   - App name: `BOUNTY`
   - User support email: your-email@example.com
   - Developer contact: your-email@example.com
5. Click **Save and Continue**
6. Scopes: Add `/auth/userinfo.email` and `/auth/userinfo.profile`
7. Click **Save and Continue**
8. Add test users if in testing mode

#### 2.2 Create iOS OAuth Client

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **iOS**
4. Name: `BOUNTY iOS`
5. Bundle ID: `com.bounty.BOUNTYExpo`
6. Click **Create**
7. Copy the **Client ID**

#### 2.3 Create Android OAuth Client

1. Create Credentials → OAuth client ID
2. Application type: **Android**
3. Name: `BOUNTY Android`
4. Package name: `app.bountyfinder.BOUNTYExpo`
5. Get SHA-1 certificate fingerprint:

```bash
# For debug builds
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android

# For release builds
keytool -list -v -keystore /path/to/your-release-key.keystore
```

6. Paste SHA-1 fingerprint
7. Click **Create**
8. Copy the **Client ID**

#### 2.4 Create Web OAuth Client

1. Create Credentials → OAuth client ID
2. Application type: **Web application**
3. Name: `BOUNTY Web`
4. Authorized JavaScript origins:
   - `https://bountyfinder.app`
   - `http://localhost:19006` (for development)
5. Authorized redirect URIs:
   - `https://bountyfinder.app/auth/callback`
   - `http://localhost:19006/auth/callback`
6. Click **Create**
7. Copy the **Client ID**

### Step 3: Update Environment Variables

Add to your `.env`:

```bash
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=xxx-xxx.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=xxx-xxx.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=xxx-xxx.apps.googleusercontent.com
```

### Step 4: Test Google Sign-in

#### On All Platforms

1. Build and run app
2. Tap Google Sign In button
3. Should open Google OAuth screen
4. Sign in with Google account
5. Verify redirect and profile creation

---

## Configuration & Testing

### Step 1: Validate Configuration

The app includes a configuration validator that runs on startup.

#### Check Configuration Status

```typescript
// In your app entry point (App.tsx or _layout.tsx)
import { logConfigurationStatus } from './lib/config/validation';

// Log configuration status in development
if (__DEV__) {
  logConfigurationStatus();
}
```

You'll see output like:

```
🔍 Configuration Validation

═══════════════════════════════════════════════════════════════

📊 Integration Status:

✅ Payment (Stripe): Configured
⚠️ Apple Pay: Not Configured
   Missing: APPLE_MERCHANT_ID
✅ Apple Sign In: Configured
✅ Google Sign In: Configured
✅ Supabase: Configured

═══════════════════════════════════════════════════════════════
✅ Configuration validation passed
⚠️  2 warning(s) - Some features may be disabled
═══════════════════════════════════════════════════════════════
```

### Step 2: Environment-Specific Configuration

#### Development (.env.development)

```bash
# Use test/sandbox keys
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxx
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxx

# Use test accounts
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=test-ios.apps.googleusercontent.com
```

#### Production (.env.production)

```bash
# Use live keys
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx

# Use production accounts
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=prod-ios.apps.googleusercontent.com
```

### Step 3: Testing Checklist

#### Apple Pay Testing

- [ ] Simulator: Add test card and complete payment
- [ ] Device: Test with real card in sandbox mode
- [ ] Verify payment intent created in Stripe
- [ ] Verify webhook received
- [ ] Verify wallet balance updated
- [ ] Test cancellation flow
- [ ] Test failure scenarios

#### Apple Authentication Testing

- [ ] iOS: Test native Sign In button
- [ ] Android: Test OAuth web flow
- [ ] Verify token exchange with Supabase
- [ ] Verify profile creation for new users
- [ ] Test with existing users
- [ ] Test error scenarios

#### Google Sign-in Testing

- [ ] iOS: Test OAuth flow
- [ ] Android: Test OAuth flow
- [ ] Web: Test OAuth flow
- [ ] Verify token exchange
- [ ] Verify profile creation
- [ ] Test with existing users
- [ ] Test error scenarios

---

## Deployment Checklist

### Pre-Deployment

#### Environment Setup
- [ ] All environment variables set in production
- [ ] Secrets stored securely (use Expo Secrets or similar)
- [ ] `.env.production` file created and verified
- [ ] No sensitive keys in version control

#### Apple Configuration
- [ ] Merchant ID registered and verified
- [ ] Payment Processing Certificate uploaded to Stripe
- [ ] Service ID configured with production domains
- [ ] App ID has Apple Pay enabled
- [ ] Entitlements in app.json are correct

#### Google Configuration
- [ ] OAuth clients created for all platforms
- [ ] OAuth consent screen published (not in testing mode)
- [ ] Redirect URIs include production domains
- [ ] SHA-1 fingerprints for release builds added

#### Stripe Configuration
- [ ] Production keys obtained
- [ ] Webhook endpoint configured with production URL
- [ ] Webhook signing secret stored
- [ ] Apple Pay enabled and verified
- [ ] Domain verification completed

### Build & Deploy

#### iOS Build

```bash
# Build for App Store
eas build --platform ios --profile production

# Submit to App Store
eas submit --platform ios
```

#### Android Build

```bash
# Build for Play Store
eas build --platform android --profile production

# Submit to Play Store
eas submit --platform android
```

### Post-Deployment

#### Verification
- [ ] Download app from store
- [ ] Test Apple Pay with real card
- [ ] Test Apple Sign In
- [ ] Test Google Sign In
- [ ] Verify webhooks are working
- [ ] Check error tracking (Sentry)
- [ ] Monitor analytics (Mixpanel)

#### Monitoring
- [ ] Set up alerts for payment failures
- [ ] Set up alerts for auth failures
- [ ] Monitor success rates
- [ ] Check user feedback

---

## Troubleshooting

### Common Issues

#### Apple Pay: "Not Available"

**Symptoms**: Apple Pay button doesn't appear or says "Not Available"

**Possible Causes**:
1. Device doesn't support Apple Pay
2. No cards in Wallet
3. Merchant ID mismatch
4. Entitlements not set correctly

**Solutions**:
1. Check device compatibility (iPhone 6+, iOS 13+)
2. Add a card to Wallet app
3. Verify `APPLE_MERCHANT_ID` matches Apple Developer Portal
4. Check `app.json` entitlements match Merchant ID
5. Rebuild app after entitlements change

#### Apple Authentication: "Invalid Service ID"

**Symptoms**: Error when trying to sign in with Apple

**Possible Causes**:
1. Service ID not configured
2. Return URLs don't match
3. Domain not verified

**Solutions**:
1. Verify Service ID in Apple Developer Portal
2. Check return URL in Service ID configuration
3. Verify domain ownership
4. Update `EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI` to match

#### Google Sign-in: "Client ID Error"

**Symptoms**: OAuth screen shows error about client ID

**Possible Causes**:
1. Wrong client ID for platform
2. SHA-1 fingerprint mismatch (Android)
3. Bundle ID mismatch (iOS)

**Solutions**:
1. Verify using correct client ID for platform
2. Check SHA-1 fingerprint matches (Android)
3. Verify Bundle ID matches (iOS)
4. Ensure OAuth consent screen is published

#### Stripe Webhook: Not Receiving Events

**Symptoms**: Payments succeed but wallet not updated

**Possible Causes**:
1. Webhook URL incorrect
2. Webhook signing secret wrong
3. Endpoint not reachable
4. Not handling events correctly

**Solutions**:
1. Verify webhook URL in Stripe Dashboard
2. Check `STRIPE_WEBHOOK_SECRET` matches
3. Test endpoint with Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3001/webhooks/stripe
   ```
4. Check server logs for errors

### Getting Help

#### Documentation
- [Apple Pay Integration Guide](https://developer.apple.com/apple-pay/)
- [Sign in with Apple Guide](https://developer.apple.com/sign-in-with-apple/)
- [Google Sign-In Documentation](https://developers.google.com/identity/sign-in/ios)
- [Stripe Documentation](https://stripe.com/docs)

#### Support Channels
- Apple Developer Support: https://developer.apple.com/support/
- Google Cloud Support: https://cloud.google.com/support
- Stripe Support: https://support.stripe.com
- Expo Forums: https://forums.expo.dev

---

## Security Best Practices

### API Keys
- ✅ Never commit keys to version control
- ✅ Use environment variables
- ✅ Use different keys for dev/production
- ✅ Rotate keys periodically
- ✅ Restrict API keys by domain/platform

### Payment Security
- ✅ Never store card data
- ✅ Always use HTTPS
- ✅ Validate amounts server-side
- ✅ Implement idempotency keys
- ✅ Enable 3D Secure
- ✅ Monitor for fraud

### Authentication Security
- ✅ Validate tokens server-side
- ✅ Use CSRF protection
- ✅ Implement rate limiting
- ✅ Validate redirect URIs
- ✅ Use secure session storage
- ✅ Monitor failed attempts

---

## Next Steps

After completing this guide, you should have:

1. ✅ Apple Pay configured and working
2. ✅ Apple Authentication configured and working
3. ✅ Google Sign-in configured and working
4. ✅ All integrations tested
5. ✅ App deployed to production

### Recommended Improvements

Consider these enhancements:

1. **Analytics**: Add tracking for conversion rates
2. **A/B Testing**: Test different payment flows
3. **Biometric Auth**: Add Face ID/Touch ID for sensitive operations
4. **Multi-currency**: Support currencies beyond USD
5. **Recurring Payments**: Add subscription support
6. **Saved Payment Methods**: Let users save cards

### Maintenance

Schedule regular reviews:

- **Weekly**: Monitor success rates and errors
- **Monthly**: Review and update API keys if needed
- **Quarterly**: Audit security practices
- **Annually**: Review and renew developer accounts

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-09  
**Next Review:** 2026-03-09
