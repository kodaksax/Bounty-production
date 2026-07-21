# UI/UX Polish — What Shipped and What's Next

This tracks a design-system audit and polish pass. It's a roadmap, not a backlog — treat
each phase as a scoped follow-up task, not something to build all at once.

## Shipped this pass

- **Unified design tokens.** `lib/themes/tokens.ts` adds `spacing`/`radius`/`typography`/
  `shadows` to `AppTheme` (previously colors-only), so `useAppTheme()` consumers can pull a
  real scale instead of hardcoding pixel values. `components/themed/ThemedButton` and
  `ThemedCard` now consume it as the reference implementation.
- **Fixed three unreadable-text bugs** on trust-critical screens: `dispute-modal.tsx`,
  `dispute-submission-form.tsx`, `revision-feedback-banner.tsx` all had dark text on dark (or
  white-on-pale) backgrounds.
- **Added a confirmation step before bank withdrawals** (`withdraw-with-bank-screen.tsx`) —
  previously the transfer fired immediately on tapping "Withdraw $X" with no "are you sure."
- **Unified brand green.** `#00912C` (a stale value from the legacy `lib/theme.ts`) and
  `#059669` (the live `lib/themes` green) were coexisting across the consumer app —
  `components/ui/button.tsx`, `bottom-nav.tsx`, `app/dispute/create.tsx`,
  `bountydetailmodal.tsx`, and the embedded Connect onboarding screen all had visible
  `#00912C`. All corrected to `#059669`. **Not touched, by decision:** the admin panel
  (`app/(admin)/*`, ~35 occurrences) and `supabase/functions/connect/index.ts` (the
  server-rendered Stripe Connect webview) — both still show the old green.
- **One `formatCurrency()` helper** (`lib/utils.ts`) replacing hand-rolled
  `` `$${x.toFixed(2)}` `` (no thousands separator) across withdraw/deposit/receipt screens.
- **Tab-switch fade.** `app/tabs/bounty-app.tsx` had zero animation swapping between
  Bounty/Wallet/Postings/Profile/Messages (instant `display:none` toggle) while every Stack
  navigator elsewhere in the app uses `slide_from_right`. Now cross-fades, respects reduced
  motion.
- **Unified button press animation** to the existing (previously one-consumer)
  `useAccessibleAnimation` hook, fixing a reduced-motion gap and a component-identity bug
  that was remounting the button's native view on every press.
- **FlatList perf props** (`removeClippedSubviews`/`maxToRenderPerBatch`/`windowSize`/
  `initialNumToRender`) added to `archived-bounties-screen`, `history-screen`,
  `payment-methods-modal`, `wallet-screen` — matching what `bounty-feed`/`postings-screen`
  already had.
- **Loading/empty state consistency** — `app/tabs/search.tsx`'s plain-text "no results" swapped
  for the shared `EmptyState` component; `history-screen.tsx`'s bare spinner swapped for the
  existing `PostingsListSkeleton`.

## Shipped this pass — 2026-07-16

