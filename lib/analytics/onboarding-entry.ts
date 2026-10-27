// lib/analytics/onboarding-entry.ts
//
// `onboarding_started` / `onboarding_resumed`: exactly one of the two per
// visit to the onboarding route group (app/onboarding/*), emitted from its
// layout by components/onboarding/OnboardingEntryTracker.tsx.
//
//   onboarding_started  the first time this journey reaches a real onboarding
//                       step (welcome for a signed-out visitor, otherwise
//                       whichever step they land on)
//   onboarding_resumed  a later visit, in a new app process, by a journey that
//                       already started
//
// Both carry `entry_point` (the step reached), `authenticated` and `intent`.
//
// Until 2026-10-26 these fired from the onboarding gate (app/onboarding/index.tsx),
// which the two main entry paths never pass through: app/index.tsx sends a
// first-time device straight to /onboarding/welcome, and sign-up sends the new
// account straight to /onboarding/style. In production that left 92 people
// with onboarding_started against 713 reaching the style step in 60 days (the
// reported ~13%), and 53 of those 92 were already past the style step when it
// fired, so it mostly measured a cold-start re-entry, not a start.
//
// A "journey" is keyed by the PostHog anonymous id AND the user id. The
// anonymous id survives sign-up (identify() merges it into the new person), so
// a start recorded on the welcome screen is the same journey as the
// authenticated style step that follows; it changes on reset(), so a second
// account created on the same device after a logout starts its own journey.
//
// The guard is device-local, like lib/analytics/lifecycle.ts: a user who
// continues onboarding on a second device emits a second onboarding_started.
// Use a first-touch aggregation in PostHog if a strict once-per-person number
// is needed.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAnonymousId } from 'lib/posthog';
import { analyticsService } from 'lib/services/analytics-service';

export const ONBOARDING_ENTRY_STEPS = [
  'welcome',
  'username',
  'style',
  'location',
  'role-select',
  'payouts',
  'poster-profile',
  'founder-note',
] as const;

export type OnboardingEntryStep = (typeof ONBOARDING_ENTRY_STEPS)[number];

const STORAGE_KEY = '@bounty/onboarding/started_journeys';
// Ids, newest first. A handful of accounts per device at most; the cap only
// stops a pathological device growing the list without bound.
const MAX_STORED_IDS = 20;
// Stands in for the anonymous id when PostHog isn't configured, so the guard
// still works for the other sinks trackEvent feeds (Sentry breadcrumbs).
const NO_POSTHOG_ANON_ID = 'no-posthog';

/**
 * The onboarding step a pathname shows, or null for anything else — including
 * the `/onboarding` gate itself, which hasn't decided yet whether this user
 * belongs in onboarding at all.
 */
export function onboardingStepFromPath(pathname: string | null | undefined): OnboardingEntryStep | null {
  const match = /^\/onboarding\/([a-z-]+)\/?$/.exec(pathname ?? '');
  if (!match) return null;
  const step = match[1] as OnboardingEntryStep;
  return ONBOARDING_ENTRY_STEPS.includes(step) ? step : null;
}

// Ids this JS runtime has already emitted for. A second call that shares one
// is the same visit continuing (Strict Mode, a layout remount, or
// welcome -> sign-up -> style, where the user id joins the anonymous id), so
// it emits nothing. Filled synchronously, before any await, so concurrent
// calls can't both emit.
const emittedThisProcess = new Set<string>();

async function readStartedIds(): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return null;
  }
}

export async function trackOnboardingEntry({
  step,
  userId,
  intent,
}: {
  step: OnboardingEntryStep;
  userId: string | null;
  intent: string | null;
}): Promise<void> {
  const ids = [getAnonymousId() ?? NO_POSTHOG_ANON_ID, userId].filter(
    (id): id is string => !!id
  );
  const continuingVisit = ids.some(id => emittedThisProcess.has(id));
  ids.forEach(id => emittedThisProcess.add(id));
  if (continuingVisit) return;

  try {
    // An unreadable guard must not suppress the event: count it as a start.
    const startedIds = await readStartedIds();
    const alreadyStarted = !!startedIds && ids.some(id => startedIds.includes(id));

    if (startedIds) {
      const next = [...ids, ...startedIds.filter(id => !ids.includes(id))].slice(0, MAX_STORED_IDS);
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The event still goes out; the next launch may count it as a start again.
      }
    }

    await analyticsService.trackEvent(alreadyStarted ? 'onboarding_resumed' : 'onboarding_started', {
      entry_point: step,
      authenticated: !!userId,
      intent: intent ?? 'none',
    });
  } catch {
    // Best-effort: onboarding itself must never wait on or fail for analytics.
  }
}

/** Test-only: forget which journeys this process has emitted for. */
export function __resetOnboardingEntryForTests(): void {
  emittedThisProcess.clear();
}
