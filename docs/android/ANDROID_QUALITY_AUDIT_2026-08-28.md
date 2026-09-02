# Bounty — Android & Google Play Quality Audit

**Date:** 2026-08-28
**Scope:** Android build configuration, Google Play technical quality requirements, memory/bitmap behaviour, device migration, authentication lifecycle, Android-specific UX and security.
**Codebase state:** `main` @ `4cb4d676`, Expo SDK ~55.0.29, React Native 0.83.10, React 19.2.0.

---

## Executive summary

**The headline is good news:** the thing most likely to have been an emergency isn't one. Google Play requires all new apps and updates to target **API 36 by 31 August 2026 — three days from this audit**. Bounty already targets 36. No action needed, and no rushed native change is required to stay publishable.

**The one hard compliance gap found was code optimization.** Bounty shipped with **R8 completely disabled**. `android.enableMinifyInReleaseBuilds` and `android.enableShrinkResourcesInReleaseBuilds` both default to `false` in the Expo/React Native template and were never overridden, so Bounty's obfuscation, optimization and shrinking figures were all **0%** against a Play requirement of **>=25% each** from February 2027. This is now enabled with a reviewed keep-rule set.

**The second real gap was bitmap memory in non-visible app states** — precisely where Play's thresholds are tightest (>200 MB background, >400 MB cached). Bounty is an image-heavy marketplace and never released its decoded-bitmap cache. It does now.

**Three of the brief's stated fears turned out not to be real**, and saying so is as valuable as the fixes:

- *"A user could get trapped on a welcome/login screen after migrating."* They are not trapped. The welcome screen has a first-class **Log in** CTA (`app/onboarding/welcome.tsx:89`), and onboarding does not re-run because the **server profile is authoritative** (`hooks/useAppBootstrap.ts`). The migration cost is one extra tap, not a lockout.
- *"Auth tokens might be insecurely copied to a new device."* They are not. `expo-secure-store`'s config plugin excludes the `SecureStore` shared-prefs file from both cloud backup and device transfer. This is correct and must not be "fixed".
- *"Feeds may be missing virtualization."* The marketplace feed is a properly tuned `FlatList` (`removeClippedSubviews`, `windowSize=5`, `maxToRenderPerBatch=5`, `initialNumToRender=3`, `onEndReached` pagination). 23 of 49 `FlatList`s carry explicit windowing props and 62 have `keyExtractor`.

**The genuinely unaddressed requirement is Zero-Tap Sign-In** (Play, April 2027), which needs the Android **Restore Credentials API**. No React Native or Expo binding for it exists today. This is specified below but deliberately **not** built — it needs a native module and real-device verification, neither of which can be done safely from here.

**Everything changed in this pass is config or additive code. No payment, escrow, Stripe Connect, withdrawal, RLS, messaging or authentication logic was touched.**

---

## 1. Verified Android architecture and release health

All values below were read from the repository or from `node_modules`, not assumed.

