// lib/analytics/lifecycle.ts
//
// Marketplace-activation milestones. These fire the FIRST time a given user
// completes the defining action of a role on this device:
//   - poster_activated  -> first bounty they successfully publish
//   - hunter_activated   -> first application they successfully submit
//
// They are deliberately NOT re-emitted on every subsequent publish/apply. A
// per-(user, device) guard key in AsyncStorage makes the emit idempotent so
// the "activated" milestone stays a milestone and not a running count. The
// guard is device-local, so a returning user on a new device can emit the
// event a second time — acceptable for an activation milestone, and callers
// should treat it as "first activation seen on this install", not a global
// first. Query PostHog with a first-touch / min-timestamp aggregation if a
// strict once-per-person number is needed.
//
// PostHog is behavioural analytics only. The operational source of truth for
// "has this user ever posted / applied" is the Supabase row count, never this
// event.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { analyticsService } from 'lib/services/analytics-service';

export type ActivationRole = 'poster' | 'hunter';

const guardKey = (role: ActivationRole, userId?: string | null): string =>
  `@bounty/activation/${role}/${userId ?? 'anon'}`;

// Collapses concurrent calls for the same key within one JS runtime. The
// AsyncStorage guard alone is idempotent across launches but not against a
// same-process race: two callers could each read getItem(key) === null before
// either setItem resolves, and both emit. Entries are cleared once the first
// call finishes writing its guard (or fails), so a genuinely later call is
// then correctly short-circuited by the persisted guard instead.
const inFlightKeys = new Set<string>();

async function markActivated(
  role: ActivationRole,
  userId: string | null | undefined,
  props: Record<string, string | number | boolean | undefined>
): Promise<void> {
  const key = guardKey(role, userId);
  if (inFlightKeys.has(key)) return;
  inFlightKeys.add(key);
  try {
    const alreadySeen = await AsyncStorage.getItem(key);
    if (alreadySeen) return;

    // Write the guard BEFORE emitting so a crash between the two can only
    // ever cost the event, never produce a duplicate on the next launch.
    const nowIso = new Date().toISOString();
    await AsyncStorage.setItem(key, nowIso);

    await analyticsService.trackEvent(role === 'poster' ? 'poster_activated' : 'hunter_activated', {
      role,
      activated_at: nowIso,
      ...props,
    });

    // Person-level flags so cohorts can be built without re-deriving the
    // milestone from the event stream.
    await analyticsService.updateUserProperties({
      [`${role}_activated`]: true,
      [`${role}_activated_at`]: nowIso,
    });
  } catch {
    // Activation tracking is best-effort — it must never block or fail the
    // publish/apply that triggered it.
  } finally {
    inFlightKeys.delete(key);
  }
}

/** Call once, right after a bounty the current user posted goes live. */
export const markPosterActivated = (
  userId?: string | null,
  props: Record<string, string | number | boolean | undefined> = {}
): Promise<void> => markActivated('poster', userId, props);

/** Call once, right after the current user's application is accepted by the server. */
export const markHunterActivated = (
  userId?: string | null,
  props: Record<string, string | number | boolean | undefined> = {}
): Promise<void> => markActivated('hunter', userId, props);