- **`components/ui/button.tsx` is now theme-aware and has a `loading` state.**
  Previously 100% hardcoded to the legacy dark palette (no light-mode support) and had
  no way to show in-flight state — 52 screens hand-rolled their own `ActivityIndicator`
  + manual `disabled` gating around it instead. Added a `loading?: boolean` prop: label
  fades out (opacity, layout preserved so the button doesn't resize) while a themed
  spinner fades in, ~150ms, respecting the existing `useAccessibleAnimation` reduced-motion
  handling. Colors now come from `useAppThemeContext()`. Applied to the sign-in and
  sign-up submit buttons as the reference usage (`app/auth/sign-in-form.tsx`,
  `app/auth/sign-up-form.tsx`) — the other ~50 call sites are unconverted, see below.
- **Fixed a variant/size style-collision bug in the same file.** The style array indexed
  `buttonStyles[size ?? "default"]` — but `"default"` was also the *variant* key (primary
  green bg/border/shadow). Any button using a non-default variant (`destructive`,
  `outline`, `secondary`, `ghost`, `link`) **without** an explicit `size` prop had that
  green variant style silently re-applied after the real one, overriding it back toward
  green. Fixed by only applying a size override when a non-default size is explicitly set.
- **Fixed `skeleton-loaders.tsx` rendering as opaque dark panels in light mode.** All 13
  skeleton components (used on the feed, wallet, messenger, postings, profile, and hunter
  dashboard screens per the previous pass's skeleton-adoption work) had container colors
  hardcoded to the dark palette (`#111827`, `#0B0F14`, `#374151`) and every tile had an
  explicit `bg-[#1F2937]` override. In light mode these rendered as solid dark boxes on a
  white screen. Containers now pull `theme.surface`/`theme.background`/`theme.border`;
  tile color literals were removed so tiles fall back to the base `Skeleton` component's
  own translucent (already theme-agnostic-safe) tint.
- Added `withAlpha()` to `lib/utils.ts` (hex → rgba at a given alpha) — was previously
  duplicated ad hoc per-file (e.g. `empty-state.tsx`); `button.tsx` and `skeleton-loaders.tsx`
  now share it instead of adding a third copy.

Verified via `tsc --noEmit` (clean) and `eslint` on the changed files (0 errors, 2
pre-existing unrelated warnings). Could not get a live browser screenshot this pass —
`expo start --web` hung at 0% bundling in the sandboxed environment used, unrelated to
these changes; recommend a human or a working dev environment spot-check the sign-in
screen's loading state and a skeleton screen in light mode before considering this done.

## Shipped this pass — 2026-07-17

`expo start --web` still hangs at "Starting Metro Bundler" in this sandbox (confirmed
again this pass), so this round deliberately scoped to changes verifiable by inspection
(contrast math against WCAG thresholds) rather than anything needing a visual diff —
no layout, spacing, or component-swap changes.

- **Fixed an actually-broken (not just theme-inconsistent) screen:**
  `app/onboarding/connect.tsx`'s "your account is verified for payouts" success banner
  had `backgroundColor: '#1F2937'` (near-black) with `color: '#111827'` (near-black) —
  the inline comments even say `/* emerald-100 */` / `/* emerald-800 */`, so the
  intended pale-green/dark-green pair had regressed to two near-identical near-black
  values at some point. Text was effectively invisible regardless of app theme, on the
  success state of the Stripe Connect payout-onboarding flow. Restored to `#d1fae5` /
  `#065f46` (the emerald-100/800 the comments describe).
- **Fixed the same "dark text on dark" bug class as the 2026-07-16 pass, this time in
  `components/bounty-card.tsx`** — the single most-rendered component in the app (every
  card in the main feed). Its revision/cancellation/dispute status badges used a flat
  `rgba(color, 0.15)` wash with a fixed dark (`#92400e`/`#7c2d12`) text/icon color, not
  gated on `theme.isDark` the way the adjacent `honorBadge` in the same file already is.
  Computed contrast in dark mode (translucent amber/red over the dark theme's `#111827`
  card surface) was ~2:1 against the text — WCAG AA requires 4.5:1. Added the same
  `theme.isDark ? lighterBg : originalBg` / `theme.isDark ? lightText : originalText`
  pattern already established by `honorBadge` in this file, verified at ~8.8:1 in dark
  mode by the same computation.
- **Same fix in `components/workflow-dispute-modal.tsx`'s warning box** (shown on both
  the dispute-creation and dispute-submission steps) — inverse of the bounty-card bug:
  light amber text (`#fbbf24`) on a translucent amber wash was tuned for dark mode and
  left unreadable in light mode. Made the same `theme.isDark` split; every other color
  in this file already follows that pattern, this box was the one holdout.
- **Ruled out several look-alikes rather than "fixing" them blind:** grepped the same
  dark-amber/dark-red text colors across ~12 other files. Most (`offline-mode-banner.tsx`,
  `app/onboarding/connect.tsx`'s other two banners, `connect-onboarding-wrapper.tsx`,
  `components/ui/verification-badge.tsx`) pair the dark text with a **fixed** pale
  background that doesn't depend on the app theme, so the contrast is fine as-is — only
  flagging translucent-over-adaptive-surface combinations as bugs, not every dark-on-pale
  literal.
- **Found but did not touch:** `components/escrow-status-card.tsx` has the identical
  near-black-on-near-black bug in its `released` status variant (`backgroundColor:
  '#1F2937'`, `textColor: '#111827'`) — but the component has zero import sites anywhere
  in the app (dead code, same category as `accessible-text.tsx`/`accessible-touchable.tsx`
  noted below). Left as-is per the standing decision not to modify unreferenced files
  without a reason to revive them; worth fixing at the same time as wiring it up if it's
  ever mounted.

Verified via `tsc --noEmit` (clean) and `eslint` on the three changed files (0 new
errors; workflow-dispute-modal.tsx has one pre-existing unrelated
`react/no-unescaped-entities` error and connect.tsx one pre-existing import warning,
neither on lines this pass touched). Still no live visual verification possible in this
environment — these specific fixes are backed by computed WCAG contrast ratios rather
than a screenshot, which is a reasonable substitute for pure color-value changes but not
a replacement for an actual device/browser check before shipping.

## Not done — needs a decision or bigger diff

### Phase 4 — Forms
Three incompatible validation/error idioms coexist: `react-hook-form` (used in exactly one
screen, `app/auth/sign-up-form.tsx`), a local `errors`+`touched` state record
(`CreateBounty/Step*.tsx`), and bare `Alert.alert` with no inline field errors
(`add-bank-account-modal.tsx`). Recommend picking one convention (react-hook-form is already
present as a dependency and has one working reference implementation) and migrating
screen-by-screen — this is a multi-PR effort, not a single pass.

### Phase 5 — Full hardcoded-style sweep
The new token scale (spacing/radius/typography/shadows) exists now, but ~183 files still
hardcode raw pixel values in `StyleSheet.create`. Migrating them is mechanical but high-volume
— best done incrementally, screen by screen, as those screens come up for other work rather
than as a dedicated sweep.

### Phase 6 — Deeper accessibility pass
`components/ui/accessible-text.tsx` and `accessible-touchable.tsx` currently have zero
consumers anywhere in the app — either wire them up or remove them (left in place this pass
per prior decision to not delete unreferenced files). Beyond that: a real touch-target-size
audit, dynamic type support check, and extending reduced-motion coverage past
buttons/cards/tabs to the rest of the animated components in `components/ui/`.

### `Button.loading` rollout (not attempted)
The `loading` prop added 2026-07-16 is only wired up on the sign-in/sign-up submit buttons.
~50 other screens still hand-roll `ActivityIndicator` + manual `disabled` gating around a
`TouchableOpacity` or `Button` (create-bounty submit, payout/withdraw confirms, dispute
actions, profile edit save, etc.) — converting them is mechanical but screen-by-screen, not
a sweep, since each has to be checked for whether the button's child is plain text (works
via the crossfade) or a custom node with its own internal state.