| Item | Value | Source |
|---|---|---|
| Expo SDK | ~55.0.29 | `package.json` |
| React Native | 0.83.10 | `package.json` |
| React | 19.2.0 | `package.json` |
| Native project | **None — CNG/managed.** No `android/` directory. | repo root |
| Android config source | `app.json` + `app.config.js` + `plugins/withRemoveMediaPermissions.js`, `plugins/withNewArchAppDelegate.js` | repo |
| minSdk / targetSdk / compileSdk | **24 / 36 / 36** | `react-native/gradle/libs.versions.toml` via `expoAutolinking.useExpoVersionCatalog()`; no overrides in `app.json` |
| Build tools / NDK | 36.0.0 / 27.1.12297006 | same catalog |
| AGP / Kotlin / Gradle | 8.12.0 / 2.1.20 / 8.14.3 | catalog + last prebuild snapshot |
| Hermes | **Enabled**; Hermes **V1 explicitly disabled** (`useHermesV1: false`) | `gradle.properties`, `app.json` |
| New architecture | Enabled (`newArchEnabled=true`) | prebuild snapshot |
| Edge-to-edge | Enabled | prebuild snapshot |
| Native lib packaging | `expo.useLegacyPackaging=false` -> uncompressed `.so` (needed for 16 KB page alignment) | prebuild snapshot |
| Application ID | `app.bountyfinder.BOUNTYExpo` | `app.json` |
| versionName / versionCode | 2.0.6 / EAS-managed (`appVersionSource: remote`, `autoIncrement: true`) | `app.json`, `eas.json` |
| Release artifact | AAB (no `buildType` override on the production profile) | `eas.json` |
| Signing | EAS-managed keystore | `eas.json` |
| Runtime version policy | `fingerprint` | `app.json` |
| App links | 4 `autoVerify` HTTPS filters on `bountyfinder.app` (`/auth`, `/wallet/connect`, `/bounty`, `/profile`) + custom scheme | `app.json` |
| Backup rules | `@xml/secure_store_backup_rules` + `@xml/secure_store_data_extraction_rules`, injected by the `expo-secure-store` plugin | `node_modules/expo-secure-store` |
| Total bundled assets | **2.1 MB**, only two files >300 KB | `du -sh assets` |
| Crash/ANR reporting | Sentry, `enableNative: true` on Android (native crash + ANR capture), `tracesSampleRate` 0.2 in production | `lib/services/sentry-init.ts` |

**Notable native dependencies:** Stripe + Stripe Identity, Supabase JS, `react-native-maps` + clustering, `react-native-branch`, Google Sign-In, Sentry, `expo-notifications` (FCM), `react-native-reanimated` 4 + worklets, `react-native-webview`, `expo-image`.

---

## 2. Google Play requirements — verified against current sources

Separated as requested into what Google **requires**, what is **best practice**, and what is a **Bounty-specific recommendation**.

### A. Requirements Google explicitly imposes

| Requirement | Threshold / date | Bounty status | Evidence | Action |
|---|---|---|---|---|
| **Target API level** | API 36 for new apps + updates by **31 Aug 2026**; API 35 to stay available to new users | **Compliant** | `targetSdk = "36"` in the RN 0.83.10 catalog; no override in `app.json` | None |
| **DEX code optimization** | >=25% each for obfuscation, optimization, shrinking (apps with >10 MB DEX), **Feb 2027** | **Was 0% on all three** -> **fixed this pass** | Both R8 flags defaulted to `false`; confirmed in the template `app/build.gradle` | **Done** — see Changes 7.1. Needs a build to verify. |
| **Memory usage (Anon RSS + Swap)** | 90th pct, per RAM tier / app state (e.g. apps on 4 GB: 2 GB fg, 1 GB bg), **Feb 2027** | **Unmeasured** | No Play Console access from this environment | Read Android vitals; see section 3 |
| **Bitmap memory usage** | 90th pct; >200 MB background / user-perceived-service, >400 MB cached, **Feb 2027** | **Structural risk found** -> **mitigated** | Decoded-bitmap cache was never released in non-visible states | **Done** — see Changes 7.2 |
| **Zero-Tap Sign-In restoration** | Android **Restore Credentials API**, **Apr 2027** (Block Store alternative only if completed by 30 Sep 2026) | **Not implemented** | No `androidx.credentials` restore usage anywhere | **Specified, not built** — see 5.3 |
| **User-perceived crash rate** | <1.09% overall | Unmeasured here | Sentry is wired; Play Console not accessible | Check Android vitals |
| **ANR rate** | <0.47% overall | Unmeasured here | as above | Check Android vitals |
| **64-bit + 16 KB page size** | Enforced | Likely compliant, **unverified** | NDK 27 + RN 0.83 + `useLegacyPackaging=false` | Verify with the alignment check in section 9 |
| **In-app account deletion** | Required for apps with accounts | Present | `components/settings-screen.tsx:110` -> `lib/services/account-deletion-service.ts` | Confirm the Play Console web deletion URL is also set |

