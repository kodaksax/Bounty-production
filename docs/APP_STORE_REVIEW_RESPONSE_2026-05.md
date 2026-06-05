# App Store Review Response — Submission 1425efd3 (v1.0 build 39)

> Review date: May 29, 2026 · Review device: iPad Air 11-inch (M3), iPadOS 26.5
> App: Bountyfinder / BOUNTY (`com.bounty.BOUNTYExpo`)
>
> This document tracks every rejection item from the v1.0 (39) review, the
> remediation, and — where the fix is **not** in code — the exact manual steps
> required in App Store Connect, the Apple Developer portal, or the Supabase
> dashboard. Items requiring an Account Holder/Admin action are called out.

Legend: 🟢 fixed in code · 🟦 manual configuration required · 🟨 add to App
Review Notes when resubmitting.

| # | Guideline | Status |
|---|-----------|--------|
| 1 | 4 — Design (iPad layout) | 🟢 Fixed in code |
| 2 | 5.1.2(i) — ATT / Device ID tracking | 🟦 App Privacy label (Account Holder/Admin) |
| 3 | 2.1(a) — Sign in with Apple error / card linking | 🟦 Supabase + Apple Developer config |
| 4 | 5.1.1(ix) — Organization account | 🟦 Apple Developer Program enrollment |
| 5 | 2.3.6 — Age Rating In-App Controls | 🟦 App Store Connect Age Rating |
| 6 | 2.1 — PassKit / Apple Pay verification | 🟨 Review Notes |

---

## 1. Guideline 4 — Design (bottom of "Link Card" screen hidden on iPad) — 🟢 Fixed

**Reviewer finding:** "The bottom part of linking card screen was hidden" on
iPad Air 11-inch (M3).

**Root cause:** In `components/add-card-modal.tsx` the embedded "Add Card"
content (both the Stripe Payment Element variant and the manual-entry variant)
was rendered inside a fixed-height bottom sheet (`maxHeight: 92%`) without a
flex-bounded, scrollable container and without honoring the device safe-area
inset. On taller iPad presentations the content overflowed the sheet, the
overflow was clipped (`overflow: 'hidden'`), and because the inner `ScrollView`
was not height-bounded it could not scroll to reveal the **Save Card** button.

**Fix (this PR):** `components/add-card-modal.tsx`
- Added `useSafeAreaInsets()` and a `bottomInset = Math.max(insets.bottom, 16)`.
- Embedded containers now use `flex: 1` so their `ScrollView` is height-bounded
  and scrollable.
- The embedded Payment Element variant and the non-embedded overlay Payment
  Element variant are now wrapped in a `ScrollView`.
- Every scroll container adds `paddingBottom` derived from the safe-area inset so
  the action button always clears the home indicator / rounded sheet edge.

**Verification before resubmitting:** Build and run on an iPad Air 11-inch (M3)
simulator (iPadOS 26+). Open **Wallet → Payment Methods → Add Card** and confirm
the **Save Card** button and any Apple/Google Pay express buttons are fully
visible and reachable by scrolling, in both portrait and landscape.

---

## 2. Guideline 5.1.2(i) — App Tracking Transparency / Device ID — 🟦 Manual

**Reviewer finding:** The App Privacy information declares the app collects data
(including Device ID) **used to track** the user, but the app does not present
the App Tracking Transparency (ATT) prompt.

**Determination:** BOUNTY does **not** track users in the App Store sense
(linking data with third-party data for advertising, or sharing with a data
broker). The app ships **no advertising or attribution SDKs** — verified in
`package.json`: the only data-adjacent dependencies are `@sentry/react-native`
(crash/diagnostics) and `@stripe/stripe-react-native` (payments). Neither is used
for cross-app advertising tracking. There is no AdSupport/IDFA usage and no
`AppTrackingTransparency` framework call anywhere in the codebase.

Because the app does not track, **the correct resolution is to update the App
Privacy nutrition label**, not to add an ATT prompt (Apple's first listed
option). Adding an ATT prompt for data you do not use for tracking would itself
be misleading.

**Manual steps (requires Account Holder or Admin):**
1. App Store Connect → **Bountyfinder** → **App Privacy** → **Edit**.
2. For **Device ID** (and any other data type currently marked as *Used to Track
   You*), change the usage so it is **not** flagged for **Tracking**. If Device
   ID is not actually collected at all, remove it; if it is only used for app
   functionality/analytics, keep it under the appropriate non-tracking purpose.
