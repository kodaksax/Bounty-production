# BOUNTYExpo — External Beta Testing Guide

Welcome to the external beta for **BOUNTYExpo**, a mobile-first micro-bounty marketplace for iOS and Android. Thank you for helping us make it better before the public launch!

---

## Table of Contents

1. [What is BOUNTYExpo?](#what-is-bountyexpo)
2. [Getting Access](#getting-access)
3. [Installing the App](#installing-the-app)
4. [Key Features to Test](#key-features-to-test)
5. [Test Scenarios](#test-scenarios)
6. [Known Limitations](#known-limitations)
7. [How to Report Feedback](#how-to-report-feedback)
8. [Tips for Effective Beta Testing](#tips-for-effective-beta-testing)
9. [Contact & Support](#contact--support)

---

## What is BOUNTYExpo?

BOUNTYExpo connects **Posters** (people with tasks) and **Hunters** (people who complete them). The core loop is:

```
Post a Bounty → Get Matched → Chat → Complete → Settle (Escrow)
```

**Poster**: Create a task (bounty), set a price or mark it as "for honor", review applicants, chat with the hunter, and release payment on completion.

**Hunter**: Browse open bounties, apply or accept, chat with the poster, complete the work, and receive payment.

---

## Getting Access

Beta builds are distributed via **Expo EAS** (internal distribution):

1. You should have received an invite link by email or direct message.
2. On your phone, open the invite link. You will be prompted to install the **Expo Go** app (if you don't already have it) or to accept the build profile.
3. Install the beta build.

> **Don't have an invite?** Contact the beta coordinator to request access.

---

## Installing the App

### iOS (TestFlight or Expo Go)
- Follow the invite link on your iPhone.
- Accept the TestFlight invitation (or open in Expo Go for development builds).

### Android (Expo Go or direct APK)
- Follow the invite link on your Android phone.
- If prompted, enable "Install from unknown sources" for your browser.
- Install the APK or open in Expo Go.

### Requirements
- iOS 14+ or Android 9+
- Internet connection (WiFi or cellular)
- A valid email address for account registration

---

## Key Features to Test

### 🔑 Authentication & Onboarding
- Sign up with a new email address
- Verify your email (check inbox / spam)
- Complete the onboarding flow: username → profile details → (optional) phone
- Sign out and sign back in
- Try the "Forgot Password" flow

### 📋 Create a Bounty (Poster)
- Tap the **+** (bounty) button in the bottom nav
- Fill in title, description, and compensation (amount or "for honor")
- Add an optional location
- Confirm and verify the bounty appears in the Postings feed

### 🔍 Browse & Accept (Hunter)
- Browse the Postings feed
- Search for bounties by keyword
- Open a bounty detail view
- Apply to or accept an open bounty

### 💬 Messaging
- After acceptance, verify a conversation is created automatically
- Send and receive messages in real time
- Test with the screen locked / app backgrounded (push notification should arrive)
- Reconnect after going offline and verify queued messages are sent

### 💰 Wallet & Payments
- Open the Wallet screen
- Tap "Add Money" and complete a payment (use Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC)
- Verify the balance updates
- View the transaction history

### ✅ Complete a Bounty
- As a Poster with an in-progress bounty: tap "Mark Complete"
- Verify the escrow is released
- Check the transaction history reflects the release

### 👤 Profile & Settings
- Edit your display name, bio, and avatar
- Toggle privacy settings (profile visibility, location sharing)
- Test blocking another user

### 🔔 Notifications
- Enable push notifications when prompted
- Verify notifications arrive for new messages and bounty status changes

---

## Test Scenarios

These end-to-end scenarios cover the most important flows. Try each one if possible:

| # | Scenario | Roles |
|---|----------|-------|
| 1 | New user sign-up → onboarding → first bounty created | Poster |
| 2 | Browse feed → apply to bounty → message poster | Hunter |
| 3 | Poster accepts hunter → chat → mark complete → payment released | Both |
| 4 | Add money to wallet → verify balance | Poster or Hunter |
| 5 | Sign out → sign back in (session restoration) | Either |
| 6 | Send a message while offline → reconnect → verify delivery | Either |
| 7 | Reset password via email | Either |

---

## Known Limitations

Please review [docs/KNOWN_ISSUES.md](KNOWN_ISSUES.md) for the full list. Key points:

- **Hunter payouts** via Stripe Connect are scaffolded but not active in this beta. Payment releases are recorded in-app but bank transfers are not yet processed.
- **End-to-end message encryption** is on the roadmap and not implemented in this release.
- **Ratings & reputation** system is not yet built.
- **Recurring bounties** and advanced calendar scheduling are planned for a future release.
- Some error messages may be generic; we are improving them.

---

## How to Report Feedback

We use GitHub Issues for all beta feedback:

👉 **[Open an Issue](https://github.com/kodaksax/Bounty-production/issues/new/choose)**

Choose the appropriate template:

| Template | When to use |
|----------|------------|
| 🐛 **Bug Report** | App crashes, broken flows, incorrect behaviour |
| 🧪 **Beta Feedback** | General impressions, usability suggestions, confusion points |
| 💡 **Feature Request** | Ideas for new or improved functionality |

> **Security vulnerabilities**: Please **do not** open a public issue. Use the [GitHub Security Advisory](https://github.com/kodaksax/Bounty-production/security/advisories/new) form instead.

### What makes a great bug report?

- Steps to reproduce (numbered list)
- What you expected vs. what happened
- Platform (iOS/Android), device model, and OS version
- Screenshot or screen recording if relevant

---

## Tips for Effective Beta Testing

- **Test on a real device** when possible — simulator/emulator behaviour can differ.
- **Try the unhappy paths**: enter invalid data, go offline mid-flow, use a slow connection.
- **Use the Stripe test card** `4242 4242 4242 4242` for all payment testing.
- **Don't use real personal or financial data** — this is a beta environment.
- **Test with at least two accounts** (one Poster, one Hunter) for end-to-end flows.
- **Note the exact steps** that led to a bug — the more specific, the faster we can fix it.

---

## Contact & Support

- **GitHub Issues**: [github.com/kodaksax/Bounty-production/issues](https://github.com/kodaksax/Bounty-production/issues)
- **Security disclosures**: [GitHub Security Advisories](https://github.com/kodaksax/Bounty-production/security/advisories/new)
- **General questions**: Open a [Beta Feedback](https://github.com/kodaksax/Bounty-production/issues/new?template=beta_feedback.yml) issue

Thank you for testing BOUNTYExpo! 🚀
