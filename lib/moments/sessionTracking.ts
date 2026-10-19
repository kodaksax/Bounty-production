/**
 * Moments Queue — inactivity / returning-user detection.
 *
 * Pure decision logic for whether a user counts as "returning after
 * inactivity" (see registry.ts: inactive_user_return), kept separate from
 * the Supabase read/write in providers/moments-provider.tsx for the same
 * reason engine.ts is separate from momentsService.ts — easy to unit test,
 * and it's the one place the inactivity threshold and the
 * "don't write on every foreground" throttle live. `profiles.last_session_at`
 * is intentionally generic (not moments-specific) so future lifecycle
 * campaigns (welcome-back, new-opportunities-nearby, unclaimed-earnings,
 * seasonal re-engagement) can key off the same column.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Per-user, per-device count of distinct sessions (see shouldRecordSession for the session-boundary definition). */
const SESSION_COUNT_KEY_PREFIX = '@bounty_moments_session_count:';

/** Reads the current session count without incrementing it. Returns 0 if never recorded on this device. */
export async function getSessionCount(userId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_COUNT_KEY_PREFIX + userId);
    const parsed = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Increments and persists the session count, returning the new value. Call once per detected session boundary. */
export async function incrementSessionCount(userId: string): Promise<number> {
  const next = (await getSessionCount(userId)) + 1;
  try {
    await AsyncStorage.setItem(SESSION_COUNT_KEY_PREFIX + userId, String(next));
  } catch {
    // Best-effort — worst case a session goes uncounted, which only makes
    // session-gated moments slightly more conservative, never less.
  }
  return next;
}

/**
 * When this JS runtime last recorded a session for each user (ISO string).
 *
 * MomentsProvider decides "is this a new session?" from the signed-in
 * profile's last_session_at, but it writes that column straight to Supabase
 * and the in-memory profile is never re-read afterwards. For a brand-new user
 * the value it holds stays null for the whole first sitting, so every later
 * refresh() — every AppState 'active' (an OS permission dialog, the payment
 * sheet, a quick app switch) and every provider remount — counted as another
 * session. One extra count is enough to clear MIN_SESSIONS_FOR_ACTIVATION_PROMPT
 * and surface the ID-verification prompt minutes after onboarding (SBA-06).
 * Module-level rather than a ref so it survives provider remounts; a cold
 * start or web reload re-reads the profile, which by then holds the write.
 */
const sessionRecordedAt = new Map<string, string>();

/** The later of the profile's last_session_at and this runtime's own record of a session write. */
export function effectiveLastSessionAt(userId: string, profileLastSessionAt: string | null): string | null {
  const local = sessionRecordedAt.get(userId) ?? null;
  if (!local) return profileLastSessionAt;
  if (!profileLastSessionAt) return local;
  return new Date(local).getTime() > new Date(profileLastSessionAt).getTime()
    ? local
    : profileLastSessionAt;
}

/** Call synchronously, before any await, when recording a session, so a concurrent refresh() sees it. */
export function noteSessionRecorded(userId: string, at: string): void {
  sessionRecordedAt.set(userId, at);
}

/** Test-only: forget every in-memory session record. */
export function resetSessionRecordsForTests(): void {
  sessionRecordedAt.clear();
}

/** Below this many days since last_session_at, a user isn't "returning" — just continuing a normal cadence. */
export const INACTIVITY_THRESHOLD_DAYS = 14;

/** Minimum gap between last_session_at writes, so rapid foreground/background toggles don't spam the DB. */
export const SESSION_WRITE_THROTTLE_MS = 30 * 60 * 1000;

export interface ReturningUserResult {
  isReturning: boolean;
  daysSinceLastSession: number | null;
}

/** `lastSessionAt` is the value read BEFORE this session's write — i.e. when the user was last seen prior to right now. */
export function evaluateReturningUser(lastSessionAt: string | null): ReturningUserResult {
  if (!lastSessionAt) return { isReturning: false, daysSinceLastSession: null };
  const days = (Date.now() - new Date(lastSessionAt).getTime()) / DAY_MS;
  return { isReturning: days >= INACTIVITY_THRESHOLD_DAYS, daysSinceLastSession: Math.floor(days) };
}

/** Whether enough time has passed since the last recorded session to justify another write. */
export function shouldRecordSession(lastSessionAt: string | null): boolean {
  if (!lastSessionAt) return true;
  return Date.now() - new Date(lastSessionAt).getTime() > SESSION_WRITE_THROTTLE_MS;
}
