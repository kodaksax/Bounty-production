# Email Confirmation Deep Linking Setup Guide

This guide explains how to configure email confirmation links to open directly in the BOUNTY mobile app instead of redirecting to a website.

## Problem Statement

When users click the "Confirm Email" button in emails sent by Supabase:
- ❌ **Before Fix:** Link opens marketing website in browser, user gets lost
- ✅ **After Fix:** Link opens BOUNTY app directly, seamless email verification

## Solution Overview

We use **Universal Links (iOS)** and **App Links (Android)** to make `https://bountyfinder.app/auth/callback` open the app instead of the browser.

### What Are Universal Links / App Links?

These are HTTPS URLs that, when clicked:
1. **If app is installed:** Opens the app directly (seamless experience)
2. **If app is NOT installed:** Opens the URL in a browser (fallback)

**Example:**
```
User clicks: https://bountyfinder.app/auth/callback?token=abc123&type=signup
→ Opens BOUNTY app → Shows email confirmed screen → Redirects to dashboard
```

## Prerequisites

- ✅ Control over `bountyfinder.app` domain (already owned, hosted on Cloudflare)
- ✅ Apple Team ID (for iOS Universal Links)
- ✅ Android SHA-256 certificate fingerprints (for Android App Links)
- ✅ Access to Supabase project dashboard

## Implementation Steps

### Step 1: Deploy .well-known Files to bountyfinder.app

The `.well-known` directory in this repository contains files that tell iOS and Android which URLs your app can handle.

**Files to deploy:**
- `/.well-known/apple-app-site-association` (iOS)
- `/.well-known/assetlinks.json` (Android)

#### Option A: Cloudflare Pages (Recommended)

1. Create a new Cloudflare Pages project
2. Connect your GitHub repository or upload files manually
3. Create a `public/.well-known/` directory in your Pages project
4. Copy the files from this repo's `.well-known` directory
5. Deploy to Cloudflare Pages
6. Configure custom domain: `bountyfinder.app`

#### Option B: Cloudflare Workers

Deploy this worker script to handle `.well-known` endpoints:

```javascript
// worker.js
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  // Serve iOS Universal Links file
  if (url.pathname === '/.well-known/apple-app-site-association') {
    return new Response(JSON.stringify({
      "applinks": {
        "apps": [],
        "details": [{
          "appID": "YOUR_TEAM_ID.com.bounty.BOUNTYExpo",
          "paths": ["/auth/callback", "/auth/*"]
        }]
      }
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      }
    })
  }
  
  // Serve Android App Links file
  if (url.pathname === '/.well-known/assetlinks.json') {
    return new Response(JSON.stringify([{
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": {
        "namespace": "android_app",
        "package_name": "app.bountyfinder.BOUNTYExpo",
        "sha256_cert_fingerprints": [
          "YOUR_RELEASE_SHA256",
          "YOUR_DEBUG_SHA256"
        ]
      }
    }]), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      }
    })
  }
  
  // Proxy other requests to your main site or return 404
  return new Response('Not Found', { status: 404 })
}
```

#### Verify Deployment

Test that files are accessible:

```bash
# Test iOS file
curl -I https://bountyfinder.app/.well-known/apple-app-site-association
# Should return: HTTP 200, Content-Type: application/json

# Test Android file  
curl -I https://bountyfinder.app/.well-known/assetlinks.json
# Should return: HTTP 200, Content-Type: application/json
```

### Step 2: Get Your Apple Team ID

1. Log in to [Apple Developer](https://developer.apple.com/account)
2. Navigate to **Membership** section
3. Copy your **Team ID** (e.g., `ABC123XYZ9`)
4. Update `.well-known/apple-app-site-association`:
   ```json
   {
     "applinks": {
       "apps": [],
       "details": [{
         "appID": "ABC123XYZ9.com.bounty.BOUNTYExpo",  // Replace TEAMID
         "paths": ["/auth/callback", "/auth/*"]
       }]
     }
   }
   ```

### Step 3: Get Your Android SHA-256 Fingerprints

#### For Debug Builds:
```bash
# macOS/Linux
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA256

# Windows
keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" \
  -alias androiddebugkey -storepass android -keypass android | findstr SHA256
```

#### For Production Builds (EAS):
```bash
# Using EAS CLI
eas credentials

# Then navigate to: Android → Production → Keystore → Show details
# Copy the SHA-256 fingerprint
```

Update `.well-known/assetlinks.json`:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "app.bountyfinder.BOUNTYExpo",
    "sha256_cert_fingerprints": [
      "AA:BB:CC:DD:...:ZZ",  // Your release SHA-256
      "11:22:33:44:...:99"   // Your debug SHA-256
    ]
  }
}]
```

### Step 4: Configure Supabase Email Redirect URL

1. **Open Supabase Dashboard:**
   - Go to [app.supabase.com](https://app.supabase.com)
   - Select your BOUNTY project

2. **Navigate to Authentication Settings:**
   - Click **Authentication** in the sidebar
   - Click **URL Configuration**

3. **Set Redirect URLs:**
   ```
   Site URL: https://bountyfinder.app
   
   Redirect URLs (add all of these):
   - https://bountyfinder.app/auth/callback
   - https://bountyfinder.app/auth/*
   - bountyexpo-workspace://auth/callback (for fallback)
   ```

4. **Configure Email Templates (Optional but Recommended):**
   - Click **Email Templates** in Authentication sidebar
   - Select **Confirm signup** template
   - Update the confirmation link to use:
     ```
     {{ .ConfirmationURL }}
     ```
   - This will automatically use your configured redirect URL

5. **Save Changes**

### Step 5: Update App Configuration

The app configuration has already been updated in `app.json`:

**iOS (Already Configured):**
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

**Android (Added):**
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

**Auth Callback Route (Created):**
- File: `app/auth/callback.tsx`
- Handles: Email confirmation, password reset, magic links
- Auto-redirects users after successful verification

### Step 6: Rebuild and Deploy App

After making these changes, rebuild your app:

```bash
# For iOS
eas build --platform ios --profile production

