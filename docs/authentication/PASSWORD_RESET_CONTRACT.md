# Password Reset — Client ⇄ Supabase Contract

Authoritative description of how Bounty's password-recovery flow works, verified
empirically against live Supabase projects on 2026-08-18. Supersedes the
architecture sections of `FORGOT_PASSWORD_SETUP.md` and
`RESET_PASSWORD_FLOW_FIX.md`, both of which describe a redirect contract the
client did not actually implement.

Everything below marked **verified** was observed directly, not inferred:
production project `xwlwqzzphmmhghiqvkeu` was probed read-only, and a full
create → reset → sign-in → replay cycle was run end-to-end against development
project `ajsbkocnixpwbrjokvnq` with a throwaway account.

---

## 1. The contract

### Request

`lib/services/auth-service.ts → requestPasswordReset(email)` calls

```ts
supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo })
```

`redirectTo` comes from `lib/auth/auth-redirect.ts → getAuthCallbackUrl()`:

| Platform | Value |
|---|---|
| iOS / Android | `bountyexpo-workspace://auth/callback` |
| Web | `<window.location.origin>/auth/callback` |
| Any, overridden | `EXPO_PUBLIC_AUTH_REDIRECT_URL` (only if allowlisted) |

Any caller-supplied or env-supplied redirect is validated by
`isAllowedAuthRedirect()` and silently replaced by the default if it fails.

### Email → link

Supabase mails `{{ .ConfirmationURL }}`, which is

```
https://<project>.supabase.co/auth/v1/verify
  ?token=<hashed-otp>&type=recovery&redirect_to=<redirectTo>
```

### Verify → redirect  **(verified)**

`GET` on that URL answers **303 See Other**. Credentials and errors both land in
the **fragment**, never the query string:

```
# success
Location: bountyexpo-workspace://auth/callback
          #access_token=<jwt>&expires_at=1787074924&expires_in=3600
          &refresh_token=<token>&sb=&token_type=bearer&type=recovery

# expired, already used, or malformed
Location: bountyexpo-workspace://auth/callback
          #error=access_denied&error_code=otp_expired
          &error_description=Email+link+is+invalid+or+has+expired&sb=
```

The client runs auth-js's **default `implicit` flow** (`lib/supabase.ts` sets no
`flowType`), so this is the shape to expect. `?code=` (PKCE) is also handled
defensively but is not currently produced.

### Redirect allowlist  **(verified, production)**

| `redirect_to` requested | Result |
|---|---|
| `bountyexpo-workspace://auth/callback` | accepted |
| `bountyexpo-workspace://auth` | accepted (this is the Site URL) |
| `https://bountyfinder.app/auth/callback` | accepted |
| `bountyexpo://auth/callback` | **rejected** — stale scheme |
| `https://evil.example.com/steal` | **rejected** |

A rejected `redirect_to` does **not** produce an error. Supabase silently
substitutes the Site URL, which in production is `bountyexpo-workspace://auth`.
That is why `redirectTo` is validated client-side before it is sent: a bad value
fails invisibly rather than loudly.

### Client-side handling

1. `app/auth/callback.tsx` (also rendered by `app/auth/index.tsx`, so the Site-URL
   fallback path behaves identically) reads the **raw** incoming URL through
   `lib/auth/use-incoming-auth-url.ts`, which wraps
   `Linking.getInitialURL()` + the `url` event.
2. `lib/auth/recovery-link.ts → parseAuthLink()` parses query **and** fragment
   into exactly one outcome: `tokens` / `token_hash` / `code` / `error` / `none`.
3. `lib/auth/consume-auth-link.ts → consumeAuthLink()` exchanges it for a session
   (`setSession` / `verifyOtp` / `exchangeCodeForSession`) and reports
   `established`, `already_established`, `expired`, `invalid`, `failed`, or `none`.
4. On success the screen calls `beginPasswordRecovery()` and
   `router.replace('/auth/update-password')`.
5. `app/auth/update-password.tsx` confirms a live session via
   `supabase.auth.getSession()`, then calls
   `updatePassword() → supabase.auth.updateUser({ password })`.
6. On success it calls `endPasswordRecovery()` +
   `resetConsumedRecoveryLink()` and routes to `ROUTES.ROOT`, which finds the
   still-valid session and enters the app.

### Which auth event fires

**`PASSWORD_RECOVERY` never fires in this client.** auth-js only emits it from
`_getSessionFromURL`, gated on `isBrowser() && detectSessionInUrl`, and
`lib/supabase.ts` sets `detectSessionInUrl: false`. `setSession()` and
`verifyOtp()` emit plain **`SIGNED_IN`**.

Recovery mode is therefore signalled explicitly through
`beginPasswordRecovery()` / `endPasswordRecovery()` on the auth context. This is
**in-memory only and deliberately not persisted** — restarting the app must not
resume a recovery flow. The `PASSWORD_RECOVERY` branch in
`providers/auth-provider.tsx` is retained only so the flag still works if
`detectSessionInUrl` is ever enabled for web.

---

## 2. Why the native path cannot use router params

On native, expo-router's `extractExactPathFromURL`
(`node_modules/expo-router/build/fork/extractPathFromURL.js`) rebuilds an
incoming link as `host + pathname + search` and **discards the fragment**. Since
Supabase puts the credentials in the fragment, `useLocalSearchParams()` is
structurally incapable of carrying them on iOS/Android.

