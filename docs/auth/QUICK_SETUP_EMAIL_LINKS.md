# Quick Setup Guide - Email Deep Linking

## 🚀 For the Repository Owner (@kodaksax)

Follow these steps to fix the email misdirection bug:

### Step 1: Deploy .well-known Files to Cloudflare (5 minutes)

You have two options:

#### Option A: Cloudflare Workers (Fastest)
1. Go to Cloudflare Dashboard → Workers
2. Create new Worker
3. Copy and paste the code below:

```javascript
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  // iOS Universal Links
  if (url.pathname === '/.well-known/apple-app-site-association') {
    return new Response(JSON.stringify({
      "applinks": {
        "apps": [],
        "details": [{
          "appID": "REPLACE_WITH_YOUR_APPLE_TEAM_ID.com.bounty.BOUNTYExpo",
          "paths": ["/auth/callback", "/auth/*"]
        }]
      }
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    })
  }
  
  // Android App Links
  if (url.pathname === '/.well-known/assetlinks.json') {
    return new Response(JSON.stringify([{
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": {
        "namespace": "android_app",
        "package_name": "app.bountyfinder.BOUNTYExpo",
        "sha256_cert_fingerprints": [
          "REPLACE_WITH_RELEASE_SHA256",
          "REPLACE_WITH_DEBUG_SHA256"
        ]
      }
    }]), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    })
  }
  
  // For all other requests, return to your main site or return 404
  return fetch(request)
}
```

4. Deploy the Worker
5. Add route: `bountyfinder.app/.well-known/*`
6. Save and deploy

#### Option B: Cloudflare Pages (Traditional)
1. Create `public/.well-known/` folder in your website project
2. Copy files from `.well-known/` directory in this repo
3. Deploy to Cloudflare Pages
4. Configure custom domain: `bountyfinder.app`

### Step 2: Get Your Apple Team ID (2 minutes)

1. Go to https://developer.apple.com/account
2. Log in with your Apple Developer account
3. Click **Membership** in the sidebar
4. Copy your **Team ID** (looks like: `ABC123XYZ9`)
5. Update the Worker code above: Replace `REPLACE_WITH_YOUR_APPLE_TEAM_ID` with your Team ID

### Step 3: Get Your Android SHA-256 Fingerprints (3 minutes)

Run this command in your terminal:

```bash
# If using EAS Build (recommended)
eas credentials

# Then navigate to:
# Android → Production → Keystore → Show details
# Copy the SHA-256 fingerprint
```

Or if you have the keystore file:

```bash
keytool -list -v -keystore /path/to/your.keystore -alias your-alias
```

Update the Worker code: Replace the SHA-256 placeholders with your actual fingerprints.

### Step 4: Configure Supabase (3 minutes)

1. Open https://app.supabase.com
2. Select your BOUNTY project
3. Go to **Authentication** → **URL Configuration**
4. Set these values:

```
Site URL: https://bountyfinder.app

Redirect URLs (add each on a new line):
https://bountyfinder.app/auth/callback
https://bountyfinder.app/auth/*
bountyexpo-workspace://auth/callback
```

5. Click **Save**
6. (Optional) Go to **Email Templates** → **Confirm signup**
7. Ensure the confirmation URL uses: `{{ .ConfirmationURL }}`

### Step 5: Rebuild the App (10-20 minutes)

The code changes have been committed. Now rebuild the app:

```bash
# For production
eas build --platform all --profile production

# Or for testing
eas build --platform all --profile preview
```

**Important:** The app MUST be rebuilt for the Android intent filters to take effect.

### Step 6: Test (5 minutes)

#### Test on iOS (Physical Device Only):
1. Install the rebuilt app
2. Sign up with a new email
3. Check email on the same device
4. Click "Confirm Email" button
5. ✅ App should open directly

#### Test on Android:
1. Install the rebuilt app
2. Sign up with a new email
3. Check email on device
4. Click "Confirm Email" button
5. ✅ Should show app chooser with BOUNTY option

#### Quick Test Without Email:
**iOS:**
1. Open Notes app
2. Type: `https://bountyfinder.app/auth/callback?token=test&type=signup`
3. Long press the link
4. Should show "Open in BOUNTY"

**Android:**
```bash
# Run this command with device connected:
adb shell am start -a android.intent.action.VIEW -d "https://bountyfinder.app/auth/callback?token=test&type=signup"
```

### Verification Checklist

- [ ] Cloudflare Worker deployed with correct Apple Team ID
- [ ] Cloudflare Worker has correct Android SHA-256 fingerprints
- [ ] Test URLs work:
  ```bash
  curl https://bountyfinder.app/.well-known/apple-app-site-association
  curl https://bountyfinder.app/.well-known/assetlinks.json
  ```
- [ ] Supabase redirect URL is set to `https://bountyfinder.app/auth/callback`
- [ ] App has been rebuilt and installed
- [ ] Email confirmation opens app directly (iOS)
- [ ] Email confirmation opens app directly (Android)

## 🆘 Troubleshooting

### Links still open in browser

**iOS:**
- Wait 24 hours (Apple caches Universal Links)
- Or: Delete and reinstall the app
- Verify Apple Team ID is correct

**Android:**
- Check SHA-256 fingerprints match your signing certificate
- Run: `adb shell pm get-app-links app.bountyfinder.BOUNTYExpo`
- Should show: `verified` for bountyfinder.app

### .well-known files return 404

- Check Cloudflare Worker is deployed
- Check route is set: `bountyfinder.app/.well-known/*`
- Test in browser: https://bountyfinder.app/.well-known/apple-app-site-association

### App shows error screen

- Check Supabase logs: Authentication → Logs
- Ensure redirect URL matches exactly: `https://bountyfinder.app/auth/callback`
- Verify email template uses `{{ .ConfirmationURL }}`

## 📚 Full Documentation

For detailed information, see:
- **EMAIL_DEEP_LINKING_SETUP.md** - Complete setup guide
- **.well-known/README.md** - .well-known files explanation
- **app/auth/callback.tsx** - Implementation details

## 🎯 Expected Outcome

After completing these steps:
- ✅ Email confirmation links open app directly (no browser redirect)
- ✅ Users see success screen in app
- ✅ Auto-redirect to dashboard after confirmation
- ✅ Error handling for expired links
- ✅ Works on both iOS and Android

## 📞 Need Help?

If you encounter issues:
1. Check the troubleshooting section above
2. Review Supabase Authentication logs
3. Test with the verification checklist
4. Check app logs for error details

---

**Estimated Total Time:** 30 minutes
**Difficulty:** Intermediate
**Requires:** Cloudflare access, Apple Developer account, EAS credentials