# For Android
eas build --platform android --profile production

# Or both
eas build --platform all --profile production
```

**Important:** The app must be rebuilt for the new `intentFilters` to take effect on Android.

### Step 7: Test the Flow

#### iOS Testing:

1. **Install the app** on a physical device (Universal Links don't work in Simulator)
2. **Sign up** for a new account
3. **Check your email** on the same device
4. **Click "Confirm Email"** button
5. ✅ **Expected:** App opens directly, shows success screen

**Alternative Test (without email):**
1. Open Notes app
2. Type: `https://bountyfinder.app/auth/callback?token=test&type=signup`
3. Long press the link
4. Should show "Open in BOUNTY" option

#### Android Testing:

1. **Install the app** on device or emulator
2. **Sign up** for a new account
3. **Check your email** on the same device
4. **Click "Confirm Email"** button
5. ✅ **Expected:** Shows app chooser with BOUNTY option, opens app

**Verify App Links are working:**
```bash
# Check verification status
adb shell pm get-app-links app.bountyfinder.BOUNTYExpo

# Should show: "verified" for bountyfinder.app domain
```

## Troubleshooting

### iOS Issues

**Problem:** Link still opens in Safari
- ✅ Verify Apple Team ID is correct in `apple-app-site-association`
- ✅ Check file is accessible at: `https://bountyfinder.app/.well-known/apple-app-site-association`
- ✅ Ensure file has NO `.json` extension
- ✅ Content-Type must be `application/json`
- ✅ Wait 24 hours or reinstall app (iOS caches these files)

**Problem:** File not found (404)
- ✅ Verify Cloudflare deployment is live
- ✅ Check custom domain is properly configured
- ✅ Test URL in browser: should download JSON file

### Android Issues

**Problem:** Link opens in Chrome instead of app
- ✅ Verify SHA-256 fingerprints match your actual app certificate
- ✅ Check package name: `app.bountyfinder.BOUNTYExpo`
- ✅ Run verification command (see above)
- ✅ Ensure `autoVerify: true` in app.json

**Problem:** App Link verification failed
```bash
# Reset verification status
adb shell pm set-app-links --package app.bountyfinder.BOUNTYExpo 0 all

# Trigger re-verification
adb shell pm verify-app-links --re-verify app.bountyfinder.BOUNTYExpo
```

### General Issues

**Problem:** Email link shows error in app
- ✅ Check Supabase redirect URL is set to: `https://bountyfinder.app/auth/callback`
- ✅ Verify email template uses `{{ .ConfirmationURL }}`
- ✅ Check app logs for error details

**Problem:** Deep link parameters not received
- ✅ Ensure Expo Linking is set up correctly (already configured)
- ✅ Check `useLocalSearchParams()` is working in callback screen
- ✅ Test with a dummy link first

## Testing Checklist

Before deploying to production, verify:

- [ ] `.well-known` files are accessible at `bountyfinder.app`
- [ ] Apple Team ID is correct in `apple-app-site-association`
- [ ] Android SHA-256 fingerprints are correct in `assetlinks.json`
- [ ] Supabase redirect URL is set to `https://bountyfinder.app/auth/callback`
- [ ] App has been rebuilt with new configuration
- [ ] iOS Universal Links work on physical device
- [ ] Android App Links verification passes
- [ ] Email confirmation flow works end-to-end
- [ ] Success screen shows and redirects properly
- [ ] Error handling works for expired links

## Architecture Notes

### Flow Diagram

```
1. User signs up → Supabase sends email
2. Email contains: https://bountyfinder.app/auth/callback?token=xxx&type=signup
3. User clicks link → OS checks .well-known files
4. iOS/Android recognizes app can handle URL
5. Opens app → Calls app/auth/callback.tsx
6. Screen extracts token → Calls supabase.auth.verifyOtp()
7. Success → Shows confirmation → Redirects to dashboard
8. Error → Shows error screen with retry options
```

### Security Considerations

- ✅ Universal/App Links use HTTPS only (secure)
- ✅ Token verification happens server-side (Supabase)
- ✅ Expired tokens are rejected automatically
- ✅ .well-known files contain no secrets (safe to be public)
- ✅ SHA-256 fingerprints are public identifiers (not private keys)

## Maintenance

### When to Update

**Update `.well-known` files when:**
- App bundle identifier changes
- Android signing keys change (new SHA-256 fingerprints)
- Apple Team ID changes
- You add new deep link paths

**No update needed for:**
- App version updates
- Minor bug fixes
- UI changes

### Monitoring

Monitor these metrics:
- Email open rate
- Confirmation completion rate
- Deep link success rate
- Time from signup to confirmation

## References

- [iOS Universal Links](https://developer.apple.com/ios/universal-links/)
- [Android App Links](https://developer.android.com/training/app-links)
- [Expo Linking](https://docs.expo.dev/guides/linking/)
- [Supabase Auth Redirects](https://supabase.com/docs/guides/auth/redirect-urls)
- [Cloudflare Pages](https://pages.cloudflare.com/)

## Support

For issues with this setup:
1. Check the troubleshooting section above
2. Review logs in Supabase dashboard → Authentication → Logs
3. Test with the checklist above
4. Check mobile app logs for error details

---

**Last Updated:** February 2026
**Author:** GitHub Copilot
**Status:** ✅ Implementation Complete
