// lib/analytics/screen-tracking.ts
//
// Emits PostHog's native `$screen` event (via `screen()`) for real navigation
// events — a route change from expo-router (see the ScreenTracker in
// app/_layout.tsx), or an in-app tab switch inside the bounty-app shell (see
// app/tabs/bounty-app.tsx), which never changes the route so expo-router alone
// can't see it. autocapture's captureScreens is off (see app/_layout.tsx)
// because expo-router exposes no NavigationContainer ref for it to hook, so
// this is the only source of $screen.
//
// `$screen` carries this module's navigation properties (screen_name,
// previous_screen, navigation_source, seconds_on_previous_screen) and feeds
// PostHog's own surfaces (paths, the replay event overlay, DAU/WAU). The
// custom `screen_viewed` event it used to be mirrored from was retired
// 2026-09-25: the two matched 1:1, property for property.
//
// A screen counts as viewed only once it has stayed on top for
// SCREEN_SETTLE_MS. Anything replaced sooner is dropped. The 2026-11-23 audit
// found 421 of 8,590 $screen events (30 days) repeating the same screen for
// the same person within 2 s. None were double mounts. They were screens
// nobody stopped on:
//   - redirect gates: app/index.tsx ("home") and app/onboarding/index.tsx
//     ("onboarding") show a loader and router.replace() on, typically 20 ms
//     to 750 ms later;
//   - transient route states: useSegments() briefly reporting the screen
//     underneath during a replace (onboarding_style -> onboarding ->
//     onboarding_style, search flashing under an open profile), under 250 ms;
//   - tabs swiped through: the pager commits a tab when it comes to rest, so
//     swiping Home -> Wallet -> Messages committed Wallet for a few hundred ms.
// The view that does settle is stamped with the time it appeared, not the
// time it settled, so timestamps and seconds_on_previous_screen stay true.
//
// Deliberately fire-and-forget: lib/posthog.ts already queues and flushes in
// the background, so nothing here blocks the UI thread.
import { screen as posthogScreen } from '../posthog';

export type NavigationSource = 'tab' | 'push' | 'deep_link' | 'back' | 'notification';

/**
 * How long a screen must stay on top to count as a view. 750 ms is the
 * lowest value that, replayed over the 30 days to 2026-11-24, brings
 * same-screen repeats within 2 s under 0.5% (0.22%); it drops about a
 * quarter of $screen events, almost all loaders, redirects and swiped-through
 * tabs.
 */
export const SCREEN_SETTLE_MS = 750;

const MAX_STACK = 25;

// The last screen actually reported, and the navigation stack of reported
// screens (used to infer "back").
const state: { screenName: string | null; viewedAt: number | null; stack: string[] } = {
  screenName: null,
  viewedAt: null,
  stack: [],
};

// A screen that is on top but has not been there for SCREEN_SETTLE_MS yet.
type PendingView = {
  screenName: string;
  source?: NavigationSource;
  properties?: Record<string, unknown>;
  appearedAt: number;
  timer: ReturnType<typeof setTimeout>;
};
let pendingView: PendingView | null = null;

let pendingSource: NavigationSource | null = null;

/**
 * Marks the *next* screen view as originating from the given source,
 * for cases the navigation itself can't tell us (e.g. a deep link is resolved
 * before expo-router finishes navigating to it). Consumed by the next view
 * that is reported, so a redirect gate passed through on the way does not
 * use it up.
 */
export function markPendingNavigationSource(source: NavigationSource): void {
  pendingSource = source;
}

function report(view: PendingView): void {
  const { screenName, appearedAt } = view;
  const previousScreen = state.screenName;
  const secondsOnPrevious =
    previousScreen && state.viewedAt
      ? Math.round((appearedAt - state.viewedAt) / 1000)
      : undefined;

  let source: NavigationSource;
  if (view.source) {
    source = view.source;
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
  state.viewedAt = appearedAt;

  const eventProperties = {
    screen_name: screenName,
    ...(previousScreen ? { previous_screen: previousScreen } : {}),
    navigation_source: source,
    ...(secondsOnPrevious !== undefined ? { seconds_on_previous_screen: secondsOnPrevious } : {}),
    // Marks views counted under the settle rule. Events without it predate
    // 2026-11-24 (an OTA update does not change $app_version, so this is the
    // only way to tell the two apart).
    settle_ms: SCREEN_SETTLE_MS,
    ...view.properties,
  };

  posthogScreen(screenName, eventProperties, { timestamp: new Date(appearedAt) });
}

/**
 * Records that `screenName` is now on top. Reported once it has stayed there
 * for SCREEN_SETTLE_MS (see the header). Safe to call from a navigation effect
 * on every render: a call naming the screen already on top, reported or
 * pending, is a no-op.
 */
export function trackScreenView(
  screenName: string,
  opts: { source?: NavigationSource; properties?: Record<string, unknown> } = {}
): void {
  if (!screenName) return;
  if (pendingView?.screenName === screenName) return;

  // Whatever was waiting to settle was replaced before it did: drop it.
  if (pendingView) {
    clearTimeout(pendingView.timer);
    pendingView = null;
  }
  // Back on the screen already reported (A -> B -> A with B never settling).
  if (screenName === state.screenName) return;

  const view: PendingView = {
    screenName,
    source: opts.source,
    properties: opts.properties,
    appearedAt: Date.now(),
    timer: setTimeout(() => {
      if (pendingView !== view) return;
      pendingView = null;
      report(view);
    }, SCREEN_SETTLE_MS),
  };
  pendingView = view;
}

// The bounty-app tab shell (app/tabs/bounty-app.tsx) is one route whose
// visible tab is local state. It reports tab switches itself and records the
// current tab here, so the route tracker can report that tab whenever the
// shell route comes back on top (e.g. Back from a pushed screen). Before
// 2026-11-24 a return to the shell reported nothing until the next tab
// switch, and with the settle window it would also have let a screen that
// flashed over the shell settle and be reported while the shell was showing.
let shellTab: string | null = null;

/** The tab shell's tab is now `screenName` (tab bar, swipe, or first mount). */
export function trackShellTabView(
  screenName: string,
  opts: { source?: NavigationSource; properties?: Record<string, unknown> } = {}
): void {
  shellTab = screenName;
  trackScreenView(screenName, opts);
}

/** The tab shell unmounted; its last tab no longer describes anything. */
export function clearShellTab(): void {
  shellTab = null;
}

/**
 * The tab shell's route is on top. Reports its current tab; before the shell
 * has said which tab that is, it only drops whatever was waiting to settle,
 * and the shell's own first report follows.
 */
export function trackShellRouteView(opts: { source?: NavigationSource } = {}): void {
  if (shellTab) {
    trackScreenView(shellTab, opts);
    return;
  }
  if (pendingView) {
    clearTimeout(pendingView.timer);
    pendingView = null;
  }
}

/** Test-only: clears module state so specs don't leak into one another. */
export function __resetScreenTrackingStateForTests(): void {
  if (pendingView) clearTimeout(pendingView.timer);
  pendingView = null;
  shellTab = null;
  state.screenName = null;
  state.viewedAt = null;
  state.stack = [];
  pendingSource = null;
}
