# Production Build & Submission Guide

## Overview
This guide walks through building BOUNTY for production and submitting to the Apple App Store and Google Play Store.

## 📋 Pre-Build Checklist

### Code Quality ✅
- [ ] All console.log/console.warn statements removed or suppressed (see CODE_CLEANUP_GUIDE.md)
- [ ] ESLint passes: `npm run lint`
- [ ] TypeScript compiler passes: `npx tsc --noEmit`
- [ ] No commented-out code blocks
- [ ] All TODO/FIXME addressed or marked as post-launch
- [ ] Code reviewed by team

### Configuration ✅
- [ ] app.json updated with production values
- [ ] eas.json production profile configured
- [ ] Environment variables set for production
- [ ] Privacy policy URL accessible
- [ ] Terms of service URL accessible
- [ ] Sentry configured for error tracking
- [ ] Mixpanel configured for analytics

### Testing ✅
- [ ] All critical flows tested manually
- [ ] Beta testing completed (10-20 testers)
- [ ] Payment/escrow flow validated
- [ ] No critical bugs outstanding
- [ ] Performance acceptable on target devices

### Legal & Compliance ✅
- [ ] Privacy policy reviewed and accessible
- [ ] Terms of service reviewed and accessible
- [ ] Age rating determined (17+ recommended for UGC)
- [ ] Export compliance determined
- [ ] Content rating questionnaires completed

### Assets Ready ✅
- [ ] App icon (1024x1024) finalized
- [ ] Screenshots captured (all required sizes)
- [ ] Feature graphic created (Google Play)
- [ ] App description written
- [ ] Keywords/metadata optimized
- [ ] Promotional video created (optional)

## 🏗️ Building with EAS

### Prerequisites

1. **Install EAS CLI:**
```bash
npm install -g eas-cli
```

2. **Login to Expo:**
```bash
eas login
```

3. **Configure Project:**
```bash
eas build:configure
```

### Production Build Commands

#### Build for Both Platforms
```bash
eas build --platform all --profile production
```

#### Build for iOS Only
```bash
eas build --platform ios --profile production
```

#### Build for Android Only
```bash
eas build --platform android --profile production
```

### Build Process

1. **Start the Build:**
```bash
eas build --platform all --profile production
```

2. **Monitor Progress:**
- Builds run on Expo's servers
- Monitor at: https://expo.dev/accounts/[your-account]/projects/bountyexpo/builds
- Receive email when complete (typically 10-20 minutes)

3. **Download Artifacts:**
- **iOS:** `.ipa` file (for TestFlight/App Store)
- **Android:** `.aab` file (for Play Console)

### Build Configuration (eas.json)

Current production configuration:
```json
{
  "build": {
    "production": {
      "distribution": "store",
      "autoIncrement": true
    }
  }
}
```

**Key settings:**
- `distribution: "store"` - Optimized for app store submission
- `autoIncrement: true` - Automatically increments build number

### Troubleshooting Builds

#### Build Fails - Missing Credentials
```bash
# Configure iOS credentials
eas credentials -p ios

# Configure Android credentials
eas credentials -p android
```

#### Build Fails - Native Module Issues
```bash
# Clear cache and rebuild
eas build --platform all --profile production --clear-cache
```

#### Build Succeeds but App Crashes
- Check Sentry for crash reports
- Review native logs in EAS build logs
- Test with development build first: `eas build --profile development`

## 📱 iOS App Store Submission

### Prerequisites
- Apple Developer Program membership ($99/year)
- App Store Connect account
- Production `.ipa` file from EAS build

### Step 1: App Store Connect Setup

1. **Create App Record:**
   - Go to: https://appstoreconnect.apple.com
   - My Apps → "+" → New App
   - **Platforms:** iOS
   - **Name:** BOUNTY
   - **Primary Language:** English (US)
   - **Bundle ID:** com.bounty.BOUNTYExpo (from app.json)
   - **SKU:** bounty-ios-001 (unique identifier)
   - **User Access:** Full Access

2. **Configure App Information:**
   - **Category:** Primary: Productivity, Secondary: Lifestyle
   - **Content Rights:** Check if contains third-party content
   - **Age Rating:** Complete questionnaire (recommend 17+ for UGC)
   - **Privacy Policy URL:** https://bountyfinder.app/legal/privacy
   - **Support URL:** https://bountyfinder.app/support (create this)
   - **Marketing URL:** https://bountyfinder.app (optional)

### Step 2: Upload Build

#### Option A: Using EAS Submit
```bash
eas submit --platform ios --latest
```

Follow prompts to configure submission.

#### Option B: Manual Upload via Transporter
1. Download Transporter app from Mac App Store
2. Download `.ipa` from EAS build
3. Drag `.ipa` into Transporter
4. Click "Deliver"
5. Wait for processing (5-15 minutes)

