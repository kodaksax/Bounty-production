# Authentication Troubleshooting Guide

Based on the errors encountered, here are the specific configuration issues and how to fix them.

---

## Error 1: Apple Sign-in - "Provider not enabled"

**Error Message**: `Provider (issuer "https://appleid.apple.com") is not enabled`

### Root Cause
Apple authentication is not enabled in your Supabase project settings.

### Fix Steps

1. **Go to Supabase Dashboard**
   - Navigate to https://supabase.com/dashboard
   - Select your project

2. **Enable Apple Provider**
   - Go to Authentication → Providers
   - Find "Apple" in the list
   - Toggle it to **Enabled**

3. **Configure Apple Provider** (Required fields)
   ```
   Service ID: com.bountyexpo.service
   Secret Key: [Your Apple Sign In Key .p8 file content]
   Key ID: [10-character Key ID from Apple Developer Portal]
   Team ID: [Your Apple Team ID from Apple Developer Portal]
   ```

4. **Get Required Credentials from Apple**

   **Service ID** (already created based on your env):
   - Go to https://developer.apple.com/account
   - Certificates, Identifiers & Profiles → Identifiers
   - Find: `com.bountyexpo.service`
   - Verify it has Sign In with Apple enabled

   **Secret Key (.p8 file)**:
   - Go to Keys → Create new key (or use existing)
   - Enable "Sign In with Apple"
   - Download the .p8 file
   - Copy its contents for Supabase

   **Key ID**:
   - Found in the Keys section
   - 10-character identifier (e.g., ABC123DEFG)

   **Team ID**:
   - Found in Apple Developer account membership details
   - 10-character identifier (e.g., XYZ987UVWX)

5. **Save Configuration**
   - Click "Save" in Supabase
   - Test the configuration

### Verification
After configuration, the error should change from "not enabled" to either success or a different error about credentials.

---

## Error 2: Google Sign-in - "invalid_request" / Redirect URI Mismatch

**Error Message**: `Error 400: invalid_request` with `redirect_uri=exp://192.168.0.59:8081`

### Root Cause
The OAuth redirect URI being used by Expo doesn't match what's configured in Google Cloud Console.

### Understanding the Issue

When using Expo in development:
- Expo generates dynamic redirect URIs like `exp://192.168.0.59:8081`
- Your local IP address (192.168.0.59) changes
- Port (8081) is dynamic
- Google OAuth requires exact URI matches

### Fix Option 1: Use Custom Scheme (Recommended for Development)

**IMPORTANT**: Google Cloud Console rejects certain URI formats. Follow this exactly.

1. **The app already uses custom scheme**: `bountyexpo-workspace` (configured in app.json)

2. **Add Redirect URIs to Google Cloud Console**
   - Go to https://console.cloud.google.com
   - Select your project
   - APIs & Services → Credentials
   - Click on your OAuth 2.0 Client ID (Web application)
   
3. **Add ONLY These URIs** (Google will reject wildcards):
   ```
   bountyexpo-workspace://auth/callback
   com.bounty.BOUNTYExpo://auth/callback
   app.bountyfinder.BOUNTYExpo://auth/callback
   exp://localhost:8081
   exp://127.0.0.1:8081
   http://localhost:19006/auth/callback
   https://bountyfinder.app/auth/callback
   ```

4. **⚠️ URIs That Google WILL REJECT**:
   ```
   ❌ exp://192.168.0.0/--/auth/callback  (wildcard IPs)
   ❌ exp://*/auth/callback               (wildcards)
   ❌ Any URI with wildcards or patterns
   ```

