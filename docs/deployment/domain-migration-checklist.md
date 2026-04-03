# Domain Migration Checklist — bountyfinger.net

> **Companion to:** [`domain-migration-bountyfinger.md`](./domain-migration-bountyfinger.md)  
> **Supabase project ref:** `ajsbkocnixpwbrjokvnq`  
> **EAS project ID:** `b5485f88-0b1f-4622-bbed-b1ae142dcb46`

---

## Pre-Flight

- [ ] Confirm Cloudflare zone access for `bountyfinger.net`
- [ ] Confirm hosting provider access (origin server / Vercel / Cloudflare Pages)
- [ ] Confirm Stripe Dashboard access (admin)
- [ ] Authenticate Supabase CLI: `supabase login`
- [ ] Authenticate EAS CLI: `eas login`
- [ ] Confirm Apple Developer account access
- [ ] Confirm Google Play Console access
- [ ] **Schedule maintenance window** (low-traffic period recommended)

---

## Step 1 — DNS (Cloudflare)

- [ ] Add CNAME: `app` → `<hosting-provider-cname>` (proxy ON)
- [ ] Add CNAME/A: `api` → `<api-server-host-or-ip>` (proxy ON)
- [ ] Add CNAME/A: `api-staging` → `<staging-server-host-or-ip>` (proxy ON)
- [ ] Set SSL/TLS to **Full (strict)**
- [ ] Verify Universal SSL covers `*.bountyfinger.net`
- [ ] Add 301 redirect on old zone: `bountyfinder.app/*` → `https://app.bountyfinger.net/$1`
- [ ] Add 301 redirect on old zone: `api.bountyfinder.app/*` → `https://api.bountyfinger.net/$1`

**Acceptance:**
```bash
dig app.bountyfinger.net +short    # resolves
dig api.bountyfinger.net +short    # resolves
curl -sI https://app.bountyfinger.net | head -3   # HTTP/2 200
curl -sI https://api.bountyfinger.net/health | head -3  # HTTP/2 200
```

---

## Step 2 — .well-known Files

- [ ] Serve `.well-known/apple-app-site-association` at `app.bountyfinger.net`
- [ ] Serve `.well-known/assetlinks.json` at `app.bountyfinger.net`
- [ ] Update Cloudflare Worker route (if used): `app.bountyfinger.net/.well-known/*`

**Acceptance:**
```bash
curl -s https://app.bountyfinger.net/.well-known/apple-app-site-association | jq .applinks
curl -s https://app.bountyfinger.net/.well-known/assetlinks.json | jq .[0].target.package_name
```

---

## Step 3 — Supabase Auth

- [ ] Dashboard → Auth → URL Config → Set **Site URL**: `https://app.bountyfinger.net`
- [ ] Add redirect URLs:
  ```
  https://app.bountyfinger.net/auth/callback
  https://app.bountyfinger.net/auth/*
  ```
- [ ] Keep old `bountyfinder.app` redirect URLs (remove after 90 days)

---

## Step 4 — Supabase Edge Function Secrets

- [ ] Set `APP_URL`:
  ```bash
  supabase secrets set APP_URL=https://app.bountyfinger.net \
    --project-ref ajsbkocnixpwbrjokvnq
  ```
- [ ] Redeploy critical functions:
  ```bash
  supabase functions deploy payments --project-ref ajsbkocnixpwbrjokvnq
  supabase functions deploy webhooks --project-ref ajsbkocnixpwbrjokvnq
  supabase functions deploy connect --project-ref ajsbkocnixpwbrjokvnq
  ```
- [ ] Redeploy remaining functions:
  ```bash
  for fn in accept-bounty-request admin-review-id apple-pay auth completion \
            process-notification review-id send-expo-push wallet; do
    supabase functions deploy "$fn" --project-ref ajsbkocnixpwbrjokvnq
  done
  ```

**Acceptance:**
```bash
supabase secrets list --project-ref ajsbkocnixpwbrjokvnq | grep APP_URL
# Should show: APP_URL=https://app.bountyfinger.net
```

---

## Step 5 — Stripe

- [ ] Stripe Dashboard → Webhooks → **Add endpoint**: `https://api.bountyfinger.net/webhooks/stripe`
- [ ] Subscribe to events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `setup_intent.succeeded`, `setup_intent.setup_failed`, `account.updated`, `transfer.created`, `payout.paid`, `payout.failed`
- [ ] Copy new webhook signing secret (`whsec_...`)
- [ ] Update servers (DO NOT commit to git):
  ```bash
  # services/api/.env
  STRIPE_WEBHOOK_SECRET=whsec_NEW_VALUE

  # server/.env
  STRIPE_WEBHOOK_SECRET=whsec_NEW_VALUE
  ```