### B. Android best practices (not Play requirements)

- Notification channels per category on Android 8+ — **was missing in the live path**, fixed (7.3).
- Predictive back (`enableOnBackInvokedCallback`) — currently `false` in the generated manifest.
- Release image caches under memory pressure — Android gives JS no signal, so background is the hook (7.2).
- Runtime permission requested at a contextual moment rather than at sign-in.

### C. Bounty-specific recommendations

Prioritised in section 6.

---

## 3. Memory, images, lists, startup, network

### Images — the real finding is *when* bitmaps are released, not *how big* they are

**Upload path is already correct.** `lib/utils/image-utils.ts` resizes and compresses through `expo-image-manipulator` before upload, with an iterative quality-reduction loop. Attachments, avatars and proof photos are not uploaded at full camera resolution.

**Display path has one gap.** `lib/components/OptimizedImage.tsx` derives thumbnail URLs for **Cloudinary** and **Imgix**, then falls through to a generic `?w=&h=` for anything else. Bounty's images are served from **Supabase Storage**, which ignores those parameters — its transformation endpoint is `/storage/v1/render/image/public/...?width=&height=&resize=`. So list thumbnails download and decode the full-size original. `expo-image` (Glide-backed on Android) downsamples to the view box, so this costs bandwidth and decode time more than resident bitmap memory — but it is the single highest-leverage remaining image change. See 6, P2-1.

**The fixed gap:** decoded bitmaps were retained indefinitely after backgrounding. Play measures bitmap memory *specifically* in background (>200 MB) and cached (>400 MB) states, and Google's guidance is explicit that bitmaps "should not be held in memory for extended periods of time in non-visible app states". A user who scrolled a long feed and switched away left that cache resident for as long as Android kept the process. Fixed in 7.2.

**Why this had to be driven by `AppState` and not a memory warning:** React Native does **not** forward Android's `onTrimMemory` to JavaScript. `AppState`'s `memoryWarning` event is emitted by `RCTAppState` on iOS only; on Android `MemoryPressureRouter` dispatches trim callbacks to native listeners (Yoga, ViewManager caches) and never crosses the bridge. Verified against `react-native@0.83.10` — **there is no JS-visible memory-pressure signal on Android at all.** Backgrounding is the only available hook.

### Lists — healthy

The marketplace feed (`components/bounty-feed.tsx:1011`) is a well-tuned `Animated.FlatList`. Repo-wide: 49 `FlatList`s, 23 with explicit windowing props, 62 `keyExtractor`s, 17 `getItemLayout`s, and no `ScrollView` found rendering an unbounded remote dataset on a high-traffic screen. This area does not need work.

Two residual items (both P2, see section 6): the feed's `onScroll` runs on the JS thread (`useNativeDriver: false`) at `scrollEventThrottle={16}`, and `filteredBounties` grows without a cap across a long paginating session.

### Startup

The startup gate in `app/_layout.tsx` is bounded and does not block on network: `analyticsService.initialize()` is synchronous and cheap, asset preload is raced against 3 s, initial-navigation wait against 3 s, with an 8 s overall safety timeout. Sentry and PostHog are initialised inside the effect rather than at module scope — a deliberate fix for the 2.0.5 splash-freeze incident, and it should stay that way. **No startup changes recommended.**

### Network

Supabase realtime channels are reference-counted and shared (`lib/services/notification-realtime.ts`), re-subscribed on `userId` change, and torn down on unmount. Push-token registration has persisted retry with exponential backoff and a deferred-registration flag. This area is in better shape than the brief anticipated.

### Bundle size

Bundled assets total **2.1 MB** — not a problem. The meaningful size lever was R8, now enabled; expect a substantial DEX and resource reduction once measured on a real build.

---

## 4. Authentication lifecycle

The auth stack is the most hardened part of the codebase and was **not modified**.

