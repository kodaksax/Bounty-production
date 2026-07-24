# Apple Pay Production Failure Report

Date: 2026-07-24
Scope: `com.bounty.BOUNTYExpo` iOS App Store build

## Root Cause

**The Apple Pay merchant identifier the JS runtime passes to `initStripe()` does not match the `com.apple.developer.in-app-payments` entitlement compiled into the signed iOS binary.** PassKit only authorizes Apple Pay for merchant IDs the app is actually entitled for. When `initStripe({ merchantIdentifier })` is called with an ID outside that entitlement, Apple Pay fails at the native/OS layer — before any JS network call, before any Stripe API call, and without throwing a JS-visible error in most cases. That exactly matches every symptom in the investigation brief: no `/apple-pay/payment-intent` calls, no `/apple-pay/confirm` calls, no Stripe PaymentIntent ever created, no analytics (there was no telemetry on this path at all — see "Changes Made").

There were actually **two independent wrong values**, neither of which matched the real entitlement:

| Source | Value | Valid Apple Pay ID format? | Matches entitlement? |
|---|---|---|---|
| iOS entitlement (`app.json` → `ios.entitlements`, unchanged since the feature was first added) | `merchant.com.bountyexpo-workspace` | ✅ | — (this is the ground truth) |
| `@stripe/stripe-react-native` Expo plugin config in `app.json` | `merchant.com.bountyexpo-workspace` | ✅ | ✅ matches entitlement |
| **EAS production env var** `EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID` (live in EAS dashboard today) | `merchant.com.bounty.BOUNTYExpo` | ✅ syntactically | ❌ **does not match** |
| **JS hardcoded fallback** in `lib/services/stripe-sdk.ts` (used if the env var is ever unset) | `com.bounty0.BOUNTYExpo` | ❌ missing required `merchant.` prefix, and has a typo (`bounty0`) | ❌ **does not match** |

Since the EAS production environment variable is set, production builds used `merchant.com.bounty.BOUNTYExpo` at runtime — silently wrong every time.

### How this happened (confirmed via `git log`)

- `app.json`'s entitlement (`merchant.com.bountyexpo-workspace`) has been **stable since Apple Pay was first added** — it is the one referenced in `docs/APP_STORE_REVIEW_RESPONSE_2026-05.md` as "already configured" for a real App Store review, and it matches the last generated native project (`ios-backup-20260123-171108/BOUNTY/BOUNTY.entitlements`). This is the value actually registered.
- The JS fallback was **deliberately changed** in commit `3a148136` ("Address PR feedback: update merchantIdentifier..."), which changed the default from `merchant.com.bountyexpo` to `com.bounty0.BOUNTYExpo` — dropping the mandatory `merchant.` prefix and introducing a typo. This fallback was never valid.
- At some later point, someone set `EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID=merchant.com.bounty.BOUNTYExpo` in the EAS dashboard — a plausible-looking value (it mirrors the bundle ID naming convention) but one that was never registered as the app's actual Apple Pay Merchant ID and doesn't match the compiled entitlement.

### Why this was hard to notice

`components/add-money-screen.tsx` and `components/onboarding/PosterFundingScreen.tsx` intentionally **always render the Apple Pay button on iOS** — a deliberate, correct choice per Apple App Review Guideline 2.1 (the integration must be discoverable even when unusable on a given device). The tap handler (`hooks/use-wallet-deposit.ts` → `payWithApplePay`) re-checks `applePayService.isAvailable()` and, if unavailable, shows: *"Apple Pay isn't set up on this device. Open the Wallet app and add a card..."* — a message that reads exactly like a normal device-provisioning issue. There was no logging or analytics event on this dead-end path, so a config bug was indistinguishable from "the user just doesn't have Apple Pay set up," for every single user, on every device — which is why it went undetected.

## Evidence

