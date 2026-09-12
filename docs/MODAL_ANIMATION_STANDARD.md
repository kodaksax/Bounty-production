# Modal Animation Standard

A full audit of every modal, bottom sheet, dialog, action sheet, and overlay
in the app, plus the fixes applied to bring the worst offenders in line with
a single shared animation system.

## The standard: `components/ui/app-modal.tsx`

Every modal in the app should render through `<AppModal>`. It is a thin
wrapper around RN's `<Modal animationType="none">` that drives its own
timeline on the UI thread via Reanimated, so there is exactly one animation
system per modal instead of native-Modal-animation + a second JS/Reanimated
effect fighting each other.

```tsx
<AppModal visible={visible} onRequestClose={handleClose} variant="dialog">
  <YourCardContent />
</AppModal>
```

- **`variant="dialog"`** — centered card. Backdrop fades 0→1, content fades
  0→1 and scales 0.96→1.0. Use for confirmations, alerts, code-entry modals.
- **`variant="sheet"`** — bottom sheet. Backdrop fades 0→1, content fades
  0→1 and slides up ~32px. Use for bottom-sheet pickers/detail panels.
- Open: 220ms, ease-out cubic. Close: 180ms, same curve, reversed.
- `dismissable` (default `true`) controls whether tapping the backdrop
  closes it — set `false` for blocking confirmations that must be
  acknowledged via a button (matches the old `Alert.alert` contract).
- **Lifecycle:** content only mounts once `visible` flips true, and the
  underlying native `<Modal>` only unmounts once the close animation has
  actually finished playing (`onClosed` fires at that point). A modal never
  flashes in before it's ready and never vanishes mid-transition.
- **Keyboard:** the modal area shrinks by the keyboard's overlap, so a dialog
  with a text field re-centers above it instead of disappearing under it. A
  fixed-height card must also cap itself against `useModalContentHeight()`.
  See [Keyboard Avoidance Standard](./KEYBOARD_AVOIDANCE_STANDARD.md).

### Why not one primitive for *everything*

Full-workflow screens — `WorkflowDisputeModal`, `PosterReviewModal`,
`AttachmentViewerModal`, the dispute/edit-posting flows — intentionally
**keep** RN's native `presentationStyle="pageSheet"`/`"fullScreen"` +
`animationType="slide"` instead of `AppModal`. That native transition *is*
the "Apple system sheet" feel the task asks for; wrapping it in a second,
Reanimated-driven fade would reintroduce the exact "multiple animations
fighting" bug this whole effort exists to remove. `AppModal` targets the
smaller, in-app-designed dialogs/sheets where the team was hand-rolling
`Animated`/`Modal` combinations with no shared spec.

## Root cause categories found

1. **Conditional-mount-on-close.** `{show && <Modal .../>}` unmounts the
   modal the instant `show` flips false, so no exit animation — including
   ones already written in the component — ever gets to run. This was the
   single biggest source of "opens nicely, vanishes instantly" bugs.
2. **Competing animation systems.** A native `Modal animationType="fade"`
   (whole-surface opacity) running at the same time as a separate
   `Animated.spring` on one internal element, with different curves/timing.
3. **Dead animation code.** State that looked like it drove a close
   animation but didn't touch any animated value.
4. **No animation at all.** Plain conditionally-rendered `View` overlays
   with zero transition in or out.
5. **Off-primitive but functionally fine.** Plenty of modals use RN's
   native `animationType="fade"`/`"slide"` correctly (open and close both
   animate because the component stays mounted and only `visible` toggles)
   — these aren't bugged, just inconsistent in scale/duration/easing with
   the rest of the app.

## Fixed this pass

