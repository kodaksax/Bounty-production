# Forgot Password Flow — Setup & Configuration Guide

Complete guide for configuring the forgot-password / reset-password flow in BOUNTYExpo.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Environment Variables](#environment-variables)
4. [Supabase Dashboard Configuration](#supabase-dashboard-configuration)
5. [Deep Link Setup](#deep-link-setup)
6. [SMTP Provider Setup (Production)](#smtp-provider-setup-production)
7. [Security Features](#security-features)
8. [Testing the Flow](#testing-the-flow)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The forgot-password flow allows users to request a password reset link via email, click the link to open the app, and set a new password. The flow is built on Supabase Auth and uses universal links to route users back into the mobile app. When the link is opened on a desktop browser or a device without the app installed, a web-based password update page (hosted on GitHub Pages) handles the flow as a fallback.

### Flow Summary

```
User taps "Forgot?" → enters email → taps "Send Reset Link"
  → Supabase sends reset email → user clicks link
  → Mobile: app opens auth/callback → session established → update-password screen
  → Desktop/Web: bountyfinder.app/auth/callback page loads → web password form
  → user sets new password → password updated → user signs in
```

### Key Files

| File | Purpose |
|------|---------|
| `app/auth/reset-password.tsx` | Reset password screen (email input, send link) |
| `app/auth/update-password.tsx` | Update password screen (new password form) |
| `app/auth/callback.tsx` | Handles deep-link callback from reset email |
| `lib/services/auth-service.ts` | Service layer: `requestPasswordReset()`, `updatePassword()`, `verifyResetToken()` |
| `lib/utils/password-validation.ts` | Password strength checking, email validation |
| `lib/config/app.ts` | Deep link scheme configuration |
| `docs/auth/callback/index.html` | Web fallback: callback + password update form (GitHub Pages) |
| `docs/auth/update-password/index.html` | Web fallback: informational landing page |

---

## Architecture

```
┌─────────────────┐     ┌────────────────┐     ┌──────────────────┐
│  reset-password  │────▶│  auth-service   │────▶│  Supabase Auth   │
│    (screen)      │     │  (client lib)   │     │  (backend)       │
└─────────────────┘     └────────────────┘     └──────┬───────────┘
                                                       │ sends email
                                                       ▼
                                               ┌──────────────────┐
                                               │  User's Inbox    │
                                               │  (SMTP/Supabase) │
                                               └──────┬───────────┘
                                                       │ clicks link
                                                       ▼
                                               ┌──────────────────┐
                                               │ bountyfinder.app │
                                               │ /auth/callback   │
                                               └──────┬───────────┘
                                      ┌───────────────┤
                                      ▼               ▼
                               ┌──────────┐   ┌───────────────────┐
                               │ Mobile   │   │ Desktop / Web     │
                               │ (app     │   │ (GitHub Pages     │
                               │  opens)  │   │  password form)   │
                               └────┬─────┘   └───────────────────┘
                                    ▼
┌─────────────────┐     ┌────────────────┐
│ update-password  │◀────│  auth/callback  │
│   (screen)       │     │  (screen)       │
└─────────────────┘     └────────────────┘
```

---

## Environment Variables

The following environment variables are relevant to the forgot-password flow. Set them in your `.env` file or hosting platform.

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://abc123.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key | `eyJhbGciOiJI...` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `EXPO_PUBLIC_AUTH_REDIRECT_URL` | Override the redirect URL in reset emails | `https://bountyfinder.app/auth/callback` |
| `EXPO_PUBLIC_DEEP_LINK_SCHEME` | App deep link scheme | `bountyexpo-workspace` |

> **Note:** The default redirect URL is `https://bountyfinder.app/auth/callback` (a web URL).
> This ensures reset links work on both mobile (the OS opens the app via universal links)
> and desktop browsers (a web-based password form loads on GitHub Pages).
> The deep link scheme is configured in `lib/config/app.ts` and defaults to `bountyexpo-workspace`.

---

## Supabase Dashboard Configuration

### 1. Email Templates

1. Open [Supabase Dashboard](https://app.supabase.com) → select your project
2. Navigate to **Authentication** → **Email Templates**
3. Click **"Reset Password"** template
4. Ensure the template is **enabled** (toggle ON)
5. Verify the template body contains `{{ .ConfirmationURL }}`

### 2. Redirect URLs

1. Go to **Authentication** → **URL Configuration**
2. Set **Site URL**: `https://bountyfinder.app` (or your production domain)
3. Add the following to **Redirect URLs**:

```
bountyexpo-workspace://auth/callback
bountyexpo-workspace://auth/update-password
https://bountyfinder.app/auth/callback
https://bountyfinder.app/auth/update-password
```

> Both the custom scheme (`bountyexpo-workspace://`) and the universal link
> (`https://bountyfinder.app/`) are listed so the flow works whether the
> device resolves the deep link via custom scheme or universal link.

### 3. Rate Limits

Supabase has built-in rate limits on auth emails:

| Setting | Built-in Email | Custom SMTP |
|---------|---------------|-------------|
| Per email address | 4/hour | Provider-dependent |
| Project-wide | 30/hour (free tier) | Provider-dependent |

To adjust: **Project Settings** → **Auth** → **Rate Limits**

---

## Deep Link Setup

### iOS (Universal Links)

The app is already configured in `app.json`:

```json
{
  "ios": {
    "associatedDomains": [
      "applinks:bountyfinder.app",
      "applinks:*.bountyfinder.app"
    ]
  }
}
```

**Server requirement:** An `apple-app-site-association` file must be hosted at
`https://bountyfinder.app/.well-known/apple-app-site-association`.

### Android (Intent Filters)

Configured in `app.json`:

```json
{
  "android": {
    "intentFilters": [{
      "action": "VIEW",
      "autoVerify": true,
      "data": [{
        "scheme": "https",
        "host": "bountyfinder.app",
        "pathPrefix": "/auth"
      }],
      "category": ["BROWSABLE", "DEFAULT"]
    }]
  }
}
```

**Server requirement:** A Digital Asset Links file must be hosted at
`https://bountyfinder.app/.well-known/assetlinks.json`.

### Custom Scheme Fallback

Both platforms also support the `bountyexpo-workspace://` custom scheme, which
Expo Router resolves directly. This is set in `app.json` → `scheme` and in
`lib/config/app.ts`.

---

## Web Fallback (GitHub Pages)

When a user opens the password reset link on a desktop browser or a device
without the app installed, the link lands on a web-based password update page
hosted via GitHub Pages at `https://bountyfinder.app/auth/callback`.

### How It Works

1. **Reset email redirect** points to `https://bountyfinder.app/auth/callback`
   (a universal link / web URL).
2. **On mobile** (with the app installed), the OS intercepts the universal link
   and opens the app directly — the existing in-app callback flow takes over.
3. **On desktop / web**, the browser loads `docs/auth/callback/index.html` which:
   - Extracts the auth tokens from the URL hash fragment.
   - Attempts to open the mobile app via deep link (for edge cases).
   - After a short timeout, displays an inline password update form.
   - Uses the Supabase JS client (CDN) to set the session and update the password.

### Setup

The web pages are auto-deployed from the `docs/` directory to GitHub Pages
(see `.github/workflows/deploy-pages.yml`).

**Required one-time configuration:**

Edit `docs/auth/callback/index.html` and replace the placeholder credentials
at the top of the `<script>` block:

```javascript
var SUPABASE_URL  = 'REPLACE_WITH_SUPABASE_URL';   // e.g. https://abc123.supabase.co
var SUPABASE_ANON = 'REPLACE_WITH_SUPABASE_ANON_KEY'; // your Supabase anon/public key
```

> **Note:** The anon key is a public value designed for client-side use — it is
> safe to include in the HTML.  The web page enforces the same password
> requirements as the mobile app (min 8 chars, uppercase, lowercase, number,
> special character).

### Files

| File | URL | Purpose |
|------|-----|---------|
| `docs/auth/callback/index.html` | `bountyfinder.app/auth/callback` | Token exchange + password update form |
| `docs/auth/update-password/index.html` | `bountyfinder.app/auth/update-password` | Informational landing page |

---

## SMTP Provider Setup (Production)

Supabase's built-in email has low rate limits and may land in spam. For
production, configure a custom SMTP provider.

### Supported Providers

| Provider | Docs |
|----------|------|
| SendGrid | https://docs.sendgrid.com/for-developers/sending-email/integrating-with-the-smtp-api |
| AWS SES | https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html |
| Mailgun | https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/#send-via-smtp |
| Resend | https://resend.com/docs/send-with-supabase-smtp |
| Postmark | https://postmarkapp.com/developer/user-guide/sending-email/sending-with-api |

### Configuration Steps

1. Open **Supabase Dashboard** → **Project Settings** → **Authentication**
2. Scroll to **SMTP Settings** → click **Enable Custom SMTP**
3. Enter:
   - **Sender email**: `noreply@yourdomain.com`
   - **Sender name**: `BOUNTY`
   - **Host**: your SMTP host (e.g. `smtp.sendgrid.net`)
   - **Port**: `587` (TLS) or `465` (SSL)
   - **Username**: provided by your SMTP service
   - **Password**: provided by your SMTP service
4. Click **Save** → **Send Test Email** to verify

### Sender Domain

For best deliverability:
- Set up SPF, DKIM, and DMARC records for your sending domain
- Verify the sender domain in your SMTP provider's dashboard
- Use a consistent `From` address

---

## Security Features

The forgot-password flow includes multiple layers of security:

### Anti-Enumeration

`requestPasswordReset()` always returns a generic success message regardless
of whether the email exists. This prevents attackers from discovering which
email addresses have accounts.

### Client-Side Rate Limiting

`reset-password.tsx` enforces:
- **60-second cooldown** between reset requests (resend countdown timer)
- **5-attempt limit** before a 5-minute lockout

These are defense-in-depth measures on top of Supabase's server-side limits.

### Server-Side Rate Limiting

Supabase Auth rate-limits `resetPasswordForEmail` calls per email address and
per project. The auth-service detects `429` / rate-limit error messages and
returns a `rate_limited` error code.

### Token Security

- Reset tokens expire after **1 hour** (configurable in Supabase)
- Tokens are **single-use** — they cannot be replayed
- Tokens are exchanged for a session via `verifyOtp()` before the user can
  set a new password

### Password Strength

`update-password.tsx` uses `lib/utils/password-validation.ts` to enforce:
- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one number (0-9)
- At least one special character (`@$!%*?&`)
- Common weak passwords are penalized in the strength score
- A real-time strength indicator guides the user

### Audit Trail

Every password-reset request is logged with:
- Correlation ID for end-to-end tracing
- Platform/user-agent information
- Analytics events: `auth_password_reset_requested`, `auth_password_reset_failed`, `auth_password_reset_error`

---

## Testing the Flow

### Prerequisites

- Supabase project with email templates enabled
- At least one test user with a verified email
- App running locally (`npx expo start`)

### Manual Test Checklist

| # | Step | Expected Result |
|---|------|-----------------|
| 1 | Navigate to Sign In → tap "Forgot?" | Reset Password screen opens |
| 2 | Leave email empty → tap "Send Reset Link" | "Email is required" field error |
| 3 | Enter invalid email → tap "Send Reset Link" | "Please enter a valid email address" field error |
| 4 | Enter valid email → tap "Send Reset Link" | Loading spinner → success message |
| 5 | Immediately tap "Resend" | Countdown timer shown (60s) |
| 6 | After countdown → tap "Resend" | Another reset email sent |
| 7 | Tap "Send Reset Link" 6+ times quickly | Lockout message: "Too many attempts…" |
| 8 | Check email inbox | Password reset email received |
| 9 | Click reset link in email | App opens → auth/callback → update-password |
| 10 | Enter weak password | Strength indicator shows "weak", submit disabled |
| 11 | Enter strong password + confirm | Strength indicator shows "strong", submit enabled |
| 12 | Tap "Update Password" | Success screen → "Sign In Now" button |
| 13 | Sign in with new password | Login succeeds |
| 14 | Sign in with old password | Login fails |

### Automated Tests

```bash
# Run auth-service unit tests
npx jest __tests__/unit/services/auth-service.test.ts --runInBand --no-coverage

# Run password-validation unit tests
npx jest __tests__/unit/utils/password-validation.test.ts --runInBand --no-coverage
```

---

## Troubleshooting

### Email Not Arriving

1. **Check Supabase Auth Logs:** Dashboard → Logs → Auth Logs
2. **Check spam/junk folder** — add `noreply@mail.app.supabase.com` to contacts
3. **Verify email template** is enabled and contains `{{ .ConfirmationURL }}`
4. **Check rate limits** — Supabase free tier: 30 emails/hour project-wide
5. **Custom SMTP:** verify credentials in Supabase SMTP settings; check provider dashboard for send failures

### Deep Link Not Opening App

1. **iOS:** verify `apple-app-site-association` is hosted and the `applinks:` associated domain is configured
2. **Android:** verify `assetlinks.json` is hosted and intent filter is in `app.json`
3. **Clear Metro cache:** `npx expo start --clear`
4. **Rebuild native shell:** `npx expo run:ios` / `npx expo run:android`
5. **Custom scheme fallback:** ensure `bountyexpo-workspace://auth/callback` is in Supabase redirect URLs

### "Invalid Reset Link" Error

- Token may have expired (default 1 hour)
- Token may have already been used (single-use)
- Redirect URL mismatch — verify URLs in Supabase match app configuration
- Request a new reset link from the reset-password screen

### Password Update Fails

- Session may have expired — request a new reset link
- "New password cannot be the same as your current password" — choose a different password
- Check for error details in the app console (`[auth-service]` log prefix)

### App Console Log Prefixes

| Prefix | Source |
|--------|--------|
| `[auth-service]` | `lib/services/auth-service.ts` |
| `[auth-callback]` | `app/auth/callback.tsx` |
| `[reset-password]` | `app/auth/reset-password.tsx` |

---

## Related Documentation

- [`RESET_PASSWORD_FLOW_FIX.md`](./RESET_PASSWORD_FLOW_FIX.md) — Previous fix summary
- [`EMAIL_DEEP_LINKING_SETUP.md`](./EMAIL_DEEP_LINKING_SETUP.md) — Email deep linking configuration
- [`QUICK_SETUP_EMAIL_LINKS.md`](./QUICK_SETUP_EMAIL_LINKS.md) — Quick setup guide for email links
- [`AUTH_RATE_LIMITING.md`](./AUTH_RATE_LIMITING.md) — Rate limiting implementation
- [`../testing/AUTHENTICATION_TESTING_GUIDE.md`](../testing/AUTHENTICATION_TESTING_GUIDE.md) — Comprehensive testing guide
- [`../security/SECURITY.md`](../security/SECURITY.md) — Security documentation