3. Ensure **no** data type remains under the "Used to Track You" section.
4. Save. Confirm the label shows no tracking before resubmitting.

**If product later adds real tracking** (e.g. an ad/attribution SDK), then the
app **must** call `AppTrackingTransparency` before collecting tracking data. The
implementation path would be: add `expo-tracking-transparency`, set
`NSUserTrackingUsageDescription` in `app.json → ios.infoPlist`, and request
permission with `requestTrackingPermissionsAsync()` before initializing the SDK.
None of this is wired up today because the app does not track.

**Reply to App Review:** State that the app does not track users on any
platform, that the App Privacy label has been corrected to remove the Device ID
"tracking" designation, and that no ATT prompt is required.

---

## 3. Guideline 2.1(a) — Sign in with Apple error & unable to link a card — 🟦 Config

**Reviewer finding:** An error notification appeared when signing in with Apple,
and the reviewer was unable to link a card.

These two symptoms almost always share one root cause on this stack: the review
build could not complete native authentication, and without an authenticated
session the card-linking SetupIntent call also fails. The **app code paths are
correct** (`app/auth/sign-in-form.tsx` performs a native
`AppleAuthentication.signInAsync` → `supabase.auth.signInWithIdToken`, and
`components/add-card-modal.tsx` creates a Stripe SetupIntent for the signed-in
user). The failure is in **backend/provider configuration**, which is why this is
a manual fix.

### 3a. Supabase Apple provider must authorize the iOS bundle ID — 🟦
Native iOS Sign in with Apple returns an identity token whose audience (`aud`)
is the app's **bundle identifier** `com.bounty.BOUNTYExpo`. Supabase rejects the
token (surfacing as the on-device error) unless that bundle ID is listed.

Manual steps — Supabase dashboard → **Authentication → Providers → Apple**:
1. Enable the Apple provider.
2. In **Authorized Client IDs**, add `com.bounty.BOUNTYExpo` (the iOS bundle ID).
   Keep any existing Services ID used for web/Android as additional entries
   (comma-separated). The native iOS client ID is the bundle ID, **not** the
   Services ID.
3. Ensure the **Secret Key (for OAuth)** / Services ID + Team ID + Key ID are
   present and current (the signing key has not expired/been revoked).
4. Save and allow a minute for propagation, then retest native Apple sign-in.

Reference: the bundle ID is defined in `app.json → ios.bundleIdentifier`, and
the Sign in with Apple entitlement is declared at
`app.json → ios.entitlements["com.apple.developer.applesignin"]`.

### 3b. Apple Developer "Sign in with Apple" capability — 🟦
In the Apple Developer portal, confirm the App ID `com.bounty.BOUNTYExpo` has the
**Sign in with Apple** capability enabled, and that the provisioning profile used
for the review build includes it. (EAS-managed credentials normally handle this,
but verify after any bundle ID or team changes.)

### 3c. Stripe configuration for card linking — 🟦
Card linking uses a Stripe SetupIntent created by the backend for the
authenticated user. Verify before resubmitting:
1. `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` in the production EAS env matches the
   **same Stripe account/mode** the backend uses for the SetupIntent secret
   (both live, or both test — never mixed). `AddCardModal` logs a publishable-key
   mode mismatch warning; check device logs if linking still fails.
2. The backend SetupIntent endpoint is reachable from the production API base
   URL (`https://bountyfinder.app`) and returns a `client_secret`.
3. Re-run the **end-to-end test**: sign in with Apple on a real iPad → Wallet →
   Add Card → enter a Stripe test card → confirm the card persists.

**Reply to App Review:** Note that the Apple sign-in error was a provider
configuration issue (now corrected), and provide a demo account plus the exact
path Wallet → Payment Methods → Add Card so the reviewer can re-verify.

---

## 4. Guideline 5.1.1(ix) — Organization account required — 🟦 Manual (cannot fix in code)

**Reviewer finding:** Apps offering highly regulated services / handling
sensitive data must be submitted from an Apple Developer Program account enrolled
as an **organization**, not an individual. (BOUNTY handles payments/KYC, so this
applies.)

**This cannot be resolved in code or with documentation/permission letters.** The
only resolutions are:
1. **Convert** the existing individual account to an organization account by
   contacting **Apple Developer Support** (requires a legal entity name and a
   D-U-N-S number), **or**