- **Session storage** (`lib/auth-session-storage.ts`): always persists to `SecureStore` under a project-scoped key (`supabase.auth.token.<ref>`), chunked above 1900 bytes, every native call raced against a 4 s timeout so a hung Keystore operation can never stall sign-in, with a read-through in-memory cache. Writes never rethrow, so storage failure degrades to "session lives for this run" rather than a failed login.
- **Client init** (`lib/supabase.ts`): a deferred proxy over a lazily-created client, with a hard environment guard that refuses to start against the wrong Supabase project for the build channel.
- **Bootstrap** (`hooks/useAppBootstrap.ts`): resolves auth *and* onboarding inside a single loading phase so no intermediate screen flashes. The **server profile is authoritative** for onboarding completion, with a per-user AsyncStorage flag only as an offline fallback — and it self-heals that flag whenever the profile confirms completion.
- **Routing** (`app/index.tsx`): idempotent destination-keyed navigation; environment error -> blocked account -> password recovery -> unauthenticated -> authenticated, with a dedicated non-destructive retry screen for a stalled restore rather than bouncing the user to sign-in.

**Verdict against the brief's scenarios:** new user, existing user, returning user, failed-then-successful login, and process death are all handled correctly. There is no path found where a user who successfully creates an account is dumped back to the welcome screen.

**Remaining edge case (P2):** after a device migration the session is intentionally gone *and* the local `@bounty_has_signed_in_before` flag is gone, so `app/index.tsx:174` routes to `/onboarding/welcome` instead of the sign-in form. The user taps **Log in**, signs in, and lands straight in the app — onboarding does not repeat. One extra tap, no lockout.

---

## 5. Device migration — exactly what happens

### 5.1 What Android actually transfers

`expo-secure-store`'s config plugin writes both backup descriptors, and both use `<include domain="sharedpref" path="."/>` with `<exclude domain="sharedpref" path="SecureStore"/>`.

Per Android's Auto Backup documentation: **"If you specify an `<include>` element, the system no longer includes any files by default and backs up only the files specified."** Because the only `<include>` is scoped to `sharedpref`, the `database`, `file` and `external` domains are all silently dropped.

`@react-native-async-storage/async-storage` stores everything in a SQLite database (`RKStorage`) in the `database` domain.

| Data | Store | Migrates? | Correct? |
|---|---|---|---|
| Supabase session / refresh token | SecureStore (`sharedpref/SecureStore`) | **No — explicitly excluded** | **Yes, and required.** SecureStore values are encrypted with a non-exportable Android Keystore key. Transferring the ciphertext without the key would only produce undecryptable garbage. |
| E2E messaging private key | SecureStore | No | Correct — device-bound by design |
| Onboarding flags, drafts, caches, offline queue, pending push tokens | AsyncStorage (`database`) | **No — silently dropped** | Mixed (see below) |
| Onboarding completion | **Supabase profile (server)** | **Yes** | This is why migration does not re-run onboarding |
| Push token | Re-registered on `userId` change | **Re-issued** | Correct — FCM tokens are per-install |
| App links | Manifest `autoVerify` | Yes | Correct |

### 5.2 Net user experience today

A user moving to a new Android phone: restores -> opens Bounty -> sees the **welcome screen** (not the sign-in form) -> taps **Log in** -> signs in -> lands in the app with their profile, bounties, balance and onboarding state intact, because all of that is server-side.

**This is secure and it is not a lockout.** The losses are local drafts and caches. Notably, the current behaviour also *accidentally* avoids a real hazard: had AsyncStorage been restored wholesale, the **offline action queue** and **pending push tokens** would have been resurrected on a new device — a genuine duplicate-action and mis-routed-notification risk for a marketplace handling real money. Any future change to the backup rules must explicitly exclude those keys.

### 5.3 The actual gap: Zero-Tap Sign-In (Play requirement, April 2027)

Google requires apps with sign-in to restore sign-in state automatically across devices using the **Android Restore Credentials API** (`androidx.credentials`), which issues a restore key that Android migrates through the backup/transfer channel and which the app redeems on the new device.

