# Domain Migration Guide — bountyfinger.net

> **Last updated:** 2026-04-03  
> **Author:** Engineering / DevOps  
> **Status:** Ready for execution

---

## 1. Summary

### Goal

Migrate the BOUNTY mobile app, API backend, and Supabase Edge Functions from the current `bountyfinder.app` domain to the new public domain **`bountyfinger.net`**.

### Scope

| Component | Old Value | New Value |
|-----------|-----------|-----------|
| App / deep links | `bountyfinder.app` | `app.bountyfinger.net` |
| Staging API | `api-staging.bountyfinder.app` | `api-staging.bountyfinger.net` |
| Production API | `api.bountyfinder.app` (or hosted) | `api.bountyfinger.net` |
| Stripe webhooks | `https://bountyfinder.app/webhooks/stripe` | `https://api.bountyfinger.net/webhooks/stripe` |
| Stripe Connect return/refresh URLs | `https://app.bountyfinder.app/wallet/connect/*` | `https://app.bountyfinger.net/wallet/connect/*` |
| Universal Links / App Links host | `bountyfinder.app` | `app.bountyfinger.net` |
| Supabase auth redirect | `https://bountyfinder.app/auth/callback` | `https://app.bountyfinger.net/auth/callback` |
| Support email | `support@bountyfinder.app` | `support@bountyfinger.net` |
| Beta email | `beta@bountyfinder.app` | `beta@bountyfinger.net` |

### Expected Downtime

**Near-zero** if executed in order. DNS propagation may take up to 24 hours for some ISPs, but Cloudflare proxied records propagate within seconds for Cloudflare-resolving clients.

Recommended: Execute during a low-traffic window (e.g., weeknight 10 PM–2 AM local time).

### Rollback Plan

1. **DNS:** Repoint `app.bountyfinger.net` / `api.bountyfinger.net` CNAME records back to the old origin, or remove them and re-enable the old domain records.
2. **Env vars / secrets:** Revert EAS secrets, Supabase Edge Function secrets, and server `.env` to old URLs. Redeploy.
3. **App builds:** If a new app binary has shipped, push an OTA update via `eas update` reverting `EXPO_PUBLIC_API_URL` and associated domain values.
4. **Stripe:** Revert webhook endpoint URL in Stripe Dashboard.
5. **Supabase Auth:** Revert Site URL and redirect URLs in the Supabase Dashboard.
6. Keep `bountyfinder.app` DNS records **active for at least 90 days** after migration to handle cached deep links.

---

## 2. Preconditions & Access Needed

Before starting, confirm the following access:

| Requirement | Who | Verified? |
|-------------|-----|-----------|
| **Cloudflare** account + zone access for `bountyfinger.net` | Sysadmin | ☐ |
| **Hosting provider** access (the origin server or service that serves the API / .well-known files — e.g., Vercel, Netlify, Cloudflare Pages, AWS ALB, ECS) | Sysadmin / DevOps | ☐ |
| **Stripe Dashboard** access (owner or admin) | Engineering lead | ☐ |
| **Supabase CLI** authenticated with project ref `ajsbkocnixpwbrjokvnq` (owner or admin) | DevOps | ☐ |
| **EAS CLI** authenticated (`eas login`) with project `b5485f88-0b1f-4622-bbed-b1ae142dcb46` | DevOps | ☐ |
| **Apple Developer** account (to update Associated Domains entitlement if using a new domain) | iOS lead | ☐ |
| **Google Play Console** access (to update Digital Asset Links verification) | Android lead | ☐ |

### Tool versions

```bash
# Ensure these are installed
supabase --version   # >= 1.100.0
eas --version        # >= 7.0.0
node --version       # >= 18
```

---

## 3. DNS / Cloudflare Steps

### 3.1 Recommended Hostname Scheme

| Hostname | Purpose | Record Type | Target |
|----------|---------|-------------|--------|
| `app.bountyfinger.net` | Frontend deep links, .well-known hosting, user-facing URL | CNAME | Your hosting provider (e.g., `cname.vercel-dns.com.` or Cloudflare Pages `your-project.pages.dev`) |
| `api.bountyfinger.net` | API server (Fastify / legacy Express) | A or CNAME | Your API server IP or load balancer hostname |
| `api-staging.bountyfinger.net` | Staging API | A or CNAME | Staging server IP or hostname |

### 3.2 Create DNS Records in Cloudflare

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Select the **`bountyfinger.net`** zone.
3. Go to **DNS → Records**.
4. Add the following records:

