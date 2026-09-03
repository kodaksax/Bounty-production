/**
 * Arm assignment for the "post first, pay at accept" funding experiment.
 *
 *   'control'  — today's behaviour: the poster's wallet is debited at INSERT
 *                time by the fn_reserve_bounty_escrow trigger, so an unfunded
 *                wallet is a hard block on posting at all.
 *   'deferred' — the poster's FIRST bounty may be posted unfunded; escrow is
 *                reserved when they select a hunter.
 *
 * Assignment comes from the PostHog multivariate flag
 * 'post-first-pay-at-accept'. Its variant keys map onto the local arm names:
 *
 *   PostHog 'test'    -> 'deferred'
 *   PostHog 'control' -> 'control'
 *   false / missing   -> 'control'   (outside the rollout, flag off, or
 *                                     PostHog unavailable)
 *
 * WHAT THIS FLAG DOES AND DOES NOT CONTROL
 * ----------------------------------------
 * It controls whether the posting flow ASKS for deferred funding. It is not,
 * and must never become, the authority on whether deferred funding is GRANTED.
 * The server re-decides every time:
 *
 *   * public.fn_can_defer_bounty_funding()      — eligibility (kill switch,
 *                                                 scope, amount cap, "has this
 *                                                 poster ever posted?")
 *   * trg_bounties_normalize_funding_mode       — silently downgrades an
 *                                                 ungranted request back to
 *                                                 'at_post' at INSERT
 *   * trg_bounties_enforce_funding_before_work  — refuses to let an unfunded
 *                                                 bounty enter a work state
 *
 * So a user who forges the flag, or an install whose cached flag is stale,
 * gets exactly today's behaviour rather than a free unfunded bounty.
 *
 * Resolution order deliberately mirrors lib/experiments/first-screen-variant.ts
 * (persisted arm -> synchronous SDK read -> short wait -> control), because the
 * posting flow has the same "must not block on the network" constraint.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { getFeatureFlag, onFeatureFlags, type FeatureFlagValue } from '../posthog';

export type DeferredFundingVariant = 'control' | 'deferred';

/** PostHog flag key backing the post-first/pay-at-accept experiment. */
export const DEFERRED_FUNDING_FLAG_KEY = 'post-first-pay-at-accept';

const STORAGE_KEY = '@bounty_deferred_funding_variant';

/** Longest the posting flow will wait on the first /flags response. */
const FLAG_WAIT_MS = 400;

let cachedVariant: DeferredFundingVariant | null = null;
let resolvePromise: Promise<DeferredFundingVariant> | null = null;

function toVariant(flagValue: FeatureFlagValue | undefined): DeferredFundingVariant {
  return flagValue === 'test' ? 'deferred' : 'control';
}

function readFlag(): Promise<FeatureFlagValue | undefined> {
  const immediate = getFeatureFlag(DEFERRED_FUNDING_FLAG_KEY);
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
    unsubscribe = onFeatureFlags(() => finish(getFeatureFlag(DEFERRED_FUNDING_FLAG_KEY)));
    // onFeatureFlags may fire synchronously if flags landed mid-subscribe.
    if (settled) unsubscribe();
  });
}

/** Resolves this device's arm. Exported for non-React callers. */
export async function resolveDeferredFundingVariant(): Promise<DeferredFundingVariant> {
  if (cachedVariant) return cachedVariant;

  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'control' || stored === 'deferred') {
      cachedVariant = stored;
      return stored;
    }
  } catch {
    // Fall through to a fresh flag read.
  }

  const flagValue = await readFlag();
  if (flagValue === undefined) {
    // Flags never arrived. Run control for this session WITHOUT persisting, so
    // a later launch can still enroll the device.
    return 'control';
  }

  const assigned = toVariant(flagValue);
  cachedVariant = assigned;
  AsyncStorage.setItem(STORAGE_KEY, assigned).catch(() => {
    /* best-effort persistence */
  });
  return assigned;
}

export interface DeferredFundingVariantState {
  /** Defaults to 'control' until the persisted/flag value resolves. */
  variant: DeferredFundingVariant;
  /** True once `variant` reflects the real resolved arm. */
  ready: boolean;
}

export function useDeferredFundingVariant(): DeferredFundingVariantState {
  const [state, setState] = useState<DeferredFundingVariantState>({
    variant: cachedVariant ?? 'control',
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
    if (!resolvePromise) resolvePromise = resolveDeferredFundingVariant();
    resolvePromise.then(variant => {
      if (!cancelled) setState({ variant, ready: true });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/** Test seam — resets the module-level cache between suites. */
export function __resetDeferredFundingVariantCacheForTests(): void {
  cachedVariant = null;
  resolvePromise = null;
}
