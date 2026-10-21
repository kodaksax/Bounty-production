# Motion System

How Bounty moves. Tokens live in `lib/motion.ts`; this page is the why and the
how-to. Modal presentation has its own deeper write-up in
[MODAL_ANIMATION_STANDARD.md](./MODAL_ANIMATION_STANDARD.md), and it uses these
tokens.

## Principles

- **Responsive before decorative.** Press feedback starts on touch-down and is
  done in ~120ms. Nothing makes the user wait for an animation to finish.
- **Continuity, not choreography.** Motion explains where something came from
  or went. If removing an animation loses no information, it shouldn't exist.
- **Exits are faster than entrances.** Arrivals decelerate (`easeOut`),
  departures accelerate (`easeIn`), in-place changes use `easeInOut`.
- **No overshoot by default.** Springs settle without bounce (`settleSpring`).
- **Reduce Motion is a different animation, not no animation.** Slides become
  crossfades; shimmers become in-place pulses. Feedback that confirms an
  action stays.

## Tokens (`lib/motion.ts`)

| Token | Value | Use |
|---|---|---|
| `duration.press` | 120ms | touch-down feedback |
| `duration.fast` | 160ms | touch-up, chevrons, toggles, small state changes |
| `duration.base` | 220ms | content swaps, dialogs opening, crossfades |
| `duration.screen` | 260ms | route entrances |
| `duration.exit` | 180ms | anything leaving |
| `duration.loaderDelay` | 220ms | wait before a loading indicator may appear |
| `press.scale` | 0.97 | buttons and cards that depress |
| `press.opacity` | 0.7 | `activeOpacity` for rows, icons, links |
| `press.scaledOpacity` | 0.9 | `activeOpacity` for surfaces that also scale |
| `distance.route` | 24px | route slide distance |
| `distance.content` | 8px | content settling inside a screen |

`easeOut`, `easeIn` and `easeInOut` are worklet functions. The same function
works as a Reanimated `withTiming` easing and as an RN `Animated.timing`
easing, so both runtimes play identical curves.

## Patterns

**Press feedback.** Use the shared `Button` (components/ui/button.tsx) for
actions. For a pressable card, use `usePressAnimation()` from
`hooks/use-accessible-animation` and set `activeOpacity={press.scaledOpacity}`
on the touchable. For a plain row/icon `TouchableOpacity`, set
`activeOpacity={press.opacity}`. React Native's default is 0.2, which reads as
a blink.

**Route changes.** The root navigator is a native Stack (`app/_layout.tsx`):
pushes slide over the screen below, back reverses it, iOS has the edge swipe,
and the screen underneath stays mounted with its scroll position. Hand-overs
from the auth gate (`index`, `onboarding`, the tab shell) crossfade. Nested
group stacks keep `slide_from_right`. On web the stack doesn't animate, so
`components/ui/route-transition.tsx` adds the entrance there only. Don't add
per-screen entrance animations on top.

**Screens that stay mounted underneath.** A screen that only loads on mount
won't reload when the user comes back to it. Use `useRefreshOnReturn` from
`hooks/useRouteFocus.ts` for data that a pushed screen can change (it skips
the first focus) and keep the refresh silent — no skeletons on return.
Anything painted above every route (the status-bar strip) must come down when
its screen loses focus (`useIsScreenFocused`). A screen that guards leaving
(unsaved changes) must also turn off the swipe: `useSwipeBackEnabled(!dirty)`.

**Modals and sheets.** Use `AppModal` (`variant="dialog" | "sheet"`). Full-height
workflow sheets keep the native `presentationStyle="pageSheet"` slide.

**Loading.** Full-screen waits use `ScreenLoader`, which holds the indicator
back for `duration.loaderDelay` so fast loads never flash a spinner. Inline
placeholders use `Skeleton`, which shares one clock across every instance on
screen.

**Switches.** Spread `switchColors(theme)` (lib/themes/switch-colors.ts) onto
every React Native `<Switch>`.

## Don'ts

- Don't scale a pressed element *up*, or add bounce to press feedback.
- Don't start a new `Animated.loop` per list item; share a clock.
- Don't animate `width`/`height`/`margin` on the JS thread during gestures.
- Don't wrap the root navigator in a keyed view to animate it. That remounts
  the navigator and resets history.