**Bounty has no implementation, and no React Native or Expo binding for this API exists today.** Delivering it requires:

1. An Expo module wrapping `androidx.credentials` `CreateRestoreCredentialRequest` / `GetRestoreCredentialRequest`.
2. Creating a restore credential at sign-in, keyed to the Supabase user.
3. On first launch after restore, redeeming it and exchanging it for a Supabase session **server-side** — the restore credential must never be treated as a bearer token by the client.
4. A new backup rule permitting the restore credential's storage while keeping `SecureStore` excluded.

This is a multi-week native workstream with real security surface. It is **specified here and deliberately not implemented** — building it blind, without a device or Play Console, would be exactly the kind of insecure migration shortcut the brief warns against. The deadline is April 2027, so there is time to do it properly.

---

## 6. Prioritised findings

### P0 — Play compliance / security / data loss

**P0-1 · R8 code optimization disabled** — *Fixed this pass.*
Problem: obfuscation, optimization and shrinking all at 0% against a >=25% Play requirement from Feb 2027; also the largest available APK-size reduction.
Evidence: `android.enableMinifyInReleaseBuilds` / `enableShrinkResourcesInReleaseBuilds` absent from `app.json`, both defaulting to `false` in the template `app/build.gradle`.
Fix: enabled both, with a 127-line reviewed keep-rule set.
Risk: **Medium — requires a real build and device smoke test.** R8 can strip reflection-driven code. Mitigated with deliberately over-broad keeps for Stripe, Expo modules, RN/JNI, Branch, Firebase, Maps, Sentry, Glide/Fresco, Reanimated.
Complexity: config change done; verification is the remaining work.

### P1 — Serious Android reliability/performance

**P1-1 · Decoded bitmaps never released in non-visible states** — *Fixed this pass.* Risk: Low. See 7.2.

**P1-2 · Android notification channels never created in production** — *Fixed this pass.*
Problem: channels existed only in `app/hooks/usePushNotifications.tsx`, which has **zero importers**. The live path (`lib/services/notification-service.ts`) never created any, so every notification fell back to a single generic channel — users could not mute chat without also muting payouts, and payment notifications got no priority treatment.
Risk: Low (additive, idempotent upsert). See 7.3.

**P1-3 · Push payloads carry no `channelId`** — *Not fixed; server-side.*
`grep -rn channelId supabase/functions` returns nothing, so the new channels will not categorise anything until senders include one. Fix: add `channelId: 'messages' | 'bounties' | 'payments' | 'system'` to each Expo push payload. Risk: Low, but it touches deployed edge functions and needs a separate deploy authorization.
Complexity: Small.

**P1-4 · Shipped Android permission set unverified** — *Not fixed; needs a prebuild.*
The last prebuild snapshot (`android-backup-20260123-171108`, Jan 2026, older SDK) lists `SYSTEM_ALERT_WINDOW`, `RECORD_AUDIO`, `READ/WRITE_EXTERNAL_STORAGE` in the **main** manifest. Today neither `SYSTEM_ALERT_WINDOW` nor `RECORD_AUDIO` is declared by any dependency's main manifest — `SYSTEM_ALERT_WINDOW` now appears only in React Native's **debug** manifest — and `plugins/withRemoveMediaPermissions.js` strips the media permissions. The current release permission set is therefore probably clean, but **has not been verified against the current config**. Unnecessary sensitive permissions trigger Play policy declarations and can delay review. Verification command in section 9.

### P2 — Meaningful improvement

