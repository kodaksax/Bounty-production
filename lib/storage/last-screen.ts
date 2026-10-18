/**
 * Remembers which bottom tab of the app shell (app/tabs/bounty-app.tsx) a
 * user was on, so a cold start can reopen it instead of always landing on the
 * bounty feed. A warm resume needs none of this — the JS state survives — but
 * once the OS kills the backgrounded app the tab lives only in local state.
 *
 * Per user (a different account signing in never inherits someone else's tab)
 * and time-boxed: coming back after a long break lands on the feed, which is
 * what the app is for.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_SCREEN_KEY_PREFIX = '@bounty_last_screen:';

/** How long a remembered tab stays eligible for restore after the user left it. */
export const LAST_SCREEN_TTL_MS = 60 * 60 * 1000;

/** Tabs worth restoring. 'bounty' is the default anyway; 'admin' is its own route. */
const RESTORABLE_SCREENS = new Set(['wallet', 'postings', 'profile', 'messages']);

function keyFor(userId: string): string {
  return `${LAST_SCREEN_KEY_PREFIX}${userId}`;
}

/** Best-effort; a failed write only means the next cold start opens the feed. */
export async function saveLastScreen(userId: string, screen: string): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify({ screen, at: Date.now() }));
  } catch {
    // ignore
  }
}

/**
 * The tab to reopen for this user, or null for the feed. Never throws, and
 * gives up after `timeoutMs` so a slow storage read can't hold the launch.
 */
export async function getRestorableLastScreen(
  userId: string,
  timeoutMs = 500
): Promise<string | null> {
  const read = (async () => {
    try {
      const raw = await AsyncStorage.getItem(keyFor(userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const screen = parsed?.screen;
      const at = Number(parsed?.at);
      if (typeof screen !== 'string' || !RESTORABLE_SCREENS.has(screen)) return null;
      if (!Number.isFinite(at) || Date.now() - at > LAST_SCREEN_TTL_MS) return null;
      return screen;
    } catch {
      return null;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
