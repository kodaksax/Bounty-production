# Initialization and Lifecycle Hardening Report (2026-07-22)

## Scope

This audit focused on startup and lifecycle safety for asynchronous dependencies and listener registration across:

- App root startup and provider composition
- Supabase/auth listeners
- Stripe initialization and token-driven refresh
- Wallet and notifications realtime/auth listeners
- Network and AppState listeners
- Hook-level listeners (NetInfo, AppState, Dimensions, Accessibility, BackHandler)

## Verified Provider Startup Order

Source: app/\_layout.tsx

1. NetworkProvider
2. AuthProvider
3. AdminProvider
4. StripeProvider
5. WalletProvider
6. NotificationProvider
7. WebSocketProvider
8. App route content (Slot)

This order ensures network/auth state is available before dependent providers initialize or subscribe.

## Issues Found and Root Causes

### 1) Inconsistent listener cleanup contracts

Root cause:

- Different APIs return different cleanup contracts (`() => void`, `{ remove() }`, `{ unsubscribe() }`), but cleanups were often called directly with assumptions.
- This is fragile during SDK/runtime variance and test doubles.

Impact:

- Potential runtime cleanup errors on unmount/hot reload when handle shapes differ.

### 2) Async registration timing assumptions

Root cause:

- Some code assumes registration returns immediately; deferred/proxy SDKs can resolve later.
- Cleanup can run before registration resolves.

Impact:

- Missed cleanup and potential listener leaks (or crashes in unsafe destructuring paths already fixed previously).

### 3) Async state updates after unmount

Root cause:

- Async startup/check flows (`initialize`, `fetch`, `checkConnection`) updated React state without mounted guards.

Impact:

- Potential React warnings, stale updates, and racey UI state during fast navigation, app restart, or Fast Refresh.

### 4) Realtime/channel cleanup was not uniformly promise-aware

Root cause:

- Async cleanup APIs were sometimes wrapped in sync `try/catch` patterns.

Impact:

- Rejected cleanup promises could be dropped silently.

## Fixes Implemented

### Shared lifecycle utilities

Added `lib/utils/lifecycle.ts`:

- `safeCleanup(handle, onError?)` for cleanup contract normalization
- `resolveMaybeAsyncRegistration(registration, onResolved, onError?)` for sync/promise registration support
- `createDeferredCleanupController(onError?)` for cleanup-before-resolve lifecycle races

### Supabase listener lifecycle standardization

Updated `lib/utils/supabase-subscription.ts` to reuse shared lifecycle helpers.

### Root startup hardening

Updated `app/_layout.tsx`:

- Deep-link listener cleanup now uses `safeCleanup`
- `registerDeviceSession()` now has explicit async error handling

### Stripe provider hardening

Updated `lib/stripe-context.tsx`:

- Added mounted guard for all state updates
- Added initialization de-duplication via in-flight init promise ref
- Prevented post-unmount state updates for async Stripe operations

### Network provider hardening

Updated `providers/network-provider.tsx`:

- Added mounted guard around async NetInfo fetch/check paths
- Defensive teardown retained for non-function unsubscribe handles

### Notification service/provider hardening

Updated `lib/services/notification-service.ts`:

- Listener teardown now uses `safeCleanup`

Updated `lib/context/notification-context.tsx`:

- AppState and notifications listener teardown standardized with `safeCleanup`

### Hook-level lifecycle hardening

Updated hooks:

- `hooks/useWebSocket.ts`: mounted guard + defensive cleanup for AppState/NetInfo listeners
- `hooks/useForegroundRefresh.ts`: safe AppState cleanup
- `hooks/useOfflineMode.ts`: mounted guards + safe NetInfo/queue listener cleanup
- `hooks/use-accessible-animation.ts`: safe Accessibility listener cleanup
- `hooks/use-mobile.tsx`: safe Dimensions listener cleanup
- `hooks/useBackHandler.ts`: safe BackHandler cleanup
- `hooks/useSessionMonitor.ts`: safe callback cleanup + guarded async startup check errors

## Regression Tests Added

1. `__tests__/unit/lib/lifecycle.test.ts`

- Covers cleanup normalization and async registration handling
- Covers cleanup-before-resolution behavior with deferred handles

2. `__tests__/unit/hooks/waitForAuthEvent.test.ts`

- Added Promise-returning `onAuthStateChange` registration test

3. `__tests__/unit/hooks/network-provider.test.tsx`

- Added regression for non-function NetInfo unsubscribe handle

## Remaining Risks / Technical Debt

1. Provider readiness contracts are implicit

- Providers expose internal loading state independently, but there is no single app-wide "bootstrap readiness" contract.

2. Some service APIs still rely on best-effort logging

- Several non-critical flows (analytics, notification token registration, background sync) intentionally swallow errors to protect UX.
- This is acceptable, but should be paired with metric dashboards to detect silent degradation.

3. Background/foreground resilience is distributed

- Lifecycle logic is spread across multiple hooks/providers rather than one central lifecycle coordinator.

## Recommendations

1. Introduce a lightweight `AppRuntimeProvider`

- Centralize app foreground/background, network-online, and auth-ready signals.
- Let dependent providers subscribe to this unified runtime state.

2. Introduce explicit provider readiness contracts

- Expose `status: 'idle' | 'initializing' | 'ready' | 'degraded'` from critical providers.
- Add a root readiness gate for first-frame sensitive screens.

3. Add chaos-mode lifecycle tests

- Add CI tests that intentionally delay SDK init and listener registration, then run rapid mount/unmount cycles.

4. Standardize listener registration wrappers

- Continue migrating direct listener calls to shared lifecycle helpers so all cleanup is shape-safe and async-safe.

## Startup Dependency Graph (Current)

App Launch
-> NetworkProvider
-> AuthProvider
-> AdminProvider
-> StripeProvider
-> WalletProvider
-> NotificationProvider
-> WebSocketProvider
-> App Ready (Slot)

Supabase client itself remains lazily initialized via deferred proxy and can resolve asynchronously; callers now treat this as a first-class lifecycle constraint.
