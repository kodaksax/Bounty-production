# Production Deployment Guide - EAS Build & Environment Configuration

> Complete guide for deploying BountyExpo mobile app to production using Expo Application Services (EAS)

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [EAS Build Setup](#eas-build-setup)
- [Building the App](#building-the-app)
- [Deployment Process](#deployment-process)
- [OTA Updates](#ota-updates)
- [Monitoring and Alerts](#monitoring-and-alerts)
- [Rollback Procedures](#rollback-procedures)
- [Production Checklist](#production-checklist)
- [Troubleshooting](#troubleshooting)

---

## Overview

BountyExpo uses Expo Application Services (EAS) for building and deploying the mobile app. This guide covers the complete deployment workflow for production.

### Deployment Workflow

```
Code Changes → CI Tests → EAS Build → App Store/Play Store → Production
                     ↓
              OTA Updates (for JS changes)
```

---

## Prerequisites

### Required Accounts
- [ ] Expo account with EAS access
- [ ] Apple Developer Program membership ($99/year)
- [ ] Google Play Console account ($25 one-time)
- [ ] GitHub account with repository access
- [ ] Sentry account for error tracking
- [ ] Mixpanel account for analytics

### Required Tools

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Verify login
eas whoami
```

### Apple Developer Setup

1. **Create App ID:**
   - Go to [developer.apple.com](https://developer.apple.com)
   - Identifiers → App IDs → Create new
   - Bundle ID: `com.bounty.BOUNTYExpo`
   - Enable capabilities: Push Notifications, Sign in with Apple

2. **Create App in App Store Connect:**
   - Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
   - My Apps → Add new app
   - Platform: iOS
   - Bundle ID: Select created Bundle ID
   - SKU: `bountyexpo-ios`

3. **Configure Certificates:**
   ```bash
   # EAS will handle certificates automatically
   eas credentials
   ```

### Google Play Setup

1. **Create Application:**
   - Go to [play.google.com/console](https://play.google.com/console)
   - Create app
   - App name: BOUNTY
   - Package name: `app.bountyfinder.BOUNTYExpo`

2. **Set up Service Account:**
   - Google Cloud Console → IAM & Admin → Service Accounts
   - Create service account
   - Grant "Service Account User" role
   - Create JSON key
   - Save as `google-service-account.json`

3. **Grant Permissions:**
   - Play Console → Setup → API access
   - Link service account
   - Grant "Release Manager" role

---

## Environment Configuration

### 1. GitHub Secrets

Configure the following secrets in your GitHub repository:

**Expo & EAS:**
```bash
EXPO_TOKEN=<your-expo-token>
```

**Supabase:**
```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

**API URLs:**
```bash
EXPO_PUBLIC_STAGING_API_URL=https://staging-api.bountyexpo.com
EXPO_PUBLIC_PRODUCTION_API_URL=https://api.bountyexpo.com
```

**Stripe:**
```bash
EXPO_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...
EXPO_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY=pk_live_...
```

**Monitoring:**
```bash
EXPO_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
EXPO_PUBLIC_MIXPANEL_TOKEN=<your-token>
```

**Google Services:**
```bash
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=<your-api-key>
```

**Apple:**
```bash
APPLE_ID=<your-apple-id@example.com>
ASC_APP_ID=<app-store-connect-app-id>
APPLE_TEAM_ID=<team-id>
```

**Android:**
```bash
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./google-service-account.json
```

### 2. Local Environment Files

**Staging (.env.staging):**
```bash
cp .env.staging.example .env.staging
# Edit with staging values
```

**Production (.env.production):**
```bash
cp .env.production.example .env.production
# Edit with production values
```

⚠️ **Warning:** Never commit these files. They're already in `.gitignore`.

---

## EAS Build Setup

### 1. Initialize EAS

```bash
# Initialize EAS in your project
eas init

# This will create/update eas.json with your project ID
```

### 2. Configure Build Profiles

The `eas.json` file contains build profiles for different environments:

**Development:**
- Local development and testing
- Development client enabled
- Internal distribution

**Staging:**
- Testing before production
- Internal distribution
- Test Stripe keys
- Staging API

**Preview:**
- Quick testing builds
- Simulator builds for iOS
- Test configuration

**Production:**
- Store distribution
- Live Stripe keys
- Production API
- Auto-increment version

### 3. Configure Credentials

**iOS Credentials:**
```bash
# Let EAS manage credentials automatically
eas credentials

# Or manually configure
eas credentials -p ios
```

**Android Credentials:**
```bash
# Generate keystore (EAS will prompt)
eas credentials -p android

# Or use existing keystore
eas credentials:configure-build -p android
```

---

## Building the App

### 1. Development Build

```bash
# Build for iOS simulator
eas build --profile development --platform ios

# Build for Android emulator
eas build --profile development --platform android
```

### 2. Staging Build

```bash
# Build for internal testing
eas build --profile staging --platform all

# Or specific platform
eas build --profile staging --platform ios
eas build --profile staging --platform android
```

### 3. Production Build

```bash
# Build for App Store and Google Play
eas build --profile production --platform all

# Or trigger via GitHub Actions
# Push to main branch or use workflow dispatch
```

### 4. Monitor Build Progress

```bash
# Check build status
eas build:list

# View specific build
eas build:view <build-id>

# Cancel build if needed
eas build:cancel <build-id>
```

**Build Dashboard:**
Visit [expo.dev/accounts/your-account/projects/BOUNTYExpo/builds](https://expo.dev) to monitor builds.

---

## Deployment Process

### 1. Pre-Deployment Checklist

- [ ] All tests pass (`npm run test:ci`)
- [ ] Code review approved
- [ ] Release notes prepared
- [ ] Environment variables configured
- [ ] Certificates valid (iOS)
- [ ] Version number incremented (production)
- [ ] API server deployed and healthy
- [ ] Database migrations completed
- [ ] Monitoring tools configured

### 2. Automated Deployment via GitHub Actions

**Trigger Build:**
```bash
# Push to main branch
git push origin main

# Or use workflow dispatch in GitHub Actions UI
```

**Monitor Progress:**
1. Check GitHub Actions workflow
2. View EAS build progress
3. Wait for build completion
4. Review build artifacts

### 3. Submit to App Stores

**iOS - App Store:**
```bash
# Submit to App Store Connect
eas submit --platform ios --latest

# Or manually:
# 1. Download IPA from EAS
# 2. Upload via Transporter app
# 3. Submit for review in App Store Connect
```

**Android - Google Play:**
```bash
# Submit to Google Play
eas submit --platform android --latest

# Or manually:
# 1. Download AAB from EAS
# 2. Upload to Play Console
# 3. Create release
```

### 4. Review and Release

**iOS Review Process:**
1. App submitted → "Waiting for Review"
2. In Review (typically 24-48 hours)
3. Approved → Ready for Sale
4. Release manually or automatically

**Android Review Process:**
1. App submitted → "In Review"
2. Review (typically 1-7 days)
3. Approved → Published
4. Rolled out to percentage of users

---

## OTA Updates

### What are OTA Updates?

Over-The-Air (OTA) updates allow you to push JavaScript, styling, and asset changes without going through app store review.

### When to Use OTA

✅ **Use OTA for:**
- Bug fixes
- UI/UX improvements
- Content updates
- Minor feature additions
- Configuration changes

❌ **Don't use OTA for:**
- Native code changes
- Package.json dependency changes
- Expo SDK version updates
- Changes to app.json native config

### Publishing OTA Updates

**Staging Update:**
```bash
# Publish to staging channel
eas update --branch staging --message "Bug fixes"

# Verify update
eas update:view --branch staging
```

**Production Update:**
```bash
# Publish to production channel
eas update --branch production --message "Critical bug fix"

# Monitor rollout
eas update:view --branch production
```

**Automated via GitHub Actions:**
```bash
# Push to develop for staging update
git push origin develop

# Push to main for production update
git push origin main
```

### OTA Update Strategy

**Gradual Rollout:**
1. Deploy to 10% of users
2. Monitor for 24 hours
3. Increase to 50%
4. Monitor for 24 hours
5. Roll out to 100%

**Monitoring:**
```bash
# Check update statistics
eas update:list --branch production

# View specific update
eas update:view <update-id>
```

---

## Monitoring and Alerts

See [MONITORING_ALERTING_SETUP.md](./MONITORING_ALERTING_SETUP.md) for detailed monitoring configuration.

### Quick Setup

**1. Sentry Error Tracking**
```bash
# Already configured in app
# Set EXPO_PUBLIC_SENTRY_DSN in GitHub Secrets
```

**2. Mixpanel Analytics**
```bash
# Already configured in app
# Set EXPO_PUBLIC_MIXPANEL_TOKEN in GitHub Secrets
```

**3. Health Checks**
```bash
# Monitor API health
curl https://api.bountyexpo.com/health
```

### Key Metrics to Monitor

**Technical:**
- App crash rate < 1%
- API error rate < 0.1%
- Response time p95 < 500ms
- App launch time < 3s

**Business:**
- Daily Active Users (DAU)
- Bounty completion rate
- Payment success rate
- User retention

---

## Rollback Procedures

### 1. Rollback OTA Update

```bash
# List previous updates
eas update:list --branch production

# Republish previous version
eas update:republish --branch production --group <previous-group-id>

# Or roll back to specific update
eas update:roll-back --branch production --to <update-id>
```

### 2. Rollback App Store Version

**iOS:**
1. Go to App Store Connect
2. My Apps → BOUNTY → App Store
3. Remove current version from sale (if critical)
4. Users will stay on previous version

**Android:**
1. Go to Play Console
2. Release → Production
3. Roll back to previous release
4. Confirm rollback

### 3. Emergency Rollback

**Fast rollback (OTA):**
```bash
# Immediate rollback to last known good
eas update:republish --branch production --group <last-good-group>
```

**Full rollback (Native):**
1. Build previous version
2. Fast-track review if critical
3. Submit hotfix

---

## Production Checklist

### Pre-Launch

- [ ] All features tested on real devices
- [ ] iOS App Store review guidelines compliance
- [ ] Google Play policies compliance
- [ ] Privacy policy and terms of service in place
- [ ] GDPR compliance if applicable
- [ ] App Store screenshots and descriptions ready
- [ ] Play Store screenshots and descriptions ready
- [ ] Support email configured
- [ ] App Store pricing set
- [ ] In-app purchases configured (if applicable)

### Environment

- [ ] Production API endpoints configured
- [ ] Production database ready and migrated
- [ ] Redis cache configured
- [ ] Stripe live keys configured
- [ ] Supabase production instance ready
- [ ] CDN configured for assets
- [ ] SSL certificates valid
- [ ] Domain names configured

### Security

- [ ] Secrets not hardcoded
- [ ] API keys rotated and secure
- [ ] Rate limiting configured
- [ ] Input validation in place
- [ ] SQL injection prevention verified
- [ ] XSS prevention verified
- [ ] HTTPS enforced
- [ ] Security headers configured

### Monitoring

- [ ] Sentry error tracking configured
- [ ] Mixpanel analytics configured
- [ ] CloudWatch logs configured
- [ ] Uptime monitoring configured
- [ ] Alert rules configured
- [ ] On-call schedule set up
- [ ] Status page configured
- [ ] Performance monitoring active

### Documentation

- [ ] README updated with production info
- [ ] API documentation current
- [ ] Deployment guide reviewed
- [ ] Runbooks prepared for common issues
- [ ] Emergency contacts documented
- [ ] Architecture diagrams updated

---

## Troubleshooting

### Build Failures

**Issue: iOS build fails with certificate error**
```bash
# Solution: Re-generate credentials
eas credentials -p ios
# Select "Set up a new iOS distribution certificate"
```

**Issue: Android build fails with keystore error**
```bash
# Solution: Reset Android credentials
eas credentials -p android
# Select "Remove keystore" then rebuild
```

**Issue: Out of memory error**
```bash
# Solution: Use larger resource class
# Edit eas.json:
{
  "build": {
    "production": {
      "ios": {
        "resourceClass": "m-medium" // or "large"
      }
    }
  }
}
```

### Submission Failures

**Issue: iOS app rejected for metadata**
- Review rejection reason in App Store Connect
- Update app description/screenshots
- Resubmit

**Issue: Android app rejected for policy violation**
- Review policy in Play Console
- Update app listing or code
- Appeal if needed

### OTA Update Issues

**Issue: Update not reaching users**
```bash
# Check update status
eas update:view --branch production

# Verify channel configuration in app.json
# Ensure app is configured with correct update URL
```

**Issue: Update causes crashes**
```bash
# Immediately roll back
eas update:republish --branch production --group <previous-good-group>

# Investigate error in Sentry
# Fix and republish
```

### Runtime Issues

**Issue: High crash rate after deployment**
1. Check Sentry for crash reports
2. Identify affected versions
3. Roll back if critical
4. Fix and redeploy

**Issue: API connectivity problems**
1. Verify API health endpoint
2. Check environment variables
3. Test from device
4. Review network configuration

---

## Support and Resources

### Documentation
- [Expo Documentation](https://docs.expo.dev)
- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [EAS Submit Documentation](https://docs.expo.dev/submit/introduction/)
- [EAS Update Documentation](https://docs.expo.dev/eas-update/introduction/)

### Community
- [Expo Discord](https://chat.expo.dev)
- [Expo Forums](https://forums.expo.dev)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/expo)

### Internal
- Email: devops@bountyexpo.com
- Slack: #engineering, #deployments
- On-call: PagerDuty

---

## Appendix

### A. Version Numbering

Follow semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR:** Breaking changes
- **MINOR:** New features, backward compatible
- **PATCH:** Bug fixes

Example: `1.2.3`

### B. Release Notes Template

```markdown
## Version X.Y.Z

### New Features
- Feature description

### Improvements
- Improvement description

### Bug Fixes
- Bug fix description

### Known Issues
- Known issue description
```

### C. Build Time Estimates

| Build Type | Platform | Estimated Time |
|------------|----------|----------------|
| Development | iOS | 5-10 minutes |
| Development | Android | 5-10 minutes |
| Production | iOS | 15-20 minutes |
| Production | Android | 10-15 minutes |
| OTA Update | All | 2-5 minutes |

### D. Resource Classes

| Class | vCPU | RAM | Cost Factor |
|-------|------|-----|-------------|
| default | 4 | 8 GB | 1x |
| m-medium | 6 | 12 GB | 2x |
| large | 12 | 24 GB | 4x |

---

**Last Updated:** January 2026
**Maintained By:** DevOps Team
