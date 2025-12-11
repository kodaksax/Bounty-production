# Security Features Implementation Guide

This document describes the security features implemented in BountyExpo and provides guidance for production deployment.

## Overview

BountyExpo implements a multi-layered security approach:

1. **Email Verification** - Required for posting bounties and withdrawing funds
2. **Phone Verification (SMS)** - Optional identity verification via OTP
3. **Two-Factor Authentication (2FA)** - Optional TOTP-based authentication
4. **ID Verification** - Future roadmap for government ID verification

## 1. Email Verification

### Implementation

Email verification is enforced at the application level through:

- `EmailVerificationBanner` component - Shows warning banner to unverified users
- `useEmailVerification` hook - Provides verification status and permissions
- Verification gates in critical flows (posting bounties, withdrawing funds)

### Files

- `components/ui/email-verification-banner.tsx` - Banner UI component
- `hooks/use-email-verification.tsx` - Verification status hook
- `lib/services/auth-service.ts` - Email verification service methods
- `app/screens/CreateBounty/index.tsx` - Bounty creation gate
- `components/withdraw-screen.tsx` - Withdrawal gate

### Usage

```typescript
import { useEmailVerification } from 'hooks/use-email-verification';

function MyComponent() {
  const { isEmailVerified, canPostBounties, canWithdrawFunds, userEmail } = useEmailVerification();

  if (!canPostBounties) {
    return <EmailVerificationBanner email={userEmail} />;
  }

  // ... rest of component
}
```

### Configuration

Email verification is handled by Supabase Auth:

1. Enable email confirmation in Supabase Dashboard:
   - Go to Authentication > Settings
   - Enable "Enable email confirmations"
   - Configure email templates (optional)

2. Set up redirect URLs:
   - Add `bountyexpo://auth/callback` to redirect URLs
   - Configure deep linking in `app.json`

### Testing

To test email verification:

1. Sign up with a real email address
2. Check inbox for verification email
3. Click verification link
4. App should detect verified status automatically
5. Try posting a bounty - should succeed after verification

## 2. Phone Verification (SMS OTP)

### Implementation

Phone verification uses Supabase Phone Auth to send and verify OTP codes:

- `phone-verification-service.ts` - Send and verify OTP
- `app/onboarding/phone.tsx` - Phone number collection
- `app/onboarding/verify-phone.tsx` - OTP verification screen

### Files

- `lib/services/phone-verification-service.ts` - Core service
- `app/onboarding/phone.tsx` - Phone input (updated with OTP trigger)
- `app/onboarding/verify-phone.tsx` - OTP verification UI

### Usage

```typescript
import { sendPhoneOTP, verifyPhoneOTP } from 'lib/services/phone-verification-service';

// Send OTP
const result = await sendPhoneOTP('+15551234567');
if (result.success) {
  // Navigate to OTP entry screen
}

// Verify OTP
const verified = await verifyPhoneOTP('+15551234567', '123456');
if (verified.success) {
  // Phone verified!
}
```

### Configuration

#### Recommended: Supabase Phone Auth

**This is the ONLY recommended approach for production use.**

1. Enable Phone Auth in Supabase:
   ```
   Dashboard > Authentication > Providers > Phone
   ```

2. Choose SMS provider:
   - Twilio (most reliable)
   - MessageBird
   - Vonage

3. Add credentials in Supabase Settings:
   - Twilio Account SID
   - Twilio Auth Token
   - Twilio Phone Number

**Why Supabase Phone Auth?**
- Credentials stay secure on the server
- No need to build your own backend API
- Automatic rate limiting and security
- Built-in OTP management

#### Advanced: Custom Backend Integration (Not Recommended)

⚠️ **WARNING**: Direct integration with SMS providers is NOT recommended and should only be considered by advanced users with existing backend infrastructure.

**Security Requirements:**
- Twilio credentials (Account SID and Auth Token) must NEVER be stored in client-side code
- Requires a secure backend API server with proper authentication
- Must implement rate limiting to prevent SMS abuse
- Must handle OTP storage and verification securely

If you absolutely need a custom backend:
1. Build secure API endpoints for OTP send/verify
2. Never expose SMS provider credentials to the client
3. Implement comprehensive rate limiting
4. Consider using Supabase Phone Auth instead - it's easier and more secure

### Testing

#### Development Testing

For development, you can:

1. Use Supabase's test mode (if available)
2. Use Twilio test credentials
3. Add your phone number to verified caller IDs in Twilio

#### Production Testing

1. Test with a real phone number
2. Verify OTP code arrives within 30 seconds
3. Test expired OTP (wait >5 minutes)
4. Test invalid OTP codes
5. Test rate limiting (multiple attempts)

## 3. Two-Factor Authentication (2FA)

### Implementation

2FA uses TOTP (Time-based One-Time Password) compatible with Google Authenticator, Authy, etc.

Uses Supabase MFA (Multi-Factor Authentication) feature.

### Files

- `components/settings/security.tsx` - Security settings with 2FA toggle
- Supabase MFA handles TOTP generation and verification

### Usage

The `SecuritySettings` component provides:
- Enable/disable 2FA toggle
- QR code display for authenticator app setup
- Verification code entry

