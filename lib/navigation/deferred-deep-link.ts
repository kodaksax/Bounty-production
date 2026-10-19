/**
 * Makes a notification's destination win over the root gate's landing on a
 * cold start.
 *
 * Opening the app from a notification, the notification handler navigates
 * about 100 ms after launch, but the root gate (app/index.tsx) only routes
 * once the session is restored, and it routes with router.replace, which
 * replaces whatever is focused: the screen the notification just opened. The
 * user then lands on the feed, or on the tab restored from their last session
 * (lib/storage/last-screen.ts), instead of where the notification pointed.
 *
 * So while the gate is still deciding (it holds deep links from mount until
 * its first navigation), a deep link waits here:
 *   - a link into the tab shell (`/tabs/bounty-app?tab=…`) is taken by the
 *     gate, which lands there instead of the restored tab: one shell, and
 *     the explicit tab wins;
 *   - any other link is opened once the gate has navigated, on top of where
 *     the gate landed.
 * With no gate holding (the usual warm tap), a deep link opens immediately.
 */

import { isBountyAppTabPath } from './bounty-app-tab';

type Navigate = (path: string) => void;

let holds = 0;
let pending: { path: string; navigate: Navigate } | null = null;

function flush(): void {
  const p = pending;
  pending = null;
  if (p) p.navigate(p.path);
}

/**
 * Opens `path` with `navigate` now, or once the root gate has made its first
 * navigation if it is still deciding. A later link replaces a waiting one:
 * the last notification tapped wins.
 */
export function openDeepLink(path: string, navigate: Navigate): void {
  if (holds === 0) {
    navigate(path);
    return;
  }
  pending = { path, navigate };
}

/**
 * Called by the root gate while it decides where a launch lands. Returns the
 * release, which opens any waiting link; call it right after the gate's first
 * navigation (and on unmount). Safe to call more than once.
 */
export function holdDeepLinks(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0) flush();
  };
}

/**
 * For the root gate: claims a waiting link into the tab shell, so the gate
 * can land there itself instead of on the restored tab. Null when none waits.
 */
export function takeDeferredTabLink(): string | null {
  if (!pending || !isBountyAppTabPath(pending.path)) return null;
  const { path } = pending;
  pending = null;
  return path;
}

/** Test-only. */
export function __resetDeferredDeepLinksForTests(): void {
  holds = 0;
  pending = null;
}
