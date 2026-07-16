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