| File | Issue | Fix |
|---|---|---|
| `components/bountydetailmodal.tsx` | `handleClose` set an `isClosing` state that was never read anywhere — the "close animation" was a dead 300ms `setTimeout` doing nothing, then the parent yanked the modal out instantly. | Migrated to `AppModal` (`variant="dialog"`). Added `onClosed` wiring so the real `onClose` (which the 4 call sites use to unmount the component) only fires after the close animation actually finishes. |
| `components/ui/feedback-modal.tsx` | Native `Modal animationType="fade"` (whole surface) ran concurrently with a separate `Animated.spring` bounce on just the icon circle — two systems, two curves, and the spring reset instantly (`setValue(0)`) with no exit animation of its own. | Migrated to `AppModal` (`dialog`, `dismissable={false}` to preserve its blocking-alert behavior). One timeline now drives backdrop + card + icon together. |
| `components/moments/MomentSheet.tsx` | Opened with a nice parallel fade+slide, but closed by returning `null` the instant `activeContent` went null — zero exit animation despite having a working entrance one. | Migrated to `AppModal` (`sheet`). Added `displayContent` state that holds the last moment's content during the close animation so the sheet doesn't blank out while fading/sliding away. |
| `components/payment-methods-modal.tsx` | Drag-to-dismiss played a smooth slide+fade out before calling `onClose`, but tapping the header ✕ or the backdrop called `onClose()` directly — same component, two different close behaviors, one of them abrupt. | Added a shared `animateCloseThenCall()` helper; the ✕ button, backdrop tap, and Android back button now all play the same fade+slide-down before invoking `onClose`, same as the drag gesture. (Left on its own custom `Animated`/`PanResponder` implementation rather than `AppModal`, since its drag-to-dismiss gesture doesn't fit that primitive.) |
| `components/ui/tooltip.tsx` (`TooltipContent`) | `if (!isOpen) return null` ran *before* the `<Modal animationType="fade">`, unmounting it in the same render that closed it — killed the exit fade even though the parent (`Tooltip`) already kept the component mounted correctly via `cloneElement`. | Removed the early return; the `Modal` component itself (kept mounted, `visible={isOpen}`) now handles both directions natively, matching the working `InfoTooltip` pattern already in the same file. |
| `app/profile/[userId].tsx` ("More options" dropdown) | Plain `{showMoreMenu && <Pressable>...}` — zero animation opening or closing. | Added a small local `MoreMenuPopover` (Reanimated fade+scale, same 220ms/180ms timing as `AppModal`) that stays mounted through the close animation instead of being conditionally rendered. Not routed through `AppModal` itself since it's an anchored popover, not a full-screen modal. |
| `components/ui/mfa-code-modal.tsx` | Native `fade`, functionally fine, but off the shared spec (no scale, different feel from the sheet-style confirmations elsewhere). | Migrated to `AppModal` (`dialog`). |
| `components/ui/totp-enrollment-modal.tsx` | Same as above. | Migrated to `AppModal` (`dialog`); existing `isVerifying` back-button guard preserved via `onRequestClose`. |
| `components/ui/withdrawal-confirm-sheet.tsx` | Native `slide`, functionally fine, off-spec. | Migrated to `AppModal` (`sheet`, `dismissable={!isSubmitting}`). Updated its one test that asserted on the raw `visible` prop reaching RN's `Modal`, since `AppModal` now returns `null` outright before ever mounting a `Modal` when never opened. |

## Known, not fixed this pass (follow-up backlog, ranked)

Found during the audit but out of scope for this pass's time budget — listed
so the next pass doesn't have to rediscover them.

**Zero animation, both directions (highest priority):**
- `app/search/saved-searches.tsx` — "New Search" modal is a plain absolute
  `View`, mounted/unmounted conditionally.
- `app/tabs/postings-screen.tsx` — confirmation-card overlay wrapper has no
  transition at the wrapper level (unverified whether `BountyConfirmationCard`
  compensates internally).
- `components/add-bank-account-modal.tsx` / `components/add-card-modal.tsx`
  (non-embedded mode) — no `Modal`, no `Animated`/Reanimated at all.

**Conditional-mount-on-close (parent unmounts before any exit animation can
finish), now that the two worst-affected children are fixed:**
- `components/transaction-history-screen.tsx` (427) — `TransactionDetailModal`
  is actually fine here: it already gates its own `onClose` call on the
  reverse animation's `finished` callback, so the parent's conditional
  unmount is harmless in practice. Still worth wrapping it in a real
  `<Modal>` at some point — it currently renders as an absolutely-positioned
  `View` inside the screen rather than a portal, so it can in principle
  render under other native chrome on some screens.
- `components/onboarding/PosterFundingScreen.tsx` (235) and
  `components/add-money-screen.tsx` (274) — both conditionally mount
  `PaymentMethodsModal`; now that `PaymentMethodsModal` always plays its
  close animation before calling `onClose`, these are no longer actually
  broken, just still using the conditional-mount pattern.

**Off-primitive but not broken** (native `fade`, correctly kept-mounted,
mechanical swap to `AppModal` would be low-risk/low-urgency):
`components/ui/escrow-explainer.tsx`, `components/ui/reputation-score.tsx`,
`components/ui/trust-badges.tsx` (×2 near-duplicate implementations —
worth de-duplicating at the same time), `components/ui/verification-badge.tsx`,
`components/ui/tooltip.tsx`'s `InfoTooltip`, `components/notifications-bell.tsx`,
`components/offline-status-badge.tsx` (uses `slide` with a *centered* card,
a visual mismatch — `slide` reads as a bottom-sheet gesture elsewhere in the
app), `components/enhanced-profile-section.tsx` (4 call sites), most modals
under `app/(admin)/`, `app/auth/`, `app/screens/CreateBounty/`, `app/tabs/`.

**Other animation bugs found, not modal-related:**
- `components/ui/animated-section.tsx` (used throughout
  `components/my-posting-expandable.tsx`'s accordions) drives one
  expand/collapse toggle with both `Animated.timing` (chevron) and
  `LayoutAnimation.configureNext` (content height) concurrently — the
  "multiple animation systems" anti-pattern, just outside of a modal
  context.
- `components/connect-embedded-webview.tsx` — its popup-close handler resets
  several state vars and forces a `key`-based WebView remount at the same
  moment the popup's native close animation starts, which is real work
  happening concurrently with an in-flight transition (jank risk, not an
  abrupt-close bug).

## Testing

- `npx tsc --noEmit` passes with no errors on the full project after all
  changes in this pass.
- Full Jest suite passes (195/199 suites, 4 pre-existing skips unrelated to
  this work; 2709 tests). Getting here required a test-infra fix: this
  project's Jest config (`jest.config.js`) has no Babel transform for plain
  `.js` node_modules files, so `react-native-reanimated`'s ESM build (needed
  by the new `AppModal`) couldn't be parsed. Added a global
  `jest.mock('react-native-reanimated', …)` to `jest.setup.js`, matching the
  project's existing convention of globally mocking heavy native modules
  there (same file already mocks `react-native` itself, `@stripe/stripe-react-native`,
  various `expo-*` packages, etc.) — a per-test-file mock still overrides it,
  as `success-animation.test.tsx` already does. Also added `Pressable` to the
  existing `react-native` mock, which was missing it entirely (any component
  rendering a bare `Pressable` under this config would have failed the same
  way before this change).
- **Not verified in a running app.** No iOS/Android simulator was exercised
  in this session, so the animation feel (timing, easing, backdrop
  ordering) described here has not been visually confirmed on-device. Do a
  manual pass on both platforms — open/close each migrated modal, background
  the app mid-animation, and rotate/rapid-tap the trigger button — before
  treating this as fully verified.
