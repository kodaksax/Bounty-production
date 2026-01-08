# Production Deployment - Quick Start Guide

> Fast-track guide to deploying BountyExpo to production. Start here, then refer to detailed docs.

## 🚀 Quick Navigation

- **Full EAS Deployment Guide:** [PRODUCTION_DEPLOYMENT_EAS.md](./PRODUCTION_DEPLOYMENT_EAS.md)
- **Monitoring Setup:** [MONITORING_ALERTING_SETUP.md](./MONITORING_ALERTING_SETUP.md)
- **GitHub Secrets:** [GITHUB_SECRETS_GUIDE.md](./GITHUB_SECRETS_GUIDE.md)
- **Infrastructure & Backend:** [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## ⚡ 5-Minute Setup

### 1. Prerequisites (One-time)

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Verify
eas whoami
```

### 2. Configure Secrets

Add these to GitHub Settings → Secrets → Actions:

**Essential Secrets:**
```bash
EXPO_TOKEN                              # From: eas login
EXPO_PUBLIC_SUPABASE_URL                # From: supabase.com
EXPO_PUBLIC_SUPABASE_ANON_KEY          # From: supabase.com
EXPO_PUBLIC_PRODUCTION_API_URL         # Your API domain
EXPO_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY # From: stripe.com
EXPO_PUBLIC_SENTRY_DSN                 # From: sentry.io
```

See [GITHUB_SECRETS_GUIDE.md](./GITHUB_SECRETS_GUIDE.md) for complete list.

### 3. Build & Deploy

**Option A: Automatic (via GitHub Actions)**
```bash
# Push to main branch triggers production build
git push origin main
```

**Option B: Manual**
```bash
# Build for production
eas build --profile production --platform all

# Submit to stores
eas submit --platform ios --latest
eas submit --platform android --latest
```

---

## 📋 Pre-Deployment Checklist

### Configuration
- [ ] All GitHub Secrets configured
- [ ] API server deployed and healthy
- [ ] Database migrations completed
- [ ] Environment variables verified

### Testing
- [ ] Tests passing (`npm run test:ci`)
- [ ] Manual testing on real devices
- [ ] Payment flow tested with test cards
- [ ] Push notifications working

### Monitoring
- [ ] Sentry configured and receiving test errors
- [ ] Mixpanel tracking events
- [ ] Health check endpoint responding
- [ ] Alerts configured

### App Stores
- [ ] Apple Developer account active
- [ ] Google Play Console account active
- [ ] App Store listing complete
- [ ] Play Store listing complete
- [ ] Privacy policy published
- [ ] Terms of service published

---

## 🏗️ Build Profiles

### Development
```bash
eas build --profile development --platform ios
# For local testing, dev client enabled
```

### Staging
```bash
eas build --profile staging --platform all
# Internal testing, test Stripe keys
```

### Production
```bash
eas build --profile production --platform all
# Store distribution, live Stripe keys
```

---

## 🔄 Common Tasks

### Push OTA Update
```bash
# Staging
eas update --branch staging --message "Bug fixes"

# Production
eas update --branch production --message "Critical fix"
```

### Check Build Status
```bash
eas build:list
eas build:view <build-id>
```

### Rollback OTA Update
```bash
eas update:republish --branch production --group <previous-group-id>
```

### View Logs
```bash
# API logs
docker logs api-container --follow

# Or via CloudWatch
aws logs tail /ecs/bountyexpo-api --follow
```

---

## 📊 Monitoring Dashboard URLs

Once configured, access monitoring at:

- **Sentry:** https://sentry.io/organizations/your-org/projects/
- **Mixpanel:** https://mixpanel.com/project/your-project/
- **EAS Builds:** https://expo.dev/accounts/your-account/projects/BOUNTYExpo/builds
- **API Health:** https://api.bountyexpo.com/health

---

## 🚨 Emergency Procedures

### App Crashing in Production

1. **Immediate Action:**
   ```bash
   # Rollback OTA update
   eas update:republish --branch production --group <last-good-group>
   ```

2. **Investigation:**
   - Check Sentry for crash reports
   - Review recent changes
   - Test in staging

3. **Communication:**
   - Update status page
   - Notify users if needed

### API Down

1. **Check Health:**
   ```bash
   curl https://api.bountyexpo.com/health
   ```

2. **View Logs:**
   ```bash
   # CloudWatch
   aws logs tail /ecs/bountyexpo-api --follow
   
   # Or Docker
   docker logs api-container
   ```

3. **Rollback if Needed:**
   ```bash
   # Rollback to previous Docker image
   # See DEPLOYMENT.md for details
   ```

---

## 📁 File Structure

```
Bounty-production/
├── eas.json                           # EAS build configuration
├── app.json                           # Expo app configuration
├── .env.production                    # Production env (gitignored)
├── .env.staging                       # Staging env (gitignored)
├── .github/workflows/
│   ├── eas-build.yml                 # EAS build automation
│   ├── deploy-api.yml                # API deployment
│   └── ci.yml                        # Tests and linting
├── PRODUCTION_DEPLOYMENT_EAS.md      # Complete EAS guide
├── MONITORING_ALERTING_SETUP.md      # Monitoring setup
├── GITHUB_SECRETS_GUIDE.md           # Secrets reference
└── DEPLOYMENT.md                      # Infrastructure guide
```

---

## 🎯 Deployment Workflow

```
1. Code Changes
   ↓
2. Create PR
   ↓
3. CI Tests Run (GitHub Actions)
   ↓
4. Code Review
   ↓
5. Merge to main
   ↓
6. EAS Build Triggered (GitHub Actions)
   ↓
7. Build Completes
   ↓
8. Submit to App Stores (Manual or Auto)
   ↓
9. App Store Review (1-2 days iOS, varies Android)
   ↓
10. Release to Production
    ↓
11. Monitor (Sentry, Mixpanel, Logs)
```

**For Hotfixes:**
- Use OTA updates (bypasses app store review)
- Only for JavaScript/styling changes
- Takes effect within minutes

---

## 💡 Best Practices

### Version Control
- Main branch → Production
- Develop branch → Staging
- Feature branches → Development

### Testing
- Run tests locally before pushing
- All tests must pass in CI
- Test on real devices before production

### Deployment Timing
- Deploy during low-traffic hours
- Have team available during deployment
- Monitor for 30 minutes post-deployment

### Communication
- Announce deployments in team Slack
- Update changelog
- Notify users of major changes

---

## 🔗 Quick Links

### Documentation
- [Expo Docs](https://docs.expo.dev)
- [EAS Build Docs](https://docs.expo.dev/build/introduction/)
- [Sentry React Native](https://docs.sentry.io/platforms/react-native/)
- [Stripe Integration](https://stripe.com/docs/payments)

### Dashboards
- [Expo Dashboard](https://expo.dev)
- [Sentry Dashboard](https://sentry.io)
- [Mixpanel Dashboard](https://mixpanel.com)
- [Stripe Dashboard](https://dashboard.stripe.com)

### Support
- **Email:** devops@bountyexpo.com
- **Slack:** #engineering, #deployments
- **On-Call:** PagerDuty

---

## 📝 Next Steps

1. ✅ Set up GitHub Secrets
2. ✅ Configure monitoring (Sentry, Mixpanel)
3. ✅ Test staging build
4. ✅ Review app store listings
5. ✅ Schedule production deployment
6. ✅ Monitor deployment
7. ✅ Document any issues

---

## ❓ Need Help?

**Choose your guide:**

- **First time deploying?** → Read [PRODUCTION_DEPLOYMENT_EAS.md](./PRODUCTION_DEPLOYMENT_EAS.md)
- **Setting up monitoring?** → Read [MONITORING_ALERTING_SETUP.md](./MONITORING_ALERTING_SETUP.md)
- **Configuring secrets?** → Read [GITHUB_SECRETS_GUIDE.md](./GITHUB_SECRETS_GUIDE.md)
- **Deploying backend/infrastructure?** → Read [DEPLOYMENT.md](./DEPLOYMENT.md)

**Still stuck?**
- Check troubleshooting sections in detailed guides
- Review GitHub Actions logs
- Contact team on Slack

---

**Last Updated:** January 2026  
**Version:** 1.0.0
