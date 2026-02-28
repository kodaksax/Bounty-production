# BOUNTY Internal Beta Deployment Guide

> Comprehensive guide for deploying and managing the BOUNTY app internal beta to TestFlight (iOS) and Google Play Console (Android)

## Table of Contents

- [Overview](#overview)
- [Beta Testing Goals](#beta-testing-goals)
- [Prerequisites](#prerequisites)
- [iOS Beta Deployment (TestFlight)](#ios-beta-deployment-testflight)
- [Android Beta Deployment (Google Play Console)](#android-beta-deployment-google-play-console)
- [Beta Tester Management](#beta-tester-management)
- [Feedback Collection](#feedback-collection)
- [Known Issues & Workarounds](#known-issues--workarounds)
- [Version Management](#version-management)
- [Troubleshooting](#troubleshooting)

---

## Overview

This guide covers the complete process for deploying the BOUNTY mobile app to internal beta testing channels:

- **TestFlight** for iOS beta distribution
- **Google Play Console Internal Testing** for Android beta distribution

The internal beta phase is designed to validate core functionality, identify critical bugs, and gather user feedback before a wider public release.

### What is Internal Beta Testing?

Internal beta testing allows you to:
- Test the app with a limited group of trusted testers
- Collect focused feedback on specific features
- Identify and fix critical issues before public release
- Validate the deployment pipeline and update process
- Ensure compliance with App Store and Play Store requirements

---

## Beta Testing Goals

### Primary Objectives

1. **Functional Validation**
   - Verify all core user flows work as expected
   - Test bounty creation, acceptance, and completion
   - Validate payment and escrow functionality
   - Test messaging and real-time updates
   - Verify authentication and profile management

2. **Performance Testing**
   - Monitor app performance on various devices
   - Identify memory leaks or performance bottlenecks
   - Test under different network conditions
   - Validate offline functionality

3. **User Experience Feedback**
   - Gather feedback on UI/UX design
   - Identify confusing workflows or terminology
   - Test accessibility features
   - Validate onboarding experience

4. **Technical Validation**
   - Test push notifications
   - Validate deep linking
   - Test third-party integrations (Stripe, Supabase)
   - Verify data persistence and sync

### Success Criteria

- [ ] All critical user flows complete without errors
- [ ] No P0 or P1 bugs reported
- [ ] Average crash-free sessions > 99%
- [ ] Positive feedback from 80%+ of testers
- [ ] All payment test transactions successful
- [ ] Push notifications delivered successfully

---

## Prerequisites

### Required Accounts & Access

- [ ] **Apple Developer Account** ($99/year)
  - Team admin or developer role
  - Access to App Store Connect
  
- [ ] **Google Play Developer Account** ($25 one-time fee)
  - Access to Play Console
  - Internal testing enabled

- [ ] **Expo Account**
  - Signed up at [expo.dev](https://expo.dev)
  - EAS CLI installed locally
  
- [ ] **Access to Production Services**
  - Supabase project for authentication
  - Stripe account (test mode) for payments
  - Backend API accessible

### Required Tools

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Verify installation
eas --version

# Login to Expo account
eas login

# Verify project configuration
eas build:configure
```

### Repository Setup

```bash
# Clone the repository
git clone https://github.com/kodaksax/Bounty-production.git
cd Bounty-production

# Install dependencies
pnpm install

# Verify TypeScript compilation
pnpm type-check

# Test local build
npx expo start
```

---

## iOS Beta Deployment (TestFlight)

### Step 1: Configure App Store Connect

1. **Create App Record**
   - Navigate to [App Store Connect](https://appstoreconnect.apple.com)
   - Click "My Apps" → "+" → "New App"
   - Fill in app information:
     - **Platform**: iOS
     - **Name**: BOUNTY
     - **Primary Language**: English (U.S.)
     - **Bundle ID**: `com.bounty.BOUNTYExpo` (matches app.json)
     - **SKU**: `bounty-ios-001` (or your preference)
     - **User Access**: Full Access

2. **Configure App Information**
   - Navigate to your app → "App Information"
   - Set **Category**: Productivity (or appropriate category)
   - Set **Content Rights**: Use appropriate declaration
   - Add **Privacy Policy URL**: (your privacy policy URL)
   - Add **Support URL**: (your support page URL)

3. **Set Up Test Flight**
   - Navigate to "TestFlight" tab
   - Click "Internal Testing" in sidebar
   - Create a new internal testing group: "BOUNTY Beta Testers"

### Step 2: Configure iOS Build Settings

Review and update `app.json` for beta builds:

```json
{
  "expo": {
    "name": "BOUNTY Beta",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "com.bounty.BOUNTYExpo",
      "buildNumber": "1",
      "supportsTablet": true,
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false,
        "NSPhotoLibraryUsageDescription": "BOUNTY needs access to your photo library...",
        "NSLocationWhenInUseUsageDescription": "BOUNTY needs your location to show nearby bounties..."
      }
    }
  }
}
```

Update `eas.json` for beta builds:

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "channel": "beta",
      "ios": {
        "simulator": false,
        "buildNumber": "auto"
      },
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api-staging.bountyfinder.app",
        "EXPO_PUBLIC_SUPABASE_URL": "your-staging-supabase-url",
        "EXPO_PUBLIC_ENVIRONMENT": "beta"
      }
    }
  }
}
```

### Step 3: Build for iOS Beta

```bash
# Start iOS beta build
eas build --platform ios --profile preview

# Monitor build progress
# EAS will provide a build URL to track progress

# Once complete, the build will be automatically submitted to TestFlight
```

**Build Process Steps:**
1. EAS uploads your project to Expo servers
2. Project is built on Apple's infrastructure
3. Binary is signed with your Apple Developer credentials
4. Build is uploaded to TestFlight (if auto-submit is enabled)
5. You'll receive an email when the build is ready

**Typical Build Time:** 15-30 minutes

### Step 4: Submit to TestFlight

If auto-submit isn't configured:

```bash
# Submit the latest iOS build to TestFlight
eas submit --platform ios --latest
```

Or manually:
1. Download the `.ipa` file from EAS build page
2. Upload to App Store Connect via Transporter app
3. Wait for processing (5-15 minutes)

### Step 5: Configure TestFlight Build

1. **Navigate to TestFlight** in App Store Connect
2. **Select your build** under "Builds" section
3. **Add Test Information**:
   - **What to Test**: Describe beta testing focus areas
   - **Email**: Optional additional information for testers
   - **App Review Information**: Contact details
   - **Export Compliance**: Select "No" if not using encryption

4. **Review Build Status**
   - Status should change to "Ready to Submit"
   - Build will go through Apple's beta review (1-24 hours)
   - You'll receive email when approved

### Step 6: Invite Internal Testers

1. **Add Testers to Internal Group**
   - Navigate to TestFlight → Internal Testing
   - Click on "BOUNTY Beta Testers" group
   - Click "Add Testers"
   - Enter email addresses (up to 100 internal testers)
   - Testers must have Apple IDs

2. **Enable Build for Group**
   - Select your testing group
   - Click "Builds" → "+" to add a build
   - Select your latest beta build
   - Click "Next" → "Submit"

3. **Testers Receive Invitation**
   - Testers get email invitation
   - They must install TestFlight app from App Store
   - Accept invitation and install BOUNTY beta

**Note**: Internal testers don't count against your 10,000 external tester limit.

### Step 7: Monitor TestFlight Metrics

Track beta performance:
- **Installs**: Number of testers who installed
- **Sessions**: Number of app sessions
- **Crashes**: Crash reports and logs
- **Feedback**: Screenshot feedback from testers

Access metrics at: TestFlight → Your Build → Activity

---

## Android Beta Deployment (Google Play Console)

### Step 1: Configure Google Play Console

1. **Create App**
   - Navigate to [Google Play Console](https://play.google.com/console)
   - Click "Create app"
   - Fill in app details:
     - **App name**: BOUNTY
     - **Default language**: English (United States)
     - **App or game**: App
     - **Free or paid**: Free (or paid if applicable)
     - **Package name**: `app.bountyfinder.BOUNTYExpo`

2. **Complete App Setup**
   - Complete all required sections:
     - App access
     - Ads
     - Content rating
     - Target audience
     - News apps
     - COVID-19 contact tracing and status apps
     - Data safety
     - Government apps
     - Financial features

3. **Set Up Internal Testing Track**
   - Navigate to "Testing" → "Internal testing"
   - Click "Create new release"
   - This will be used for beta deployment

### Step 2: Configure Android Build Settings

Review `app.json` for Android:

```json
{
  "expo": {
    "android": {
      "package": "app.bountyfinder.BOUNTYExpo",
      "versionCode": 1,
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/bounty-icon.png",
        "backgroundColor": "#ffffff"
      },
      "permissions": [
        "ACCESS_FINE_LOCATION",
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE"
      ]
    }
  }
}
```

Update `eas.json` for Android beta:

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "channel": "beta",
      "android": {
        "buildType": "apk",
        "versionCode": "auto"
      },
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api-staging.bountyfinder.app",
        "EXPO_PUBLIC_SUPABASE_URL": "your-staging-supabase-url",
        "EXPO_PUBLIC_ENVIRONMENT": "beta"
      }
    }
  }
}
```

### Step 3: Build for Android Beta

```bash
# Start Android beta build
eas build --platform android --profile preview

# For internal testing, you can also build APK for faster testing
eas build --platform android --profile preview --type apk
```

**Build Types:**
- **APK**: Faster to build, easier to distribute directly
- **AAB** (Android App Bundle): Required for Play Store, smaller downloads

**Typical Build Time:** 10-20 minutes

### Step 4: Submit to Google Play Internal Testing

```bash
# Submit to Play Console
eas submit --platform android --latest --track internal
```

Or manually:
1. Download the `.aab` or `.apk` from EAS
2. Navigate to Play Console → Testing → Internal testing
3. Click "Create new release"
4. Upload your `.aab` file
5. Add release notes
6. Review and roll out to internal testing

### Step 5: Configure Internal Testing

1. **Create Tester List**
   - Navigate to "Testing" → "Internal testing"
   - Under "Testers", click "Create email list"
   - Name: "BOUNTY Beta Testers"
   - Add tester emails (up to 100 for internal testing)

2. **Enable Access**
   - Internal testers get immediate access
   - No review process for internal testing
   - Builds available within minutes of upload

3. **Share Testing Link**
   - Copy the "Copy link" URL from Internal testing page
   - Share with your testers
   - Link format: `https://play.google.com/apps/internaltest/...`

### Step 6: Invite Internal Testers

**Option 1: Email List** (Recommended)
1. Add emails to your "BOUNTY Beta Testers" list
2. Google sends automatic invitations
3. Testers click link and opt-in
4. They can then download from Play Store

**Option 2: Share Link Directly**
1. Copy internal testing link from Play Console
2. Share link via email/Slack/etc.
3. Testers must opt-in first time
4. They can then install from Play Store

**Important**: Testers must have Gmail accounts or Google accounts.

### Step 7: Monitor Play Console Metrics

Track performance:
- **Installs**: Active testers and install counts
- **Crashes**: Pre-launch reports and crash logs
- **ANRs**: Application Not Responding errors
- **Feedback**: User feedback and ratings

Access at: Play Console → Your App → Quality → Android vitals

---

## Beta Tester Management

### Recruiting Beta Testers

**Ideal Beta Tester Profile:**
- Willingness to provide detailed feedback
- Available for 2-4 weeks of testing
- Diverse device types (old and new)
- Various network conditions
- Mix of iOS and Android users

**Recruitment Channels:**
- Internal team members
- Friends and family
- Early supporters/waitlist
- Social media community
- User research panels

**Recommended Group Size:**
- **Internal Beta**: 20-50 testers
- **iOS**: 10-25 testers
- **Android**: 10-25 testers

### Tester Onboarding

**Send Welcome Email** (template in `docs/beta-tester-welcome-email.md`):

```
Subject: Welcome to BOUNTY Internal Beta! 🎉

Hi [Name],

Thank you for joining the BOUNTY internal beta! You're helping us build something special.

Getting Started:
1. Install TestFlight (iOS) or accept Play Store invitation (Android)
2. Install BOUNTY Beta app
3. Create your account and complete onboarding
4. Start testing! See attached testing guide

What to Test:
- Create a bounty and see how it works
- Accept a bounty as a hunter
- Test messaging between poster and hunter
- Try completing a bounty and releasing payment
- Report any bugs or confusing experiences

How to Provide Feedback:
- Use the in-app feedback button
- Email beta@bountyfinder.app
- Join our Slack channel: #bounty-beta

Testing Period: [Start Date] - [End Date]

Questions? Reply to this email!

Best,
The BOUNTY Team
```

**Provide Testing Guide**: See `BETA_TESTING_CHECKLIST.md`

### Managing Tester Feedback

**Set Up Feedback Channels:**

1. **In-App Feedback**
   - Implement feedback button in app
   - Collect device info, screenshots automatically
   - Send to your support system

2. **Dedicated Email**: `beta@bountyfinder.app`
   - Monitor daily
   - Respond within 24 hours
   - Track issues in project management tool

3. **Slack/Discord Channel**: `#bounty-beta`
   - Real-time discussions
   - Quick troubleshooting
   - Community building

4. **Weekly Survey**
   - Send weekly check-in via email
   - Ask about specific features
   - Track sentiment over time

**Feedback Template**:
```
Beta Feedback - Week [X]

What worked well:
- [Feature/flow that worked]

What didn't work:
- [Issues encountered]

What was confusing:
- [UX/clarity issues]

Suggestions:
- [Improvements]

Device: [Model]
OS Version: [Version]
App Version: [Version]
```

---

## Feedback Collection

### Setting Up Feedback Systems

**1. In-App Feedback (Recommended)**

Implement a feedback mechanism:

```typescript
// lib/services/feedbackService.ts
import * as Device from 'expo-device';
import * as Application from 'expo-application';

interface FeedbackData {
  message: string;
  category: 'bug' | 'feature' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  screenshot?: string;
  deviceInfo: {
    model: string;
    osVersion: string;
    appVersion: string;
  };
}

export async function submitFeedback(data: FeedbackData) {
  const deviceInfo = {
    model: Device.modelName || 'Unknown',
    osVersion: Device.osVersion || 'Unknown',
    appVersion: Application.nativeApplicationVersion || 'Unknown',
  };

  // Send to your backend or feedback service
  await fetch('https://api.bountyfinder.app/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...data,
      deviceInfo,
      timestamp: new Date().toISOString(),
    }),
  });
}
```

**2. Crash Reporting**

Already integrated via Sentry:
- Automatic crash reports
- Performance monitoring
- Release tracking
- User feedback on errors

**3. Analytics Events**

Track key metrics:
```typescript
// Track beta-specific events
analytics.track('beta_bounty_created', {
  userId: user.id,
  bountyType: 'standard',
  amount: bounty.amount,
});

analytics.track('beta_feature_used', {
  feature: 'messaging',
  duration: sessionDuration,
});
```

**4. User Interviews**

Schedule 1-on-1 sessions:
- 30-minute video calls
- Walk through specific flows
- Observe where they struggle
- Ask open-ended questions

### Prioritizing Feedback

**Bug Severity Levels:**

| Severity | Definition | Response Time |
|----------|------------|---------------|
| **P0 - Critical** | App crashes, data loss, security issues | Immediate (< 4 hours) |
| **P1 - High** | Major feature broken, blocking user flows | Same day |
| **P2 - Medium** | Feature partially working, workaround exists | Within 3 days |
| **P3 - Low** | Minor issues, cosmetic problems | Next sprint |

**Feature Request Evaluation:**

Score requests based on:
- **Impact**: How many users does this affect?
- **Effort**: How much work is required?
- **Alignment**: Does this fit our vision?
- **Urgency**: Is this needed before public launch?

### Acting on Feedback

**Weekly Review Process:**
1. Collect all feedback from channels
2. Categorize by type (bug, feature, UX)
3. Prioritize based on severity/impact
4. Assign to team members
5. Update testers on progress
6. Deploy fixes and notify testers

**Closing the Loop:**
- Always respond to tester feedback
- Thank them for their contribution
- Explain what action you're taking
- Notify when their issue is fixed

---

## Known Issues & Workarounds

### Current Known Issues

**1. iOS Sign-In Delay (P2)**
- **Issue**: First sign-in can take 5-10 seconds
- **Workaround**: Inform users to wait; loading indicator shown
- **Status**: Investigating Supabase auth latency
- **Target Fix**: Version 1.0.1

**2. Android Push Notifications Intermittent (P2)**
- **Issue**: Push notifications don't always appear on Android
- **Workaround**: Pull to refresh in-app to see updates
- **Status**: Investigating FCM token refresh
- **Target Fix**: Version 1.0.2

**3. Image Upload on Older Android Devices (P3)**
- **Issue**: Image picker crashes on Android < 10
- **Workaround**: Use alternative image picker library
- **Status**: Testing fix
- **Target Fix**: Version 1.0.1

**4. Offline Mode Limited (P3)**
- **Issue**: Some features don't work offline
- **Workaround**: Require internet connection for now
- **Status**: Planned enhancement
- **Target Fix**: Version 1.1.0

### Reporting New Issues

**When you encounter a bug, collect:**

1. **Steps to Reproduce**
   ```
   1. Open app
   2. Navigate to [screen]
   3. Tap [button]
   4. Expected: [X], Actual: [Y]
   ```

2. **Device Information**
   - Device model
   - OS version
   - App version
   - Network condition (WiFi/4G/5G)

3. **Screenshots/Videos**
   - Use built-in screenshot tools
   - Record screen video if issue is complex

4. **Console Logs** (if developer)
   - Open Xcode console (iOS)
   - Open Android Studio logcat (Android)
   - Copy relevant error messages

**Submit via:**
- In-app feedback button
- Email: beta@bountyfinder.app
- GitHub Issues (for developer testers)

---

## Version Management

### Version Numbering Strategy

**Format**: `MAJOR.MINOR.PATCH-BUILD`

Example: `1.0.0-beta.1`

- **MAJOR**: Breaking changes (e.g., 1.x.x → 2.x.x)
- **MINOR**: New features (e.g., 1.0.x → 1.1.x)
- **PATCH**: Bug fixes (e.g., 1.0.0 → 1.0.1)
- **BUILD**: Build number (auto-incremented by EAS)

**Beta Versioning:**
- Beta builds: `1.0.0-beta.1`, `1.0.0-beta.2`, etc.
- Release candidates: `1.0.0-rc.1`, `1.0.0-rc.2`, etc.
- Production: `1.0.0`, `1.0.1`, etc.

### Incrementing Versions

**Before Each Beta Release:**

1. **Update app.json**
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

2. **Update package.json**
   ```json
   {
     "version": "1.0.0-beta.2"
   }
   ```

3. **Create Git Tag**
   ```bash
   git tag -a v1.0.0-beta.2 -m "Beta release 2"
   git push origin v1.0.0-beta.2
   ```

### Release Notes Template

**Beta Release Notes** (`RELEASE_NOTES.md`):

```markdown
# Version 1.0.0-beta.2

Released: [Date]

## What's New
- [New feature or improvement]
- [New feature or improvement]

## Bug Fixes
- Fixed [specific bug]
- Resolved [specific issue]

## Known Issues
- [Known issue with workaround]
- [Known issue being investigated]

## Testing Focus
This release focuses on:
- [Specific area to test]
- [Specific flow to validate]

Please report any issues via the in-app feedback button!
```

### OTA Updates vs Store Releases

**Over-The-Air (OTA) Updates:**
- For JavaScript/content changes only
- Instant updates without app store approval
- Use during beta for rapid iteration

```bash
# Publish OTA update to beta channel
eas update --branch beta --message "Fix messaging bug"
```

**Store Releases:**
- Required for native code changes
- Required for app.json config changes
- Takes 1-24 hours for review (TestFlight)
- Use for major features or native fixes

**Decision Matrix:**

| Change Type | Update Method |
|-------------|---------------|
| JS bug fix | OTA Update |
| UI tweaks | OTA Update |
| New JS feature | OTA Update |
| Native library update | Store Release |
| Permissions change | Store Release |
| Bundle ID change | Store Release |

---

## Troubleshooting

### Common Build Issues

**1. "Provisioning profile doesn't include the application identifier"**

**Solution:**
```bash
# Clear EAS credentials and re-generate
eas credentials:delete -p ios
eas build --platform ios --profile preview --clear-cache
```

**2. "Build failed: Task exited with non-zero code"**

**Solution:**
```bash
# Check build logs for specific error
# Common fixes:
npm run type-check  # Fix TypeScript errors
pnpm install       # Reinstall dependencies
eas build --platform [ios|android] --profile preview --clear-cache
```

**3. "Android build fails with gradle error"**

**Solution:**
```bash
# Clear gradle cache
rm -rf android/.gradle
rm -rf android/build

# Rebuild
eas build --platform android --profile preview --clear-cache
```

### Common Testing Issues

**1. "TestFlight build not appearing"**

**Troubleshooting:**
- Check build status in App Store Connect
- Verify build passed beta review
- Ensure you're in the correct testing group
- Wait up to 24 hours for Apple review

**2. "Can't install from Play Store internal testing"**

**Troubleshooting:**
- Verify tester accepted invitation
- Check tester is using correct Google account
- Ensure tester is in the tester list
- Try removing and re-adding tester

**3. "App crashes on startup"**

**Troubleshooting:**
- Check environment variables are set correctly
- Verify API endpoints are accessible
- Check Sentry for crash logs
- Test with different network conditions

**4. "Push notifications not working"**

**Troubleshooting:**
- Verify push certificates (iOS) or FCM config (Android)
- Check notification permissions granted
- Test push notification endpoint
- Verify device token registration

### Getting Help

**Internal Support:**
- Engineering team Slack: `#bounty-engineering`
- Direct email: dev@bountyfinder.app

**External Resources:**
- [Expo EAS Documentation](https://docs.expo.dev/eas/)
- [TestFlight Help](https://developer.apple.com/testflight/)
- [Play Console Help](https://support.google.com/googleplay/android-developer)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/expo)

**Emergency Contact:**
- For critical production issues: [on-call phone/pager]
- For security issues: security@bountyfinder.app

---

## Next Steps After Beta

Once beta testing is complete:

### 1. Analyze Results
- [ ] Review all feedback and prioritize fixes
- [ ] Analyze crash and performance metrics
- [ ] Calculate key metrics (retention, engagement)
- [ ] Conduct post-beta survey

### 2. Prepare for Production
- [ ] Fix all P0 and P1 issues
- [ ] Address critical UX feedback
- [ ] Update App Store/Play Store listings
- [ ] Prepare marketing materials
- [ ] Create production environment variables

### 3. Production Release
- [ ] Build production versions
- [ ] Submit for App Store review
- [ ] Promote to production in Play Console
- [ ] Monitor closely for first 48 hours
- [ ] Prepare rollback plan

### 4. Post-Launch
- [ ] Send thank you to beta testers
- [ ] Share launch announcement
- [ ] Monitor user reviews and ratings
- [ ] Plan first update based on feedback

---

## Appendix

### Useful Commands Reference

```bash
# EAS Build Commands
eas build --platform ios --profile preview                # iOS beta build
eas build --platform android --profile preview            # Android beta build
eas build --platform all --profile preview                # Both platforms

# EAS Submit Commands
eas submit --platform ios --latest                        # Submit to TestFlight
eas submit --platform android --latest --track internal   # Submit to Play Console

# EAS Update Commands (OTA)
eas update --branch beta --message "Bug fix"              # Push OTA update
eas update:view --branch beta                             # View update status

# Build Management
eas build:list                                            # List recent builds
eas build:view [BUILD_ID]                                 # View specific build
eas build:cancel [BUILD_ID]                               # Cancel running build

# Credentials Management
eas credentials                                            # Manage credentials
eas credentials:delete -p ios                             # Delete iOS credentials
eas credentials:delete -p android                         # Delete Android credentials

# Development
npx expo start                                            # Start dev server
pnpm type-check                                           # Check TypeScript
pnpm test                                                 # Run tests
```

### Resources

- **Official Documentation**: [DEPLOYMENT.md](./DEPLOYMENT.md)
- **iOS Setup**: [TESTFLIGHT_SETUP.md](./TESTFLIGHT_SETUP.md)
- **Android Setup**: [GOOGLE_PLAY_BETA_SETUP.md](./GOOGLE_PLAY_BETA_SETUP.md)
- **Testing Checklist**: [BETA_TESTING_CHECKLIST.md](./BETA_TESTING_CHECKLIST.md)
- **Feedback Template**: [docs/beta-feedback-template.md](./docs/beta-feedback-template.md)
- **Release Notes**: [RELEASE_NOTES.md](./RELEASE_NOTES.md)

### Contact

- **Beta Program Manager**: beta@bountyfinder.app
- **Engineering Team**: dev@bountyfinder.app
- **Security Issues**: security@bountyfinder.app

---

*Last Updated: January 2026*
*Version: 1.0*