- [ ] Update Supabase secret:
  ```bash
  supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_NEW_VALUE \
    --project-ref ajsbkocnixpwbrjokvnq
  ```
- [ ] (If Apple Pay) Add `app.bountyfinger.net` in Stripe → Apple Pay domains
- [ ] Keep old webhook endpoint active for 2 weeks, then disable

**Acceptance:**
```bash
stripe listen --forward-to https://api.bountyfinger.net/webhooks/stripe
# In another terminal:
stripe trigger payment_intent.succeeded
# Should see: 200 OK
```

---

## Step 6 — Server `.env` Updates

- [ ] `services/api/.env`:
  ```bash
  APP_URL=https://app.bountyfinger.net
  ```
- [ ] `server/.env`:
  ```bash
  APP_URL=https://app.bountyfinger.net
  ```
- [ ] Add new domain to CORS allowlist (if applicable)
- [ ] Restart API server:
  ```bash
  pm2 restart bountyexpo-api
  ```
- [ ] Restart legacy server:
  ```bash
  pm2 restart bounty-legacy-server
  ```

**Acceptance:**
```bash
curl -s https://api.bountyfinger.net/health | jq .status
# Expected: "ok"
```

---

## Step 7 — Expo / EAS

- [ ] Update `app.json` — associatedDomains: add `applinks:app.bountyfinger.net`, `applinks:*.bountyfinger.net`
- [ ] Update `app.json` — Android intent filter host: `app.bountyfinger.net`
- [ ] Update `app.json` — `extra.API_BASE_URL`: `https://app.bountyfinger.net`
- [ ] Update `eas.json` — preview `EXPO_PUBLIC_API_URL`: `https://api-staging.bountyfinger.net`
- [ ] Set EAS secrets:
  ```bash
  eas secret:create --scope project \
    --name EXPO_PUBLIC_API_URL \
    --value "https://api.bountyfinger.net" \
    --type string --force

  eas secret:create --scope project \
    --name APP_URL \
    --value "https://app.bountyfinger.net" \
    --type string --force
  ```
- [ ] Update `.env.staging.example` and `.env.production.example` with new URLs
- [ ] Build preview for QA:
  ```bash
  eas build --platform all --profile preview
  ```
- [ ] After QA passes, build production:
  ```bash
  eas build --platform all --profile production
  ```
- [ ] Push OTA update for existing installs:
  ```bash
  eas update --branch production --message "Migrate to bountyfinger.net domain"
  ```

---

## Step 8 — Deep Link Verification

- [ ] **iOS:** Paste `https://app.bountyfinger.net/auth/callback?token=test&type=signup` in Notes → tap → app opens
- [ ] **Android:** Send message with same URL → tap → app opens
- [ ] Validate via Apple CDN:
  ```bash
  curl -s "https://app-site-association.cdn-apple.com/a/v1/app.bountyfinger.net" | jq .
  ```

---

## Step 9 — Old Domain Redirects

- [ ] Verify 301 from old domain:
  ```bash
  curl -sI https://bountyfinder.app/ | grep -E "HTTP|Location"
  curl -sI https://bountyfinder.app/auth/callback | grep -E "HTTP|Location"
  ```

---

## Step 10 — Email & Monitoring

- [ ] Set up SPF/DKIM/DMARC DNS records for `bountyfinger.net` (if sending email)
- [ ] Update Supabase email templates with new domain links
- [ ] Update uptime monitors to check `app.bountyfinger.net` and `api.bountyfinger.net`
- [ ] Update Sentry / APM if domain-based filtering is used

---

## Post-Migration (90 Days Later)

- [ ] Remove `bountyfinder.app` redirect URLs from Supabase Auth
- [ ] Remove `applinks:bountyfinder.app` from `app.json`
- [ ] Remove old Android intent filter for `bountyfinder.app`
- [ ] Disable old Stripe webhook endpoint
- [ ] Update all docs referencing `bountyfinder.app`

---

## Sign-Off

| Role | Name | Date | ✓ |
|------|------|------|---|
| DevOps / Sysadmin (DNS + infra) | | | ☐ |
| Engineering Lead (Stripe + Supabase) | | | ☐ |
| iOS Lead (deep link testing) | | | ☐ |
| Android Lead (deep link testing) | | | ☐ |
| QA (smoke tests) | | | ☐ |
