# .well-known Directory - Universal Links & App Links Configuration

This directory contains configuration files for iOS Universal Links and Android App Links, which enable email confirmation links to open directly in the BOUNTY app.

## Files

### 1. apple-app-site-association (iOS Universal Links)
**Purpose:** Tells iOS which URLs should open in the BOUNTY app instead of Safari.

**Important Notes:**
- This file MUST NOT have a `.json` extension
- The `TEAMID` in `appID` must be replaced with your Apple Team ID
- Find your Team ID at: https://developer.apple.com/account (Membership section)
- The paths `/auth/callback` and `/auth/*` are configured to open in the app

**Required Format:**
```
appID: "TEAMID.com.bounty.BOUNTYExpo"
```
Replace `TEAMID` with your actual Apple Team ID (e.g., "ABC123XYZ9.com.bounty.BOUNTYExpo")

### 2. assetlinks.json (Android App Links)
**Purpose:** Tells Android which URLs should open in the BOUNTY app instead of Chrome.

**Important Notes:**
- You must add your app's SHA-256 certificate fingerprints
- Different fingerprints are needed for:
  - Debug builds (development)
  - Release builds (production)

**How to Get Your SHA-256 Fingerprints:**

#### For Debug Key:
```bash
# macOS/Linux
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA256

# Windows
keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android | findstr SHA256
```

#### For Release Key:
```bash
# If using EAS Build
eas credentials

# Or from your release keystore
keytool -list -v -keystore /path/to/release.keystore -alias your-key-alias | grep SHA256
```

**Edit the file and replace:**
- `REPLACE_WITH_YOUR_RELEASE_KEY_SHA256` with your production SHA-256 fingerprint
- `REPLACE_WITH_YOUR_DEBUG_KEY_SHA256` with your debug SHA-256 fingerprint

## Deployment to Cloudflare

These files must be hosted at `https://bountyfinder.app/.well-known/` for Universal/App Links to work.

### Steps to Deploy on Cloudflare:

1. **Create the files on your server/hosting:**
   ```bash
   # Upload these files to your web server at:
   https://bountyfinder.app/.well-known/apple-app-site-association
   https://bountyfinder.app/.well-known/assetlinks.json
   ```

2. **Verify Content-Type Headers:**
   - `apple-app-site-association` should have `Content-Type: application/json`
   - `assetlinks.json` should have `Content-Type: application/json`

3. **Configure Cloudflare (if using Cloudflare Pages or Workers):**

   **Option A: Cloudflare Pages**
   - Create a `public/.well-known/` directory in your Pages project
   - Copy these files there
   - Deploy to Cloudflare Pages

   **Option B: Cloudflare Workers**
   ```javascript
   addEventListener('fetch', event => {
     event.respondWith(handleRequest(event.request))
   })

   async function handleRequest(request) {
     const url = new URL(request.url)
     
     if (url.pathname === '/.well-known/apple-app-site-association') {
       return new Response(APPLE_ASSOCIATION, {
         headers: {
           'Content-Type': 'application/json',
           'Access-Control-Allow-Origin': '*'
         }
       })
     }
     
     if (url.pathname === '/.well-known/assetlinks.json') {
       return new Response(ASSET_LINKS, {
         headers: {
           'Content-Type': 'application/json',
           'Access-Control-Allow-Origin': '*'
         }
       })
     }
     
     // Handle other routes or proxy to your main site
     return fetch(request)
   }

   const APPLE_ASSOCIATION = `{...}` // Content from apple-app-site-association
   const ASSET_LINKS = `[...]` // Content from assetlinks.json
   ```

   **Option C: Traditional Web Server**
   - Upload to your web root's `.well-known/` directory
   - Ensure your web server (nginx, Apache, etc.) serves these files correctly

4. **Verify Deployment:**
   ```bash
   # Test iOS file
   curl -I https://bountyfinder.app/.well-known/apple-app-site-association
   
   # Test Android file
   curl -I https://bountyfinder.app/.well-known/assetlinks.json
   ```

   Both should return:
   - HTTP 200 status
   - `Content-Type: application/json`
   - The file content in the response body

## Testing Universal Links

### iOS Testing:
1. Install the app on a physical device (Universal Links don't work in Simulator)
2. Open Notes app and paste: `https://bountyfinder.app/auth/callback?token=test`
3. Long press the link → Should show "Open in BOUNTY" option
4. Tap it → Should open the app instead of Safari

### Android Testing:
1. Install the app on a physical device or emulator
2. Send yourself a text/email with: `https://bountyfinder.app/auth/callback?token=test`
3. Tap the link → Should show app chooser with BOUNTY option
4. Select BOUNTY → Should open the app instead of Chrome

## Troubleshooting

### iOS Issues:
- **Link opens in Safari:** Ensure Apple Team ID is correct in apple-app-site-association
- **File not found:** Check that the file is accessible at the root domain without extension
- **Not working after install:** Wait 24 hours or reinstall the app (iOS caches these files)

### Android Issues:
- **Link opens in Chrome:** Verify SHA-256 fingerprints match your actual app certificate
- **Package name mismatch:** Ensure `app.bountyfinder.BOUNTYExpo` matches your app's package name
- **Not working:** Run `adb shell pm get-app-links app.bountyfinder.BOUNTYExpo` to check verification status

## Security Notes
- These files are public and safe to commit to version control
- They don't contain any secrets or API keys
- They simply tell mobile OS which URLs your app can handle
- SHA-256 fingerprints are public identifiers, not private keys

## Next Steps
After deploying these files:
1. Update Supabase email redirect URL to: `https://bountyfinder.app/auth/callback`
2. Test the email confirmation flow
3. Monitor for any deep linking issues

## References
- [iOS Universal Links Documentation](https://developer.apple.com/ios/universal-links/)
- [Android App Links Documentation](https://developer.android.com/training/app-links)
- [Expo Linking Documentation](https://docs.expo.dev/guides/linking/)