```
Type: CNAME
Name: app
Target: <your-hosting-provider-cname>   (e.g., cname.vercel-dns.com)
Proxy: ON (orange cloud)
TTL: Auto

Type: CNAME  (or A if pointing to IP)
Name: api
Target: <your-api-server-hostname>      (e.g., my-alb-123.us-east-1.elb.amazonaws.com)
Proxy: ON (orange cloud)
TTL: Auto

Type: CNAME
Name: api-staging
Target: <your-staging-server-hostname>
Proxy: ON (orange cloud)
TTL: Auto
```

5. **(Optional)** Add a root redirect rule if users visit `bountyfinger.net` directly:
   - Go to **Rules → Redirect Rules**.
   - Create rule: `bountyfinger.net/*` → `https://app.bountyfinger.net/$1` (301 permanent).

### 3.3 SSL/TLS Settings

1. Go to **SSL/TLS → Overview**.
2. Set mode to **Full (strict)** (requires a valid cert on origin).
3. Go to **SSL/TLS → Edge Certificates**.
4. Verify that the Universal SSL certificate covers `*.bountyfinger.net` and `bountyfinger.net`.
5. If using Cloudflare Origin CA for your server:
   ```bash
   # Generate origin certificate (in Cloudflare Dashboard → SSL/TLS → Origin Server)
   # Hostnames: *.bountyfinger.net, bountyfinger.net
   # Validity: 15 years (recommended for origin certs)
   ```

### 3.4 Keep Old Domain Active (Redirect)

Set up 301 redirects from the old domain so existing links and cached deep links continue working:

1. In the **`bountyfinder.app`** Cloudflare zone:
   - Add redirect rule: `bountyfinder.app/*` → `https://app.bountyfinger.net/$1` (301).
   - Add redirect rule: `api.bountyfinder.app/*` → `https://api.bountyfinger.net/$1` (301).
   - Add redirect rule: `api-staging.bountyfinder.app/*` → `https://api-staging.bountyfinger.net/$1` (301).

2. Keep these redirects active for **at least 90 days**.

### 3.5 Verify DNS Propagation

```bash
# Check A/CNAME resolution
dig app.bountyfinger.net +short
dig api.bountyfinger.net +short
dig api-staging.bountyfinger.net +short

# Check HTTPS connectivity
curl -I https://app.bountyfinger.net
curl -I https://api.bountyfinger.net/health
```

---

## 4. Hosting / .well-known Files

The `.well-known/apple-app-site-association` and `.well-known/assetlinks.json` files must be accessible at the new domain for Universal Links (iOS) and App Links (Android) to work.

### 4.1 Ensure Files Are Served at New Domain

If using **Cloudflare Workers** (current setup per docs):

1. Update the Worker route to match the new domain:
   - Old: `bountyfinder.app/.well-known/*`
   - New: `app.bountyfinger.net/.well-known/*`

2. Or if hosting on Vercel/Netlify/Cloudflare Pages, ensure the `.well-known/` directory is deployed and served with `Content-Type: application/json`.

### 4.2 Verify

```bash
curl -s https://app.bountyfinger.net/.well-known/apple-app-site-association | jq .
# Expected: JSON with applinks details

curl -s https://app.bountyfinger.net/.well-known/assetlinks.json | jq .
# Expected: JSON with Android app package + SHA256 fingerprints
```

---

## 5. Supabase Configuration

### 5.1 Update Auth Redirect URLs (Dashboard)

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/ajsbkocnixpwbrjokvnq/auth/url-configuration).
2. Update:
   - **Site URL:** `https://app.bountyfinger.net`
   - **Redirect URLs** (add new, keep old temporarily):
     ```
     https://app.bountyfinger.net/auth/callback
     https://app.bountyfinger.net/auth/*
     exp://localhost:8081
     bountyexpo://
     bountyexpo://auth/callback
     ```
3. Keep the old `bountyfinder.app` redirect URLs for 90 days during transition.

### 5.2 Update Edge Function Secrets

The `connect` edge function reads `APP_URL` for Stripe Connect return/refresh URLs:

```bash
# Set APP_URL for the connect edge function
supabase secrets set APP_URL=https://app.bountyfinger.net \
  --project-ref ajsbkocnixpwbrjokvnq

# Verify secrets are set
supabase secrets list --project-ref ajsbkocnixpwbrjokvnq
```

> **Files affected:**
> - `supabase/functions/connect/index.ts` — reads `Deno.env.get('APP_URL')` for `return_url` and `refresh_url` defaults.

### 5.3 Redeploy Edge Functions

After updating secrets, redeploy all edge functions to pick up the new environment:

