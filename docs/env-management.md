# Environment Management Guide

This document explains how BOUNTYExpo selects, validates, and configures its three
runtime environments (development, staging, production), and provides step-by-step
instructions for common operations: rotating keys, configuring EAS secrets, and
troubleshooting missing-env errors.

---

## Table of Contents

1. [How environment selection works](#1-how-environment-selection-works)
2. [File layout and templates](#2-file-layout-and-templates)
3. [Validating your environment](#3-validating-your-environment)
4. [Starting Expo for each environment](#4-starting-expo-for-each-environment)
5. [EAS secrets — configuration and commands](#5-eas-secrets--configuration-and-commands)
6. [Expo Go vs EAS dev builds vs standalone builds](#6-expo-go-vs-eas-dev-builds-vs-standalone-builds)
7. [Configuring Supabase instances](#7-configuring-supabase-instances)
8. [Configuring Stripe sandboxes](#8-configuring-stripe-sandboxes)
9. [Adding new credentials / rotating keys](#9-adding-new-credentials--rotating-keys)
10. [Release checklist (staging → production)](#10-release-checklist-staging--production)
11. [Git hygiene](#11-git-hygiene)
12. [Troubleshooting](#12-troubleshooting)
13. [CI integration](#13-ci-integration)

---

## 1. How environment selection works

The active environment is determined by a single variable: **`APP_ENV`**.

```
APP_ENV=development  (default when not set)
APP_ENV=staging
APP_ENV=production
```

**Resolution order** (highest priority first):

| Priority | Source | Notes |
|----------|--------|-------|
| 1 | `APP_ENV` env var | Set by npm scripts, EAS profiles, or CI |
| 2 | `EXPO_PUBLIC_ENVIRONMENT` | Fallback for older tooling |
| 3 | `'development'` | Compile-time default |

When `APP_ENV` is resolved, `app.config.js` loads the matching dotenv file:

```
.env.development   ← loaded when APP_ENV=development
.env.staging       ← loaded when APP_ENV=staging
.env.production    ← loaded when APP_ENV=production
.env               ← fallback when the specific file is absent
```

**Key files:**

- [`app.config.js`](../app.config.js) — loads the env file and injects `EXPO_PUBLIC_*` keys into the Expo bundle's `extra` object.
- [`lib/config.ts`](../lib/config.ts) — centralised frontend config accessor; exports `config` (values) and `configDiagnostics` (safe metadata about which key source was used).
- [`scripts/check-env.js`](../scripts/check-env.js) — CLI validator; exits non-zero when required keys are missing.

**How `lib/config.ts` resolves keys:**

```
EXPO_PUBLIC_SUPABASE_URL   → preferred (baked into bundle by EAS)
SUPABASE_URL               → fallback (server-side / local dev only)
```

The `configDiagnostics` object records which source was used without exposing values:

```ts
import { configDiagnostics } from './lib/config';
// { supabaseUrlSource: 'EXPO_PUBLIC', supabaseUrlPrefix: 'https://xw...', ... }
```

---

## 2. File layout and templates

| File | Committed? | Purpose |
|------|-----------|---------|
| `.env.development.example` | ✅ yes | Template for local dev — copy to `.env.development` |
| `.env.staging.example` | ✅ yes | Template for staging — copy to `.env.staging` |
| `.env.production.example` | ✅ yes | Template for production — copy to `.env.production` |
| `.env.example` | ✅ yes | Generic template (all keys with comments) |
| `.env.development` | ❌ git-ignored | Your real dev secrets |
| `.env.staging` | ❌ git-ignored | Your real staging secrets |
| `.env.production` | ❌ git-ignored | Your real production secrets |
| `.env` | ❌ git-ignored | Generic fallback |

**First-time setup:**

```bash
# Development
cp .env.development.example .env.development
# Edit .env.development — fill in your dev Supabase URL, anon key, etc.

# Staging (optional for local use)
cp .env.staging.example .env.staging

# Production (optional for local use; prefer EAS secrets for CI)
cp .env.production.example .env.production
```

---

## 3. Validating your environment

The `env:check` script validates that all required keys are present for the current
`APP_ENV`. Use it before starting Expo or before a release.

```bash
# Validate development (default)
npm run env:check

# Validate a specific environment
APP_ENV=staging    npm run env:check
APP_ENV=production npm run env:check

# Print a diagnostic table of which keys are set (no values shown)
npm run env:print
APP_ENV=staging npm run env:print
```

**Required keys by role:**

| Key | Role | Required in |
|-----|------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | frontend | all envs |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | frontend | all envs |
| `EXPO_PUBLIC_API_URL` | frontend | all envs |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | frontend | staging + production |
| `SUPABASE_URL` | backend | all envs |
| `SUPABASE_SERVICE_ROLE_KEY` (or variant) | backend | all envs |
| `DATABASE_URL` | backend | all envs |

---

## 4. Starting Expo for each environment

### Local development (Expo Go or metro bundler)

```bash
# Load .env.development and start
npm run start:dev

# Load .env.staging and start
npm run start:staging

# Load .env.production and start
npm run start:prod
```

These scripts use `cross-env APP_ENV=<env> expo start`, which causes
`app.config.js` to load the matching `.env.<env>` file before bundling.

### EAS dev builds

```bash
# Development profile → uses APP_ENV=development (set in eas.json)
eas build --profile development --platform ios

# Staging profile
eas build --profile preview --platform ios

# Production profile
eas build --profile production --platform ios
```

---

## 5. EAS secrets — configuration and commands

EAS secrets are injected as environment variables during the **build** step.
They are the recommended way to supply `EXPO_PUBLIC_*` keys without committing them.

### Listing existing secrets

```bash
eas secret:list
```

### Adding secrets

```bash
# Development / feature builds
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL \
  --value "https://your-dev.supabase.co" --type string

eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY \
  --value "your-dev-anon-key" --type string

# Staging (tied to the "preview" EAS build profile)
eas secret:create --scope project --name STAGING_SUPABASE_URL \
  --value "https://your-staging.supabase.co" --type string

eas secret:create --scope project --name STAGING_SUPABASE_ANON_KEY \
  --value "your-staging-anon-key" --type string

# Production
eas secret:create --scope project --name PRODUCTION_SUPABASE_URL \
  --value "https://your-production.supabase.co" --type string

eas secret:create --scope project --name PRODUCTION_SUPABASE_ANON_KEY \
  --value "your-production-anon-key" --type string
```

### Recommended naming convention for EAS secrets

| EAS Secret name | Maps to `EXPO_PUBLIC_*` key | Environment |
|-----------------|----------------------------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | `EXPO_PUBLIC_SUPABASE_URL` | development |
| `STAGING_SUPABASE_URL` | `EXPO_PUBLIC_SUPABASE_URL` (remapped in `eas.json`) | staging |
| `PRODUCTION_SUPABASE_URL` | `EXPO_PUBLIC_SUPABASE_URL` (remapped in `eas.json`) | production |

Map them in `eas.json` under each profile's `env` section.
The `${SECRET_NAME}` syntax is EAS-specific — EAS replaces these references with
the corresponding EAS project secret values at build time:

```json
{
  "build": {
    "preview": {
      "env": {
        "APP_ENV": "staging",
        "EXPO_PUBLIC_SUPABASE_URL": "${STAGING_SUPABASE_URL}",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "${STAGING_SUPABASE_ANON_KEY}",
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY": "${STAGING_STRIPE_PUBLISHABLE_KEY}"
      }
    },
    "production": {
      "env": {
        "APP_ENV": "production",
        "EXPO_PUBLIC_SUPABASE_URL": "${PRODUCTION_SUPABASE_URL}",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "${PRODUCTION_SUPABASE_ANON_KEY}",
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY": "${PRODUCTION_STRIPE_PUBLISHABLE_KEY}"
      }
    }
  }
}
```

> **Note:** `${VAR}` here is EAS secret substitution syntax, not standard shell
> variable expansion. EAS resolves these at build-initiation time using the secrets
> stored via `eas secret:create`.

---

## 6. Expo Go vs EAS dev builds vs standalone builds

| Build type | Env source | Notes |
|------------|-----------|-------|
| **Expo Go** | `.env.development` loaded by Metro | `EXPO_PUBLIC_*` vars are available. Works for quick iteration. |
| **EAS dev build** | EAS secrets + `.env.development` | Use `eas build --profile development`. Supports native modules. |
| **EAS preview (staging)** | EAS secrets only | Baked at build time. No local `.env` is read. |
| **EAS production** | EAS secrets only | Baked at build time. `EXPO_PUBLIC_*` values frozen in the bundle. |

> **Important:** `EXPO_PUBLIC_*` values are embedded into the JavaScript bundle
> at build time. Changing an EAS secret requires a **new build** — an OTA update
> alone will **not** change baked-in env vars.

---

## 7. Configuring Supabase instances

BOUNTYExpo requires three separate Supabase projects:

| Instance | Used for | `APP_ENV` |
|----------|---------|-----------|
| Dev | Local development & feature branches | `development` |
| Staging | QA, integration testing, stakeholder demos | `staging` |
| Production | Live users | `production` |

### Getting credentials

1. Open [supabase.com/dashboard](https://supabase.com/dashboard).
2. Select (or create) your project.
3. Go to **Settings → API**.
4. Copy:
   - **Project URL** → `EXPO_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`
   - **anon / public key** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** (secret — backend only) → `SUPABASE_SERVICE_ROLE_KEY`

### Schema migrations

Always apply migrations to dev → staging → production in order:

```bash
# Run pending migrations against the dev project
supabase db push --db-url "$DATABASE_URL"

# Verify, then apply to staging
supabase db push --db-url "$STAGING_DATABASE_URL"
```

---

## 8. Configuring Stripe sandboxes

| Stripe mode | Used for | Key prefix |
|-------------|---------|-----------|
| Test mode | development + staging | `pk_test_` / `sk_test_` |
| Live mode | production | `pk_live_` / `sk_live_` |

### Getting keys

1. Open [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys).
2. Toggle between **Test mode** and **Live mode** as needed.
3. Copy the publishable key (`pk_*`) → `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
4. Copy the secret key (`sk_*`) → `STRIPE_SECRET_KEY` (backend only, never in `EXPO_PUBLIC_*`).

### Webhooks

```bash
# Local development (Stripe CLI)
stripe listen --forward-to localhost:3001/webhooks/stripe

# Copy the webhook signing secret → STRIPE_WEBHOOK_SECRET
```

For staging/production, create webhooks at
[dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks)
and add the signing secret as an EAS secret.

---

## 9. Adding new credentials / rotating keys

### Adding a new key

1. Add the variable name + a placeholder to **all three** `.env.*.example` files.
2. Add it to the validation list in `scripts/check-env.js` under `FRONTEND_REQUIRED`
   or `BACKEND_REQUIRED` (depending on role).
3. Access it in code via `lib/config.ts` — add a new field under `config`.
4. Update EAS secrets for all profiles that need it.
5. Run `npm run env:check` locally and verify CI passes.

### Rotating Supabase anon / service keys

1. In the Supabase dashboard, go to **Settings → API → Reset anon/service key**.
2. Copy the new key value.
3. Update your local `.env.<env>` file.
4. Update the corresponding EAS secret:
   ```bash
   eas secret:push --scope project --env-file .env.staging
   # or manually:
   eas secret:create --scope project --name STAGING_SUPABASE_ANON_KEY --value "new-key" --force
   ```
5. Trigger a new EAS build for the affected profiles.
6. Run `npm run env:check` and `npx tsc --noEmit` to confirm no regressions.

### Rotating Stripe keys

1. In the Stripe dashboard, roll the old key (this immediately invalidates it).
2. Copy the new key.
3. Follow the same steps as above (update local file → update EAS secret → rebuild).

---

## 10. Release checklist (staging → production)

Before tagging a production release, verify the following:

- [ ] All required EAS secrets for `production` profile are set (`eas secret:list`).
- [ ] Run `APP_ENV=production npm run env:check` — exits 0.
- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Schema migrations applied to production Supabase instance.
- [ ] Stripe live-mode webhook configured and `STRIPE_WEBHOOK_SECRET` updated.
- [ ] Sentry DSN updated to the production project.
- [ ] Analytics token updated to the production workspace.
- [ ] Trigger EAS production build: `eas build --profile production --platform all`.
- [ ] Smoke-test the production build on a physical device before submitting to stores.

---

## 11. Git hygiene

| Rule | Reason |
|------|--------|
| Never commit `.env`, `.env.development`, `.env.staging`, `.env.production` | They contain real secrets |
| Always commit `.env.*.example` | Provides reference for developers and CI |
| Store secrets in EAS secrets or a team password manager | Avoids accidental secret leaks via git history |
| Rotate compromised keys immediately | Even if exposed for seconds, treat as compromised |

Use `git log --all --full-diff -p -- '*.env*'` to audit whether any `.env` files with
real values have accidentally been committed. If they have, rotate the keys immediately
and use `git filter-repo` (or BFG) to scrub the history.

---

## 12. Troubleshooting

### "Invalid API key" / Authentication errors at runtime

1. Run the safe diagnostic:
   ```bash
   npm run env:print
   ```
2. Look at `supabaseUrlPrefix` — does it match your Supabase project URL?
3. Check `supabaseUrlSource` — if it reads `'FALLBACK'`, the `EXPO_PUBLIC_SUPABASE_URL`
   key was **not** baked into the bundle. Rebuild with the correct EAS secret set.
4. Inspect at runtime:
   ```ts
   import { configDiagnostics } from './lib/config';
   console.debug('[diagnostics]', configDiagnostics);
   // In supabase.ts the same info is logged as '[supabase.debug] env'
   ```
5. For sign-in failures, check the Supabase Auth logs at
   **Supabase dashboard → Authentication → Logs**.

### "Authentication configuration appears invalid"

This error is usually thrown by Supabase when the anon key is wrong or from a different
project than the URL. Steps:
- Confirm `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are from the
  **same** Supabase project.
- Rebuild the app after updating the EAS secret.

### Missing env after an OTA update

`EXPO_PUBLIC_*` variables are baked at **build time**. An OTA update only replaces the
JavaScript bundle — it does **not** re-inject env vars. You must trigger a new native
build to change baked env values.

### `env:check` exits 1 in CI

By default `scripts/check-env.js` exits 1 when required keys are missing. In PR
pipelines where secrets are not available, set `ALLOW_MISSING_SECRETS=1`:

```yaml
- name: Validate env (PR — secrets may not be available)
  run: npm run env:check
  env:
    APP_ENV: development
    ALLOW_MISSING_SECRETS: '1'
```

For release pipelines, omit `ALLOW_MISSING_SECRETS` so the check is strict.

---

## 13. CI integration

The CI workflow (`.github/workflows/ci.yml`) runs `env:check` and `npx tsc --noEmit`
as part of every pull-request and push:

```yaml
- name: Validate environment variables
  run: npm run env:check
  env:
    APP_ENV: development
    ALLOW_MISSING_SECRETS: '1'
    EXPO_PUBLIC_SUPABASE_URL:  ${{ secrets.EXPO_PUBLIC_SUPABASE_URL }}
    EXPO_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.EXPO_PUBLIC_SUPABASE_ANON_KEY }}

- name: TypeScript type check
  run: npx tsc --noEmit
```

For release pipelines, remove `ALLOW_MISSING_SECRETS: '1'` and ensure all required
secrets are configured in your GitHub / EAS project settings.
