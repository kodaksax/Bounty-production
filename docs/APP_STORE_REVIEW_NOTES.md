# App Store Review Notes

> Last updated: 2026-04-26
>
> This document captures known App Store / Play Store review considerations for
> BOUNTY (`com.bounty.BOUNTYExpo` on iOS, `app.bountyfinder.BOUNTYExpo` on
> Android), with the rationale for current decisions and the recommended path
> if a reviewer asks follow-up questions.

## Summary of changes already shipped

The following high-risk findings from the pre-submission review have been
addressed in code:

| Item | Resolution | Location |
|---|---|---|
| Background location capability declared but not used | Removed `UIBackgroundModes: ["location"]` and `NSLocationAlwaysAndWhenInUseUsageDescription` from `ios.infoPlist`. Only foreground `NSLocationWhenInUseUsageDescription` is requested, matching the actual code path in `lib/services/location-service.ts`. | `app.json` |
| Inconsistent / misleading fee disclosure | Bounty creation review screen now states the actual 10% platform fee on completion plus the optional Stripe processing fees on top-ups. FAQ updated to match. Single source of truth for the fee rate is `PLATFORM_FEE_PERCENTAGE` in `lib/wallet-context.tsx`. | `app/screens/CreateBounty/StepReview.tsx`, `components/settings/faq-screen.tsx` |
| 2FA enrollment without QR code | `Alert`-based "Set Up Authenticator" dialog replaced with `TotpEnrollmentModal`, which renders the SVG QR code returned by `supabase.auth.mfa.enroll`, exposes the manual setup secret, and collects the first verification code in one screen. Cancelling the modal best-effort unenrolls the pending factor. | `components/ui/totp-enrollment-modal.tsx`, `components/settings/privacy-security-screen.tsx` |

## Medium-risk items intentionally deferred

These items are documented rather than fixed because they are either policy
calls, require product/legal input, or can be argued against during review.
Each entry below contains the relevant Apple guideline, the current behavior,
the rationale for the current behavior, and the recommended remediation path
if a reviewer flags it.

### 1. Sign in with Apple parity on the sign-up form

* **Apple guideline**: 4.8 — Login Services. If the app uses a third-party or
  social login service that gathers personal data, Sign in with Apple must be
  offered as an equivalent option.
* **Current behavior**: `app/auth/sign-in-form.tsx` exposes Apple Sign In on
  iOS (line 618 onwards). `app/auth/sign-up-form.tsx` only offers email +
  password — neither Apple nor Google buttons are rendered there.
* **Why this is likely fine**: Apple's enforcement of 4.8 is centered on
  *account creation*. The sign-in screen is reachable from the sign-up screen
  and creates an account on first use of Apple Sign In (Supabase
  `signInWithIdToken` provisions a profile if none exists). Both Google OAuth
  and Apple Sign In can therefore be used to create an account, even though
  the buttons live on the sign-in route.
* **If a reviewer pushes back**: Add the same `AppleAuthentication.AppleAuthenticationButton`
  block from `sign-in-form.tsx` to `sign-up-form.tsx`, gated on
  `Platform.OS === 'ios'`. Reuse the existing token-exchange code path; no
  backend changes are required.

### 2. Self-declared 18+ age gate

* **Apple guideline**: 1.3 (Kids Category) and 5.1.1(iv).
* **Current behavior**: Sign-up requires checking "I confirm I am 18 years or
  older" before the `Create Account` button enables. The check is enforced
  client-side and recorded in the user profile. There is no document-based
  age verification (only Stripe Identity is used later for payouts).
* **Why this is acceptable**: BOUNTY is rated 17+ in App Store Connect, the
  Terms of Service explicitly prohibit users under 18, and Stripe's KYC flow
  is invoked for any cash-out. Self-declaration plus contractual prohibition
  is the industry norm for peer-to-peer marketplaces (e.g., TaskRabbit, Thumbtack).
* **If a reviewer pushes back**: Provide the App Store Connect age rating
  reasoning (no objectionable content, financial transactions only between
  18+ users, KYC enforced for payouts). If escalated, gate financial actions
  (post bounty, withdraw) behind Stripe Identity verification, which already
  exists in the verification flow.

### 3. Real-world services vs. digital-goods classification (IAP)

* **Apple guideline**: 3.1.1 (In-App Purchase) and 3.1.3(a) ("Reader" /
  Real-World Services exception).
* **Current behavior**: Money flows are handled via Stripe Connect with a 10%
  platform fee. No use of Apple In-App Purchase for any bounty-related
  payment.
* **Why this is permitted**: Bounties are person-to-person tasks performed
  *outside* the app — physical errands, local help, in-person services. Apple
  has long permitted real-money platforms (Uber, DoorDash, TaskRabbit, eBay,
  Etsy) to use their own payment processor for real-world services and
  goods. The BOUNTY Terms of Service and product copy consistently describe
  bounties as real-world tasks.
* **Where this could break down**: If users post primarily digital bounties
  ("design my logo," "write code for me," "edit my video") that are delivered
  inside the app or via attachments, Apple could reclassify those flows as
  digital services that must use IAP. To minimize risk:
  * Keep marketing and category framing focused on local / real-world help.
  * Discourage digital deliverables in the in-app posting categories (the
    seeded `restricted-categories` list in `services/api/src/db/seed-restricted-categories.ts`
    is the right place to enforce this).
  * If a reviewer asks, point to the Terms of Service Section 1 ("OUR
    SERVICES") and the bounty examples in onboarding (`app/onboarding/carousel.tsx`),
    which all describe physical / local tasks.

## Other reviewer-friendly facts to keep handy

* **Account deletion** (Guideline 5.1.1(v)) — fully implemented at
  `Settings → Delete Account`, with two-step confirmation
  (`components/settings-screen.tsx` lines 183–280) and the
  `deleteUserAccount` service in `lib/services/account-deletion-service.ts`.
* **In-app reporting of UGC** (Guideline 1.2) — bounties, profiles, and
  messages all support reports via `components/ReportModal.tsx`.
* **Privacy policy and terms** are inlined in
  `assets/legal/{terms.ts, privacy.ts}` and accessible from sign-up,
  settings, and the help center, satisfying Guideline 5.1.1.
* **Encryption declaration** — `ITSAppUsesNonExemptEncryption: false` is set
  because the app uses only standard TLS / system-provided crypto.
* **Push and location permission strings** are user-friendly and feature-
  specific, as required by Guideline 5.1.1(i).

## Reviewer demo-account checklist

When uploading a build, populate the App Store Connect "App Review
Information" section with:

1. A demo account with email + password, pre-verified email, and at least one
   funded bounty in `open` and `in_progress` state so reviewers can exercise
   the full create → match → chat → release flow.
2. A note indicating that real charges are not made in test mode (Stripe test
   keys), but the embedded payments dashboard (`app/wallet/payments.tsx`) and
   withdrawal flow (`components/withdraw-screen.tsx`) are otherwise live.
3. A note that 2FA is optional, opt-in, and reachable from
   `Settings → Privacy & Security` for testing.