- `app.json:28-31` — `ios.entitlements['com.apple.developer.in-app-payments'] = ["merchant.com.bountyexpo-workspace"]`, `app.json:96-103` — `@stripe/stripe-react-native` plugin `merchantIdentifier: "merchant.com.bountyexpo-workspace"`.
- `lib/services/stripe-sdk.ts:44-52` (pre-fix) — `initStripe()` called with `process.env.EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID || 'com.bounty0.BOUNTYExpo'`.
- `eas env:list --environment production` — confirmed live value `EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID=merchant.com.bounty.BOUNTYExpo`.
- `git log -S "com.bounty0.BOUNTYExpo"` — commit `3a148136`, "Address PR feedback: update merchantIdentifier... Change merchantIdentifier default to 'com.bounty0.BOUNTYExpo'" (Dec 2025), which is the regression that broke the fallback.
- `lib/stripe-context.tsx` exports a **custom React context** also named `StripeProvider` (imported in `app/_layout.tsx:22,171`) — this is *not* the `@stripe/stripe-react-native` native `<StripeProvider>` component. That's fine (the native SDK is initialized separately via `stripeSdk.initialize()` → `initStripe()`, delegated through `stripeService.initialize()` on mount), but it means there's only one JS code path that ever sets the merchant identity, and it was wrong.
- `components/onboarding/PosterFundingScreen.tsx:178-197`, `components/add-money-screen.tsx:213-235` — Apple Pay button unconditionally rendered on iOS (intentional, confirmed correct).
- `hooks/use-wallet-deposit.ts:168-195` (pre-fix) — no logging/analytics on the `!available` early-return path.
- `lib/services/apple-pay-service.ts:93-121` (pre-fix) — `console.error`-only logging, no analytics anywhere in the payment flow.

## Card vs. Apple Pay Architecture

Both flows share the same backend Stripe integration and PaymentIntent/webhook infrastructure — Apple Pay does **not** use a deprecated or separate payment engine. The divergence is entirely in the client:

- **Card**: `useStripe()` (custom context in `lib/stripe-context.tsx`) → `stripeService.createPaymentIntentSecure()` / `confirmPaymentSecure()`, which call the native SDK's card-confirmation methods. These don't require the Apple Pay merchant entitlement at all, which is exactly why cards kept working while Apple Pay silently failed.
- **Apple Pay**: `applePayService.processPayment()` (`lib/services/apple-pay-service.ts`) → backend `/apple-pay/payment-intent` → native `presentApplePay()`/`confirmApplePayPayment()` (which requires the entitled merchant ID) → backend `/apple-pay/confirm`. `services/api/src/routes/apple-pay.ts` and `supabase/functions/apple-pay/index.ts` are healthy and current — they were simply never reached.

No backend changes were needed or made.

## Changes Made

1. **`lib/config/apple-pay.json`** (new) — single source of truth for the Apple Pay merchant ID (`merchant.com.bountyexpo-workspace`, matching the real entitlement).
2. **`app.config.js`**:
   - `ios.entitlements['com.apple.developer.in-app-payments']` and the `@stripe/stripe-react-native` plugin's `merchantIdentifier` are now both force-derived from `lib/config/apple-pay.json`, so the native entitlement can never again diverge from what a hand-edit of `app.json` says.
   - Added a build-time guard (mirroring the existing Supabase-project-ref guard): if `EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID` is set to anything other than the canonical value, the **production build now fails fast** with an actionable error instead of silently shipping. Verified locally: building with today's actual EAS production env var throws `[FATAL] [apple-pay-guard] EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID="merchant.com.bounty.BOUNTYExpo" does not match...`.
3. **`lib/services/stripe-sdk.ts`**:
   - Fixed the broken hardcoded fallback (`com.bounty0.BOUNTYExpo` → the canonical value from `lib/config/apple-pay.json`).
   - Logs an error (via `logger.error`, non-fatal, defense-in-depth for builds shipped before the new guard existed) if the env var still doesn't match at runtime.
   - Added `getApplePayMerchantId()` / `getApplePayInitError()` accessors for diagnostics.
4. **`lib/services/apple-pay-service.ts`**:
   - `isAvailable()` now logs (via `logger`, not just `console.error`) whenever the device-support check returns `false` or throws, tagged with platform/app version/bundle ID/SDK-init-error — enough to diagnose a repeat of this class of bug without a repro device.
   - `processPayment()` now emits `payment_initiated` / `payment_completed` / `payment_failed` (tagged `stage: 'present' | 'confirm' | 'backend_confirm'`) / `payment_error` analytics events via the existing `analyticsService` (PostHog), matching the pattern already used for bounty escrow payments (`hooks/useBountyForm.ts`). All analytics calls are best-effort (wrapped, never block the payment).