- **P2-1 · Supabase Storage thumbnails not requested.** `OptimizedImage` handles Cloudinary/Imgix only; Supabase ignores the generic `?w=&h=` fallback, so full-size originals are downloaded for list thumbnails. Fix: add a Supabase Storage branch rewriting `/object/public/` -> `/render/image/public/` with `width`/`height`/`resize`/`quality`. **Requires the Supabase image-transformation add-on — confirm plan before implementing.** Complexity: Small.
- **P2-2 · Feed scroll handler on the JS thread.** `useNativeDriver: false` + `scrollEventThrottle={16}` drives a JS callback at 60 Hz on the busiest screen. Jank source on low-end devices. Fix requires auditing the dependent header animation for transform/opacity-only. Complexity: Medium.
- **P2-3 · Unbounded feed accumulation.** `filteredBounties` grows without a cap as the user paginates. Fix: cap retained pages. Complexity: Small.
- **P2-4 · `POST_NOTIFICATIONS` prompted at sign-in.** `lib/context/notification-context.tsx:312` fires `requestPermissionsAndRegisterToken()` on every `userId` change, so Android 13+ shows the runtime prompt immediately at sign-in with no context. Two denials permanently auto-deny. The dead hook's own documentation says contextual opt-in was the intent. **Not changed — this is a product decision affecting opt-in rates.**
- **P2-5 · Migrated users land on the welcome screen** rather than the sign-in form (section 4). Cannot be fixed by detection: nothing survives migration for JS to read. Properly solved by P3-1.
- **P2-6 · Predictive back disabled.** `android:enableOnBackInvokedCallback="false"`. Non-native-feeling on Android 14+. Enabling requires auditing all six `useBackHandler` call sites.

### P3 — Nice to have

- **P3-1 · Zero-Tap Sign-In / Restore Credentials API.** Play requirement from April 2027. Large native workstream, fully specified in 5.3. *Listed as P3 by urgency, not importance — start it well before Q1 2027.*
- **P3-2 · `buildReactNativeFromSource: true` on Android.** Significantly increases build times with no runtime benefit — it is only *required* when `useHermesV1: true`, and Hermes V1 is off. Likely a leftover from an iOS workaround. Removing it is a build-time win but changes the fingerprint, so bundle it with the next native build.
- **P3-3 · Dead code:** `app/hooks/usePushNotifications.tsx` has no importers and now duplicates the service.

---

## 7. Changes made

Every change is config or additive. No payment, escrow, Stripe, withdrawal, RLS, messaging or auth logic was modified.

### 7.1 Enabled R8 code optimization *(P0-1)*

- **`app.json`** — added `enableMinifyInReleaseBuilds: true` and `enableShrinkResourcesInReleaseBuilds: true` to the `expo-build-properties` Android block.
- **`lib/config/android-proguard-rules.pro`** *(new, 127 lines)* — reviewed keep rules kept in a real `.pro` file for reviewability, following the repo's existing `lib/config/*` build-config convention. Covers: crash-report attributes (`SourceFile`/`LineNumberTable` so Play Console and Sentry stack traces stay readable), reflection attributes, JNI native methods, RN `@DoNotStrip`/`@ReactMethod`/`@ReactProp`, all of `expo.modules.**`, Stripe + Stripe Identity, Google Sign-In/GMS, Branch, Firebase, Maps, Sentry, OkHttp/Okio warnings, Fresco/Glide, Reanimated/worklets, SVG, Kotlin metadata. Deliberately **excludes** `-repackageclasses`, `-overloadaggressively` and `-assumenosideeffects`. Documented editing rule: prefer an over-broad keep to a clever narrow one.
- **`app.config.js`** — reads the `.pro` file and injects it as `extraProguardRules` on the `expo-build-properties` plugin, reusing the existing `resolvePlugins` rewrite mechanism.

AGP embeds the R8 mapping into the AAB automatically, so Play Console de-obfuscation needs no extra step.

### 7.2 Bitmap memory released in non-visible states *(P1-1)*

