# Google OAuth Redirect URI Configuration - Quick Fix Guide

**Problem**: Google Sign-in fails with "Error 400: invalid_request" due to redirect URI mismatch.

**Root Cause**: Google OAuth requires exact URI matches. Wildcard URIs and dynamic IPs are rejected.

---

## What URIs Did Google Accept?

Based on your configuration, Google Cloud Console accepted these URIs:

✅ **Accepted URIs**:
```
bountyexpo-workspace://auth/callback
com.bounty.BOUNTYExpo://auth/callback  
app.bountyfinder.BOUNTYExpo://auth/callback
exp://localhost:8081
exp://127.0.0.1:8081
http://localhost:19006/auth/callback
https://bountyfinder.app/auth/callback
```

❌ **Rejected URIs** (Google will NOT accept these):
```
exp://192.168.0.0/--/auth/callback  (wildcard patterns)
exp://*/auth/callback               (wildcard schemes)
Any URI with * or wildcard patterns
```

---

## Current Status

**Your Configuration**: ✅ Mostly Working

The URIs you have configured will work for:
- ✅ Production (https://bountyfinder.app)
- ✅ iOS with custom scheme (bountyexpo-workspace://)
- ✅ Android with custom scheme
- ✅ Local development on localhost (exp://localhost:8081)
- ✅ Local development on 127.0.0.1 (exp://127.0.0.1:8081)

**What's NOT Working**: ❌ Local Development on LAN IP

When you run Expo on your local network (WiFi), it uses your LAN IP address like `192.168.0.59`. 
Google rejected the wildcard pattern, so you can't add a single URI that covers all possible IPs.

---

## Solutions for LAN IP Issue

### Solution 1: Test on Localhost (Immediate)

**When to use**: Quick testing on your local machine

```bash
# 1. Start Expo
npx expo start

# 2. Press 'w' to open in web browser
# OR
# 3. Scan QR with Expo Go and use localhost tunnel
```

**Why it works**: Uses `exp://localhost:8081` which is already configured.

---

### Solution 2: Add Your Current IP (Quick Fix)

**When to use**: Need to test on physical device on same WiFi

1. **Check your current redirect URI**:
   - Start the app
   - Try Google Sign-in
   - Check console logs for the exact URI
   - Example: `exp://192.168.0.59:8081`

2. **Add to Google Cloud Console**:
   - Go to https://console.cloud.google.com
   - APIs & Services → Credentials
   - Click your OAuth Client ID
   - Add the exact URI from step 1
   - Click "Save"

3. **Rebuild app**:
   ```bash
   npx expo start --clear
   ```

**Limitation**: Need to repeat when your IP changes (new WiFi network, router restart, etc.)

---

### Solution 3: Use Expo Auth Proxy (Recommended)

**When to use**: Permanent fix for all scenarios

Expo provides a proxy service that gives you a consistent HTTPS URL.

1. **Update sign-in-form.tsx**:
   ```typescript
   const redirectUri = useMemo(() => 
     makeRedirectUri({
       useProxy: true,  // ← Add this
       scheme: 'bountyexpo-workspace'
     }), []
   )
   ```

2. **Get your Expo URL**:
   ```bash
   # Check your Expo username
   npx expo whoami
   
   # Your URL will be:
   # https://auth.expo.io/@YOUR-USERNAME/BOUNTYExpo
   ```

3. **Add to Google Cloud Console**:
   ```
   https://auth.expo.io/@your-username/BOUNTYExpo
   ```

4. **Rebuild and test**:
   ```bash
   npx expo start --clear
   ```

**Benefits**:
- ✅ Works on any network
- ✅ Works on any device
- ✅ No configuration changes needed when IP changes
- ✅ More secure (HTTPS)

**Note**: Requires Expo account (free). Create at https://expo.dev

---

### Solution 4: Use ngrok (Alternative)

**When to use**: Want HTTPS tunnel without Expo account

1. **Install ngrok**:
   ```bash
   npm install -g ngrok
   ```

2. **Start Expo**:
   ```bash
   npx expo start
   # Note the port (usually 8081)
   ```

3. **Start ngrok in another terminal**:
   ```bash
   ngrok http 8081
   ```

4. **Copy the HTTPS URL**:
   ```
   Forwarding: https://abc123def456.ngrok.io -> localhost:8081
                      ↑ Copy this URL
   ```

5. **Add to Google Cloud Console**:
   ```
   https://abc123def456.ngrok.io/auth/callback
   ```

6. **Update code temporarily**:
   ```typescript
   const redirectUri = 'https://abc123def456.ngrok.io/auth/callback'
   ```

**Limitation**: ngrok URL changes each time you restart it (unless you pay for static URLs)

---

## Recommended Approach

**For Development**: Use Solution 3 (Expo Auth Proxy)
- Set up once, works everywhere
- No maintenance needed

**For Production**: Current configuration is already correct
- Uses `https://bountyfinder.app/auth/callback`
- Will work when app is published

---

## Testing Checklist

After applying any solution:

1. **Clear cache**:
   ```bash
   npx expo start --clear
   ```

2. **Check console for redirect URI**:
   - Look for log: `[Google Auth] Redirect URI: ...`
   - Verify it matches one in Google Cloud Console

3. **Test sign-in**:
   - Tap "Continue with Google"
   - Should open Google sign-in page
   - After signing in, should redirect back to app
   - Check for success or error

4. **If still failing**:
   - Copy exact error message
   - Copy exact redirect URI from logs
   - Verify URI is in Google Cloud Console (check for typos)

---

## Current Working Configuration

Based on your setup, this is what should work right now:

**On iOS Device (via USB)**:
```
URI: bountyexpo-workspace://auth/callback
Status: ✅ Should work
```

**On Android Device (via USB)**:
```
URI: com.bounty.BOUNTYExpo://auth/callback
Status: ✅ Should work
```

**On iOS Simulator**:
```
URI: exp://localhost:8081 or bountyexpo-workspace://auth/callback
Status: ✅ Should work
```

**On Android Emulator**:
```
URI: exp://127.0.0.1:8081 or app.bountyfinder.BOUNTYExpo://auth/callback
Status: ✅ Should work
```

**On Physical Device via WiFi** (e.g., 192.168.0.59):
```
URI: exp://192.168.0.59:8081
Status: ❌ Will fail (not in Google Console)
Fix: Use Solution 2 or 3 above
```

---

## Quick Commands

```bash
# See your current IP and redirect URI
npx expo start
# Look for: "[Google Auth] Redirect URI: ..."

# Clear cache and restart
npx expo start --clear

# Check Expo username (for auth proxy)
npx expo whoami

# Install ngrok (if choosing that option)
npm install -g ngrok

# Start ngrok tunnel
ngrok http 8081
```

---

## Summary

**Your Google OAuth is configured correctly** for most scenarios. The only issue is dynamic LAN IP addresses, which Google doesn't support with wildcards.

**Immediate action**: Use Solution 3 (Expo Auth Proxy) for the best developer experience, or Solution 2 (add current IP) for a quick fix.

**No code changes needed** if you use Solution 2. Solution 3 requires one line change in sign-in-form.tsx.

---

**Document Version**: 1.0  
**Created**: 2026-02-10  
**For**: Google OAuth redirect URI configuration issues