```typescript
import { SecuritySettings } from 'components/settings/security';

function SettingsScreen() {
  return (
    <SecuritySettings onBack={() => router.back()} />
  );
}
```

### Configuration

1. Enable MFA in Supabase:
   ```
   Dashboard > Authentication > Settings
   Enable "Multi-Factor Authentication"
   ```

2. No additional configuration needed - Supabase handles TOTP

### Testing

1. Navigate to Security Settings
2. Enable 2FA
3. Scan QR code with Google Authenticator
4. Enter 6-digit code to verify
5. Sign out and sign in again
6. Should be prompted for 2FA code

## 4. ID Verification (Future)

### Implementation Status

Currently implemented as UI placeholder. Requires integration with:

- **Onfido** - Identity verification service
- **Stripe Identity** - Built into Stripe
- **Custom solution** - Manual review + Supabase Edge Functions

### Files

- `app/verification/upload-id.tsx` - ID upload UI (placeholder)

### Recommended Service: Stripe Identity

For production, we recommend Stripe Identity because:

1. Already using Stripe for payments
2. Handles KYC/AML compliance
3. Automatic fraud detection
4. Simple integration

### Integration Steps (When Ready)

1. Enable Stripe Identity in Dashboard
2. Install Stripe Identity SDK:
   ```bash
   npm install @stripe/stripe-identity-react-native
   ```

3. Update `app/verification/upload-id.tsx`:
   ```typescript
   import { useStripeIdentity } from '@stripe/stripe-identity-react-native';

   function UploadIDScreen() {
     const { verifyIdentity } = useStripeIdentity();
     
     const handleVerify = async () => {
       const result = await verifyIdentity({
         sessionId: '<session_id_from_backend>'
       });
       
       if (result.success) {
         // User verified!
       }
     };
   }
   ```

4. Create backend endpoint to create verification session:
   ```typescript
   // POST /api/identity/create-verification-session
   const session = await stripe.identity.verificationSessions.create({
     type: 'document',
     metadata: { user_id: userId },
   });
   ```

## Security Best Practices

### General

1. **Never store plaintext passwords** - Supabase handles this
2. **Use HTTPS only** - Enforce in production
3. **Rate limit sensitive endpoints** - Implement in middleware
4. **Log security events** - Track failed auth attempts
5. **Regular security audits** - Review code and dependencies

### Email Verification

- Send verification emails immediately after signup
- Expire verification links after 24 hours
- Allow resending verification emails with rate limiting
- Log verification attempts

### Phone Verification

- Use E.164 phone number format
- Implement rate limiting (max 3 OTP requests per hour)
- Expire OTP codes after 5 minutes
- Never log OTP codes
- Use secure SMS provider (Twilio recommended)

### 2FA

- Enforce 2FA for admin users
- Store backup codes encrypted
- Allow recovery via email if user loses device
- Log 2FA enable/disable events

### ID Verification

- Encrypt ID documents at rest
- Delete ID documents after verification (privacy)
- Log verification attempts
- Implement manual review queue for flagged documents

## Compliance Considerations

### GDPR (Europe)

- Allow users to export their data
- Provide data deletion on request
- Get explicit consent for data processing
- Implement right to be forgotten

### CCPA (California)

- Disclose data collection practices
- Allow users to opt out of data sale
- Provide data access upon request

### KYC/AML (Financial)

- Verify identity for transactions >$1000
- Screen against sanctions lists
- Report suspicious activity
- Keep verification records for 5 years

## Monitoring and Alerting

### Key Metrics to Monitor

1. Email verification rate
2. Phone verification success rate
3. 2FA adoption rate
4. Failed authentication attempts
5. OTP delivery time
6. ID verification approval rate

### Recommended Tools

- **Sentry** - Error tracking and monitoring
- **Mixpanel** - User analytics and funnels
- **Supabase Dashboard** - Auth statistics

## Troubleshooting

### Email verification not working

1. Check Supabase email settings
2. Verify SMTP configuration
3. Check spam folder
4. Test with different email providers

### Phone OTP not received

1. Check Twilio balance
2. Verify phone number format (E.164)
3. Check carrier restrictions
4. Test with different phone number

### 2FA issues

1. Check system time on device (TOTP requires accurate time)
2. Regenerate QR code
3. Try different authenticator app
4. Use backup codes

### ID verification failing

1. Check image quality
2. Ensure ID is not expired
3. Verify service API keys
4. Check supported document types

## Future Enhancements

### Planned

1. Biometric authentication (Face ID, Touch ID)
2. Hardware security keys (FIDO2)
3. Risk-based authentication
4. Device fingerprinting
5. Behavioral biometrics

### Under Consideration

1. Social account linking (Google, Apple)
2. Passkey support
3. Decentralized identity (DID)
4. Blockchain-based verification

## Support

For security-related questions or issues:

- **Email**: security@bountyexpo.com
- **Documentation**: https://docs.bountyexpo.com/security
- **Bug Reports**: https://github.com/kodaksax/bountyexpo/issues

## Change Log

- **2024-12-10**: Initial implementation of email, phone, and 2FA
- **Future**: ID verification integration