```bash
# Deploy all functions
supabase functions deploy payments --project-ref ajsbkocnixpwbrjokvnq
supabase functions deploy webhooks --project-ref ajsbkocnixpwbrjokvnq
supabase functions deploy connect --project-ref ajsbkocnixpwbrjokvnq

# Deploy remaining functions (list them all)
for fn in accept-bounty-request admin-review-id apple-pay auth completion \
          process-notification review-id send-expo-push wallet; do
  supabase functions deploy "$fn" --project-ref ajsbkocnixpwbrjokvnq
done
```

### 5.4 Update `supabase/config.toml` (Local Development)

Update the local config to reflect the new redirect URLs for consistency:

```toml
# In [auth] section, update:
site_url = "exp://localhost:8081"
additional_redirect_urls = [
  "exp://localhost:8081",
  "bountyexpo://",
  "bountyexpo://auth/callback",
  "https://app.bountyfinger.net/auth/callback",
  "https://app.bountyfinger.net/auth/*"
]
```

---

## 6. Stripe Configuration

### 6.1 Update Webhook Endpoint

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. Find the existing webhook endpoint (currently pointing to `bountyfinder.app`).
3. **Add a new endpoint** with the new URL:
   ```
   https://api.bountyfinger.net/webhooks/stripe
   ```
4. Subscribe to the same events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `setup_intent.succeeded`
   - `setup_intent.setup_failed`
   - `account.updated` (for Connect)
   - `transfer.created`
   - `payout.paid`
   - `payout.failed`
5. Copy the new **webhook signing secret** (`whsec_...`).
6. Keep the old endpoint active for 2 weeks to catch any in-flight webhooks.
7. After confirming all webhooks land at the new URL, disable the old endpoint.

### 6.2 Update Webhook Secret in All Servers

```bash
# In your API server .env (services/api/.env):
STRIPE_WEBHOOK_SECRET=whsec_NEW_SECRET_HERE

# In legacy server .env (server/.env):
STRIPE_WEBHOOK_SECRET=whsec_NEW_SECRET_HERE

# In Supabase Edge Functions:
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_NEW_SECRET_HERE \
  --project-ref ajsbkocnixpwbrjokvnq
```

> ⚠️ **Never commit webhook secrets to git.** Use environment variables or secret managers.

### 6.3 Update Connect Return/Refresh URLs

The `APP_URL` secret (set in §5.2) controls Stripe Connect onboarding URLs:

- **Return URL:** `https://app.bountyfinger.net/wallet/connect/return`
- **Refresh URL:** `https://app.bountyfinger.net/wallet/connect/refresh`

These are used in:
- `supabase/functions/connect/index.ts` — `createAccountLink()` call (search for `return_url` / `refresh_url`)
- `server/index.js` — Express Stripe Connect route (search for `return_url` / `refresh_url`)
- `services/api/src/config/index.ts` — `app` config key (search for `APP_URL`)

Update `APP_URL` in all server environments:

```bash
# services/api .env
APP_URL=https://app.bountyfinger.net

# server/.env (legacy)
APP_URL=https://app.bountyfinger.net
```

### 6.4 Verify Apple Pay Domain (if applicable)

If Apple Pay is configured with domain verification:

