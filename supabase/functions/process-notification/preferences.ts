// Helpers for deciding, per recipient, whether an outbox notification should be
// persisted in-app (the feed bell) and/or delivered as a push, based on the
// user's notification_preferences row.
//
// This module is intentionally dependency-free and pure so it can be unit
// tested in the app's Jest suite. The logic is also inlined into index.ts
// because the Supabase Edge bundler does not support local imports.

export interface ChannelDecision {
  /** Persist a row in the `notifications` table (drives the feed bell). */
  inApp: boolean;
  /** Send an Expo push notification. */
  push: boolean;
}

/**
 * Map the outbox `data.type` value to the base name of the granular
 * per-type preference toggle. Returns null for types that have no granular
 * toggle (e.g. generic status updates / system), which are never suppressed.
 */
export function mapTypeToPreferenceKey(type: unknown): string | null {
  switch (type) {
    case 'message':
      return 'messages';
    case 'application':
      return 'applications';
    case 'acceptance':
      return 'acceptances';
    case 'review_needed':
    case 'completion':
      return 'completions';
    case 'payment':
      return 'payments';
    case 'follow':
      return 'follows';
    case 'dispute':
      return 'disputes';
    default:
      return null;
  }
}

/**
 * Read a boolean-ish preference toggle, tolerating both schema variants:
 *   - baseline schema uses bare nullable columns (e.g. `messages`)
 *   - services/api schema uses `_enabled` columns (e.g. `messages_enabled`)
 * Returns undefined when the toggle is absent or null (meaning "inherit the
 * channel default", i.e. allow).
 */
function readToggle(prefs: Record<string, unknown> | null | undefined, base: string): boolean | undefined {
  if (!prefs) return undefined;
  const bare = prefs[base];
  const enabled = prefs[`${base}_enabled`];
  const value = bare ?? enabled;
  if (value === null || value === undefined) return undefined;
  return Boolean(value);
}

/**
 * Decide which channels are allowed for a single recipient.
 *
 * Rules:
 *  - No preferences row => allow both channels (sensible default).
 *  - Granular per-type toggle explicitly false => suppress entirely.
 *  - `in_app_enabled` explicitly false => no bell row (push may still go out).
 *  - `push_enabled` explicitly false => no push (bell row may still be added).
 *  - Missing/null toggles inherit the default (allow).
 */
export function decideChannels(prefs: Record<string, unknown> | null | undefined, type: unknown): ChannelDecision {
  if (!prefs) return { inApp: true, push: true };

  const key = mapTypeToPreferenceKey(type);
  if (key !== null) {
    const typeEnabled = readToggle(prefs, key);
    if (typeEnabled === false) {
      return { inApp: false, push: false };
    }
  }

  const inApp = prefs.in_app_enabled === false ? false : true;
  const push = prefs.push_enabled === false ? false : true;
  return { inApp, push };
}

export default decideChannels;
