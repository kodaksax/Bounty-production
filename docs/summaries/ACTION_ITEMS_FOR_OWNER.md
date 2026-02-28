# Action Items for Repository Owner

## 📋 What You Need to Do to Fix Email Confirmation

**Estimated Time:** 30-45 minutes
**Difficulty:** Medium
**Prerequisites:** Access to Cloudflare, Apple Developer, EAS account

---

## ✅ Step-by-Step Actions

### 1️⃣ Deploy .well-known Files (15 minutes)

**You need to host these files at your domain:**
- `https://bountyfinder.app/.well-known/apple-app-site-association`
- `https://bountyfinder.app/.well-known/assetlinks.json`

**Choose ONE deployment method:**

#### Option A: Cloudflare Worker (Recommended - Fastest)
1. Log in to Cloudflare Dashboard
2. Go to **Workers & Pages** → **Create application** → **Create Worker**
3. Name it: `bounty-well-known`
4. Copy the worker code from `QUICK_SETUP_EMAIL_LINKS.md` (lines 35-79)
5. Paste into the worker editor
6. Click **Save and Deploy**
7. Go to **Triggers** → **Add Route**
8. Enter route: `bountyfinder.app/.well-known/*`
9. Save

**Then continue to Step 2 to update the placeholders in the worker.**

#### Option B: Cloudflare Pages
1. Create a new repository or use existing one
2. Add `public/.well-known/` directory
3. Copy files from this repo's `.well-known/` directory
4. Push to GitHub
5. Connect to Cloudflare Pages
6. Set custom domain: `bountyfinder.app`

**Then continue to Step 2 to update the placeholder values in the files.**

---

### 2️⃣ Get Your Apple Team ID (3 minutes)

1. Go to https://developer.apple.com/account
2. Sign in with your Apple Developer account
3. Click **Membership** in the left sidebar
4. Look for **Team ID** (example: `ABC123XYZ9`)
5. Copy this Team ID

**Update your deployed files:**
- If using Worker: Edit the worker code, replace `REPLACE_WITH_YOUR_APPLE_TEAM_ID`
- If using Pages: Edit `apple-app-site-association`, update the `appID` field

---

### 3️⃣ Get Your Android SHA-256 Fingerprints (5 minutes)

Run this command in your terminal:

```bash
eas credentials
```

Then:
1. Select **Android**
2. Select **Production**
3. Select **Keystore**
4. Choose **Show details**
5. Copy the **SHA-256 Fingerprint**

Also get the debug fingerprint if you want to test on development builds:
```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA256
```

**Update your deployed files:**
- If using Worker: Edit the worker code, replace the SHA-256 fingerprint placeholders
- If using Pages: Edit `assetlinks.json`, update the `sha256_cert_fingerprints` array

---

### 4️⃣ Verify Files Are Accessible (2 minutes)

Test that your files are live:

```bash
# Test iOS file
curl https://bountyfinder.app/.well-known/apple-app-site-association

# Test Android file
curl https://bountyfinder.app/.well-known/assetlinks.json
```

Both should return JSON content. If you get 404, check your Cloudflare deployment.

---

### 5️⃣ Configure Supabase (5 minutes)

1. Open https://app.supabase.com
2. Select your BOUNTY project
3. Go to **Authentication** (left sidebar)
4. Click **URL Configuration**
5. Update these settings:

```
Site URL:
https://bountyfinder.app

Redirect URLs (add each on a new line):
https://bountyfinder.app/auth/callback
https://bountyfinder.app/auth/*
bountyexpo-workspace://auth/callback
```

6. Click **Save**

**Optional but recommended:**
1. Go to **Email Templates** (still in Authentication section)
2. Select **Confirm signup**
3. Verify the confirmation URL is: `{{ .ConfirmationURL }}`
4. Save if you made changes

---

### 6️⃣ Rebuild Your App (15 minutes)

The code changes have been committed to the PR. Now rebuild:

```bash
# Install dependencies (if needed)
npm install

# Build for production
eas build --platform all --profile production

# Or just iOS
eas build --platform ios --profile production

# Or just Android
eas build --platform android --profile production
```

**Why rebuild?**
The Android `intentFilters` added to `app.json` only take effect after rebuilding.

---

### 7️⃣ Test the Flow (10 minutes)

