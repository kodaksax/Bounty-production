# Google Play Console Beta Setup Guide for BOUNTY

> Comprehensive guide for deploying BOUNTY to Google Play Console internal testing track for Android beta distribution

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Google Play Console Account Setup](#google-play-console-account-setup)
- [App Creation and Configuration](#app-creation-and-configuration)
- [EAS Build Configuration for Android](#eas-build-configuration-for-android)
- [Building for Google Play](#building-for-google-play)
- [Internal Testing Setup](#internal-testing-setup)
- [Managing Testers](#managing-testers)
- [Closed Testing and Open Testing](#closed-testing-and-open-testing)
- [OTA Updates](#ota-updates)
- [Troubleshooting](#troubleshooting)

---

## Overview

Google Play Console provides multiple testing tracks for distributing your Android app:

- **Internal Testing**: Up to 100 testers, immediate access, no review
- **Closed Testing**: Unlimited testers in managed lists, quick review
- **Open Testing**: Public, anyone can join, full review

This guide focuses on **Internal Testing** for initial beta deployment, with information on progressing to other tracks.

**Key Benefits:**
- No Google review for internal testing
- Instant updates (typically < 1 hour)
- Staged rollouts available
- Pre-launch reports and crash analytics
- Multiple APK/AAB support

---

## Prerequisites

### Required Accounts and Services

- [ ] **Google Play Developer Account** ($25 one-time fee)
  - Google account (Gmail or Google Workspace)
  - Payment method for registration fee
  - Two-factor authentication enabled

- [ ] **Google Cloud Project** (Optional but recommended)
  - For advanced features (maps, Firebase, etc.)
  - Service account for API access

- [ ] **Expo Account**
  - Registered at [expo.dev](https://expo.dev)
  - EAS CLI installed (`npm install -g eas-cli`)
  - Authenticated (`eas login`)

### Required Tools

```bash
# Install EAS CLI
npm install -g eas-cli

# Install bundletool (for testing AAB locally)
brew install bundletool  # macOS
# Or download from: https://github.com/google/bundletool/releases

# Verify installations
eas --version
bundletool version
```

### App Information

Prepare the following information:
- **App Name**: BOUNTY
- **Package Name**: `app.bountyfinder.BOUNTYExpo`
- **Category**: Productivity
- **Content Rating**: Everyone (or appropriate rating)
- **Privacy Policy URL**: Your privacy policy
- **Support Email**: support@bountyfinder.app

---

## Google Play Console Account Setup

### Step 1: Create Google Play Developer Account

1. **Go to Google Play Console**
   - Visit [play.google.com/console/signup](https://play.google.com/console/signup)
   - Sign in with your Google account

2. **Accept Developer Agreement**
   - Read and accept the Google Play Developer Distribution Agreement
   - Check the box to confirm acceptance

3. **Pay Registration Fee**
   - One-time fee of $25
   - Payment via credit card or Google Pay
   - Non-refundable

4. **Complete Account Details**
   - **Account type**: Individual or Organization
   - **Developer name**: Will be shown to users
   - **Email address**: Contact email (e.g., developer@bountyfinder.app)
   - **Phone number**: Contact phone
   - **Website**: Your website URL (optional but recommended)

5. **Wait for Verification**
   - Account verification can take 24-48 hours
   - You'll receive email when ready
   - Can create apps during verification, but can't publish

### Step 2: Enable Two-Factor Authentication

1. **Go to Google Account Security**
   - Visit [myaccount.google.com/security](https://myaccount.google.com/security)
   - Sign in with your developer account

2. **Enable 2-Step Verification**
   - Click "2-Step Verification"
   - Follow setup instructions
   - Choose method: SMS, authenticator app, or security key
   - Recommended: Use authenticator app for reliability

### Step 3: Set Up Service Account (For EAS CLI)

1. **Create Google Cloud Project**
   - Go to [console.cloud.google.com](https://console.cloud.google.com)
   - Create new project: "BOUNTY Production"
   - Note the Project ID

2. **Enable Google Play Android Developer API**
   - In Cloud Console, go to "APIs & Services" → "Library"
   - Search for "Google Play Android Developer API"
   - Click "Enable"

3. **Create Service Account**
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "Service Account"
   - Name: "EAS Build Service Account"
   - Role: "Service Account User"
   - Click "Done"

4. **Create Service Account Key**
   - Click on the service account you just created
   - Go to "Keys" tab
   - Click "Add Key" → "Create New Key"
   - Choose JSON format
   - Save file as `google-service-account.json`
   - **Keep this file secure!**

5. **Link Service Account to Play Console**
   - Go to Play Console
   - Navigate to "Setup" → "API access"
   - Click "Link" next to your Google Cloud project
   - Grant access to the service account
   - Set permissions:
     - [ ] View app information and download bulk reports
     - [ ] Manage production releases
     - [ ] Manage testing track releases

---

## App Creation and Configuration

### Step 1: Create App in Play Console

1. **Navigate to Play Console**
   - Go to [play.google.com/console](https://play.google.com/console)
   - Click "Create app"

2. **Fill in App Details**
   - **App name**: BOUNTY
   - **Default language**: English (United States)
   - **App or game**: App
   - **Free or paid**: Free
   
3. **Declarations**
   - [ ] I declare that this app is compatible with Google Play's Developer Program Policies
   - [ ] I acknowledge that I must comply with US export laws
   - Click "Create app"

### Step 2: Complete Setup Tasks

Google requires completing several setup tasks before you can publish:

#### 2.1 App Access

- Navigate to "App access" in left sidebar
- **All functionality is available without restrictions**: Select if applicable
- **Or describe restrictions**: If app requires sign-in or special access
- Click "Save"

#### 2.2 Ads

- Navigate to "Ads" in left sidebar
- **Does your app contain ads?**: No (or Yes if using ads)
- Click "Save"

#### 2.3 Content Rating

1. Navigate to "Content rating"
2. Click "Start questionnaire"
3. **Enter email address**: developer@bountyfinder.app
4. **Select category**: Productivity or Utility
5. **Answer questionnaire**:
   - Violence: No
   - Sexual content: No
   - Language: No
   - Controlled substances: No
   - Gambling: No
   - Other: No
6. Review and submit
7. Google generates rating (typically "Everyone" for productivity apps)

#### 2.4 Target Audience and Content

1. Navigate to "Target audience and content"
2. **Target age groups**:
   - Select age groups: 18 and over (or appropriate range)
   - Do you want to make your app available to children under 13? No (unless COPPA compliant)
3. Click "Next" and complete sections:
   - App details
   - Privacy policy
   - Health and fitness
   - Data safety
4. Click "Save"

#### 2.5 News Apps (if applicable)

- If your app is a news app, complete this section
- Otherwise, select "My app is not a news app"

#### 2.6 COVID-19 Contact Tracing and Status Apps

- Select "My app is not a COVID-19 contact tracing or status app"
- Click "Save"

#### 2.7 Data Safety

This is critical for user trust:

1. Navigate to "Data safety"
2. Click "Start"

3. **Data collection and security**
   - **Does your app collect or share user data?**: Yes
   - **Is all of the user data collected encrypted in transit?**: Yes
   - **Do you provide a way for users to request data deletion?**: Yes
   - **Privacy policy URL**: https://yourdomain.com/privacy

4. **Data types and purposes**
   
   Select data collected by BOUNTY:
   
   **Location**:
   - [ ] Approximate location
   - [ ] Precise location
   - Purpose: App functionality (to show nearby bounties)
   - Collection: Required
   
   **Personal info**:
   - [ ] Name
   - [ ] Email address
   - [ ] User IDs
   - Purpose: Account management
   - Collection: Required
   
   **Financial info**:
   - [ ] Payment info
   - Purpose: Payment processing
   - Collection: Required for payment features
   - Shared with: Stripe (payment processor)
   
   **Photos and videos**:
   - [ ] Photos
   - Purpose: App functionality (profile pictures, post attachments)
   - Collection: Optional
   
   **Messages**:
   - [ ] Emails
   - [ ] SMS or MMS
   - [ ] In-app messages
   - Purpose: App functionality
   - Collection: Required for communication features
   
   **App activity**:
   - [ ] App interactions
   - Purpose: Analytics
   - Collection: Optional

5. Review and submit

#### 2.8 Government Apps

- Select "My app is not a government app"
- Click "Save"

#### 2.9 Financial Features

- Select appropriate options if BOUNTY handles financial transactions
- **Peer-to-peer payments**: Yes (if applicable)
- **Digital goods**: No (unless applicable)
- Click "Save"

### Step 3: Set Up Store Listing

While not required for internal testing, prepare your store listing:

1. **Navigate to "Main store listing"**

2. **App details**
   - **App name**: BOUNTY
   - **Short description** (80 characters):
     ```
     Post tasks, find helpers, get paid. Fast, safe, and transparent.
     ```
   
   - **Full description** (4000 characters):
     ```
     BOUNTY - Your Local Task Marketplace
     
     Need help with a task? Post a bounty and find someone nearby to help. 
     From assembling furniture to running errands, BOUNTY makes it fast, 
     safe, and transparent.
     
     🎯 KEY FEATURES
     
     • Create Bounties
       Post any task with a few taps. Set your price or mark it for honor.
       Add photos, location, and deadlines.
     
     • Find Opportunities
       Browse nearby bounties. Filter by category, location, and price.
       Apply to tasks that match your skills.
     
     • Secure Messaging
       Chat directly with posters or hunters. Share updates, ask questions,
       and coordinate details.
     
     • Safe Payments
       Escrow-backed payments protect both parties. Funds released only
       when work is complete. Powered by Stripe.
     
     • Build Reputation
       Get rated after each completed bounty. Build trust and unlock
       better opportunities.
     
     • Real-time Updates
       Push notifications keep you informed. Never miss a new message
       or bounty update.
     
     🛡️ TRUST & SAFETY
     
     • Escrow payments protect your money
     • Profile verification reduces scams
     • Rating system builds trust
     • Report and block features
     • 24/7 support team
     
     💼 PERFECT FOR
     
     • Moving and delivery
     • Handyman tasks
     • Tech support
     • Errands and shopping
     • Event help
     • Creative services
     • And much more!
     
     📱 HOW IT WORKS
     
     1. Create an account in seconds
     2. Post a bounty or browse opportunities
     3. Connect through secure in-app messaging
     4. Complete the task
     5. Release payment and rate each other
     
     🌟 WHY BOUNTY?
     
     • No subscriptions or hidden fees
     • Only pay when you hire someone
     • Local focus connects you with nearby helpers
     • Fast and simple interface
     • Trusted by thousands of users
     
     📞 SUPPORT
     
     Questions? Contact us at support@bountyfinder.app
     Visit: https://bountyfinder.app
     
     Download BOUNTY today and turn tasks into opportunities!
     ```

3. **App icon**
   - Upload 512x512 PNG with transparency
   - Must be same as in-app icon
   - No borders or extra padding

4. **Graphics**
   
   **Feature graphic** (Required):
   - 1024 x 500 pixels
   - JPG or PNG
   - Showcases app's key feature
   
   **Phone screenshots** (At least 2, up to 8):
   - JPEG or 24-bit PNG (no alpha)
   - Minimum dimension: 320px
   - Maximum dimension: 3840px
   - Recommended sizes:
     - 1080 x 1920 (Portrait)
     - 1080 x 2400 (Portrait, taller)
   - Show key app features:
     - Home/browse screen
     - Create bounty screen
     - Messaging screen
     - Profile/wallet screen
   
   **Tablet screenshots** (Optional but recommended):
   - 7-inch: 1024 x 600
   - 10-inch: 1920 x 1200
   
   **Video** (Optional):
   - YouTube URL
   - 30 seconds - 2 minutes
   - Shows app in use

5. **Categorization**
   - **App category**: Productivity
   - **Tags**: task, gig, local, marketplace, jobs

6. **Contact details**
   - **Website**: https://bountyfinder.app
   - **Email**: support@bountyfinder.app
   - **Phone**: +1 (XXX) XXX-XXXX (optional)
   - **Privacy policy**: https://bountyfinder.app/privacy

7. **External marketing**
   - Set preferences for promotional campaigns

8. Click "Save"

---

## EAS Build Configuration for Android

### Step 1: Configure app.json

Ensure your `app.json` has proper Android configuration:

```json
{
  "expo": {
    "name": "BOUNTY",
    "slug": "BOUNTYExpo",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/brandmark-design (3).png",
    "scheme": "bountyexpo-workspace",
    
    "android": {
      "package": "app.bountyfinder.BOUNTYExpo",
      "versionCode": 1,
      "jsEngine": "hermes",
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/bounty-icon.png",
        "backgroundColor": "#ffffff"
      },
      
      "permissions": [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE",
        "RECEIVE_BOOT_COMPLETED",
        "VIBRATE"
      ],
      
      "googleServicesFile": "./google-services.json",
      
      "config": {
        "googleMaps": {
          "apiKey": "YOUR_GOOGLE_MAPS_ANDROID_KEY"
        }
      },
      
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "https",
              "host": "bountyfinder.app",
              "pathPrefix": "/bounty"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

### Step 2: Configure eas.json

Update `eas.json` with Android-specific profiles:

```json
{
  "cli": {
    "version": ">= 16.19.3",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": {
        "buildType": "apk",
        "versionCode": "auto"
      }
    },
    "preview": {
      "distribution": "internal",
      "channel": "beta",
      "android": {
        "buildType": "aab",
        "versionCode": "auto"
      },
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api-staging.bountyfinder.app",
        "EXPO_PUBLIC_SUPABASE_URL": "${STAGING_SUPABASE_URL}",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "${STAGING_SUPABASE_ANON_KEY}",
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY": "${STRIPE_TEST_PUBLISHABLE_KEY}",
        "EXPO_PUBLIC_ENVIRONMENT": "beta"
      }
    },
    "production": {
      "distribution": "store",
      "channel": "production",
      "android": {
        "buildType": "aab",
        "versionCode": "auto"
      },
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.bountyfinder.app",
        "EXPO_PUBLIC_SUPABASE_URL": "${PRODUCTION_SUPABASE_URL}",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "${PRODUCTION_SUPABASE_ANON_KEY}",
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY": "${STRIPE_LIVE_PUBLISHABLE_KEY}",
        "EXPO_PUBLIC_ENVIRONMENT": "production"
      }
    }
  },
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "internal"
      }
    }
  }
}
```

### Step 3: Set Environment Variables

```bash
# Set staging environment variables
eas secret:create --scope project --name STAGING_SUPABASE_URL --value "https://your-staging-project.supabase.co"
eas secret:create --scope project --name STAGING_SUPABASE_ANON_KEY --value "your-staging-anon-key"
eas secret:create --scope project --name STRIPE_TEST_PUBLISHABLE_KEY --value "pk_test_xxxxx"

# Set production environment variables
eas secret:create --scope project --name PRODUCTION_SUPABASE_URL --value "https://your-project.supabase.co"
eas secret:create --scope project --name PRODUCTION_SUPABASE_ANON_KEY --value "your-anon-key"
eas secret:create --scope project --name STRIPE_LIVE_PUBLISHABLE_KEY --value "pk_live_xxxxx"

# List secrets to verify
eas secret:list
```

---

## Building for Google Play

### Step 1: Prepare for Build

1. **Verify Project**
   ```bash
   pnpm type-check
   ```

2. **Test Locally**
   ```bash
   npx expo start
   # Test on Android emulator or device
   ```

3. **Commit Changes**
   ```bash
   git add .
   git commit -m "Prepare for Google Play beta 1"
   git push
   ```

### Step 2: Configure Build

**First time:**
```bash
# Configure EAS for Android
eas build:configure

# Choose Android options when prompted
```

### Step 3: Build AAB (Android App Bundle)

**For Play Store (Recommended):**
```bash
# Build Android App Bundle
eas build --platform android --profile preview
```

**Why AAB over APK?**
- Smaller downloads (20-30% smaller)
- Automatic optimization per device
- Required for Play Store (APKs deprecated)
- Better security

**Build Process:**
- Initializing: 1-2 min
- Building: 10-20 min
- Finalizing: 2-5 min
- Total: ~15-30 minutes

### Step 4: Handle Credentials

**First Build:**
- EAS will create a new keystore automatically
- Keystore is stored securely in EAS
- Don't lose this keystore - needed for all future updates!

**Or Use Existing Keystore:**
```bash
# Upload existing keystore
eas credentials -p android

# Select "Set up Android Keystore"
# Upload your .jks file
# Provide keystore password, key alias, and key password
```

**Backup Keystore:**
```bash
# Download keystore for backup
eas credentials -p android
# Select "Download Android Keystore"
# Save in secure location (1Password, etc.)
```

**Important**: Never lose your keystore! You cannot publish updates without it.

### Step 5: Monitor Build

```bash
# View build logs
eas build:view

# List recent builds
eas build:list --platform android

# Check specific build
eas build:view [BUILD_ID]
```

---

## Internal Testing Setup

### Step 1: Upload First Build

**Option 1: Automatic (Recommended)**
```bash
# Build and auto-submit
eas build --platform android --profile preview --auto-submit

# Or submit after build
eas submit --platform android --latest
```

**Option 2: Manual Upload**
1. Download `.aab` from EAS build page
2. Go to Play Console → Your app
3. Navigate to "Testing" → "Internal testing"
4. Click "Create new release"
5. Upload your `.aab` file
6. Add release notes
7. Click "Review release" → "Start rollout to Internal testing"

### Step 2: Create Release

1. **Release name**: Automatically generated (e.g., "1 (1.0.0)")
2. **Release notes** (What's new):
   ```
   Beta Release 1
   
   This is the first internal beta of BOUNTY. Please test:
   • Sign up and account creation
   • Creating a bounty
   • Browsing bounties
   • Messaging
   • Payment flow (using test mode)
   
   Known issues:
   • Some animations may be choppy on older devices
   • Push notifications are in testing
   
   Report bugs via in-app feedback button or email beta@bountyfinder.app
   ```

3. **Review and roll out**
   - Review release summary
   - Click "Start rollout to Internal testing"
   - Confirm rollout
   - Build available in 1-5 minutes (no review for internal testing)

### Step 3: Create Tester List

1. **Navigate to "Testing" → "Internal testing"**
2. **Testers section**:
   - Click "Create email list"
   - Name: "BOUNTY Beta Testers"
   - Add email addresses (up to 100)
   - Click "Save changes"

3. **Add Emails**:
   - Type or paste email addresses
   - One per line or comma-separated
   - Must be Gmail or Google Workspace accounts
   - Testers don't need Play Console access

**Example List:**
```
john.doe@gmail.com
jane.smith@gmail.com
beta.tester@company.com
```

### Step 4: Share Testing Link

1. **Get Opt-in URL**
   - In Internal testing page
   - Find "Copy link" button
   - Copy the opt-in URL
   - Format: `https://play.google.com/apps/internaltest/...`

2. **Share with Testers**
   - Send opt-in link via email
   - Post in Slack/Discord
   - Share via any communication channel

3. **Testers Join**
   - Click opt-in link
   - Sign in with Google account (must match email in tester list)
   - Accept to become a tester
   - Install from Play Store
   - App appears in "My apps" with "Internal test" badge

---

## Managing Testers

### Internal Testing (Up to 100 Testers)

**Benefits:**
- No Google review required
- Updates available immediately
- Up to 100 testers
- Ideal for team and close friends/family

**Adding Testers:**

**Method 1: Email List**
1. Create/edit email list in Play Console
2. Add email addresses
3. Save changes
4. Google sends automatic invitations

**Method 2: CSV Upload**
```csv
email
john.doe@gmail.com
jane.smith@gmail.com
tester@example.com
```

Upload in Play Console:
1. Internal testing → Testers
2. Click "Upload CSV"
3. Select your CSV file
4. Confirm upload

**Removing Testers:**
1. Go to tester list
2. Click "X" next to email
3. Confirm removal
4. Tester loses access immediately

### Closed Testing (Unlimited Testers)

When ready for more testers:

1. **Navigate to "Testing" → "Closed testing"**
2. **Create testing track** (if not exists)
3. **Create new release**:
   - Upload AAB
   - Add release notes
   - Review and start rollout

4. **Add testers**:
   - Create email lists (unlimited)
   - Or use Google Groups
   - Or share opt-in link

**Advantages:**
- Unlimited testers
- Google Groups integration
- Staged rollouts
- Pre-launch reports
- Still faster review than production

### Open Testing (Public Beta)

For public beta testing:

1. **Navigate to "Testing" → "Open testing"**
2. **Create new release**
3. **Set up**:
   - Upload AAB
   - Add release notes
   - Set countries (optional)
   - Set maximum testers (optional)

4. **Share**:
   - Anyone can join via link
   - Or find in Play Store search (if opted in)
   - Full Google review required (like production)

### Managing Feedback

**View Feedback:**
- Play Console → Your app → Ratings and reviews
- Filter by "Testing track"
- See reviews from internal/closed/open testers

**Reply to Reviews:**
- Click on review
- Type response
- Publish reply
- Helps build relationships with testers

---

## Closed Testing and Open Testing

### Progression Path

```
Internal Testing (100 testers)
    ↓ (Ready for more testers)
Closed Testing (Unlimited, managed lists)
    ↓ (Ready for public)
Open Testing (Public beta)
    ↓ (Ready for launch)
Production Release
```

### Closed Testing Setup

**When to use:**
- Need more than 100 testers
- Want to test with specific groups
- Preparing for wider release

**Steps:**
1. Navigate to "Closed testing"
2. Create new track: "Alpha" or "Beta"
3. Create release (same as internal)
4. Create tester lists or Google Groups
5. Share opt-in URL
6. Updates available in 1-2 hours after Google review

### Open Testing Setup

**When to use:**
- Ready for public beta
- Want anyone to join
- Testing at scale

**Steps:**
1. Navigate to "Open testing"
2. Ensure all store listing content is complete
3. Create release
4. Set optional limits:
   - Maximum testers
   - Countries
5. Submit for review
6. Available in Play Store search after approval (1-7 days)

---

## OTA Updates

### When to Use OTA vs New Build

**Use OTA (Over-The-Air) For:**
- JavaScript changes
- React component updates
- UI tweaks
- Bug fixes in JS
- Non-native changes

**Require New Build For:**
- Native module changes
- Android SDK updates
- app.json configuration changes
- Permission changes
- New native libraries

### Publishing OTA Updates

```bash
# Publish update to beta channel
eas update --branch beta --message "Fix crash on message send"

# View update status
eas update:view --branch beta

# List updates
eas update:list --branch beta
```

**Configuration:**

In `app.json`:
```json
{
  "expo": {
    "updates": {
      "url": "https://u.expo.dev/[project-id]",
      "enabled": true,
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 0
    },
    "runtimeVersion": {
      "policy": "sdkVersion"
    }
  }
}
```

### Gradual Rollout

```bash
# Roll out to 25% first
eas update --branch beta --message "New feature" --rollout-percentage 25

# Increase to 50%
eas update:rollout --branch beta --percentage 50

# Full rollout
eas update:rollout --branch beta --percentage 100
```

---

## Troubleshooting

### Build Issues

**1. "Keystore error"**

```bash
# Solution: Reset credentials
eas credentials:delete -p android
eas build --platform android --profile preview --clear-cache
```

**2. "Gradle build failed"**

Check for:
- TypeScript errors: `pnpm type-check`
- Missing dependencies: `pnpm install`
- Incompatible package versions

```bash
# Clear and rebuild
rm -rf node_modules
pnpm install
eas build --platform android --profile preview --clear-cache
```

**3. "Build failed with OutOfMemoryError"**

Update `eas.json`:
```json
{
  "build": {
    "preview": {
      "android": {
        "gradleCommand": ":app:assembleRelease",
        "withoutCredentials": false,
        "credentialsSource": "local"
      }
    }
  }
}
```

### Play Console Issues

**1. "Unable to upload AAB"**

- Verify package name matches exactly
- Ensure version code is higher than previous
- Check AAB is properly signed
- Verify keystore matches previous builds

**2. "Tester can't install app"**

- Verify tester is in the list
- Ensure tester accepted opt-in
- Check using correct Google account
- Wait up to 1 hour for processing
- Ask tester to refresh Play Store

**3. "App not showing in Play Store"**

For internal testing:
- Check release is rolled out
- Verify tester accepted opt-in
- Ensure using correct Google account
- Try clearing Play Store cache

### Testing Issues

**1. "App crashes on start"**

- Check crash reports in Play Console:
  - Navigate to Quality → Vitals → Crashes
  - View stack trace and device info
- Verify environment variables are correct
- Test on same device type
- Check Android version compatibility

**2. "Can't connect to API"**

- Verify API URL in `eas.json`
- Check backend is accessible
- Test API with curl/Postman
- Review Android network security config
- Check for SSL/certificate issues

**3. "Push notifications not working"**

- Verify FCM configuration
- Check Firebase project setup
- Verify `google-services.json` is correct
- Test notification permissions
- Review FCM token registration

### Getting Help

**Google Resources:**
- [Play Console Help](https://support.google.com/googleplay/android-developer)
- [Android Developer Docs](https://developer.android.com)
- [Play Console API](https://developers.google.com/android-publisher)

**Expo Resources:**
- [EAS Build Docs](https://docs.expo.dev/build/introduction/)
- [EAS Submit Docs](https://docs.expo.dev/submit/android/)
- [Expo Forums](https://forums.expo.dev/)
- [Discord](https://chat.expo.dev/)

**BOUNTY Support:**
- Engineering: dev@bountyfinder.app
- Beta Program: beta@bountyfinder.app

---

## Best Practices

### Pre-Build Checklist

- [ ] Run `pnpm type-check` successfully
- [ ] Test on Android emulator/device
- [ ] Increment version code if needed
- [ ] Update release notes
- [ ] Commit and push changes
- [ ] Verify environment variables
- [ ] Check app.json configuration
- [ ] Backup keystore

### Post-Build Checklist

- [ ] Test installation on real device
- [ ] Verify app launches successfully
- [ ] Test critical user flows
- [ ] Check push notifications
- [ ] Verify API connectivity
- [ ] Test sign-in/sign-up
- [ ] Review crash reports (after 24 hours)

### Security Best Practices

- [ ] Never commit keystore to git
- [ ] Store keystore securely (password manager)
- [ ] Use app signing by Google Play (recommended)
- [ ] Enable two-factor auth on Play Console
- [ ] Review permissions regularly
- [ ] Use service account for API access
- [ ] Rotate API keys periodically

---

## Quick Reference

### Essential Commands

```bash
# Build for Play Store
eas build --platform android --profile preview

# Submit to Play Console
eas submit --platform android --latest

# Build APK for testing
eas build --platform android --profile preview --type apk

# View builds
eas build:list --platform android

# Publish OTA update
eas update --branch beta --message "Bug fix"

# Manage credentials
eas credentials -p android
```

### Important URLs

- **Play Console**: https://play.google.com/console
- **Google Cloud Console**: https://console.cloud.google.com
- **Expo Dashboard**: https://expo.dev
- **Internal Test Link**: Copy from Play Console → Internal testing

### Key Timelines

| Action | Typical Duration |
|--------|------------------|
| EAS Build | 10-20 minutes |
| Upload to Play Console | 2-5 minutes |
| Internal Testing (no review) | 1-5 minutes |
| Closed Testing Review | 1-2 hours |
| Open Testing Review | 1-3 days |
| Production Review | 1-7 days |

### Version Management

**Version Code vs Version Name:**
- **versionCode**: Integer, must increment (1, 2, 3...)
- **version**: String, semantic versioning (1.0.0, 1.0.1...)

```json
{
  "version": "1.0.0",
  "android": {
    "versionCode": 1
  }
}
```

EAS can auto-increment versionCode:
```json
{
  "build": {
    "preview": {
      "android": {
        "versionCode": "auto"
      }
    }
  }
}
```

---

*Last Updated: January 2026*
*Version: 1.0*
