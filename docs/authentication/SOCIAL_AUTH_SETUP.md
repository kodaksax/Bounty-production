# Social Auth Setup (Google & Apple)

This is a quick, practical guide to wiring up **Sign in with Google** and **Sign in with Apple** for BOUNTYExpo. The mobile code is already implemented — you just need to provision provider credentials, set environment variables, and (for production) maintain **separate provider projects per deployment tier**.

> **Where the code lives**
> - Google + Apple buttons & Supabase token exchange: [`app/auth/sign-in-form.tsx`](../../app/auth/sign-in-form.tsx)
> - Android Apple flow (web fallback): [`components/social-auth-controls/AppleSignInButton.tsx`](../../components/social-auth-controls/AppleSignInButton.tsx)
> - Supabase client: [`lib/supabase.ts`](../../lib/supabase.ts)

---

## TL;DR — Required environment variables

Add these to your `.env` (and to EAS / CI secrets per environment):

```bash
# Supabase (already in use)
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...

# Google OAuth — one client ID per platform, per environment
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...apps.googleusercontent.com

# Apple (only needed for Android Apple Sign-In; iOS uses native)
EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID=app.bountyfinder.signin
EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI=https://<your-supabase-project>.supabase.co/auth/v1/callback
```

The sign-in form auto-disables the Google button when none of the three Google client IDs are set, so a missing value is non-fatal but the button will read **“Google setup required.”**

---

## App identifiers used by the providers

These come from [`app.json`](../../app.json) and must match what you register with Google/Apple:

| Field | Value |
|---|---|
| iOS bundle ID | `com.bounty.BOUNTYExpo` |
| Android package | `app.bountyfinder.BOUNTYExpo` |
| Custom URL scheme | `bountyexpo-workspace` |
| Universal link domain | `bountyfinder.app` |
| OAuth callback path | `/auth/callback` |

Resulting redirect URIs the app may use:

```
bountyexpo-workspace://auth/callback
com.bounty.BOUNTYExpo://auth/callback
app.bountyfinder.BOUNTYExpo://auth/callback
https://bountyfinder.app/auth/callback
http://localhost:19006/auth/callback   # local web dev only
exp://localhost:8081                    # Expo Go local dev
exp://127.0.0.1:8081                    # Expo Go local dev
```

> Google **rejects** wildcards (`exp://*/...`, `exp://192.168.*.*`). Add only exact URIs. See [`GOOGLE_OAUTH_REDIRECT_URI_FIX.md`](./GOOGLE_OAUTH_REDIRECT_URI_FIX.md).

---

## One Google project per environment ⚠️