#### On iOS (requires physical device):
1. Install the rebuilt app
2. Delete any existing account for testing
3. Sign up with a new email address
4. Check your email on the same device
5. Click the "Confirm Email" button
6. **Expected:** App opens directly, shows success screen

#### On Android (device or emulator):
1. Install the rebuilt app
2. Delete any existing account for testing
3. Sign up with a new email address
4. Check your email on the same device
5. Click the "Confirm Email" button
6. **Expected:** Shows app chooser, select BOUNTY, shows success screen

#### Quick Test Without Email:

**iOS:** Open Notes app, paste this link, long-press it:
```
https://bountyfinder.app/auth/callback?token=test&type=signup
```
Should show "Open in BOUNTY" option.

**Android:** Run this adb command:
```bash
adb shell am start -a android.intent.action.VIEW \
  -d "https://bountyfinder.app/auth/callback?token=test&type=signup"
```
Should open the app directly.

---

## 🔍 Verification Checklist

Before marking this as complete, verify:

- [ ] `.well-known` files are accessible at `bountyfinder.app`
  ```bash
  curl https://bountyfinder.app/.well-known/apple-app-site-association
  curl https://bountyfinder.app/.well-known/assetlinks.json
  ```

- [ ] Files contain your correct Apple Team ID and SHA-256 fingerprints

- [ ] Supabase redirect URL is set to `https://bountyfinder.app/auth/callback`

- [ ] App has been rebuilt with the new configuration

- [ ] iOS: Universal Link works on physical device
  - Link opens app directly
  - Shows confirmation success screen
  - Redirects to dashboard

- [ ] Android: App Link works on device/emulator
  - Link shows app chooser with BOUNTY
  - Opens app when selected
  - Shows confirmation success screen

---

## 🆘 Troubleshooting

### Issue: .well-known files return 404

**Solution:**
- Check Cloudflare Worker is deployed
- Check Worker route is configured: `bountyfinder.app/.well-known/*`
- Test in browser: https://bountyfinder.app/.well-known/apple-app-site-association

### Issue: Link still opens in browser (iOS)

**Possible causes:**
1. Apple Team ID is incorrect
2. iOS needs time to cache (wait 24 hours or reinstall app)
3. File not accessible or has wrong format

**Debug:**
```bash
# Verify file is valid JSON
curl https://bountyfinder.app/.well-known/apple-app-site-association | jq .
```

### Issue: Link opens in browser (Android)

**Possible causes:**
1. SHA-256 fingerprint doesn't match your app certificate
2. App Link verification failed
3. Wrong package name

**Debug:**
```bash
# Check app link verification status
adb shell pm get-app-links app.bountyfinder.BOUNTYExpo

# Should show: "verified" for bountyfinder.app
```

**Fix:**
```bash
# Reset and re-verify
adb shell pm set-app-links --package app.bountyfinder.BOUNTYExpo 0 all
adb shell pm verify-app-links --re-verify app.bountyfinder.BOUNTYExpo
```

### Issue: App shows error "Invalid Link"

**Possible causes:**
1. Supabase redirect URL not configured
2. Token expired
3. Email template not using correct URL

**Check:**
- Verify Supabase URL Configuration
- Test with a fresh signup
- Check email template uses `{{ .ConfirmationURL }}`

---

## 📚 Reference Documents

For more details, see:
- **QUICK_SETUP_EMAIL_LINKS.md** - Quick reference (this level of detail)
- **EMAIL_DEEP_LINKING_SETUP.md** - Comprehensive guide
- **EMAIL_DEEP_LINKING_VISUAL_GUIDE.md** - Flow diagrams
- **.well-known/README.md** - Technical details about the files

---

## 📞 Questions?

If you get stuck:
1. Read the troubleshooting section above
2. Check Supabase logs: Authentication → Logs
3. Check app logs in Metro or device logs
4. Verify each step in the checklist

---

## 🎉 Success Criteria

You'll know it's working when:
- ✅ You sign up on mobile
- ✅ You receive the email
- ✅ You tap "Confirm Email"
- ✅ The app opens directly (not browser)
- ✅ You see a success message
- ✅ You're redirected to the dashboard
- ✅ You can now post and apply to bounties

---

**Good luck! 🚀**

The code is ready. You just need to deploy the configuration files and rebuild the app.