5. **For Development with Changing IPs**:
   
   Your IP address (192.168.0.59) changes? You have two options:
   
   **Option A: Add Current IP Manually** (Quick fix)
   - Check console log for current redirect URI
   - Example: `exp://192.168.0.59:8081`
   - Add this exact URI to Google Cloud Console
   - Repeat when IP changes
   
   **Option B: Use Expo Auth Proxy** (Permanent fix)
   - Update sign-in-form.tsx:
     ```typescript
     const redirectUri = useMemo(() => 
       makeRedirectUri({
         useProxy: true,  // Add this line
         scheme: 'bountyexpo-workspace'
       }), []
     )
     ```
   - Add to Google Console: `https://auth.expo.io/@your-username/BOUNTYExpo`
   - Replace `your-username` with your Expo username

6. **Current Configuration Status**:
   Based on your saved URIs, you should have:
   - ✅ Custom scheme URIs (bountyexpo-workspace, bundle IDs)
   - ✅ Localhost URIs (exp://localhost, exp://127.0.0.1)
   - ✅ Production HTTPS URI
   - ❌ Dynamic IP support (not possible with Google restrictions)

### Fix Option 2: Use ngrok for Consistent URLs

1. **Install ngrok**:
   ```bash
   npm install -g ngrok
   ```

2. **Start Expo and get the port**:
   ```bash
   npx expo start
   # Note the port (usually 8081)
   ```

3. **Start ngrok tunnel**:
   ```bash
   ngrok http 8081
   ```

4. **Add ngrok URL to Google OAuth**:
   - Copy the https URL from ngrok (e.g., `https://abc123.ngrok.io`)
   - Add to Google Cloud Console redirect URIs:
     ```
     https://abc123.ngrok.io/oauth
     ```

5. **Use ngrok URL in config**:
   ```typescript
   const redirectUri = 'https://abc123.ngrok.io/oauth'
   ```

### Fix Option 3: Production Configuration (For Published Apps)

1. **Add Production Redirect URIs**:
   ```
   https://bountyfinder.app/auth/callback
   https://auth.expo.io/@your-username/your-app-slug
   ```

2. **Update makeRedirectUri** with useProxy:
   ```typescript
   const redirectUri = useMemo(() => 
     makeRedirectUri({
       useProxy: true,
       native: 'bountyexpo://oauth'
     }), []
   )
   ```

### Current Configuration Check

Based on your environment variables:
```bash
# You likely have:
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=xxx.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=xxx.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=xxx.apps.googleusercontent.com
```

**Verify these in Google Cloud Console**:
1. Each Client ID should exist
2. Each should have appropriate redirect URIs
3. OAuth consent screen should be configured

---

## Error 3: WebSocket - "No auth token available"

**Error Message**: `[WebSocket] No auth token available, cannot connect`

### Root Cause
The app is trying to connect to a WebSocket before authentication is complete or the token isn't being retrieved properly.

### Fix Steps

1. **Check Supabase Session**

   Update your WebSocket connection logic to wait for auth:

   ```typescript
   import { supabase } from 'lib/supabase';

   async function connectWebSocket() {
     // Wait for session
     const { data: { session } } = await supabase.auth.getSession();
     
     if (!session?.access_token) {
       console.log('[WebSocket] Waiting for authentication...');
       return;
     }

     // Connect with token
     const ws = new WebSocket('wss://your-ws-url', {
       headers: {
         'Authorization': `Bearer ${session.access_token}`
       }
     });
   }
   ```

2. **Add Session Listener**

   Listen for auth state changes:

   ```typescript
   useEffect(() => {
     const { data: { subscription } } = supabase.auth.onAuthStateChange(
       (event, session) => {
         if (event === 'SIGNED_IN' && session) {
           // Now safe to connect WebSocket
           connectWebSocket(session.access_token);
         }
         if (event === 'SIGNED_OUT') {
           // Disconnect WebSocket
           disconnectWebSocket();
         }
       }
     );

     return () => {
       subscription.unsubscribe();
     };
   }, []);
   ```

3. **Verify Token Retrieval**

   Add debugging to check token availability:

   ```typescript
   const { data: { session } } = await supabase.auth.getSession();
   console.log('[Auth] Session exists:', !!session);
   console.log('[Auth] Access token exists:', !!session?.access_token);
   console.log('[Auth] Token length:', session?.access_token?.length);
   ```

---

## Quick Checklist

### Before Testing Apple Sign-in
- [ ] Apple provider enabled in Supabase
- [ ] Service ID configured with all required fields
- [ ] Service ID exists in Apple Developer Portal
- [ ] Return URLs match in Apple Developer Portal
- [ ] Environment variables set correctly

### Before Testing Google Sign-in
- [ ] OAuth Client IDs created for each platform
- [ ] Redirect URIs added to Google Cloud Console
- [ ] OAuth consent screen configured
- [ ] Environment variables set with actual client IDs (not placeholders)
- [ ] App scheme configured in app.json

### General
- [ ] Supabase URL and anon key configured
- [ ] App rebuilt after environment changes
- [ ] Clear app cache if needed

---

## Testing Steps

### Test Apple Sign-in

1. **First, test in Supabase directly**:
   - Go to Authentication → Users
   - Click "Invite user"
   - Try signing in with Apple from Supabase dashboard
   - If this works, your Supabase config is correct

2. **Test in app**:
   ```bash
   # Clear cache and rebuild
   npx expo start --clear
   ```
   - Tap "Sign in with Apple"
   - Should see Apple's native sign-in
   - If it fails, check console logs

3. **Check logs**:
   ```typescript
   // Add to AppleSignInButton.tsx
   console.log('[Apple] Starting sign-in...');
   console.log('[Apple] Service ID:', process.env.EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID);
   console.log('[Apple] Redirect URI:', process.env.EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI);
   ```

### Test Google Sign-in

1. **Test redirect URI**:
   ```typescript
   // Add to sign-in-form.tsx
   console.log('[Google] Redirect URI:', redirectUri);
   console.log('[Google] iOS Client ID:', iosGoogleClientId);
   console.log('[Google] Android Client ID:', androidGoogleClientId);
   ```

2. **Verify redirect URI is added to Google**:
   - Copy the logged redirect URI
   - Check it exists in Google Cloud Console
   - Add if missing

3. **Test sign-in**:
   - Tap "Continue with Google"
   - Browser should open with Google sign-in
   - After signing in, should redirect back to app

---

## Common Mistakes

### Apple Sign-in
❌ **Mistake**: Service ID not configured in Apple Developer Portal  
✅ **Fix**: Create and configure Service ID with correct return URLs

❌ **Mistake**: Using bundle ID instead of Service ID  
✅ **Fix**: Use Service ID (e.g., `com.bountyexpo.service`), not bundle ID (e.g., `com.bounty.BOUNTYExpo`)

❌ **Mistake**: Not enabling provider in Supabase  
✅ **Fix**: Enable Apple provider in Supabase Authentication settings

### Google Sign-in
❌ **Mistake**: Using placeholder client IDs  
✅ **Fix**: Create actual OAuth clients in Google Cloud Console

❌ **Mistake**: Redirect URI mismatch  
✅ **Fix**: Add ALL possible redirect URIs (exp://, https://, custom scheme)

❌ **Mistake**: OAuth consent screen not configured  
✅ **Fix**: Configure consent screen in Google Cloud Console

---

## Need More Help?

### Logs to Collect
When asking for help, provide:
1. Console logs from the app
2. Network tab showing the OAuth request
3. Screenshot of Google Cloud Console redirect URIs
4. Screenshot of Supabase Apple provider config

### Useful Commands
```bash
# Clear Expo cache
npx expo start --clear

# View environment variables (be careful not to share secrets!)
npx expo config --type public

# Rebuild with specific platform
npx expo run:ios
npx expo run:android
```

---

## Next Steps After Fixing

Once authentication works:
1. Test profile creation after first sign-in
2. Test sign-out and sign-in again
3. Verify session persistence
4. Test on both iOS and Android
5. Deploy to production with production credentials

---

**Document Version**: 1.0  
**Created**: 2026-02-09  
**Last Updated**: 2026-02-09
