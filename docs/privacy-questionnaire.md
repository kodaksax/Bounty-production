# BOUNTYExpo - App Store Privacy Questionnaire

## Overview

This document outlines the data collection and usage practices for BOUNTYExpo to complete Apple's App Store Privacy Questionnaire. This information is required for App Store Connect submission.

---

## Data Collection Summary

| Data Type | Collected | Linked to User | Used for Tracking |
|-----------|-----------|----------------|-------------------|
| Contact Info (Email) | ✅ Yes | ✅ Yes | ❌ No |
| Contact Info (Phone) | ✅ Yes | ✅ Yes | ❌ No |
| Identifiers (User ID) | ✅ Yes | ✅ Yes | ❌ No |
| User Content (Bounties) | ✅ Yes | ✅ Yes | ❌ No |
| User Content (Messages) | ✅ Yes | ✅ Yes | ❌ No |
| User Content (Photos) | ✅ Yes | ✅ Yes | ❌ No |
| Financial Info | ✅ Yes | ✅ Yes | ❌ No |
| Location (Coarse) | ✅ Yes | ✅ Yes | ❌ No |
| Usage Data | ✅ Yes | ✅ Yes | ❌ No |
| Diagnostics | ✅ Yes | ❌ No | ❌ No |

---

## Detailed Data Categories

### 1. Contact Information

#### Email Address
- **Collected:** Yes
- **Linked to Identity:** Yes
- **Used for Tracking:** No
- **Purpose:**
  - Account creation and authentication
  - Account verification
  - Important notifications (bounty updates, messages)
  - Password reset and account recovery
- **Third-Party Sharing:** No (except authentication provider - Supabase)

#### Phone Number
- **Collected:** Yes
- **Linked to Identity:** Yes
- **Used for Tracking:** No
- **Purpose:**
  - Phone verification for trust/safety
  - SMS notifications (optional)
  - Account recovery
- **Third-Party Sharing:** No

---

### 2. Identifiers

#### User ID
- **Collected:** Yes
- **Linked to Identity:** Yes
- **Used for Tracking:** No
- **Purpose:**
  - Account identification
  - Linking user data (bounties, messages, transactions)
  - App functionality
- **Third-Party Sharing:** 
  - Supabase (authentication/database)
  - Stripe (payment processing)
  - Sentry (error reporting - anonymized)

#### Device ID
- **Collected:** Yes (via Expo/Sentry)
- **Linked to Identity:** No
- **Used for Tracking:** No
- **Purpose:**
  - Crash reporting and debugging
  - Push notification delivery
- **Third-Party Sharing:** Sentry (diagnostics only)

---

### 3. Financial Information

#### Payment Info
- **Collected:** Yes (via Stripe)
- **Linked to Identity:** Yes
- **Used for Tracking:** No
- **Data Collected:**
  - Card last 4 digits (for display only)
  - Card brand/type
  - Expiration date
- **Purpose:**
  - Processing bounty payments
  - Wallet deposits and withdrawals
  - Escrow management
- **Third-Party Sharing:** Stripe (payment processor)
- **Note:** Full card numbers are never stored on our servers; Stripe handles all sensitive payment data

#### Transaction History
- **Collected:** Yes
- **Linked to Identity:** Yes
- **Used for Tracking:** No
- **Purpose:**
  - Display user's payment history
  - Escrow tracking
  - Dispute resolution
- **Third-Party Sharing:** Stripe

---

### 4. User Content

#### Bounty Postings
- **Collected:** Yes
- **Linked to Identity:** Yes
- **Used for Tracking:** No
- **Data Collected:**
  - Bounty title and description
  - Amount/budget
  - Location (for in-person tasks)
  - Deadline information
  - Attachments/photos
- **Purpose:**
  - Core app functionality
  - Matching posters with hunters
  - Public display in bounty feed
- **Third-Party Sharing:** No

#### Messages
- **Collected:** Yes
- **Linked to Identity:** Yes
- **Used for Tracking:** No
- **Purpose:**
  - In-app communication between users
  - Coordination of bounty tasks
  - Dispute resolution (if needed)
- **Third-Party Sharing:** No
- **Retention:** Messages are stored indefinitely unless user deletes account

#### Photos/Media
- **Collected:** Yes
- **Linked to Identity:** Yes
- **Used for Tracking:** No
- **Purpose:**
  - Profile avatars
  - Bounty attachments
  - Portfolio images
  - Message attachments