Per [Google’s OAuth policy](https://support.google.com/cloud/answer/13464327), a **production** OAuth app must be a separate Cloud project from development, staging, or testing. A project counts as "production" unless **all** of these are true:

- It’s for personal use only (≤ 100 known users).
- It’s not used for development, testing, or staging.
- It’s not restricted to your Workspace/Cloud Identity organization.

Now that the repo has multiple branches (e.g. `main`, `staging`, feature branches deploying to TestFlight / internal tracks), create one Google Cloud project per tier:

| Branch / Tier | Google Cloud project | OAuth client IDs (iOS / Android / Web) | Apple Service ID |
|---|---|---|---|
| `main` → Production | `bountyexpo-prod` | `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` (prod) | `app.bountyfinder.signin` |
| `staging` → TestFlight / Internal | `bountyexpo-staging` | `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` (staging) | `app.bountyfinder.signin.staging` |
| Feature branches / local | `bountyexpo-dev` | `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` (dev) | `app.bountyfinder.signin.dev` |

Each project has its **own** consent screen, branding, and redirect-URI allow list. Ship the right values per environment via `.env.<tier>` files or EAS secrets — never reuse production credentials for testing.

The same separation should be mirrored in **Supabase**: use one Supabase project per tier and configure the matching Google + Apple providers in each.

---

## Google — step-by-step (per environment)

1. Open the [Google Cloud Console](https://console.developers.google.com/) and create/select the project for this tier (e.g. `bountyexpo-prod`).
2. **APIs & Services → OAuth consent screen**
   - User type: **External**.
   - App name, support email, logo, privacy policy (`https://bountyfinder.app/privacy.html`), terms.
   - Scopes: `openid`, `email`, `profile`.
   - For production, submit for verification when ready.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, create three clients:

   **iOS client**
   - Application type: **iOS**
   - Bundle ID: `com.bounty.BOUNTYExpo`
   - → copy into `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`

   **Android client**
   - Application type: **Android**
   - Package name: `app.bountyfinder.BOUNTYExpo`
   - SHA-1 fingerprint: from `eas credentials` (or `keytool -list`) for the keystore used by this tier’s build.
   - → copy into `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`

   **Web client** (used by `expo-auth-session` + Supabase)
   - Application type: **Web application**
   - Authorized redirect URIs — add the ones you actually use for this tier:
     ```
     https://bountyfinder.app/auth/callback
     bountyexpo-workspace://auth/callback
     com.bounty.BOUNTYExpo://auth/callback
     app.bountyfinder.BOUNTYExpo://auth/callback
     https://<your-supabase-project>.supabase.co/auth/v1/callback
     http://localhost:19006/auth/callback   # dev only
     exp://localhost:8081                    # dev only
     exp://127.0.0.1:8081                    # dev only
     ```
   - → copy into `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
4. **Supabase → Authentication → Providers → Google**
   - Enable.
   - Paste the **Web** client ID and client secret from this same Google project.
   - Save. Supabase exposes the callback as `https://<project>.supabase.co/auth/v1/callback` — it must be in the Google client’s allow list (above).

---

## Apple — step-by-step

iOS uses the native `expo-apple-authentication` flow (no web redirect). Android uses `@invertase/react-native-apple-authentication`, which requires an Apple **Service ID** + return URL.

1. [Apple Developer → Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list).
2. **App ID** for `com.bounty.BOUNTYExpo` — enable **Sign In with Apple** capability.
3. **Service ID** (one per tier, e.g. `app.bountyfinder.signin`, `…signin.staging`):
   - Enable **Sign In with Apple** → Configure.
   - Primary App ID: `com.bounty.BOUNTYExpo`.
   - Domains: `<your-supabase-project>.supabase.co`, `bountyfinder.app`.
   - Return URLs: `https://<your-supabase-project>.supabase.co/auth/v1/callback`.
4. **Key** → Create a new key with **Sign In with Apple** enabled. Download the `.p8` (one-time). Note the **Key ID** and your **Team ID**.
5. **Supabase → Authentication → Providers → Apple**
   - Enable.
   - Services ID = your Service ID (e.g. `app.bountyfinder.signin`).
   - Team ID, Key ID, and the contents of the `.p8` private key.
   - Authorized client IDs: include the iOS bundle ID `com.bounty.BOUNTYExpo` so iOS native id_tokens are accepted.
6. **Xcode (iOS)** — make sure `expo-apple-authentication` adds the **Sign In with Apple** entitlement. EAS Build does this automatically when the plugin is in `app.json`. No env var needed for iOS.
7. **Android** — set the env vars consumed by [`AppleSignInButton.tsx`](../../components/social-auth-controls/AppleSignInButton.tsx):
   ```bash
   EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID=app.bountyfinder.signin
   EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI=https://<your-supabase-project>.supabase.co/auth/v1/callback
   ```
   The redirect URI here only has to **match** what you registered on the Service ID — Apple posts to it but the app intercepts the response, so the URL doesn’t need a real backend handler.

---

## Per-branch / multi-environment workflow

Suggested layout:

```
.env.development      # bountyexpo-dev Google project + dev Supabase + dev Apple Service ID
.env.staging          # bountyexpo-staging + staging Supabase + staging Apple Service ID
.env.production       # bountyexpo-prod + prod Supabase + prod Apple Service ID
```

- Local: copy the file you want into `.env`, or use `direnv`/`dotenv-cli`.
- EAS Build: store each set as **EAS Secrets** scoped to the matching build profile in `eas.json`.
- CI: inject the right secret set based on the branch (`main` → production, `staging` → staging, others → development).

Never check real client IDs/secrets into git. The placeholders in `app/auth/sign-in-form.tsx` are intentionally fake so the app can boot without OAuth configured.

---

## Verification checklist

- [ ] `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` set for the current tier — Google button shows **“Continue with Google”** (not “Google setup required”).
- [ ] Google web client’s redirect URIs contain the Supabase callback **and** the scheme(s) used by your build.
- [ ] Supabase Google provider is enabled with the matching web client ID + secret.
- [ ] Apple Service ID has the Supabase callback as a Return URL; Supabase Apple provider has Service ID, Team ID, Key ID, `.p8` key.
- [ ] iOS bundle ID `com.bounty.BOUNTYExpo` listed in Supabase Apple **Authorized Client IDs**.
- [ ] Android: `EXPO_PUBLIC_APPLE_AUTH_SERVICE_ID` and `EXPO_PUBLIC_APPLE_AUTH_REDIRECT_URI` set.
- [ ] Tested on a real device for **each** tier — Expo Go uses dynamic `exp://` URIs that must be added to the Google client allow list.

---

## Troubleshooting

- **`Error 400: invalid_request` / redirect URI mismatch** → see [`GOOGLE_OAUTH_REDIRECT_URI_FIX.md`](./GOOGLE_OAUTH_REDIRECT_URI_FIX.md).
- **Google button reads “Google setup required”** → none of the three `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` env vars are set for the current build.
- **Apple sign-in returns no `identityToken`** → on iOS confirm the Sign In with Apple capability/entitlement is present; on Android confirm the Service ID and return URL env vars match the Apple Developer registration.
- **Supabase responds “Unverified client / invalid token”** → the iOS bundle ID isn’t in Supabase’s Apple Authorized Client IDs, or the Google web client used in Supabase is from a different Cloud project than the one that issued the id_token.
- **Works in dev but fails in TestFlight/Play** → you’re using dev credentials in a production build, or the production Google project doesn’t have the production redirect URIs / SHA-1 fingerprints. Re-check the per-tier table above.

For deeper auth issues see [`AUTH_TROUBLESHOOTING.md`](./AUTH_TROUBLESHOOTING.md).
