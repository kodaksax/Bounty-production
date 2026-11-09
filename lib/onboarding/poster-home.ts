/**
 * The `poster-home` flag and the onboarding order it selects.
 *
 *   Flag off: sign-up, style, location, role, poster profile or payouts.
 *   Flag on:  sign-up, role, then
 *             posters: location, poster profile
 *             hunters: style, location, payouts
 *
 * Every step reads one decision, taken the first time it's needed in this app
 * run, so a flag that resolves halfway through can't change the path under
 * someone. Screens after onboarding use the live flag instead.
 */

import { useEffect, useState } from 'react';
import { getFeatureFlag, onFeatureFlags, useFeatureFlag } from '../posthog';
import { nextStepAfterRole, isOnboardingRole, type OnboardingRole } from './next-step-after-role';

export const POSTER_HOME_FLAG = 'poster-home';

/** How long sign-up will wait on the first flags response before taking the old path. */
const FLAG_WAIT_MS = 400;

/** Tells the style step it's being reached after the role step, not before it. */
export const HUNTER_STYLE_STEP_AFTER_ROLE = '/onboarding/style?after_role=1' as const;

let decision: boolean | null = null;
let pending: Promise<boolean> | null = null;

function peekDecision(): boolean | null {
  if (decision !== null) return decision;
  const value = getFeatureFlag(POSTER_HOME_FLAG);
  if (value === undefined) return null;
  decision = value === true;
  return decision;
}

function waitForFlags(): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(getFeatureFlag(POSTER_HOME_FLAG) === true);
    };
    const timer = setTimeout(finish, FLAG_WAIT_MS);
    unsubscribe = onFeatureFlags(finish);
    if (settled) unsubscribe();
  });
}

/** Resolves this app run's onboarding order. A flag that never loads means the old order. */
export function resolvePosterHomeDecision(): Promise<boolean> {
  const known = peekDecision();
  if (known !== null) return Promise.resolve(known);
  if (!pending) {
    pending = waitForFlags().then(result => {
      decision = result;
      pending = null;
      return result;
    });
  }
  return pending;
}

/** The onboarding order for this run; null only while waiting on the first flags response. */
export function usePosterHomeDecision(): boolean | null {
  const [value, setValue] = useState<boolean | null>(() => peekDecision());

  useEffect(() => {
    if (value !== null) return;
    let cancelled = false;
    void resolvePosterHomeDecision().then(result => {
      if (!cancelled) setValue(result);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return value;
}

/** The live flag, for screens after onboarding. Only an explicit `true` turns it on. */
export function usePosterHomeEnabled(): boolean {
  return useFeatureFlag(POSTER_HOME_FLAG) === true;
}

export function stepAfterRoleSelect(role: OnboardingRole, posterHome: boolean) {
  if (!posterHome) return nextStepAfterRole(role);
  return role === 'poster' ? ('/onboarding/location' as const) : HUNTER_STYLE_STEP_AFTER_ROLE;
}

/** Where the location step (and the waitlist step after it) continues to. */
export function stepAfterLocation(intent: unknown, posterHome: boolean) {
  if (posterHome && isOnboardingRole(intent)) return nextStepAfterRole(intent);
  return '/onboarding/role-select' as const;
}

/** Test seam: resets the decision between cases. */
export function __resetPosterHomeDecisionForTests(): void {
  decision = null;
  pending = null;
}