2. **Enroll a new** Apple Developer Program account as an organization and
   **transfer the app** to it (App Store Connect → app transfer).

Action owner: Account Holder. Until the account is an organization, the app
cannot pass this guideline regardless of the code state. Fee waivers are
available for nonprofits/education/government entities.

---

## 5. Guideline 2.3.6 — Age Rating "In-App Controls" / Age Assurance — 🟦 Manual

**Reviewer finding:** The Age Rating indicates the app includes **In-App
Controls**, but no Parental Controls or Age Assurance mechanism was found.

**Determination:** BOUNTY does **not** implement Parental Controls or an Age
Assurance mechanism. It has a self-declared 18+ confirmation checkbox at sign-up
(`app/auth/sign-up-form.tsx`) plus Stripe Identity KYC for payouts — neither of
these is an Apple "In-App Controls / Age Assurance" feature. The metadata is
therefore inaccurate and should be corrected.

**Manual steps (App Store Connect → App Information → Age Rating → Edit):**
1. Set **Age Assurance** to **None**.
2. Set **In-App Controls / Parental Controls** to **None** (unless such a feature
   is actually added later).
3. Re-save the questionnaire and confirm the recalculated rating.

**Reply to App Review:** Confirm the app does not include Parental Controls or
Age Assurance and that the Age Rating selections have been updated to "None".

---

## 6. Guideline 2.1 — PassKit / Apple Pay verification — 🟨 Review Notes

**Reviewer finding:** The binary includes PassKit (Apple Pay) but the reviewer
could not verify Apple Pay integration.

**Determination:** Apple Pay **is** integrated. The PassKit framework is pulled
in by `@stripe/stripe-react-native`, and the app uses it:
- `components/add-money-screen.tsx` — checks availability via
  `applePayService.isAvailable()` and renders an **Apple Pay** button
  (`Platform.OS === 'ios' && isApplePayAvailable`), handled by
  `handleApplePayPress` → `applePayService.processPayment(...)`.
- `lib/services/apple-pay-service.ts` — gates on `isApplePaySupported()` from the
  Stripe SDK.
- Merchant identifier `merchant.com.bountyexpo-workspace` is configured
  consistently in `app.json` (`ios.entitlements["com.apple.developer.in-app-payments"]`
  and the `@stripe/stripe-react-native` plugin `merchantIdentifier`).

**Why the reviewer may not have seen it:** The Apple Pay button is intentionally
**hidden when `isApplePaySupported()` returns false** — i.e. when the test device
has no card provisioned in Apple Wallet. On the review device the button would
not appear until a (test) card is added to Wallet.

**Add to App Review Notes (no code change required):**
> Apple Pay is available at **Wallet → Add Money**. The Apple Pay button appears
> only on iOS devices that have a card in Apple Wallet (it is gated by
> `isApplePaySupported()`). To verify: add a card to Apple Wallet on the review
> device, open Wallet → Add Money, enter an amount, and the Apple Pay button will
> be shown. Merchant ID: `merchant.com.bountyexpo-workspace`.

If Apple Pay is **not** intended to ship in this version, instead remove the
Apple Pay capability/entitlement and the Stripe `merchantIdentifier`, and note in
Review Notes that Apple Pay is not used — but the recommended path is to keep it
and add the note above.

---

## Resubmission checklist

Before uploading the next build, confirm:

- [ ] **(Code)** iPad add-card screen verified scrollable with visible Save
      button on iPad Air 11-inch (M3).
- [ ] **(Account Holder/Admin)** App Privacy label updated so no data type is
      marked "Used to Track You" (Item 2).
- [ ] **(Config)** Supabase Apple provider lists `com.bounty.BOUNTYExpo` in
      Authorized Client IDs; Apple sign-in re-tested on device (Item 3a/3b).
- [ ] **(Config)** Stripe publishable/secret keys are same-mode; card linking
      re-tested end-to-end (Item 3c).
- [ ] **(Account Holder)** Developer account enrolled as an organization, or app
      transfer to an org account in progress (Item 4).
- [ ] **(App Store Connect)** Age Rating "Age Assurance" and In-App Controls set
      to "None" (Item 5).
- [ ] **(Review Notes)** Apple Pay location note added; demo account + repro
      steps for Apple sign-in and card linking included (Items 3, 6).