- **Third-Party Sharing:** Supabase Storage

---

### 5. Location Data

#### Precise Location
- **Collected:** No (not required)

#### Coarse Location
- **Collected:** Yes
- **Linked to Identity:** Yes
- **Used for Tracking:** No
- **Purpose:**
  - Distance calculation for bounties
  - Location-based bounty filtering
  - In-person task coordination
- **Third-Party Sharing:** No
- **Note:** Location is only accessed when user enables it; bounty location is user-entered text, not GPS

---

### 6. Usage Data

#### Product Interaction
- **Collected:** Yes
- **Linked to Identity:** Yes
- **Used for Tracking:** No
- **Data Collected:**
  - Features used
  - Bounties viewed/applied to
  - Screen navigation
- **Purpose:**
  - App improvement
  - Feature analytics
  - User experience optimization
- **Third-Party Sharing:** Analytics provider (if implemented)

---

### 7. Diagnostics

#### Crash Data
- **Collected:** Yes
- **Linked to Identity:** No
- **Used for Tracking:** No
- **Purpose:**
  - Bug identification and fixing
  - App stability improvement
- **Third-Party Sharing:** Sentry

#### Performance Data
- **Collected:** Yes
- **Linked to Identity:** No
- **Used for Tracking:** No
- **Purpose:**
  - App performance monitoring
  - Load time optimization
- **Third-Party Sharing:** Sentry

---

## Third-Party Services and Data Sharing

### Supabase (Authentication & Database)
- **Data Shared:** User ID, email, profile data, bounties, messages
- **Purpose:** Backend infrastructure, authentication, data storage
- **Privacy Policy:** https://supabase.com/privacy

### Stripe (Payment Processing)
- **Data Shared:** User ID, payment method tokens, transaction data
- **Purpose:** Payment processing, escrow management
- **Privacy Policy:** https://stripe.com/privacy
- **Note:** PCI-DSS compliant; handles all sensitive payment data

### Sentry (Error Monitoring)
- **Data Shared:** Device info, crash logs, performance metrics
- **Purpose:** Bug tracking, app stability
- **Privacy Policy:** https://sentry.io/privacy/
- **Note:** User data is anonymized

### Expo/EAS (App Infrastructure)
- **Data Shared:** Device tokens (for push notifications)
- **Purpose:** Push notifications, OTA updates
- **Privacy Policy:** https://expo.dev/privacy

---

## Data Retention

| Data Type | Retention Period |
|-----------|------------------|
| Account Data | Until account deletion |
| Bounty Postings | Until deleted by user or 1 year after completion |
| Messages | Until account deletion |
| Transaction History | 7 years (legal/tax requirements) |
| Crash Logs | 90 days |
| Analytics | 2 years |

---

## User Rights

Users can:
- ✅ **Access** their data via the app (Profile, History)
- ✅ **Correct** their profile information
- ✅ **Delete** their account and associated data
- ✅ **Export** their data (on request)
- ✅ **Opt-out** of optional notifications

### Account Deletion
- Users can delete their account from Settings
- Deletion removes: profile, posted bounties, applications, messages
- Some data retained for legal compliance (anonymized transaction records)

---

## App Store Privacy Label Responses

### Does your app collect data?
**Yes**

### Data Types Collected:

1. **Contact Info**
   - ☑️ Email Address
   - ☑️ Phone Number

2. **Identifiers**
   - ☑️ User ID
   - ☑️ Device ID

3. **Financial Info**
   - ☑️ Payment Info
   - ☑️ Other Financial Info (wallet balance)

4. **User Content**
   - ☑️ Photos or Videos
   - ☑️ Other User Content (bounties, messages)

5. **Location**
   - ☑️ Coarse Location

6. **Usage Data**
   - ☑️ Product Interaction

7. **Diagnostics**
   - ☑️ Crash Data
   - ☑️ Performance Data

### Is data linked to user identity?
**Yes** (for most data types, except diagnostics)

### Is data used for tracking?
**No** - We do not use collected data to track users across apps or websites owned by other companies.

---

## Privacy Policy URL

https://bountyfinder.app/privacy

---

## Contact for Privacy Questions

privacy@bountyfinder.app

---

## Compliance Notes

- **GDPR:** Users can request data deletion; consent obtained for data collection
- **CCPA:** California users can opt-out; no data sold to third parties
- **Apple ATT:** App Tracking Transparency not required (no tracking)
- **COPPA:** App rated 12+; no data collected from children under 13