- **`lib/services/memory-pressure.ts`** *(new)* — `startMemoryPressureWatcher()` subscribes to `AppState`, and after the app has been backgrounded for **15 s** clears the `expo-image` decoded-bitmap memory cache plus any registered trimmers. Android-only (no-op elsewhere).
  - The 15 s delay is deliberate: clearing on every background transition would thrash the cache during app-switches and camera/photo-picker round trips, forcing a full re-decode of the visible feed.
  - The **disk** cache is deliberately left alone — clearing it would force re-downloads on resume, costing users cellular data on exactly the poor connections the app must tolerate, and disk is not counted by the bitmap-memory metric.
  - `registerMemoryTrimmer(name, fn)` lets other modules opt in. Contract: cheap, failure-tolerant, and only ever drops data that can be recreated without user input — never pending writes, drafts or queued actions.
- **`app/_layout.tsx`** — installs the watcher in its own effect (not the startup gate, so it is never delayed by font loading).

### 7.3 Android notification channels in the live path *(P1-2)*

- **`lib/services/notification-service.ts`** — added `ensureAndroidChannels()` creating `messages` (HIGH), `bounties` (HIGH), `payments` (MAX), `system` (DEFAULT) and `default` (MAX), awaited at the top of `requestPermissionsAndRegisterToken()` so channels exist before any token is issued. Created *before* the permission prompt, per the documented Android pattern; `setNotificationChannelAsync` is an idempotent upsert.

### 7.4 Tests

- **`lib/__tests__/memory-pressure.test.ts`** *(new, 6 tests)* — pins both halves of the delayed-trim behaviour, coalescing of repeated background events, trimmer isolation from a throwing callback, and teardown cancelling a pending trim.

---

## 8. Tests run

| Check | Result |
|---|---|
| `npx jest __tests__/unit lib/__tests__` | **151 suites, 2456 passed, 31 todo, 0 failed** (64 s) |
| `npx jest lib/__tests__/memory-pressure.test.ts` | **6/6 passed** (new) |
| `npx tsc --noEmit -p tsconfig.json` | **Exit 0, no errors** |
| `npx expo config --type prebuild --json` (`APP_ENV=production`) | **Exit 0, empty stderr** — config resolves cleanly |
| Resolved build-properties assertion | Exactly one `expo-build-properties` entry; `minify: true`, `shrink: true`, 6061 bytes of proguard rules, no `targetSdkVersion` override (inherits 36) |

**Android builds tested: none. Manual device tests performed: none.** See section 9.

---

## 9. Remaining risks — stated plainly

**Nothing in this pass was verified on an Android device, an Android emulator, a real Android build, or the Play Console.** None of those were available in this environment. Specifically:

1. **R8 is the one change that can break the app, and it has not been build-tested.** This is the highest residual risk in this audit. It **must** go through a `preview`-profile AAB and a device smoke test — sign-in, feed scroll, post a bounty, apply, message, upload an image, a Stripe payment sheet, a withdrawal, a push notification, and a deep link — **before** it reaches production. If anything breaks, the symptom is a `ClassNotFoundException`/`NoSuchMethodError` naming the stripped class; add a targeted keep to `lib/config/android-proguard-rules.pro`. To revert entirely, set both flags back to `false` in `app.json`.

2. **This change bumps the fingerprint runtime version and therefore requires a new native build.** It cannot ship as an OTA update, and it breaks OTA compatibility with the currently shipped binary. **If any JS-only OTA hotfix is pending, publish it before merging this.**

3. **DEX size is unmeasured.** The >10 MB threshold that triggers the code-optimization requirement is almost certainly exceeded given Stripe + Maps + Branch + Firebase + GMS, but that is an inference, not a measurement. Confirm from the Play Console's DEX optimization insight.

4. **Actual memory and bitmap figures are unknown.** The 7.2 fix is a structurally sound mitigation, not a measured one. Read Android vitals' dynamic-memory and bitmap-memory metrics, and the new "Crashes and ANRs" low-memory-termination filter, to confirm Bounty is under threshold.

5. **The shipped permission set is unverified (P1-4).** Confirm in a scratch clone with:
   ```
   npx expo prebuild --platform android --no-install --clean
   cat android/app/src/main/AndroidManifest.xml
   ```
   and check for `SYSTEM_ALERT_WINDOW` / `RECORD_AUDIO`. Also verify 16 KB alignment on the built `.so` files.