5. **`lib/services/analytics-service.ts`** — added the `apple_pay_unavailable` event to the typed `AnalyticsEvent` union.
6. **`hooks/use-wallet-deposit.ts`** — the tap-time "Apple Pay Not Set Up" dead-end (previously silent) now fires `apple_pay_unavailable` before showing the alert, so a recurrence would show up immediately in PostHog instead of only in App Store reviews.

No secrets, tokens, card data, or PII are logged anywhere in these changes — only booleans, error codes/messages, platform, app version, and bundle identifier.

All existing Apple Pay test suites pass unchanged (`stripe-sdk.test.ts`, `stripe-service-applepay.test.ts`, `add-money-apple-pay.test.tsx`, `stripe-service.test.ts`, `apple-pay-receipt-service.test.ts` — 127 tests), and `tsc --noEmit` is clean.

## Remaining External Requirements

**The code fix alone does not fix production** — it fixes what ships in the *next* build and guarantees this exact drift can't silently recur. Two things still need to happen outside this repo:

1. **Correct the live EAS environment variable.** `EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID` is currently `merchant.com.bounty.BOUNTYExpo` in the `production` (and should be checked in `preview`/`development`) EAS environments. It must be changed to `merchant.com.bountyexpo-workspace` — or removed entirely, since the code now falls back to the correct value automatically. **I have not changed this** — it's a live EAS project setting; I can run `eas env:update` if you confirm, or you can update it via the EAS dashboard.
2. **Verify `merchant.com.bountyexpo-workspace` is the Apple Pay Merchant ID actually registered** in the Apple Developer Portal (Certificates, Identifiers & Profiles → Identifiers → Merchant IDs) and configured on the Stripe **live** account (Stripe Dashboard → Settings → Payment methods → Apple Pay). All local evidence points to this being correct and already live (App Store review response, the untouched entitlements file, the untouched `app.json` history), but I cannot inspect either portal directly — please confirm before the next release.
3. **New production build + submission required.** The entitlement fix only takes effect in a build produced *after* this change (`eas build --profile production --platform ios`), since entitlements are baked in at build time, not patchable via OTA/EAS Update.

## Validation Plan

Once the EAS env var is corrected (or removed) and a new production build is submitted:

1. **New production build**: `eas build --profile production --platform ios`. With today's live env var still wrong, this build will now **fail immediately** with the `[apple-pay-guard]` error instead of shipping — that failure itself is confirmation the guard works. After fixing the env var, the build should proceed normally.
2. **Apple Pay button appears**: On a real device (TestFlight or App Store build), the "Pay" Apple Pay button should render on the Add Money screen (`components/add-money-screen.tsx`) — this was never broken, so no change expected here.
3. **Apple Pay sheet opens**: Tap the button with a card provisioned in the device's Wallet app. The native Apple Pay sheet should now present (this is the step that was silently failing before).
4. **Backend receives `/apple-pay/payment-intent`**: Check Supabase edge function logs for `apple-pay` (`get_logs` / Supabase dashboard) — a request should appear immediately after the sheet is confirmed.
5. **Stripe receives the PaymentIntent**: Check the Stripe Dashboard (live mode) for a new PaymentIntent with `payment_method_types` including `card`/Apple Pay wallet metadata, matching the test amount.
6. **Wallet balance updates**: Confirm `/wallet/deposit` is called (per `hooks/use-wallet-deposit.ts`) and the user's `profiles.balance` reflects the deposit.
7. **Telemetry cross-check**: In PostHog, confirm `payment_initiated` → `payment_completed` events fire with `method: apple_pay` for the test transaction, and that no `apple_pay_unavailable` events are firing for real devices with Apple Pay set up.

This should be validated in Stripe **test mode** first if possible (a test-mode Apple Pay Merchant ID / build) before doing a live-money end-to-end test — per standing guidance, no live Apple Pay transaction should be triggered without explicit authorization.