1. Go to [Stripe Dashboard → Settings → Payment methods → Apple Pay](https://dashboard.stripe.com/settings/payments/apple_pay).
2. Add `app.bountyfinger.net` as a verified domain.
3. Download the domain verification file and host it at:
   ```
   https://app.bountyfinger.net/.well-known/apple-developer-merchantid-domain-association
   ```

---

## 7. Expo / EAS Build Configuration

### 7.1 Update `app.json`

Update the following in `app.json`:

```jsonc
{
  "expo": {
    "ios": {
      "associatedDomains": [
        "applinks:app.bountyfinger.net",
        "applinks:*.bountyfinger.net",
        // Keep old domain for transition period:
        "applinks:bountyfinder.app",
        "applinks:*.bountyfinder.app"
      ]
    },
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "https",
              "host": "app.bountyfinger.net",
              "pathPrefix": "/auth"
            }
          ]
        }
      ]
    },
    "extra": {
      "API_BASE_URL": "https://api.bountyfinger.net"
    }
  }
}
```

### 7.2 Update `eas.json` (Preview Profile)

```jsonc
{
  "build": {
    "preview": {
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api-staging.bountyfinger.net"
        // Other env vars remain as EAS secrets
      }
    }
  }
}
```

### 7.3 Update EAS Secrets (Production)

> ⚠️ **Never put production secrets in `eas.json`.** Use EAS secrets CLI.

```bash
# Set production API URL
eas secret:create --scope project \
  --name EXPO_PUBLIC_API_URL \
  --value "https://api.bountyfinger.net" \
  --type string --force

# Set APP_URL for Stripe Connect callbacks
eas secret:create --scope project \
  --name APP_URL \
  --value "https://app.bountyfinger.net" \
  --type string --force

# Verify secrets
eas secret:list
```

### 7.4 Update .env Template Files

Update the example environment files:

```bash
# .env.staging.example
EXPO_PUBLIC_API_URL=https://api-staging.bountyfinger.net

# .env.production.example
EXPO_PUBLIC_API_URL=https://api.bountyfinger.net
APP_URL=https://app.bountyfinger.net
```

### 7.5 Trigger New Builds

```bash
# Preview build (for QA)
eas build --platform all --profile preview

# Production build (after QA passes)
eas build --platform all --profile production
```

### 7.6 Push OTA Update (for existing installs)

If env vars are baked into the JS bundle (via `app.config.js` `extra` block), an OTA update will propagate the new URLs to existing app installs without requiring a new App Store / Play Store release:

```bash
eas update --branch production --message "Migrate to bountyfinger.net domain"
```

> **Note:** Associated Domains (`applinks:`) changes require a native rebuild — OTA updates do NOT change entitlements.

---

## 8. Server Configuration

### 8.1 API Server (`services/api`)

Update `services/api/.env`:

```env
APP_URL=https://app.bountyfinger.net
# Database, Supabase, Stripe keys remain unchanged
```

Restart the API server after updating:

```bash
# If using PM2/systemd:
pm2 restart bountyexpo-api
# Or:
systemctl restart bountyexpo-api
```

### 8.2 Legacy Server (`server/`)

Update `server/.env`:

```env
APP_URL=https://app.bountyfinger.net
```

Restart:

```bash
pm2 restart bounty-legacy-server
```

### 8.3 CORS Configuration

If the API servers have CORS allowlists, add the new domain:

In `server/index.js`, ensure CORS allows:
```
https://app.bountyfinger.net
```

In `services/api/src/config/index.ts`, update any CORS origin config to include the new domain.

### 8.4 Server-Side Redirects

If the API server enforces HTTPS or performs domain-based redirects, update those to recognize the new domain.

---

## 9. Apple Developer & Google Play Console

### 9.1 Apple — Associated Domains

1. Go to [Apple Developer → Certificates, IDs & Profiles → App IDs](https://developer.apple.com/account/resources/identifiers/list).
2. Select `com.bounty.BOUNTYExpo`.
3. Under **Associated Domains**, the entitlement is configured in `app.json` (updated in §7.1).
4. After building with the new `associatedDomains`, Apple will crawl `https://app.bountyfinger.net/.well-known/apple-app-site-association`.

### 9.2 Android — Digital Asset Links

1. Ensure `.well-known/assetlinks.json` is served at `https://app.bountyfinger.net/.well-known/assetlinks.json`.
2. Update the `sha256_cert_fingerprints` in `assetlinks.json` if they haven't been set:
   ```bash
   # Get your release key fingerprint
   keytool -list -v -keystore your-release-key.keystore | grep SHA256
   ```
3. Verify in Google Play Console → App Integrity → App signing that the fingerprint matches.

---

## 10. Email Configuration

If using email services (SendGrid, Postmark, etc.) with the old domain:

1. Update SPF, DKIM, and DMARC records for `bountyfinger.net` in Cloudflare DNS.
2. Update sender addresses:
   - `support@bountyfinger.net`
   - `beta@bountyfinger.net`
   - `noreply@bountyfinger.net`
3. Update email templates in Supabase Auth → Email Templates to use the new domain in links.
4. Update `EXPO_PUBLIC_SUPPORT_EMAIL` if it's an env var.

---

## 11. Monitoring & Observability

1. Update any uptime monitors (Pingdom, UptimeRobot, etc.) to check:
   - `https://app.bountyfinger.net` (200 OK)
   - `https://api.bountyfinger.net/health` (200 OK)
2. Update Sentry DSN or project settings if domain-based filtering is used.
3. Update OpenTelemetry / APM service name if it includes the domain.
4. Update any alerting rules that reference the old domain.

---

## 12. Verification & Smoke Tests

Run these checks after completing all steps:

### DNS & SSL

```bash
# DNS resolves correctly
dig app.bountyfinger.net +short
dig api.bountyfinger.net +short

# HTTPS works with valid cert
curl -sI https://app.bountyfinger.net | head -5
curl -sI https://api.bountyfinger.net/health | head -5
```

### Universal Links / App Links

```bash
# Apple App Site Association is accessible
curl -s https://app.bountyfinger.net/.well-known/apple-app-site-association | jq .

# Android Asset Links is accessible
curl -s https://app.bountyfinger.net/.well-known/assetlinks.json | jq .
```

### Supabase Auth

```bash
# Test auth redirect (should return HTML redirect page)
curl -sI "https://ajsbkocnixpwbrjokvnq.supabase.co/auth/v1/authorize?provider=google&redirect_to=https://app.bountyfinger.net/auth/callback"
```

### Stripe

```bash
# Test webhook endpoint (Stripe CLI)
stripe listen --forward-to https://api.bountyfinger.net/webhooks/stripe

# In another terminal, trigger a test event
stripe trigger payment_intent.succeeded
```

### API Health

```bash
curl -s https://api.bountyfinger.net/health | jq .
curl -s https://api-staging.bountyfinger.net/health | jq .
```

### App Deep Links

1. **iOS:** Open Notes app → paste `https://app.bountyfinger.net/auth/callback?token=test&type=signup` → tap → should open the app.
2. **Android:** Send yourself a message with the same URL → tap → should open the app.

### Old Domain Redirects

```bash
# Verify 301 redirects from old domain
curl -sI https://bountyfinder.app/auth/callback | grep -E "HTTP|Location"
# Expected: HTTP/2 301, Location: https://app.bountyfinger.net/auth/callback
```

---

## 13. Post-Migration Cleanup (After 90 Days)

After 90 days with no issues:

1. Remove old `bountyfinder.app` redirect URLs from Supabase Auth settings.
2. Remove old `applinks:bountyfinder.app` from `app.json` associated domains.
3. Remove old Android intent filter for `bountyfinder.app`.
4. Disable/delete old Stripe webhook endpoint.
5. (Optional) Let `bountyfinder.app` domain expire or park it.
6. Update all documentation references from `bountyfinder.app` to `bountyfinger.net`.

---

## Appendix A: Files That Reference `bountyfinder.app`

The following files contain references to the old domain and should be updated during or after migration:

### Code Files (update during migration)

| File | Lines | What to Update |
|------|-------|----------------|
| `app.json` | 28–29, 57, 134 | `associatedDomains`, intent filter host, `API_BASE_URL` |
| `eas.json` | 42 | `EXPO_PUBLIC_API_URL` for preview |
| `server/.env.example` | 40 | `APP_URL` |
| `.well-known/README.md` | Multiple | Documentation references |

### Documentation Files (update during post-migration cleanup)

| File | Description |
|------|-------------|
| `docs/BETA_FEEDBACK_TEMPLATE.md` | Beta email and URL |
| `docs/BETA_RELEASE_NOTES_TEMPLATE.md` | Beta email |
| `docs/authentication/EMAIL_DEEP_LINKING_SETUP.md` | All deep link setup docs |
| `docs/authentication/AUTH_TROUBLESHOOTING.md` | Auth redirect URLs |
| `docs/authentication/RESET_PASSWORD_FLOW_FIX.md` | Site URL references |
| `docs/authentication/GOOGLE_OAUTH_REDIRECT_URI_FIX.md` | OAuth redirect |
| `docs/development/ACTION_ITEMS_FOR_OWNER.md` | .well-known, redirect URLs |
| `docs/development/PRIVACY_TERMS_IMPLEMENTATION_GUIDE.md` | Support email |
| `docs/development/PRIVACY_TERMS_SUMMARY.md` | Support email |
| `docs/bounty-flows/DISPUTE_INTEGRATION_GUIDE.md` | Support email |
| `docs/bounty-flows/POSTINGS_ENHANCEMENT_README.md` | Support email |
| `docs/payments/PAYMENT_AUTH_INTEGRATIONS_ANALYSIS.md` | Webhook URLs, redirect URIs |
| `docs/deployment/PRODUCTION_DEPLOYMENT_GUIDE.md` | Domain verification, webhook URL |

---

## Appendix B: Environment Variable Reference

| Variable | Where Set | Old Value | New Value |
|----------|-----------|-----------|-----------|
| `EXPO_PUBLIC_API_URL` | EAS secrets, `.env.*` | `https://api.bountyfinder.app` | `https://api.bountyfinger.net` |
| `APP_URL` | Server `.env`, Supabase secrets | `https://app.bountyfinder.app` | `https://app.bountyfinger.net` |
| `STRIPE_WEBHOOK_SECRET` | Server `.env`, Supabase secrets | `whsec_old...` | `whsec_new...` (from new endpoint) |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | App `.env` (if set) | `support@bountyfinder.app` | `support@bountyfinger.net` |

> ⚠️ `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_PUBLISHABLE_KEY` are **NOT affected** by this domain migration. They are service-specific and do not change.
