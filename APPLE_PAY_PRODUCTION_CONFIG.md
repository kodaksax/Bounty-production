# Apple Pay Production Configuration Guide

## Overview
This guide provides step-by-step instructions for configuring Apple Pay in production for the BOUNTYExpo app.

## Prerequisites

### Required Accounts
- [ ] Apple Developer Account (Paid membership required)
- [ ] Stripe Account (Activated and verified)
- [ ] iOS App in App Store Connect

### Required Tools
- [ ] Xcode 14+ with iOS 16+ SDK
- [ ] macOS for certificate generation
- [ ] Access to server environment variables

## Configuration Steps

### 1. Apple Developer Portal Setup

#### 1.1 Create Merchant ID
1. Log in to [Apple Developer Portal](https://developer.apple.com/account)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Select **Identifiers** → Click **+** button
4. Choose **Merchant IDs** → Continue
5. Create merchant ID:
   ```
   Identifier: merchant.com.bountyexpo.payments
   Description: BountyExpo Payment Processing
   ```
6. Click **Register**
7. Note down the Merchant ID for later use

#### 1.2 Create Payment Processing Certificate
1. In Merchant ID details, click **Create Certificate**
2. Follow the Certificate Signing Request (CSR) process:
   - On macOS: Keychain Access → Certificate Assistant → Request Certificate from CA
   - Email: your-email@bountyexpo.com
   - Common Name: BountyExpo Apple Pay Certificate
   - Save to disk
3. Upload CSR to Apple Developer Portal
4. Download the certificate (.cer file)
5. Double-click to import into Keychain Access
6. **Important:** Note that Stripe will manage the actual certificate for processing

#### 1.3 Enable Apple Pay Capability in Xcode
1. Open your project in Xcode
2. Select your app target
3. Go to **Signing & Capabilities** tab
4. Click **+ Capability** → Search for **Apple Pay**
5. Under Apple Pay, click **+** to add merchant ID
6. Select `merchant.com.bountyexpo.payments`

#### 1.4 Update app.json Configuration
```json
{
  "expo": {
    "name": "BountyExpo",
    "slug": "bountyexpo",
    "ios": {
      "bundleIdentifier": "com.bountyexpo.app",
      "merchantId": "merchant.com.bountyexpo.payments",
      "infoPlist": {
        "NSApplePayCapability": "production"
      },
      "config": {
        "usesNonExemptEncryption": false
      }
    }
  }
}
```

### 2. Stripe Configuration

#### 2.1 Register Merchant ID with Stripe
1. Log in to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Settings** → **Payments**
3. Scroll to **Apple Pay** section
4. Click **Add your Apple Merchant ID**
5. Enter: `merchant.com.bountyexpo.payments`
6. Complete domain verification (see step 2.2)

#### 2.2 Domain Verification
1. Download the verification file from Stripe
2. Place it in your website at: `/.well-known/apple-developer-merchantid-domain-association`
3. Ensure it's accessible at: `https://bountyexpo.com/.well-known/apple-developer-merchantid-domain-association`
4. Return to Stripe and click **Verify Domain**

#### 2.3 Configure Payment Methods
1. In Stripe Dashboard → **Settings** → **Payment methods**
2. Ensure these are enabled:
   - ✅ Cards (Visa, Mastercard, Amex, Discover)
   - ✅ Apple Pay
   - ✅ Google Pay (for Android compatibility)

### 3. Backend Environment Configuration

#### 3.1 Required Environment Variables

Create/update `services/api/.env`:

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_live_YOUR_LIVE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY=pk_live_YOUR_LIVE_PUBLISHABLE_KEY

# Apple Pay Configuration
APPLE_MERCHANT_ID=merchant.com.bountyexpo.payments
APPLE_PAY_ENABLED=true

# Server Configuration
NODE_ENV=production
API_URL=https://api.bountyexpo.com

# Supabase (Production)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Logging
LOG_LEVEL=info
```

#### 3.2 Mobile App Environment Variables

Create/update `.env.production`:

```bash
# Stripe
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_YOUR_LIVE_PUBLISHABLE_KEY

# API
EXPO_PUBLIC_API_URL=https://api.bountyexpo.com

# Features
EXPO_PUBLIC_APPLE_PAY_ENABLED=true
```

### 4. Webhook Configuration

#### 4.1 Set Up Production Webhooks
1. In Stripe Dashboard → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Configure:
   ```
   Endpoint URL: https://api.bountyexpo.com/webhooks/stripe
   Description: Production Webhook for Apple Pay
   Version: Latest
   ```

#### 4.2 Select Events
Enable these webhook events:
- ✅ `payment_intent.succeeded`
- ✅ `payment_intent.payment_failed`
- ✅ `payment_intent.canceled`
- ✅ `charge.refunded`
- ✅ `charge.failed`

#### 4.3 Save Webhook Secret
1. After creating webhook, copy the signing secret
2. Add to server environment:
   ```bash
   STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET
   ```

### 5. Security Configuration

#### 5.1 SSL/TLS Certificate
- [ ] Ensure API domain has valid SSL certificate
- [ ] Certificate must be from a trusted CA
- [ ] Use TLS 1.2 or higher

#### 5.2 CORS Configuration
Update CORS settings to allow only production domains:
```javascript
{
  origin: [
    'https://bountyexpo.com',
    'https://www.bountyexpo.com',
    'https://app.bountyexpo.com'
  ],
  credentials: true
}
```

#### 5.3 Rate Limiting
Configure rate limits for payment endpoints:
```javascript
{
  '/apple-pay/payment-intent': {
    max: 10, // requests
    window: '1m' // per minute
  },
  '/apple-pay/confirm': {
    max: 5,
    window: '1m'
  }
}
```

### 6. Testing in Production Mode

#### 6.1 Switch to Production Keys
1. Update all Stripe keys from test to live mode
2. Ensure Apple Pay Merchant ID is registered for production
3. Deploy backend with production environment variables

#### 6.2 Test with Real Card
1. Add a real credit card to Apple Wallet on test device
2. Build production app version
3. Complete a small test transaction ($1.00)
4. Verify:
   - [ ] Payment processes successfully
   - [ ] Wallet balance updates
   - [ ] Transaction recorded in database
   - [ ] Receipt email sent (if configured)
   - [ ] Webhook received and processed

#### 6.3 Verify in Stripe Dashboard
1. Check **Payments** section for test transaction
2. Verify metadata includes:
   - `user_id`
   - `payment_method: 'apple_pay'`
3. Check **Events** for webhook delivery

### 7. Monitoring and Alerting

#### 7.1 Set Up Monitoring
Monitor these metrics:
- Payment success rate
- Payment failure rate by error code
- Average transaction amount
- Webhook delivery success rate
- API response times

#### 7.2 Alert Configuration
Set up alerts for:
- Payment failure rate > 5%
- Webhook delivery failure
- API errors on payment endpoints
- Unusual transaction patterns

### 8. Compliance and Legal

#### 8.1 Update Terms of Service
- [ ] Add Apple Pay terms
- [ ] Include payment processing terms
- [ ] Update refund policy

#### 8.2 Update Privacy Policy
- [ ] Explain payment data handling
- [ ] Mention Stripe as payment processor
- [ ] Include Apple Pay privacy terms

#### 8.3 PCI Compliance
- [ ] Verify Stripe PCI compliance certificate
- [ ] Ensure no card data stored on servers
- [ ] Review security audit logs

## Deployment Checklist

### Pre-Deployment
- [ ] All environment variables configured
- [ ] Stripe production keys active
- [ ] Apple Merchant ID registered
- [ ] Domain verification complete
- [ ] Webhooks configured and tested
- [ ] SSL certificate valid
- [ ] Test transaction completed successfully
- [ ] Terms and Privacy Policy updated

### Deployment
- [ ] Deploy backend with production config
- [ ] Deploy mobile app update to App Store
- [ ] Verify API health checks pass
- [ ] Test Apple Pay on production app

### Post-Deployment
- [ ] Monitor first transactions closely
- [ ] Verify webhooks being received
- [ ] Check error logs
- [ ] Confirm receipts being sent
- [ ] Customer support briefed on new feature

## Troubleshooting

### Common Issues

#### "Apple Pay not available"
- Check iOS version (requires iOS 13+)
- Verify device supports Apple Pay
- Ensure card is added to Wallet
- Check merchant ID in app.json

#### "Domain verification failed"
- Verify file is accessible via HTTPS
- Check file has no file extension
- Ensure proper MIME type
- Try re-uploading verification file

#### "Payment authorization failed"
- Check merchant ID matches in all places
- Verify certificate is valid
- Ensure Stripe keys are production keys
- Check webhook secret is correct

#### "Transaction not recorded in database"
- Check webhook is being received
- Verify webhook secret matches
- Check database connection
- Review API logs for errors

## Support

### Internal Support
- Engineering: dev@bountyexpo.com
- Operations: ops@bountyexpo.com

### External Support
- Stripe Support: https://support.stripe.com
- Apple Developer Support: https://developer.apple.com/support

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-02-10 | Initial production configuration guide |

## Related Documentation
- [PAYMENT_AUTH_INTEGRATIONS_ANALYSIS.md](./PAYMENT_AUTH_INTEGRATIONS_ANALYSIS.md)
- [APPLE_PAY_WALLET_COMPLETE_GUIDE.md](./APPLE_PAY_WALLET_COMPLETE_GUIDE.md)
- [STRIPE_INTEGRATION.md](./STRIPE_INTEGRATION.md)