6. **Device migration was not exercised on real hardware.** The behaviour in section 5 is derived from the backup-rule XML, Android's documented include-only semantics, and AsyncStorage's storage location — a sound chain, but not an observation. Confirm with a real backup-and-restore across two devices.

7. **Notification channels will not categorise anything until push senders include `channelId` (P1-3).** The channels now exist and are visible in system settings; routing needs the server change.

8. **Zero-Tap Sign-In remains entirely unimplemented (P3-1)** and is a hard Play requirement from April 2027.

---

## 10. Recommended next steps

1. Publish any pending OTA hotfix **before** merging this (risk 2).
2. Build a `preview` AAB and run the R8 smoke test in risk 1.
3. Read Android vitals for memory, bitmap, crash and ANR rates against the section 2 thresholds.
4. Verify the prebuild permission set and 16 KB alignment (risk 5).
5. Add `channelId` to push senders (P1-3).
6. Scope the Restore Credentials workstream (P3-1) — start well before Q1 2027.

---

## 11. Android test matrix

Automated coverage exists for logic (2456 Jest tests). The items below **require physical Android devices** and cannot be automated from this environment.

**Device tiers:** current flagship (Android 16); mid-range (Android 14/15); **low-memory 4 GB device** (the tier with the tightest Play memory thresholds); small screen (~5.4"); large screen / tablet; oldest supported (**API 24**).

| # | Scenario | Priority | Notes |
|---|---|---|---|
| 1 | Fresh install | High | |
| 2 | Upgrade from previous version | High | Verify AsyncStorage/session survive |
| 3 | Sign up | High | |
| 4 | Sign in | High | |
| 5 | Incorrect login -> successful retry | High | Regression guard on a historical edge case |
| 6 | Onboarding | High | |
| 7 | Close / reopen | High | Session must persist |
| 8 | Background / foreground | High | Also confirms the 15 s trim does not cause a visible re-decode |
| 9 | **Process death** (Developer options -> "Don't keep activities") | **Critical** | Auth restore, no onboarding replay |
| 10 | **Device migration** (real backup + restore) | **Critical** | Validates section 5 |
| 11 | Post a bounty | Critical | **R8 smoke test** |
| 12 | Browse bounties (long scroll) | High | Memory + jank on the 4 GB device |
| 13 | Accept bounty | Critical | **R8 smoke test** |
| 14 | Messaging | High | **R8 smoke test** |
| 15 | Upload images | High | **R8 smoke test** — photo picker round trip |
| 16 | Submit completion proof | Critical | |
| 17 | **Payment flow** | **Critical** | **Highest R8 risk — Stripe reflection** |
| 18 | Notifications | High | Confirm the four channels appear in system settings |
| 19 | Deep links (logged out / in / closed / backgrounded) | High | All four `autoVerify` paths |
| 20 | Logout / login | High | |
| 21 | Poor network | Medium | |
| 22 | Offline -> reconnect | Medium | Offline queue must not double-submit |
| 23 | Low-memory conditions | High | Confirm bitmap trim; watch for OOM terminations |

---

## 12. Observability

**Present:** Sentry with `enableNative: true` on Android (native crashes **and ANRs**), `tracesSampleRate` 0.2 in production; PostHog with a deliberate event taxonomy; structured auth-lifecycle logging (`lib/utils/auth-diagnostics.ts`) covering failed authentication and onboarding resolution; push-token registration failures tracked with backoff.

**Missing:** Android memory-pressure and low-memory-termination signals (Android gives JS no hook — these must come from **Android vitals**, not from in-app analytics); startup-time measurement; device-migration outcome telemetry.

**Deliberately not added:** per-screen memory sampling or a bitmap-usage reporter. That would add exactly the overhead and privacy surface the brief warns against, and Android vitals already reports both metrics at the fidelity Play enforces against. Use the Play Console, not more client instrumentation.
