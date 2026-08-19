/**
 * Welcome-screen A/B arm for app/onboarding/welcome.tsx: 'control' (the
 * existing screen) vs 'poster_first' (components/onboarding/PosterFirstWelcome.tsx).
 *
 * Assignment comes from the PostHog multivariate flag 'welcome-page-redesign',
 * which backs the "Welcome page redesign – bounty poster conversion"
 * experiment. Its variant keys map onto the local arm names, which are the
 * values the `first_screen_*` events have always reported — keeping those
 * names means existing insights keep working:
 *
 *   PostHog 'test'    -> 'poster_first'
 *   PostHog 'control' -> 'control'
 *   false / missing   -> 'control'   (outside the rollout, flag off, or
 *                                     PostHog unavailable)
 *
 * The redesign therefore renders only for devices PostHog buckets into 'test'.
 * If the 'welcome-page-redesign' flag does not exist in the dashboard, every
 * install sees the pre-redesign screen and nothing reports an error — that is
 * the intended default per spec §8, and also the exact reason the redesign
 * once looked like it had never been built. Creating the flag is what turns
 * the experiment on; see FORCE_POSTER_FIRST in app/onboarding/welcome.tsx to
 * preview the screen locally without one.
 *
 * The welcome screen has a <400ms render budget, so this never blocks on the
 * network indefinitely. Resolution order:
 *
 *   1. An arm resolved on an earlier launch (AsyncStorage) — instant, and the
 *      arm a device sees never changes between launches.
 *   2. The SDK's synchronously-readable flag value. Cached locally by PostHog
 *      after the first launch, so this is also instant in practice.
 *   3. Otherwise wait up to FLAG_WAIT_MS for the first /flags response, then
 *      fall back to DEFAULT_VARIANT. That fallback is deliberately NOT
 *      persisted: the next launch reads the by-then-cached flag and can still
 *      enroll the device in the experiment.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { getFeatureFlag, onFeatureFlags, type FeatureFlagValue } from '../posthog';

export type FirstScreenVariant = 'control' | 'poster_first';

/** PostHog flag key backing the welcome-page redesign experiment. */
export const WELCOME_REDESIGN_FLAG_KEY = 'welcome-page-redesign';

// v3: step 1 below trusts storage over the flag, so any arm persisted before
// the experiment was properly configured would outlive it and skew the split.
// Bumping discards assignments made while the default was briefly
// 'poster_first', giving the experiment a clean slate. Nothing real is lost —
// the 'welcome-page-redesign' flag did not exist during that window, so no
// device was ever genuinely enrolled.
const STORAGE_KEY = '@bounty_first_screen_variant_v3';

/** Longest the welcome screen will wait on the first /flags response. */
const FLAG_WAIT_MS = 400;

/**
 * Arm used whenever PostHog does not assign one — spec §8: "Default: control."
 *
 * This means the redesign does NOT render until the 'welcome-page-redesign'
 * flag exists in PostHog and buckets the device into 'test'. That is the
 * intended behaviour for a real experiment, but it is also exactly why the
 * screen appeared to be missing before: no flag, no redesign, no error. To see
 * it locally without the flag, use FORCE_POSTER_FIRST in
 * app/onboarding/welcome.tsx.
 */
const DEFAULT_VARIANT: FirstScreenVariant = 'control';

let cachedVariant: FirstScreenVariant | null = null;
let resolvePromise: Promise<FirstScreenVariant> | null = null;

function toVariant(flagValue: FeatureFlagValue | undefined): FirstScreenVariant {
  if (flagValue === 'test') return 'poster_first';
  if (flagValue === 'control') return 'control';
  // Flag off, or a device outside the rollout.
  return DEFAULT_VARIANT;
}

/**
 * Reads the flag, waiting up to FLAG_WAIT_MS for the first flags response if
 * it hasn't landed yet. Resolves `undefined` if it never lands in time.
 */
function readFlag(): Promise<FeatureFlagValue | undefined> {
  const immediate = getFeatureFlag(WELCOME_REDESIGN_FLAG_KEY);
  if (immediate !== undefined) return Promise.resolve(immediate);

  return new Promise(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    const finish = (value: FeatureFlagValue | undefined) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      resolve(value);
    };

    timer = setTimeout(() => finish(undefined), FLAG_WAIT_MS);
    unsubscribe = onFeatureFlags(() => finish(getFeatureFlag(WELCOME_REDESIGN_FLAG_KEY)));
    // onFeatureFlags may fire synchronously if flags landed mid-subscribe.
    if (settled) unsubscribe();
  });
}

/**
 * Resolves this device's welcome-screen arm. Exported for non-React callers;
 * components should use `useFirstScreenVariant` below.
 */
export async function resolveFirstScreenVariant(): Promise<FirstScreenVariant> {
  if (cachedVariant) return cachedVariant;

  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'control' || stored === 'poster_first') {
      cachedVariant = stored;
      return stored;
    }
  } catch {
    // Fall through to a fresh flag read. Worst case this install re-reads the
    // flag on a later launch, which PostHog buckets identically anyway.
  }

  const flagValue = await readFlag();
  if (flagValue === undefined) {
    // Flags never arrived (first launch on a slow/offline network, or PostHog
    // disabled). Render the default arm for this session without persisting
    // it — see the resolution-order note at the top of this file.
    return DEFAULT_VARIANT;
  }

  const assigned = toVariant(flagValue);
  cachedVariant = assigned;
  AsyncStorage.setItem(STORAGE_KEY, assigned).catch(() => {
    // Best-effort persistence — see note above.
  });
  return assigned;
}

export interface FirstScreenVariantState {
  /** Defaults to DEFAULT_VARIANT until the persisted/flag value resolves. */
  variant: FirstScreenVariant;
  /** True once `variant` reflects the real resolved arm. */
  ready: boolean;
}

export function useFirstScreenVariant(): FirstScreenVariantState {
  const [state, setState] = useState<FirstScreenVariantState>({
    variant: cachedVariant ?? DEFAULT_VARIANT,
    ready: cachedVariant !== null,
  });

  useEffect(() => {
    if (cachedVariant) {
      setState({ variant: cachedVariant, ready: true });
      return;
    }

    let cancelled = false;
    // Shared across mounts so a remount inside one session can't land on a
    // different arm (and can't fire a second PostHog exposure).
    if (!resolvePromise) resolvePromise = resolveFirstScreenVariant();
    resolvePromise.then(variant => {
      if (!cancelled) setState({ variant, ready: true });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
