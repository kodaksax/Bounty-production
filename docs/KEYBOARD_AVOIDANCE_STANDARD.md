# Keyboard Avoidance Standard

Companion to [Modal Animation Standard](./MODAL_ANIMATION_STANDARD.md). The
audit and the fixes behind `components/ui/keyboard-avoiding.tsx`.

## The bug this replaces

A text field in the bounty detail modal was covered by the iOS keyboard: the
user could not see what they were typing. The same failure was present across
most of the app's forms, for three distinct reasons.

1. **`KeyboardAvoidingView` inside a `<Modal>` does nothing.** It measures its
   own frame against the *window*. Inside a modal that measurement is wrong,
   so it computes no overlap and applies no padding. Every dialog with a text
   field inherited this.
2. **`keyboardVerticalOffset` was being used as "extra padding."** It is the
   distance from the top of the window to the top of the avoiding view.
   `CreateBounty` passed `insets.top` for a view that starts at y=0, and
   over-shifted the whole flow by the status-bar height.
3. **Most screens had nothing at all.** A `ScrollView` with a field halfway
   down simply let the keyboard cover the lower half.

## The standard: `components/ui/keyboard-avoiding.tsx`

Everything derives from the *overlap* — how many points of the screen the
keyboard actually covers — read from the OS event's `endCoordinates.screenY`,
never from `endCoordinates.height`. That distinction is what keeps floating
and split iPad keyboards, hardware keyboards showing only the shortcut bar,
and the interactive dismissal gesture from over-shifting the layout.

Layout is animated with the keyboard's own reported `duration` and easing
curve, so a field looks *attached* to the keyboard rather than chasing it —
the iMessage / Instagram-DM behaviour the fix was asked for.

### Pick one of four

| Surface | Use |
| --- | --- |
| Form screen with a `ScrollView` | `<KeyboardAwareScrollView>` — drop-in for `ScrollView`; pads its own content and scrolls the focused field back into view |
| Screen with a bottom-pinned CTA or composer | `<KeyboardAvoidingScreen>` — drop-in for `KeyboardAvoidingView`; the body shrinks, the pinned row stays visible |
| A bar docked to the bottom on its own | `<KeyboardStickyView>` — native-driven transform, welded to the top of the keyboard |
| `FlatList`/`SectionList` (can't give up virtualization) | `{...keyboardAwareListProps}` — the native iOS `automaticallyAdjustKeyboardInsets` path |
| Custom layout | `useKeyboardInset()` — the raw animated overlap |

### `offset` is the only thing to get right

`offset` is **the points of keyboard overlap the surface already clears**.

- Full-bleed container that reaches the screen's bottom edge → `0` (default).
- Container already inset by the safe area (`paddingBottom: insets.bottom`) →
  pass `insets.bottom`. The keyboard covers the home-indicator area, so
  clearing it twice leaves a visible dead gap under the input.
- Content sitting above the floating BottomNav → the nav is covered by the
  keyboard too; see `lib/constants/navigation.ts`.

### Modals get it for free

`AppModal` avoids the keyboard by default (`avoidKeyboard`, default `true`):
the modal area's `paddingBottom` becomes the overlap, so a centered dialog
re-centers in the space that is left and a sheet is pushed up.

A **fixed-height** card must also cap itself, or it keeps its full height and
pushes its own footer — and any input in that footer — off the bottom. Read
the space left from `useModalContentHeight()` rather than from `Dimensions`;
`components/bountydetailmodal.tsx` is the worked example.

## Android

`useKeyboardInset` deliberately reports `0` on Android and subscribes to
nothing. Expo's default `softwareKeyboardLayoutMode: 'resize'` maps to
`adjustResize`, so the OS already shrinks the app window by the keyboard and
the layout reflows on its own; shifting again in JS would double-count and
launch content off the top. This matches how the chat composer has always been
configured (`Platform.select({ ios: 'padding', android: undefined })`).

Every component here therefore renders unchanged on Android — the wrappers are
inert, not conditional, so there is one layout tree per platform.

## Not changed, and why

- **Leaf input primitives** (`ui/input.tsx`, `ui/textarea.tsx`,
  `themed/ThemedInput.tsx`, `ui/search-bar-row.tsx`, `ui/sidebar.tsx`,
  `AddressAutocomplete`) own no layout. Keyboard avoidance belongs to the
  screen that hosts them.
- **Search fields pinned to the top of a screen** (`app/tabs/search.tsx`'s
  search row, the admin list filters) are never covered by the keyboard.
- **Screens already using `KeyboardAvoidingView` correctly** (auth, chat,
  profile edit, onboarding phone) were left alone — they measure a full-screen
  frame, which is the one case RN's built-in gets right.
