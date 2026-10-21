/**
 * Motion tokens — the single source for how long things move, along which
 * curve, and how a control answers a press. See docs/MOTION_SYSTEM.md.
 *
 * The app runs two animation runtimes side by side: Reanimated (AppModal,
 * route transitions, anything on the UI thread) and RN Animated (Button,
 * cards, most legacy components). Both read from here so a duration or curve
 * means the same thing whichever runtime plays it.
 *
 * The easing curves below are plain functions marked as worklets: Reanimated
 * can run them on the UI thread, and RN Animated accepts them as an ordinary
 * `easing` function. Nothing here calls into either library at import time,
 * so test suites that mock react-native without an `Easing` export can still
 * import a component that uses these tokens.
 */

/** Durations in ms. Exits are always shorter than the matching entrance. */
export const duration = {
  /** Touch-down / touch-up feedback. Must never read as latency. */
  press: 120,
  /** Small in-place changes: chevrons, toggles, a highlight sliding over. */
  fast: 160,
  /** Content swaps and dialogs opening. */
  base: 220,
  /** Route-level entrances. */
  screen: 260,
  /** Anything leaving the screen. */
  exit: 180,
  /** Delay before a loading indicator is allowed to appear, so a fast load never flashes one. */
  loaderDelay: 220,
} as const;

/** Press feedback. One scale and one dim level for the whole app. */
export const press = {
  /** Scale for buttons and cards that depress under the finger. */
  scale: 0.97,
  /** activeOpacity for rows, icons and links that only dim. */
  opacity: 0.7,
  /** activeOpacity for surfaces that already scale, so the two don't stack into a flash. */
  scaledOpacity: 0.9,
} as const;

/** Travel distances in px. Small on purpose: motion hints direction, it doesn't tour the screen. */
export const distance = {
  /** A whole screen arriving from the side it was pushed from. */
  route: 24,
  /** Content settling into place inside a screen. */
  content: 8,
} as const;

/** Decelerate: fast start, soft landing. For everything arriving. */
export function easeOut(t: number): number {
  'worklet';
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/**
 * Accelerate away. For everything leaving. Quadratic rather than cubic: exits
 * are short, and a cubic start holds still long enough to read as a stall.
 */
export function easeIn(t: number): number {
  'worklet';
  return t * t;
}

/** In-place state changes that neither arrive nor leave. */
export function easeInOut(t: number): number {
  'worklet';
  if (t < 0.5) return 4 * t * t * t;
  const inv = -2 * t + 2;
  return 1 - (inv * inv * inv) / 2;
}

/**
 * RN Animated spring for things that settle into a slot (a tab highlight, a
 * pressed card returning to rest). Critically damped: no overshoot, no wobble.
 */
export const settleSpring = { speed: 20, bounciness: 0 } as const;