### Spinner-vs-skeleton gap (not attempted)
91 files use a raw `ActivityIndicator` for full-screen/section loading vs. ~16 that use the
`skeleton-loaders.tsx` components (now light-mode-safe as of this pass). The highest-traffic
screens already use skeletons; the remaining 91 are mostly secondary flows (settings, admin,
dispute/verification screens) where a skeleton is a genuine perceived-speed win but building
a bespoke skeleton per screen layout is high-volume, one-at-a-time work — not a good fit for
a single pass.

### Modal fragmentation (not attempted)
43 files hand-roll a bare React Native `<Modal>`; `components/ui/dialog.tsx` and `sheet.tsx`
(shadcn-style ports) are barely used outside other `components/ui/*` files; the entire
toast/toaster/sonner stack (`components/ui/toast.tsx`, `toaster.tsx`, `sonner.tsx`,
`hooks/use-toast.ts`) is never mounted anywhere — real user-facing feedback goes through
`Alert.alert` (461 call sites). Consolidating this is a legitimate improvement but too large a
blast radius to fold into a polish pass — flagging it as a candidate for a dedicated
"notification/modal system" project.

### Screens worth a deeper redesign later
- **Wallet / withdraw / transaction history** — functionally solid now, but would benefit from
  an actual visual design pass (this effort only fixed bugs and consistency, not layout).
- **`app/tabs/bounty-app.tsx`** — the tab container itself (manual `activeScreen` string state
  instead of expo-router tabs) works, but a real `app/tabs/_layout.tsx` using expo-router's
  tab navigator would get transition animations, deep-linking, and back-button handling for
  free instead of hand-rolled equivalents.
- **Admin panel** (`app/(admin)/*`) — still on the old brand green and was out of scope for
  this pass entirely; if it's meant to feel like part of the same product, it needs its own
  pass.
