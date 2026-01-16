# TestFlight Setup Guide for BOUNTY

> Detailed guide for deploying BOUNTY to Apple's TestFlight platform for iOS beta testing

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Apple Developer Account Setup](#apple-developer-account-setup)
- [App Store Connect Configuration](#app-store-connect-configuration)
- [EAS Build Configuration for iOS](#eas-build-configuration-for-ios)
- [Building for TestFlight](#building-for-testflight)
- [Uploading to TestFlight](#uploading-to-testflight)
- [Managing Testers](#managing-testers)
- [Beta Review Process](#beta-review-process)
- [OTA Updates](#ota-updates)
- [Troubleshooting](#troubleshooting)

---

## Overview

TestFlight is Apple's platform for distributing beta versions of iOS apps. It allows you to:
- Distribute beta builds to up to 10,000 external testers
- Add up to 100 internal testers (team members)
- Collect feedback and crash reports
- Test builds before public release
- Push updates without full App Store review

**Key Benefits:**
- Seamless installation via TestFlight app
- Automatic updates when new builds are available
- Built-in feedback mechanism
- Crash and usage analytics
- No need for device UDIDs

---

## Prerequisites

### Required Accounts and Access

- [ ] **Apple Developer Account** ($99/year)
  - Enrolled as Individual or Organization
  - Active membership status
  - Access to Certificates, Identifiers & Profiles
  
- [ ] **App Store Connect Access**
  - Admin, App Manager, or Developer role
  - Two-factor authentication enabled
  - App-specific password generated (for EAS CLI)

- [ ] **Expo Account**
  - Registered at [expo.dev](https://expo.dev)
  - EAS CLI installed (`npm install -g eas-cli`)
  - Authenticated (`eas login`)

### Required Tools

```bash
# Install EAS CLI
npm install -g eas-cli

# Install Fastlane (optional, for advanced automation)
sudo gem install fastlane

# Verify installations
eas --version
fastlane --version
```

### App Information

You'll need the following information ready:
- **App Name**: BOUNTY
- **Bundle Identifier**: `com.bounty.BOUNTYExpo`
- **Primary Language**: English (United States)
- **Category**: Productivity (or your chosen category)
- **Privacy Policy URL**: Your privacy policy URL
- **Support URL**: Your support page URL

---

## Apple Developer Account Setup

### Step 1: Enroll in Apple Developer Program

1. **Go to Apple Developer**
   - Visit [developer.apple.com/programs](https://developer.apple.com/programs)
   - Click "Enroll"

2. **Choose Membership Type**
   - **Individual**: $99/year, uses your personal Apple ID
   - **Organization**: $99/year, requires D-U-N-S number and legal entity verification

3. **Complete Enrollment**
   - Sign in with your Apple ID
   - Agree to Apple Developer Agreement
   - Complete payment ($99)
   - Wait for approval (typically 24-48 hours)

### Step 2: Configure Two-Factor Authentication

1. **Enable 2FA on Apple ID**
   - Go to [appleid.apple.com](https://appleid.apple.com)
   - Sign in → Security → Two-Factor Authentication
   - Follow setup instructions

2. **Generate App-Specific Password** (for EAS CLI)
   - Go to Apple ID → Security → App-Specific Passwords
   - Click "Generate password"
   - Label it "EAS CLI" or "Expo Build"
   - Save the generated password securely

### Step 3: Create App Identifier

1. **Navigate to Certificates, Identifiers & Profiles**
   - Go to [developer.apple.com/account](https://developer.apple.com/account)
   - Click "Certificates, Identifiers & Profiles"

2. **Create Identifier**
   - Click "Identifiers" → "+" button
   - Select "App IDs" → Continue
   - Select "App" → Continue

3. **Register App ID**
   - **Description**: BOUNTY App
   - **Bundle ID**: Explicit → `com.bounty.BOUNTYExpo`
   - **Capabilities**: Enable as needed:
     - [ ] Associated Domains
     - [ ] Push Notifications
     - [ ] Sign in with Apple (if using)
     - [ ] App Groups (if sharing data)
   - Click "Continue" → "Register"

### Step 4: Create Provisioning Profiles

**For Development:**
```bash
# EAS will automatically create development profiles
# You can also create manually in Apple Developer portal
```

**For Distribution (TestFlight/App Store):**
```bash
# EAS will handle this automatically during build
# Or create manually:
# 1. Go to Profiles → "+" button
# 2. Select "App Store" → Continue
# 3. Select your App ID → Continue
# 4. Select distribution certificate → Continue
# 5. Name it "BOUNTY App Store Profile" → Generate
```

---

## App Store Connect Configuration

### Step 1: Create App Record

1. **Navigate to App Store Connect**
   - Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
   - Sign in with your Apple Developer credentials

2. **Create New App**
   - Click "My Apps" → "+" → "New App"
   - Fill in the form:
     - **Platforms**: iOS
     - **Name**: BOUNTY
     - **Primary Language**: English (U.S.)
     - **Bundle ID**: Select `com.bounty.BOUNTYExpo`
     - **SKU**: `bounty-ios-001` (unique identifier for your records)
     - **User Access**: Full Access
   - Click "Create"

### Step 2: Configure App Information

1. **General Information**
   - Navigate to your app → "App Information"
   - **Category**: 
     - Primary: Productivity
     - Secondary: (optional) Social Networking
   - **Content Rights**: Choose appropriate option
   - **Age Rating**: Complete questionnaire
   - **Privacy Policy URL**: `https://yourdomain.com/privacy`
   - **Support URL**: `https://yourdomain.com/support`
   - **Marketing URL**: (optional)

2. **Pricing and Availability**
   - Navigate to "Pricing and Availability"
   - **Price**: Free (or set price)
   - **Availability**: All countries/regions (or select specific)

3. **App Privacy**
   - Navigate to "App Privacy"
   - Click "Get Started"
   - Answer questions about data collection:
     - Contact Info (email, name, phone) → Collected for account creation
     - Location → Used to show nearby bounties
     - Financial Info → Collected for payments
     - User Content → Messages, photos
   - Specify data usage and linking
   - Submit privacy information

### Step 3: Prepare App Store Listing (Optional for Beta)

While not required for TestFlight, it's good to prepare:

1. **App Store Screenshots** (Required sizes):
   - 6.7" (iPhone 15 Pro Max): 1290 x 2796
   - 6.5" (iPhone 11 Pro Max): 1284 x 2778
   - 5.5" (iPhone 8 Plus): 1242 x 2208

2. **App Preview Videos** (Optional)
   - Up to 3 videos per device size
   - 15-30 seconds recommended

3. **Promotional Text** (170 characters max)
   ```
   Create tasks, find helpers, and get things done. Fast, transparent, and secure with built-in payment escrow.
   ```

4. **Description** (4000 characters max)
   ```
   BOUNTY - Get Things Done

   Post a task (a "bounty"), set your price, and find someone nearby to help. 
   Whether it's assembling furniture, running errands, or tech support, 
   BOUNTY makes it fast and safe.

   KEY FEATURES:
   • Post bounties in minutes
   • Browse nearby opportunities
   • Secure in-app messaging
   • Escrow-backed payments
   • Real-time notifications
   • Reputation system

   [Continue with more details...]
   ```

5. **Keywords** (100 characters max)
   ```
   gig,task,bounty,freelance,local,helper,errands,services,jobs,marketplace
   ```

### Step 4: Configure TestFlight Settings

1. **TestFlight Information**
   - Navigate to "TestFlight" tab
   - Click "App Information" in sidebar
   - **Beta App Description**: 
     ```
     BOUNTY Beta - Help us test the future of task marketplace!
     
     This is a beta version for testing purposes. Please report any bugs 
     or issues using the in-app feedback button.
     ```
   - **Beta App Review Information**:
     - First Name: [Your name]
     - Last Name: [Your name]
     - Phone Number: [Your phone]
     - Email: beta@bountyfinder.app
     - Notes: Include any test accounts or special instructions

2. **Test Information**
   - For each build, you'll add specific test notes
   - This tells testers what to focus on

3. **Feedback Email** (Optional)
   - Set up `testflight@bountyfinder.app` for tester emails

---

## EAS Build Configuration for iOS

### Step 1: Configure app.json

Ensure your `app.json` has correct iOS configuration:

```json
{
  "expo": {
    "name": "BOUNTY",
    "slug": "BOUNTYExpo",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/brandmark-design (3).png",
    "scheme": "bountyexpo-workspace",
    "userInterfaceStyle": "automatic",
    
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.bounty.BOUNTYExpo",
      "buildNumber": "1",
      "jsEngine": "hermes",
      
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false,
        "NSPhotoLibraryUsageDescription": "BOUNTY needs access to your photo library to let you choose a profile picture and attach images to posts.",
        "NSPhotoLibraryAddUsageDescription": "BOUNTY saves selected images to your library when needed.",
        "NSCameraUsageDescription": "BOUNTY needs camera access to take photos for your profile or posts.",
        "NSLocationWhenInUseUsageDescription": "BOUNTY uses your location to show nearby bounties and help you find local opportunities.",
        "NSMicrophoneUsageDescription": "BOUNTY needs microphone access for voice messages.",
        "NSContactsUsageDescription": "BOUNTY needs access to your contacts to help you invite friends."
      },
      
      "associatedDomains": [
        "applinks:bountyfinder.app",
        "applinks:*.bountyfinder.app"
      ],
      
      "config": {
        "googleMapsApiKey": "YOUR_GOOGLE_MAPS_IOS_KEY"
      },
      
      "entitlements": {
        "com.apple.developer.applesignin": ["Default"],
        "aps-environment": "production"
      }
    }
  }
}
```

### Step 2: Configure eas.json

Create or update `eas.json` with iOS-specific build profiles:

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
      "ios": {
        "simulator": true,
        "buildNumber": "auto"
      }
    },
    "preview": {
      "distribution": "internal",
      "channel": "beta",
      "ios": {
        "simulator": false,
        "buildNumber": "auto",
        "resourceClass": "m1-medium"
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
      "ios": {
        "simulator": false,
        "buildNumber": "auto",
        "resourceClass": "m1-medium"
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
      "ios": {
        "appleId": "your-email@example.com",
        "ascAppId": "1234567890",
        "appleTeamId": "XXXXXXXXXX"
      }
    }
  }
}
```

### Step 3: Set Environment Variables

Set secrets in EAS:

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

## Building for TestFlight

### Step 1: Prepare for Build

1. **Verify TypeScript Compilation**
   ```bash
   pnpm type-check
   ```

2. **Test Locally**
   ```bash
   npx expo start
   # Test on iOS simulator
   ```

3. **Commit All Changes**
   ```bash
   git add .
   git commit -m "Prepare for TestFlight beta 1"
   git push
   ```

4. **Update Version**
   - Increment version in `app.json` if needed
   - EAS will auto-increment build number

### Step 2: Start Build

**For first-time setup:**
```bash
# Configure EAS build
eas build:configure

# This will:
# - Create eas.json if it doesn't exist
# - Prompt for iOS Bundle Identifier
# - Set up credentials
```

**Build for TestFlight:**
```bash
# Build iOS for internal testing (beta)
eas build --platform ios --profile preview

# Or build with local credentials (if you manage your own)
eas build --platform ios --profile preview --local
```

### Step 3: Monitor Build Progress

1. **Build URL**
   - EAS provides a build URL immediately
   - Example: `https://expo.dev/accounts/your-account/projects/bounty/builds/...`

2. **Build Phases**
   - Initializing (1-2 min)
   - Building (10-20 min)
   - Finalizing (2-5 min)
   - Total: ~15-30 minutes

3. **Track in Terminal**
   ```bash
   # View build logs in real-time
   eas build:view
   
   # List recent builds
   eas build:list --platform ios
   ```

4. **Email Notification**
   - You'll receive email when build completes
   - Email contains download link and next steps

### Step 4: Handle Build Credentials

**First Time Building:**
- EAS will ask about credentials
- Choose "Let EAS handle credentials" (recommended)
- EAS creates distribution certificate and provisioning profile
- Credentials are stored securely in EAS

**Or Use Existing Credentials:**
```bash
# Upload your own credentials
eas credentials

# Follow prompts to:
# 1. Upload .p12 distribution certificate
# 2. Upload provisioning profile
# 3. Provide certificate password
```

**View/Manage Credentials:**
```bash
# View credentials for iOS
eas credentials -p ios

# Remove credentials (to regenerate)
eas credentials:delete -p ios
```

---

## Uploading to TestFlight

### Option 1: Automatic Upload (Recommended)

EAS can automatically submit to TestFlight:

```bash
# Build and auto-submit
eas build --platform ios --profile preview --auto-submit
```

Or submit after building:

```bash
# Submit the latest iOS build
eas submit --platform ios --latest
```

**What happens:**
1. EAS downloads your `.ipa` file
2. Uploads to App Store Connect via API
3. Build appears in TestFlight within 5-15 minutes
4. Goes through Apple's beta review

### Option 2: Manual Upload

If auto-submit doesn't work:

1. **Download .ipa from EAS**
   - Go to build URL
   - Click "Download .ipa"
   - Save to your computer

2. **Upload via Transporter**
   - Download [Transporter app](https://apps.apple.com/us/app/transporter/id1450874784) from Mac App Store
   - Open Transporter
   - Drag and drop your `.ipa` file
   - Sign in with Apple ID
   - Click "Deliver"
   - Wait for upload to complete (5-15 min)

3. **Verify Upload**
   - Go to App Store Connect
   - Navigate to your app → TestFlight
   - Build should appear under "iOS Builds"
   - Status: "Processing" (takes 5-15 minutes)

### Option 3: Fastlane Upload

For advanced users with Fastlane:

```ruby
# Fastfile
lane :beta do
  # Download from EAS
  sh("eas build:download --platform ios --latest --output build.ipa")
  
  # Upload to TestFlight
  upload_to_testflight(
    ipa: "build.ipa",
    skip_waiting_for_build_processing: true
  )
end
```

```bash
# Run lane
fastlane beta
```

---

## Managing Testers

### Internal Testing (Up to 100 Testers)

**Who are Internal Testers?**
- Team members with App Store Connect access
- Don't count against 10,000 external tester limit
- Can test immediately after build processing
- No Apple review required
- Multiple builds can be active simultaneously

**Adding Internal Testers:**

1. **Add Users to App Store Connect**
   - Go to "Users and Access"
   - Click "+" to add new user
   - Enter email, First Name, Last Name
   - Assign role: Admin, App Manager, Developer, Marketing, or Sales
   - Send invitation

2. **Create Internal Testing Group**
   - Go to TestFlight → Internal Testing
   - Click "+" to create new group
   - Name: "BOUNTY Core Team" or "BOUNTY Beta Testers"
   - Add team members to the group

3. **Enable Build for Testing**
   - Select your testing group
   - Click "Builds" tab
   - Click "+" to add a build
   - Select your uploaded build
   - Add test information:
     - **What to Test**: Specific features or flows to focus on
     - **Email Text**: Additional context for testers
   - Click "Submit"

4. **Testers Receive Invitation**
   - Automatic email sent to all group members
   - Email contains link to download TestFlight app
   - Once TestFlight installed, BOUNTY app appears in their list

### External Testing (Up to 10,000 Testers)

**Who are External Testers?**
- Anyone with an email address
- Requires Apple beta review (1-24 hours)
- Can only test one build at a time
- Good for wider beta testing

**Setting Up External Testing:**

1. **Create External Testing Group**
   - Go to TestFlight → External Testing
   - Click "+" to create new group
   - Name: "BOUNTY Public Beta"
   - Add build (must be reviewed by Apple first)

2. **Add Build for Review**
   - Select your build
   - Add required information:
     - **Beta App Description**: What is being tested
     - **What to Test**: Specific areas for focus
     - **Email**: beta@bountyfinder.app
     - **First/Last Name**: Contact person
     - **Phone**: Contact phone
     - **Sign-in Required**: Yes/No
     - **Test Account**: Provide if sign-in required
     - **Export Compliance**: Usually "No" for non-encryption
   - Submit for Review

3. **Wait for Apple Review**
   - Typically takes 1-24 hours
   - You'll receive email when approved
   - Build status changes to "Ready to Test"

4. **Add External Testers**
   - Import CSV with emails
   - Or add individually
   - Public link option (anyone with link can join)

**CSV Format for Bulk Import:**
```csv
First Name,Last Name,Email
John,Doe,john@example.com
Jane,Smith,jane@example.com
```

### Managing Tester Groups

**Best Practices:**
- Create different groups for different testing phases
- Example groups:
  - "Internal Team" (5-10 people)
  - "Friends & Family" (20-30 people)
  - "Early Adopters" (50-100 people)
  - "Public Beta" (unlimited)

**Group Organization:**
```
Internal Testing
├── Core Engineering Team (10)
├── Design Team (5)
└── QA Team (5)

External Testing
├── Friends & Family (30)
├── Early Supporters (100)
└── Public Beta (unlimited)
```

---

## Beta Review Process

### Understanding Beta Review

**What Apple Reviews:**
- App doesn't crash on launch
- Core functionality works
- Content isn't offensive or illegal
- App follows basic guidelines
- Test account works (if provided)

**What They DON'T Review:**
- Full App Store guidelines (comes later)
- Design quality
- Feature completeness
- Marketing materials

### Typical Review Timeline

- **Submission**: Immediate
- **In Review**: 1-24 hours (usually 4-8 hours)
- **Approved**: Ready for testing
- **Rejected**: Rare, but requires fix and resubmission

### Common Rejection Reasons

1. **App Crashes on Launch**
   - Test thoroughly before submitting
   - Provide working test account
   - Check all environment variables are set

2. **Sign-In Issues**
   - Always provide working test credentials
   - Ensure backend is accessible
   - Test account should have sample data

3. **Missing Information**
   - Complete all required fields
   - Provide clear testing instructions
   - Add contact information

4. **Export Compliance Issue**
   - Answer export compliance questions accurately
   - If using encryption, provide documentation

### If Your Build is Rejected

1. **Read Rejection Reason**
   - Check email from Apple
   - Review specific issues mentioned

2. **Fix Issues**
   - Address all concerns
   - Test fix locally
   - Build new version

3. **Resubmit**
   ```bash
   # Build new version
   eas build --platform ios --profile preview
   
   # Submit for review
   eas submit --platform ios --latest
   ```

4. **Add Resolution Notes**
   - In TestFlight, add notes explaining fixes
   - Reference previous submission if applicable

---

## OTA Updates

### When to Use OTA vs New Build

**Use OTA (Over-The-Air) Updates For:**
- JavaScript code changes
- React component updates
- Bug fixes in JS code
- UI tweaks and adjustments
- Non-native changes

**Require New Build For:**
- Native module updates
- iOS SDK changes
- app.json configuration changes
- Permission changes
- New native dependencies

### Publishing OTA Updates

```bash
# Publish update to beta channel
eas update --branch beta --message "Fix message sending bug"

# Check update status
eas update:view --branch beta

# See update analytics
eas update:list --branch beta
```

**Update Configuration:**

In `eas.json`:
```json
{
  "build": {
    "preview": {
      "channel": "beta"
    }
  }
}
```

In `app.json`:
```json
{
  "expo": {
    "updates": {
      "url": "https://u.expo.dev/[project-id]",
      "fallbackToCacheTimeout": 0,
      "checkAutomatically": "ON_LOAD",
      "enabled": true
    },
    "runtimeVersion": {
      "policy": "sdkVersion"
    }
  }
}
```

### Update Strategy

**Automatic Updates:**
- Users get updates on next app launch
- No action required from testers
- Fast iteration during beta

**Gradual Rollout:**
```bash
# Roll out to 25% of users first
eas update --branch beta --message "New feature" --rollout-percentage 25

# Increase to 50%
eas update:rollout --branch beta --percentage 50

# Full rollout
eas update:rollout --branch beta --percentage 100
```

---

## Troubleshooting

### Build Issues

**1. "Failed to authenticate with Apple"**

```bash
# Solution: Regenerate app-specific password
# 1. Go to appleid.apple.com
# 2. Sign in → Security → App-Specific Passwords
# 3. Generate new password
# 4. Update in EAS:
eas credentials -p ios
# Select "Set up Apple authentication"
# Enter new password
```

**2. "Provisioning profile error"**

```bash
# Solution: Clear and regenerate credentials
eas credentials:delete -p ios
eas build --platform ios --profile preview --clear-cache
```

**3. "Build failed with exit code 65"**

This usually means a compilation error. Check:
```bash
# Run TypeScript check
pnpm type-check

# Fix any errors, then rebuild
eas build --platform ios --profile preview
```

**4. "Missing required icon sizes"**

Ensure you have icons in `assets/images/`:
- App icon: 1024x1024 PNG
- Transparent background or solid color

### TestFlight Issues

**1. "Build not appearing in TestFlight"**

- Wait up to 30 minutes for processing
- Check App Store Connect for processing status
- Verify build didn't fail Apple's scan
- Check email for any issues

**2. "Can't install from TestFlight"**

- Verify tester is in the correct group
- Ensure build is enabled for that group
- Check tester has accepted invitation
- Verify TestFlight app is up to date
- Try removing and re-adding tester

**3. "TestFlight shows 'expired' build"**

- TestFlight builds expire after 90 days
- Upload a new build
- Builds don't auto-renew

**4. "Tester can't see latest build"**

- Verify you added the build to their group
- Check if build is still processing
- Ensure build passed beta review
- Ask tester to refresh TestFlight

### Testing Issues

**1. "App crashes on specific device"**

- Check Crashes section in TestFlight
- Review crash logs:
  - TestFlight → Build → Crashes
  - Click on crash to see stack trace
- Test on that specific device model
- Check iOS version compatibility

**2. "Push notifications not working"**

- Verify push certificates are correct
- Check notification permissions granted
- Test push notification endpoint
- Review push token registration code

**3. "App won't connect to API"**

- Verify API URL in `eas.json` is correct
- Check backend is accessible from internet
- Test API endpoints with curl/Postman
- Review network request logs

### Getting Help

**Apple Resources:**
- [TestFlight Help](https://developer.apple.com/help/testflight/)
- [App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi)
- [Developer Forums](https://developer.apple.com/forums/)

**Expo Resources:**
- [EAS Build Docs](https://docs.expo.dev/build/introduction/)
- [EAS Submit Docs](https://docs.expo.dev/submit/introduction/)
- [Expo Forums](https://forums.expo.dev/)
- [Discord](https://chat.expo.dev/)

**BOUNTY Support:**
- Engineering: dev@bountyfinder.app
- Beta Program: beta@bountyfinder.app

---

## Best Practices

### Pre-Build Checklist

- [ ] Run `pnpm type-check` successfully
- [ ] Test on local iOS simulator
- [ ] Increment build number if needed
- [ ] Update CHANGELOG or release notes
- [ ] Commit and push all changes
- [ ] Verify environment variables are set
- [ ] Review app.json configuration

### Post-Build Checklist

- [ ] Test build installs successfully
- [ ] Verify app launches without crashing
- [ ] Test critical user flows
- [ ] Check push notifications work
- [ ] Verify API connectivity
- [ ] Test sign-in/sign-up flows
- [ ] Submit beta review information

### Regular Maintenance

- [ ] Upload new build every 60 days (builds expire after 90)
- [ ] Monitor crash reports weekly
- [ ] Review tester feedback regularly
- [ ] Update test information for each build
- [ ] Keep App Store Connect contact info current
- [ ] Maintain valid payment method
- [ ] Renew Apple Developer membership annually

---

## Quick Reference

### Essential Commands

```bash
# Build for TestFlight
eas build --platform ios --profile preview

# Submit to TestFlight
eas submit --platform ios --latest

# View build status
eas build:list --platform ios

# Publish OTA update
eas update --branch beta --message "Bug fix"

# Manage credentials
eas credentials -p ios

# View project info
eas project:info
```

### Important URLs

- **App Store Connect**: https://appstoreconnect.apple.com
- **Apple Developer**: https://developer.apple.com/account
- **Expo Dashboard**: https://expo.dev
- **TestFlight Public Link**: Provided in App Store Connect

### Key Timelines

| Action | Typical Duration |
|--------|------------------|
| EAS Build | 15-30 minutes |
| Upload to TestFlight | 5-15 minutes |
| Apple Processing | 5-15 minutes |
| Beta Review | 1-24 hours |
| Total (first build) | 1-25 hours |
| Total (subsequent builds) | 20-60 minutes |

---

*Last Updated: January 2026*
*Version: 1.0*