#### Option C: Using Xcode (if you have source)
1. Archive the app in Xcode
2. Window → Organizer → Archives
3. Select archive → Distribute App
4. App Store Connect → Upload
5. Follow wizard

### Step 3: Complete App Store Listing

#### Version Information
- **Version Number:** 1.0.0
- **Copyright:** 2024 BOUNTY, Inc. (or your entity)
- **Trade Representative Contact:** Your contact info

#### App Store Information

**Name:** BOUNTY
**Subtitle:** Fast & Safe Micro Task Marketplace
**Promotional Text (updatable without review):**
```
Launch Special: Post your first 3 bounties with zero platform fees! 
Find reliable help or earn extra income with our secure escrow system.
```

**Description:**
Use the full description from APP_STORE_ASSETS.md (4000 character optimized version)

**Keywords (100 characters max):**
```
task,gig,freelance,jobs,local,errands,help,hire,work,earn,money,marketplace,escrow,secure,quick
```

**Support URL:** https://bountyfinder.app/support
**Marketing URL:** https://bountyfinder.app

#### Screenshots
Upload screenshots for:
- 6.5" Display (iPhone 14 Pro Max) - Required
- 5.5" Display (iPhone 8 Plus) - Required
- 12.9" iPad Pro - If supporting iPad

See APP_STORE_ASSETS.md for specifications.

#### App Previews (Optional but Recommended)
- Upload 30-second demo video
- Shows key features: create, browse, chat, pay
- See APP_STORE_ASSETS.md for specifications

### Step 4: App Review Information

**Sign-In Required:** Yes
**Demo Account:**
- **Username:** demo@bountyfinder.app
- **Password:** Demo123!Bounty
- **Notes:** Create this account with test data before submission

**Contact Information:**
- **First Name:** [Your name]
- **Last Name:** [Your name]
- **Phone Number:** [Your phone]
- **Email:** support@bountyfinder.app

**Notes (for reviewer):**
```
BOUNTY is a micro task marketplace connecting people who need help 
with those who can provide it.

To test the app:
1. Login with provided demo account
2. Browse existing bounties in the Postings tab
3. Create a new test bounty (use test payment method)
4. Accept a bounty to test the hunter flow
5. Use in-app messaging to coordinate
6. Complete bounty to test escrow release

Note: Payments are processed via Stripe in TEST mode for review. 
Test card: 4242 4242 4242 4242, any future date, any CVV.

The app requires location permissions for location-based bounties 
(optional feature) and camera/photo library for profile pictures 
and bounty attachments.
```

### Step 5: Version Release

**Release Options:**
- [ ] **Manual release:** Control when app goes live after approval
- [ ] **Automatic release:** Goes live immediately after approval
- [ ] **Scheduled release:** Choose specific date/time

**Recommendation:** Manual release for first version (gives time to prepare launch materials)

### Step 6: Export Compliance

**Is your app subject to export regulations?**
- Select "No" if app only uses standard encryption (HTTPS, etc.)
- **ITSAppUsesNonExemptEncryption = false** already set in app.json

**Typical Answer for BOUNTY:**
```
This app uses encryption for:
- HTTPS network calls
- Secure payment processing (Stripe)
- Standard iOS data protection

This is standard encryption and doesn't require export documentation.
Select: No (or "uses standard encryption")
```

### Step 7: Advertising Identifier (IDFA)

**Does this app use the Advertising Identifier (IDFA)?**
- **No** if not using ad networks
- **Yes** if using analytics with advertising features

**For BOUNTY (assuming Mixpanel without ads):**
```
Select: No (unless using ad-based monetization)

If using ad attribution:
- Check purposes that apply
- Provide details on tracking
```

### Step 8: Submit for Review

1. **Final Review:**
   - Check all information is accurate
   - Verify screenshots display correctly
   - Test demo account works
   - Ensure all URLs are accessible

2. **Submit:**
   - Click "Submit for Review"
   - Confirm submission
   - Cannot edit during review (except metadata like promotional text)

3. **Monitor Status:**
   - **Waiting for Review:** In queue (1-3 days typically)
   - **In Review:** Apple is testing (1-2 days)
   - **Pending Developer Release:** Approved, waiting for your release
   - **Ready for Sale:** Live on App Store

### App Review Timeline
- **Average review time:** 24-48 hours
- **First submission:** May take longer
- **Rejections:** Common on first try, address issues and resubmit

### Common Rejection Reasons

1. **Incomplete Information:**
   - Missing demo account or doesn't work
   - Broken links (privacy policy, terms, support)
   - Unclear app purpose

2. **Crashes or Bugs:**
   - App crashes during review
   - Features don't work as described
   - Payment flow issues

