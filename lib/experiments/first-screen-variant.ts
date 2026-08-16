/**
 * `first_screen_variant` A/B flag for the onboarding welcome screen
 * (app/onboarding/welcome.tsx): 'control' (existing screen) vs
 * 'poster_first' (see components/onboarding/PosterFirstWelcome.tsx).
 *
 * This is a local, device-level assignment rather than a PostHog remote
 * flag: the welcome screen has a <400ms render budget, and a random 50/50
 * split resolved from AsyncStorage is both instant and sufficient — there's
 * no need to wait on a network round-trip to decide which arm to render.
 * Assigned once per install on first read, persisted to AsyncStorage, and
 * never reassigned afterwards.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type FirstScreenVariant = 'control' | 'poster_first';

const STORAGE_KEY = '@bounty_first_screen_variant';

let cachedVariant: FirstScreenVariant | null = null;
let resolvePromise: Promise<FirstScreenVariant> | null = null;

async function resolveVariant(): Promise<FirstScreenVariant> {
  if (cachedVariant) return cachedVariant;

  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'control' || stored === 'poster_first') {
      cachedVariant = stored;
      return stored;
    }
  } catch {
    // Fall through to a fresh assignment. Worst case this install gets
    // re-assigned on a later launch, which only adds noise, not bias.
  }

  const assigned: FirstScreenVariant = Math.random() < 0.5 ? 'control' : 'poster_first';
  cachedVariant = assigned;
  AsyncStorage.setItem(STORAGE_KEY, assigned).catch(() => {
    // Best-effort persistence — see note above.
  });
  return assigned;
}

export interface FirstScreenVariantState {
  /** Defaults to 'control' until the persisted/assigned value resolves. */
  variant: FirstScreenVariant;
  /** True once `variant` reflects the real persisted/assigned value. */
  ready: boolean;
}

export function useFirstScreenVariant(): FirstScreenVariantState {
  const [state, setState] = useState<FirstScreenVariantState>({
    variant: cachedVariant ?? 'control',
    ready: cachedVariant !== null,
  });

  useEffect(() => {
    if (cachedVariant) {
      setState({ variant: cachedVariant, ready: true });
      return;
    }

    let cancelled = false;
    if (!resolvePromise) resolvePromise = resolveVariant();
    resolvePromise.then(variant => {
      if (!cancelled) setState({ variant, ready: true });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
