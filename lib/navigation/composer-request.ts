/**
 * Asks the tab shell (app/tabs/bounty-app.tsx) to open the composer on its
 * Post tab, from a screen pushed over it, such as Search.
 *
 * A route param can't carry this. The shell is already mounted under the
 * pushed screen, and a param would have to survive the pop back to it. Its
 * `tab` param also only picks a tab: it doesn't say where the poster came
 * from, which the composer reports as `entry_point`. So the request goes
 * through memory instead.
 *
 * The shell listens only while it is the focused screen. A request made while
 * Search still covers it waits, and is delivered when the poster is back on
 * the shell. Switching tabs underneath a covering screen doesn't stick: the
 * pager's scroll is lost when the shell comes back into view, and it lands
 * on the old tab. The same wait covers Search opened from a cold deep link,
 * where the shell mounts only after Search sends the poster on.
 */

type ComposerRequestListener = (entryPoint: string) => void;

/** A request nobody picked up within this window is dropped, not replayed later. */
export const COMPOSER_REQUEST_TTL_MS = 10_000;

const listeners = new Set<ComposerRequestListener>();
let pending: { entryPoint: string; at: number } | null = null;

/** Open the composer, reporting `entryPoint` as where the poster came from. */
export function requestComposer(entryPoint: string): void {
  if (listeners.size === 0) {
    pending = { entryPoint, at: Date.now() };
    return;
  }
  listeners.forEach((listener) => listener(entryPoint));
}

/**
 * Called by the tab shell while focused. Delivers a recent request that
 * arrived before it was listening, then every later one. Returns the
 * unsubscribe function.
 */
export function subscribeComposerRequests(listener: ComposerRequestListener): () => void {
  listeners.add(listener);
  if (pending !== null) {
    const { entryPoint, at } = pending;
    pending = null;
    if (Date.now() - at <= COMPOSER_REQUEST_TTL_MS) listener(entryPoint);
  }
  return () => {
    listeners.delete(listener);
  };
}