3. **Privacy Violations:**
   - Collecting data without disclosure
   - Missing purpose strings
   - Privacy policy doesn't match app behavior

4. **Design Issues:**
   - Poor user experience
   - Looks unfinished
   - Placeholder content

5. **Content Policy Violations:**
   - User-generated content without moderation
   - Inappropriate content
   - Missing age rating

**If Rejected:** Review feedback, fix issues, and resubmit (usually within 24-48 hours)

## 🤖 Google Play Store Submission

### Prerequisites
- Google Play Console account ($25 one-time fee)
- Production `.aab` file from EAS build

### Step 1: Google Play Console Setup

1. **Create App:**
   - Go to: https://play.google.com/console
   - Create app → "Create app"
   - **App name:** BOUNTY
   - **Default language:** English (United States)
   - **App or game:** App
   - **Free or paid:** Free
   - Accept declarations

2. **Set Up Store Listing:**
   - Dashboard → Store presence → Main store listing

### Step 2: Complete Store Listing

#### App Details

**App name:** BOUNTY
**Short description (80 characters):**
```
Create tasks, find hunters, pay securely with escrow. Fast & transparent.
```

**Full description (4000 characters):**
Use the Android version from APP_STORE_ASSETS.md

**App icon:**
- Upload 512 x 512 PNG (32-bit with alpha)
- File: `./assets/images/bounty-icon.png`

**Feature graphic (required):**
- 1024 x 500 PNG or JPEG
- See APP_STORE_ASSETS.md for design guidance

**Phone screenshots:**
- Upload 2-8 screenshots (1080 x 1920 minimum)
- See APP_STORE_ASSETS.md for specifications

**7-inch tablet screenshots (optional):**
- Upload if supporting tablets

**10-inch tablet screenshots (optional):**
- Upload if supporting tablets

#### Categorization

**App category:** Productivity
**Tags (optional):** tasks, gigs, marketplace, freelance, local
**Store listing contact email:** support@bountyfinder.app
**External marketing (optional):** No

**Privacy Policy URL:**
```
https://bountyfinder.app/legal/privacy
```

### Step 3: Content Rating

1. **Start questionnaire:**
   - Dashboard → Policy → App content → Content rating

2. **Answer questions honestly:**
   - **App category:** Productivity
   - **User-generated content?** Yes (if allowing bounty posts/chat)
   - **Violence?** No
   - **Nudity?** No
   - **Drugs?** No
   - **Gambling?** No
   - **Social interaction?** Yes (chat feature)
   - **Purchases?** Yes (in-app payments)
   - **Location sharing?** Yes (optional feature)

3. **Submit:**
   - Receive rating (likely ESRB: Everyone 10+ or Teen)
   - May get different ratings per country

### Step 4: Target Audience

1. **Target age group:**
   - Select: 18+ (safest for marketplace/payments app)

2. **Appeals to children?** No

3. **Store presence:**
   - Parental gate: Not applicable (18+)

### Step 5: News Apps

**Is this a news app?** No

### Step 6: COVID-19 Contact Tracing

**Is this a contact tracing app?** No

### Step 7: Data Safety

1. **Collected data types:**
   - Personal info: Name, Email, Phone number
   - Financial info: Payment info (processed by Stripe)
   - Location: Approximate location (optional)
   - Photos: Profile pictures, bounty attachments
   - Messages: In-app chat messages

2. **Data usage:**
   - Account creation
   - App functionality
   - Analytics
   - Fraud prevention

3. **Data sharing:**
   - Third parties: Stripe (payment processing), Sentry (error tracking)
   - Purpose: Payment processing, app functionality

4. **Security practices:**
   - Data encrypted in transit (HTTPS)
   - Data encrypted at rest (depends on backend)
   - Can request data deletion

5. **Link to privacy policy:**
   ```
   https://bountyfinder.app/legal/privacy
   ```

### Step 8: Government Apps

**Is this a government app?** No

### Step 9: Financial Features

**Does app include ads?** No (assuming no ads)

**Does app include in-app purchases?** No (payments go through Stripe)

### Step 10: Upload Build

#### Option A: Using EAS Submit
```bash
eas submit --platform android --latest
```

Follow prompts to configure submission.

#### Option B: Manual Upload
1. **Go to Release Dashboard:**
   - Dashboard → Release → Production

2. **Create Release:**
   - Click "Create new release"
   - Upload `.aab` file from EAS build
   - Release name: 1.0.0

