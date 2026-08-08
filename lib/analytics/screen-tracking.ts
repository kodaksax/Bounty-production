// lib/analytics/screen-tracking.ts
//
// Emits `screen_viewed` for real navigation events — a route change from
// expo-router (see the ScreenTracker in app/_layout.tsx), or an in-app tab
// switch inside the bounty-app shell (see app/tabs/bounty-app.tsx), which
// never changes the route so expo-router alone can't see it.
//
// Deliberately fire-and-forget: `capture()` in lib/posthog.ts already queues
// and flushes in the background, so nothing here blocks the UI thread.
import { capture as posthogCapture } from '../posthog';

export type NavigationSource = 'tab' | 'push' | 'deep_link' | 'back' | 'notification';

const MAX_STACK = 25;

const state: { screenName: string | null; viewedAt: number | null; stack: string[] } = {
  screenName: null,
  viewedAt: null,
  stack: [],
};

let pendingSource: NavigationSource | null = null;

/**
 * Marks the *next* screen_viewed call as originating from the given source,
 * for cases the navigation itself can't tell us (e.g. a deep link is resolved
 * before expo-router finishes navigating to it). Consumed once.
 */
export function markPendingNavigationSource(source: NavigationSource): void {
  pendingSource = source;
}

/**
 * Records a screen view. Safe to call from a navigation effect on every
 * render — a call naming the screen already on top is a no-op, so re-renders
 * and duplicate effect firings never produce more than one event per real
 * navigation.
 */
export function trackScreenView(
  screenName: string,
  opts: { source?: NavigationSource; properties?: Record<string, unknown> } = {}
): void {
  if (!screenName || screenName === state.screenName) return;

  const now = Date.now();
  const previousScreen = state.screenName;
  const secondsOnPrevious =
    previousScreen && state.viewedAt ? Math.round((now - state.viewedAt) / 1000) : undefined;

  let source: NavigationSource;
  if (opts.source) {
    source = opts.source;
    state.stack.push(screenName);
  } else if (pendingSource) {
    source = pendingSource;
    state.stack.push(screenName);
  } else {
    const isBack = state.stack.length >= 2 && state.stack[state.stack.length - 2] === screenName;
    source = isBack ? 'back' : 'push';
    if (isBack) state.stack.pop();
    else state.stack.push(screenName);
  }
  pendingSource = null;

  if (state.stack.length > MAX_STACK) {
    state.stack.splice(0, state.stack.length - MAX_STACK);
  }

  state.screenName = screenName;
  state.viewedAt = now;

  posthogCapture('screen_viewed', {
    screen_name: screenName,
    ...(previousScreen ? { previous_screen: previousScreen } : {}),
    navigation_source: source,
    ...(secondsOnPrevious !== undefined ? { seconds_on_previous_screen: secondsOnPrevious } : {}),
    ...opts.properties,
  });
}

/** Test-only: clears module state so specs don't leak into one another. */
export function __resetScreenTrackingStateForTests(): void {
  state.screenName = null;
  state.viewedAt = null;
  state.stack = [];
  pendingSource = null;
}
