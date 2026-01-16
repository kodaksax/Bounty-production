# Beta Deployment Quick Reference

> Quick commands and steps for deploying BOUNTY to beta testing

## 📋 Pre-Deployment Checklist

- [ ] Apple Developer Account active ($99/year)
- [ ] Google Play Developer Account active ($25 one-time)
- [ ] Expo account with EAS access
- [ ] EAS CLI installed (`npm install -g eas-cli`)
- [ ] Staging environment configured
- [ ] Test Stripe keys ready
- [ ] All code committed and pushed

## 🚀 Quick Start Commands

### Initial Setup (One-Time)

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure project for EAS
eas build:configure

# Set environment variables
eas secret:create --scope project --name STAGING_SUPABASE_URL --value "your-url"
eas secret:create --scope project --name STAGING_SUPABASE_ANON_KEY --value "your-key"
eas secret:create --scope project --name STRIPE_TEST_PUBLISHABLE_KEY --value "pk_test_xxxxx"
```

### iOS Beta Deployment

```bash
# Build for TestFlight
eas build --platform ios --profile preview

# Auto-submit to TestFlight (optional)
eas build --platform ios --profile preview --auto-submit

# Or submit after build
eas submit --platform ios --latest

# View build status
eas build:list --platform ios

# Publish OTA update (for JS-only changes)
eas update --branch beta --message "Fix message bug"
```

### Android Beta Deployment

```bash
# Build AAB for Play Store
eas build --platform android --profile preview

# Auto-submit to Play Console
eas build --platform android --profile preview --auto-submit

# Or submit after build
eas submit --platform android --latest

# Build APK for direct testing (faster)
eas build --platform android --profile preview --type apk

# View build status
eas build:list --platform android

# Publish OTA update
eas update --branch beta --message "Fix crash"
```

### Build Both Platforms

```bash
# Build for both iOS and Android
eas build --platform all --profile preview
```

## 📱 Platform Setup Summary

### iOS/TestFlight

1. **Apple Developer Portal**
   - Create App ID: `com.bounty.BOUNTYExpo`
   - Enable required capabilities
   - Let EAS handle certificates/profiles

2. **App Store Connect**
   - Create app record
   - Set up TestFlight
   - Create internal testing group
   - Add testers (up to 100)

3. **Timeline**
   - Build: 15-30 min
   - Upload: 5-15 min
   - Apple processing: 5-15 min
   - Beta review: 1-24 hours
   - **Total: ~1-25 hours**

### Android/Play Console

1. **Google Play Console**
   - Create app
   - Complete all setup sections
   - Set up internal testing track

2. **Service Account (for EAS)**
   - Create in Google Cloud Console
   - Download JSON key
   - Grant Play Console access

3. **Timeline**
   - Build: 10-20 min
   - Upload: 2-5 min
   - Processing: 1-5 min
   - **No review for internal testing**
   - **Total: ~15-30 min**

## 👥 Managing Testers

### Add iOS Testers (TestFlight)

1. App Store Connect → TestFlight → Internal Testing
2. Select testing group
3. Click "Add Testers"
4. Enter email addresses (up to 100)
5. Testers receive automatic invitation

**Share Link**: Get from TestFlight page

### Add Android Testers (Play Console)

1. Play Console → Testing → Internal testing
2. Create email list
3. Add emails (up to 100)
4. Or share opt-in link

**Share Link**: Copy from Internal testing page

## 📝 Version Management

### Update Version Numbers

**app.json:**
```json
{
  "version": "1.0.0-beta.2",
  "ios": {
    "buildNumber": "2"
  },
  "android": {
    "versionCode": 2
  }
}
```

Or use auto-increment in **eas.json:**
```json
{
  "build": {
    "preview": {
      "ios": {
        "buildNumber": "auto"
      },
      "android": {
        "versionCode": "auto"
      }
    }
  }
}
```

### Create Git Tag

```bash
git tag -a v1.0.0-beta.2 -m "Beta release 2"
git push origin v1.0.0-beta.2
```

## 🔄 Update Workflows

### OTA Update (for JS changes)

```bash
# Publish to beta channel
eas update --branch beta --message "Bug fix"

# View update status
eas update:view --branch beta

# Gradual rollout
eas update --branch beta --message "New feature" --rollout-percentage 25
eas update:rollout --branch beta --percentage 100
```

### New Build (for native changes)

Requires new build when:
- Native module updated
- app.json configuration changed
- Permissions changed
- New native dependencies

```bash
# Increment version, then:
eas build --platform [ios|android] --profile preview
eas submit --platform [ios|android] --latest
```

## 🐛 Common Issues

### Build Failed

```bash
# Clear cache and retry
eas build --platform [ios|android] --profile preview --clear-cache

# Check TypeScript errors
pnpm type-check

# Verify credentials
eas credentials -p [ios|android]
```

### iOS: Provisioning Profile Error

```bash
# Delete and regenerate credentials
eas credentials:delete -p ios
eas build --platform ios --profile preview
```

### Android: Keystore Error

```bash
# Reset credentials (use with caution!)
eas credentials:delete -p android
eas build --platform android --profile preview