3. **Release Notes:**
```markdown
# BOUNTY - Initial Release

Welcome to BOUNTY, the fast and safe micro task marketplace!

## What's New
- Create and post bounties (tasks) in seconds
- Browse and accept tasks from your community
- Built-in messaging to coordinate with posters/hunters
- Secure escrow payments through Stripe
- Profile system with reputation tracking
- Location-based task discovery
- Wallet to manage your earnings

## Getting Started
1. Create an account
2. Complete your profile
3. Post a task or browse available bounties
4. Connect through in-app chat
5. Complete bounties and get paid securely

Need help? Visit bountyfinder.app/support

Thank you for using BOUNTY! 🎯
```

### Step 11: Production Release

1. **Review Release:**
   - Countries/regions: All (or select specific)
   - Review all details

2. **Submit for Review:**
   - Click "Start rollout to Production"
   - Confirm submission

3. **Review Process:**
   - **Review time:** Typically 1-3 days (sometimes hours)
   - **Status updates via email**

### Google Play Review Timeline
- **Average review time:** Few hours to 3 days
- **First submission:** May take longer
- **Updates:** Usually faster than initial submission

### Common Rejection Reasons

1. **Violation of Content Policy:**
   - Missing or inadequate content moderation
   - Privacy policy issues
   - Misleading functionality

2. **Data Safety Issues:**
   - Incorrect data safety declarations
   - Missing or broken privacy policy
   - Data collection not disclosed

3. **Minimum Functionality:**
   - App is broken or incomplete
   - Crashes on test devices
   - Core features don't work

4. **Intellectual Property:**
   - Copyrighted content
   - Trademark issues
   - Impersonation

5. **User Generated Content:**
   - No moderation system
   - Inappropriate content allowed
   - Missing reporting mechanisms

**If Rejected:** Review policy violation details, fix issues, and resubmit

## 🚀 Post-Submission Checklist

### After iOS Approval
- [ ] Test app from TestFlight one final time
- [ ] Release app (if using manual release)
- [ ] Monitor crash reports in Sentry
- [ ] Check analytics in Mixpanel
- [ ] Monitor App Store reviews
- [ ] Prepare support channels (email, in-app)
- [ ] Announce launch on social media

### After Android Approval
- [ ] Test app from Play Store (internal track first)
- [ ] Monitor crash reports in Play Console
- [ ] Check analytics in Mixpanel
- [ ] Monitor Play Store reviews
- [ ] Prepare support channels
- [ ] Announce launch

### First 24-48 Hours
- [ ] Monitor crash reports actively
- [ ] Respond to early user feedback
- [ ] Watch for critical bugs
- [ ] Track key metrics:
  - Downloads
  - Sign-ups
  - Bounty creations
  - Completions
  - Payment success rate
  - Crash-free rate

### First Week
- [ ] Analyze user feedback
- [ ] Plan hotfix if critical issues found
- [ ] Start gathering feature requests
- [ ] Monitor retention rate
- [ ] Check payment processing
- [ ] Verify all integrations working

## 📊 Build Versioning

### Version Numbers
Format: `MAJOR.MINOR.PATCH`

**Current:** 1.0.0

**Next versions:**
- 1.0.1 - Bug fix release
- 1.1.0 - New features
- 2.0.0 - Major changes

### Build Numbers
- Automatically incremented by EAS (`autoIncrement: true`)
- Format: 1, 2, 3, 4, etc.
- Can't reuse build numbers

### Updating Version
Edit `app.json` and `package.json`:

```json
// app.json
{
  "expo": {
    "version": "1.0.1"
  }
}

// package.json
{
  "version": "1.0.1"
}
```

## 🔄 Releasing Updates

### Creating Update Build
```bash
# Increment version in app.json and package.json first
eas build --platform all --profile production
```

### Submitting Update

**iOS:**
```bash
eas submit --platform ios --latest
```

**Android:**
```bash
eas submit --platform android --latest
```

### Update Review
- **iOS:** Full review (24-48 hours) for every update
- **Android:** Faster review for updates (hours to 1 day)

## 🆘 Troubleshooting

### Build Issues
```bash
# Clear cache and retry
eas build --platform all --profile production --clear-cache

# Check build logs
eas build:list
# Click on build for detailed logs
```

### Submission Issues
- Verify bundle IDs match exactly
- Check all required fields filled
- Ensure privacy policy is accessible
- Test demo account works
- Verify payment flow works

### Review Rejections
1. Read rejection reason carefully
2. Address all listed issues
3. Test fixes thoroughly
4. Respond to reviewer if needed
5. Resubmit with clear notes on fixes

## 📚 Resources

- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [EAS Submit Documentation](https://docs.expo.dev/submit/introduction/)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Developer Policy](https://play.google.com/about/developer-content-policy/)
- [App Store Connect Help](https://developer.apple.com/help/app-store-connect/)
- [Play Console Help](https://support.google.com/googleplay/android-developer/)

---

**Ready to build?** Follow this guide step-by-step and your app will be in the stores soon! 🎉
