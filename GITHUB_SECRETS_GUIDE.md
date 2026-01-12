# GitHub Secrets Configuration Guide

> Complete reference for configuring GitHub Secrets required for CI/CD and deployments

## Table of Contents

- [Overview](#overview)
- [How to Add Secrets](#how-to-add-secrets)
- [Required Secrets](#required-secrets)
- [Environment-Specific Secrets](#environment-specific-secrets)
- [Security Best Practices](#security-best-practices)
- [Rotating Secrets](#rotating-secrets)

---

## Overview

GitHub Secrets are encrypted environment variables used in GitHub Actions workflows. They're essential for secure deployments without exposing sensitive data in code.

### Secret Categories

1. **Expo & EAS** - App building and deployment
2. **Supabase** - Backend and authentication
3. **Stripe** - Payment processing
4. **Monitoring** - Error tracking and analytics
5. **Cloud Services** - API keys and credentials
6. **Apple** - iOS app deployment
7. **Google** - Android app deployment

---

## How to Add Secrets

### Via GitHub Web Interface

1. Navigate to your repository
2. Go to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Enter the name and value
5. Click **Add secret**

### Via GitHub CLI

```bash
# Install GitHub CLI if needed
brew install gh  # macOS
# or visit: https://cli.github.com/

# Login to GitHub
gh auth login

# Add a secret
gh secret set SECRET_NAME

# Add secret from file
gh secret set SECRET_NAME < secret-file.txt

# Add secret inline
echo "secret-value" | gh secret set SECRET_NAME
```

---

## Required Secrets

### 1. Expo & EAS

#### `EXPO_TOKEN`
**Description:** Token for authenticating with Expo services  
**How to obtain:**
```bash
# Login to Expo
eas login

# Generate token
eas credentials
# Or visit: https://expo.dev/settings/access-tokens
```
**Format:** `string` (alphanumeric token)  
**Example:** `aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ0123456789`

---

### 2. Supabase

#### `EXPO_PUBLIC_SUPABASE_URL`
**Description:** Your Supabase project URL  
**How to obtain:**
1. Go to [supabase.com](https://supabase.com)
2. Select your project
3. Settings → API
4. Copy "Project URL"

**Format:** `https://<project-id>.supabase.co`  
**Example:** `https://abcdefghijklmnop.supabase.co`

#### `EXPO_PUBLIC_SUPABASE_ANON_KEY`
**Description:** Supabase anonymous key (public)  
**How to obtain:**
1. Supabase Dashboard → Settings → API
2. Copy "anon public" key

**Format:** `string` (long JWT token)  
**Example:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

#### `SUPABASE_SERVICE_ROLE_KEY` (Optional, for backend)
**Description:** Supabase service role key (private, bypass RLS)  
**How to obtain:**
1. Supabase Dashboard → Settings → API
2. Copy "service_role secret" key

**⚠️ Warning:** Never expose this key in client-side code!

---

### 3. API Configuration

#### `EXPO_PUBLIC_STAGING_API_URL`
**Description:** API endpoint for staging environment  
**Format:** `https://staging-api.yourdomain.com`  
**Example:** `https://staging-api.bountyexpo.com`

#### `EXPO_PUBLIC_PRODUCTION_API_URL`
**Description:** API endpoint for production environment  
**Format:** `https://api.yourdomain.com`  
**Example:** `https://api.bountyexpo.com`

---

### 4. Stripe

#### `EXPO_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY`
**Description:** Stripe test mode publishable key  
**How to obtain:**
1. Go to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Developers → API keys
3. Toggle "Test mode" ON
4. Copy "Publishable key"

**Format:** `pk_test_...`  
**Example:** `pk_test_51ABC...xyz`

#### `EXPO_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY`
**Description:** Stripe live mode publishable key  
**How to obtain:**
1. Stripe Dashboard → Developers → API keys
2. Toggle "Test mode" OFF
3. Copy "Publishable key"

**Format:** `pk_live_...`  
**Example:** `pk_live_51ABC...xyz`

#### `STRIPE_SECRET_KEY` (Backend only)
**Description:** Stripe secret key (test or live)  
**How to obtain:**
1. Stripe Dashboard → Developers → API keys
2. Copy "Secret key"

**Format:** `sk_test_...` or `sk_live_...`  
**⚠️ Warning:** Keep this secret! Never expose in client-side code.

#### `STRIPE_WEBHOOK_SECRET` (Backend only)
**Description:** Stripe webhook signing secret  
**How to obtain:**
1. Stripe Dashboard → Developers → Webhooks
2. Add endpoint or select existing
3. Click "Reveal" next to "Signing secret"

**Format:** `whsec_...`  
**Example:** `whsec_abc123...`

---

### 5. Monitoring & Analytics

#### `EXPO_PUBLIC_SENTRY_DSN`
**Description:** Sentry Data Source Name for error tracking  
**How to obtain:**
1. Go to [sentry.io](https://sentry.io)
2. Select/create project
3. Settings → Client Keys (DSN)
4. Copy DSN

**Format:** `https://<key>@<region>.ingest.sentry.io/<project-id>`  
**Example:** `https://abc123@us.ingest.sentry.io/456789`

#### `EXPO_PUBLIC_MIXPANEL_TOKEN`
**Description:** Mixpanel project token for analytics  
**How to obtain:**
1. Go to [mixpanel.com](https://mixpanel.com)
2. Select project
3. Settings → Project Settings
4. Copy "Project Token"

**Format:** `string` (32-character hex)  
**Example:** `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

---

### 6. Google Services

#### `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`
**Description:** Google Places API key for location autocomplete  
**How to obtain:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. APIs & Services → Credentials
3. Create credentials → API key
4. Restrict key to:
   - Places API
   - Geocoding API
   - Your app's bundle ID/package name

**Format:** `string`  
**Example:** `AIzaSyABC...XYZ`

**⚠️ Important:** Restrict this key in production!

---

### 7. Apple (iOS Deployment)

#### `APPLE_ID`
**Description:** Your Apple ID email  
**Format:** `email`  
**Example:** `developer@bountyexpo.com`

#### `ASC_APP_ID`
**Description:** App Store Connect App ID  
**How to obtain:**
1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. My Apps → Select your app
3. App Information → Copy "Apple ID"

**Format:** `numeric string`  
**Example:** `1234567890`

#### `APPLE_TEAM_ID`
**Description:** Your Apple Developer Team ID  
**How to obtain:**
1. Go to [developer.apple.com](https://developer.apple.com)
2. Account → Membership
3. Copy "Team ID"

**Format:** `10-character string`  
**Example:** `ABCDEF1234`

---

### 8. Google (Android Deployment)

#### `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`
**Description:** Path to Google Play service account key file  
**How to obtain:**
1. Google Cloud Console → IAM & Admin → Service Accounts
2. Create/select service account
3. Keys → Add Key → Create new key
4. Select JSON format
5. Save file

**Format:** `path/to/file.json`  
**Example:** `./google-service-account.json`

**Note:** For GitHub Actions, you may need to encode the JSON:
```bash
# Encode JSON file to base64
base64 google-service-account.json > encoded.txt

# Add encoded content as secret
gh secret set GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 < encoded.txt

# In workflow, decode:
# echo "${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 }}" | base64 -d > google-service-account.json
```

---

### 9. Testing (Optional)

#### `TEST_DATABASE_URL`
**Description:** Database URL for running tests  
**Format:** `postgresql://user:password@host:port/database`  
**Example:** `postgresql://test:test@localhost:5432/bountyexpo_test`

#### `CODECOV_TOKEN`
**Description:** Token for uploading coverage reports  
**How to obtain:**
1. Go to [codecov.io](https://codecov.io)
2. Add repository
3. Copy token

**Format:** `UUID string`

---

## Environment-Specific Secrets

### Development
No secrets needed - use `.env` file locally

### Staging
```bash
EXPO_PUBLIC_SUPABASE_URL=<staging-url>
EXPO_PUBLIC_STAGING_API_URL=<staging-api>
EXPO_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY=<test-key>
```

### Production
```bash
EXPO_PUBLIC_SUPABASE_URL=<production-url>
EXPO_PUBLIC_PRODUCTION_API_URL=<production-api>
EXPO_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY=<live-key>
```

---

## Security Best Practices

### 1. Secret Rotation

**Rotate secrets regularly:**
- API keys: Every 90 days
- Authentication tokens: Every 6 months
- Database passwords: Every 6 months
- Service account keys: Yearly

**When to rotate immediately:**
- Suspected compromise
- Employee departure
- Public exposure
- Security audit finding

### 2. Access Control

**Limit who can access secrets:**
1. Repository Settings → Manage access
2. Use branch protection rules
3. Require reviews for workflow changes
4. Use environment-specific secrets

### 3. Secret Scope

**Use environment secrets when possible:**
```yaml
jobs:
  deploy:
    environment: production  # Uses production-specific secrets
    steps:
      - name: Deploy
        env:
          API_KEY: ${{ secrets.API_KEY }}  # Scoped to production
```

### 4. Never Log Secrets

**Bad:**
```yaml
- name: Debug
  run: echo "API Key: ${{ secrets.API_KEY }}"  # ❌ Don't do this!
```

**Good:**
```yaml
- name: Debug
  run: echo "API Key is set: ${{ secrets.API_KEY != '' }}"  # ✅ Check without exposing
```

### 5. Use Secret Scanning

**Enable on GitHub:**
1. Repository Settings → Code security and analysis
2. Enable "Secret scanning"
3. Enable "Push protection"

---

## Rotating Secrets

### When a Secret is Compromised

**Immediate Actions:**
1. Revoke the compromised secret
2. Generate new secret
3. Update GitHub Secret
4. Redeploy applications
5. Audit access logs
6. Document incident

### Rotation Checklist

- [ ] Generate new secret/token
- [ ] Update GitHub Secret
- [ ] Update any backup/disaster recovery configs
- [ ] Trigger redeployment of affected services
- [ ] Verify services are working
- [ ] Revoke old secret
- [ ] Document rotation in changelog
- [ ] Update password manager (if applicable)

### Example: Rotating Stripe Keys

```bash
# 1. Generate new keys in Stripe Dashboard
# 2. Update GitHub Secrets
gh secret set EXPO_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY

# 3. Trigger deployment
git push origin main

# 4. Verify deployment
curl https://api.bountyexpo.com/health

# 5. Delete old keys from Stripe Dashboard
```

---

## Verification Checklist

Use this checklist before deploying:

### Expo & EAS
- [ ] `EXPO_TOKEN` is set and valid
- [ ] Token has correct permissions

### Supabase
- [ ] `EXPO_PUBLIC_SUPABASE_URL` points to correct project
- [ ] `EXPO_PUBLIC_SUPABASE_ANON_KEY` is valid
- [ ] Keys match between staging/production

### Stripe
- [ ] Test keys for staging
- [ ] Live keys for production
- [ ] Keys are not swapped
- [ ] Webhook secrets configured

### Monitoring
- [ ] `EXPO_PUBLIC_SENTRY_DSN` is set
- [ ] `EXPO_PUBLIC_MIXPANEL_TOKEN` is set
- [ ] Monitoring is receiving data

### Platform-Specific
- [ ] Apple credentials for iOS
- [ ] Google credentials for Android
- [ ] Service accounts have correct permissions

---

## Troubleshooting

### Secret not found error
```
Error: Secret EXPO_TOKEN not found
```
**Solution:** Verify secret name matches exactly (case-sensitive)

### Invalid secret format
```
Error: Invalid format for EXPO_PUBLIC_SUPABASE_URL
```
**Solution:** Check secret format matches requirements

### Permission denied
```
Error: Insufficient permissions to access secret
```
**Solution:** Check repository permissions and environment access

### Secret exposed in logs
**Solution:**
1. Immediately rotate the secret
2. Update GitHub Secret
3. Review workflow files to remove logging

---

## Quick Reference Commands

```bash
# List all secrets
gh secret list

# Set a secret
gh secret set SECRET_NAME

# Delete a secret
gh secret delete SECRET_NAME

# Set multiple secrets from file
# Format: SECRET_NAME=value (one per line)
gh secret set -f secrets.txt

# Set secret for specific environment
gh secret set SECRET_NAME --env production
```

---

## Support

**Issues with secrets?**
- Review GitHub Actions logs (secrets are masked)
- Check secret names for typos
- Verify secret values are correct
- Contact: devops@bountyexpo.com

**Security concerns?**
- Immediately rotate affected secrets
- Report to: security@bountyexpo.com
- Document in incident log

---

**Last Updated:** January 2026  
**Maintained By:** DevOps Team