# Or download backup
eas credentials -p android
# Select "Download Android Keystore"
```

### Tester Can't Install

**iOS:**
- Verify tester is in group
- Check tester accepted invitation
- Ensure TestFlight app updated
- Wait up to 24 hours for review

**Android:**
- Verify email in tester list
- Check tester accepted opt-in
- Ensure using correct Google account
- Wait up to 1 hour for processing

## 📊 Monitoring

### View Build Logs

```bash
# List recent builds
eas build:list

# View specific build
eas build:view [BUILD_ID]

# View in browser
# URL provided after build starts
```

### TestFlight Metrics

- App Store Connect → TestFlight → Build
- View installs, sessions, crashes
- Read tester feedback

### Play Console Metrics

- Play Console → App → Quality → Android vitals
- View installs, crashes, ANRs
- Read user feedback

## 📧 Communication Templates

### Release Announcement

**Subject**: New BOUNTY Beta Build Available! (v1.0.0-beta.X)

Body: See `docs/templates/BETA_RELEASE_NOTES_TEMPLATE.md`

### Bug Report Template

```
Beta Version: 1.0.0-beta.2
Device: iPhone 14, iOS 17.2
Issue: [Brief title]
Steps: 
1. [Step 1]
2. [Step 2]
3. [What happened]
Expected: [Expected behavior]
Actual: [Actual behavior]
```

## 🔗 Important Links

### Documentation
- Full Guide: [BETA_DEPLOYMENT_GUIDE.md](./BETA_DEPLOYMENT_GUIDE.md)
- iOS Guide: [TESTFLIGHT_SETUP.md](./TESTFLIGHT_SETUP.md)
- Android Guide: [GOOGLE_PLAY_BETA_SETUP.md](./GOOGLE_PLAY_BETA_SETUP.md)
- Testing Checklist: [BETA_TESTING_CHECKLIST.md](./BETA_TESTING_CHECKLIST.md)

### External Resources
- App Store Connect: https://appstoreconnect.apple.com
- Play Console: https://play.google.com/console
- Expo Dashboard: https://expo.dev
- EAS Docs: https://docs.expo.dev/eas/

### Support
- Beta Email: beta@bountyfinder.app
- Dev Team: dev@bountyfinder.app
- Urgent Issues: urgent@bountyfinder.app

## 🎯 Typical Beta Cycle

1. **Week 1: Internal Testing**
   - Deploy to 10-20 internal testers
   - Fix critical bugs
   - Iterate quickly with OTA updates

2. **Week 2-3: Expanded Beta**
   - Add 30-50 more testers
   - Test at scale
   - Fix high-priority bugs
   - Deploy new builds weekly

3. **Week 4: Stabilization**
   - Focus on bug fixes
   - No new features
   - Final polish
   - Prepare for production

4. **Week 5: Production Prep**
   - Complete store listings
   - Prepare marketing materials
   - Final beta build
   - Submit for app store review

## 🚨 Emergency Procedures

### Critical Bug in Beta

```bash
# If OTA update possible:
eas update --branch beta --message "Critical fix" --rollout-percentage 100

# If new build required:
# 1. Fix bug locally
# 2. Test thoroughly
# 3. Increment version
git commit -am "Critical fix: [description]"
eas build --platform all --profile preview
eas submit --platform all --latest

# 4. Notify testers via email
```

### Rollback to Previous Build

**iOS:**
- Not possible to rollback in TestFlight
- Upload new build with fix
- Disable problematic build

**Android:**
- Create new release with previous AAB
- Or upload new build with fix

**OTA Updates:**
```bash
# Rollback to previous update
eas update:rollback --branch beta
```

## ✅ Pre-Release Checklist

Before promoting to production:

- [ ] All P0 and P1 bugs fixed
- [ ] Crash-free rate > 99%
- [ ] Core flows tested by 20+ users
- [ ] Performance metrics acceptable
- [ ] Positive feedback from 80%+ testers
- [ ] Store listings complete
- [ ] Marketing materials ready
- [ ] Support documentation updated
- [ ] Privacy policy and terms updated
- [ ] App Store screenshots prepared
- [ ] Production environment tested
- [ ] Rollback plan documented

## 💡 Tips

- **Build at consistent times** (e.g., every Monday 10am)
- **Communicate regularly** with testers (weekly updates)
- **Respond to feedback** within 24 hours
- **Track metrics** in a spreadsheet or tool
- **Thank testers** frequently!
- **Iterate quickly** during beta (that's the point)
- **Don't wait for perfection** to get initial builds out
- **Use OTA updates** for rapid JS-only fixes
- **Keep testers informed** of known issues

## 📞 Help Resources

Stuck? Check these in order:

1. Search [troubleshooting sections](./BETA_DEPLOYMENT_GUIDE.md#troubleshooting)
2. Check [EAS Build docs](https://docs.expo.dev/build/introduction/)
3. Search [Expo forums](https://forums.expo.dev/)
4. Ask in Discord: https://chat.expo.dev/
5. Email: beta@bountyfinder.app

---

*Last Updated: January 2026*
*Keep this guide handy during beta deployment!*