On web the fragment survives and expo-router exposes it as the reserved `'#'`
search param, which `parseAuthLink` also understands.

**Do not "simplify" the callback screen to read `useLocalSearchParams()` alone —
that is the exact bug this flow shipped with.**

---

## 3. Behaviour matrix

| Situation | Result |
|---|---|
| Valid link, cold start | Session established, → update-password |
| Valid link, app running / resumed | Same, via the `url` event |
| Same link tapped twice | Second tap forwards, does not error (session from the first still held) |
| Expired link (>1h) | "Reset Link Expired" + request-new-link + back-to-sign-in |
| Already-used link | Same as expired — Supabase reports both as `otp_expired` |
| Malformed / truncated link | "Reset Link Invalid" + same escape hatches |
| Network failure mid-verify | "Something Went Wrong" + **Try Again** |
| No link at all | "Reset Link Invalid" |
| Link lands on `/auth` (Site-URL fallback) | Handled identically |
| Session lapsed before submit | Falls back to invalid-link screen with a fresh-reset action |
| Double-tap on Update Password | One `updateUser` call |
| App restart after a completed reset | Normal signed-in state; recovery does **not** resume |

Supabase's raw `error_description` is never shown to users.

---

## 4. Environment configuration

### Production (`xwlwqzzphmmhghiqvkeu`) — required

| Setting | Value | Status |
|---|---|---|
| Site URL | `bountyexpo-workspace://auth` | already set |
| Redirect URLs | must include `bountyexpo-workspace://auth/callback` | already allowlisted |
| Redirect URLs | remove `bountyexpo://…` if present | stale scheme, already rejected |
| `EXPO_PUBLIC_AUTH_REDIRECT_URL` | **leave unset** | falls back to native scheme |
| Custom SMTP | **needs verifying** | see risk below |

### To restore the desktop/web path

`docs/auth/callback/index.html` is a complete, correct web fallback — it reads
the fragment and can either finish the reset in-browser or hand off to
`bountyexpo-workspace://auth/callback` with the fragment attached. It is simply
not being served.

`https://bountyfinder.app` currently terminates **no TLS** (handshake fails from
multiple independent clients) and plain HTTP 301s to `https://bountyfinder.crd.co`
— a Carrd landing page. Consequences:

- the reset link cannot load in a desktop browser;
- iOS cannot fetch `/.well-known/apple-app-site-association`, so universal links
  are not associated;
- Android cannot fetch `/.well-known/assetlinks.json`, so `autoVerify` App Links
  do not verify.

To fix, in order:

1. Serve `docs/auth/` at `https://bountyfinder.app/auth/` (GitHub Pages + a
   `CNAME`, or any host) with a valid certificate for the apex.
2. Publish `/.well-known/apple-app-site-association`
   (`appID: <TEAMID>.com.bounty.BOUNTYExpo`, paths `/auth/*`) and
   `/.well-known/assetlinks.json` for `app.bountyfinder.BOUNTYExpo`.
3. Only then set `EXPO_PUBLIC_AUTH_REDIRECT_URL=https://bountyfinder.app/auth/callback`
   for production and rebuild/republish.

Until step 3, mobile works via the custom scheme and desktop does not.

### Development (`ajsbkocnixpwbrjokvnq`) / staging (`gwumwpoomwvkjyibdmpj`)

Same Site URL and allowlist as production (verified for dev). No override needed.

---

## 5. Tests

| File | Covers |
|---|---|
| `__tests__/unit/auth/recovery-link.test.ts` | URL/fragment parsing, error mapping, redaction, prototype-pollution and duplicate-key hardening |
| `__tests__/unit/auth/auth-redirect.test.ts` | Redirect allowlist, open-redirect rejection, platform defaults |
| `__tests__/unit/auth/consume-auth-link.test.ts` | Session establishment per link kind, single-use / repeat-tap semantics, error classification |
| `__tests__/integration/password-recovery-lifecycle.test.tsx` | Cold start, warm start, resume, twice-tapped link, expired/invalid/malformed, `/auth` fallback, update-password gating, duplicate submit, no-credential-logging |
| `__tests__/unit/services/auth-service.test.ts` | Request validation, enumeration safety, redirect defaults and overrides, no email in logs |

Lifecycle tests deliver links the way the OS does (raw URL via mocked
`expo-linking`), not via router params — a params-only test would pass against
the broken implementation.

---

## 6. Known risks

- **SMTP**: the dev project hit `over_email_send_rate_limit` after a handful of
  requests, i.e. it uses Supabase's built-in mailer. If production does too,
  real reset emails will be throttled. Confirm a custom SMTP provider is
  configured for production.
- **Enumeration, Low**: `POST /auth/v1/recover` returns `200 {}` instantly for an
  unregistered address but `429 over_email_send_rate_limit` for a registered one
  once the project's send limit is saturated. The client maps 429 to a generic
  "too many requests" message, but the two paths remain distinguishable. This is
  Supabase-side behaviour; masking it client-side would hide genuine send
  failures from legitimate users. Best addressed by configuring adequate SMTP
  capacity.
- **`isInRecoveryMode()`** in `auth-service.ts` reads `session.user.amr`, which
  auth-js does not populate (`amr` is a JWT claim). It always returns `false`.
  Nothing in the app calls it; left in place rather than churned, but it should
  not be adopted.
