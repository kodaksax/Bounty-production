/**
 * Arm assignment for the "$1 posting service fee" experiment.
 *
 *   'control'   — today's behaviour: publishing is free and the bounty reward
 *                 is escrowed when a hunter is accepted (pay-at-accept).
 *   'fee'       — the poster passes through a checkout step before the bounty
 *                 is created, paying the $1 service fee AND the full bounty
 *                 reward in one charge. The bounty is then published funded.
 *
 * Assignment comes from the PostHog multivariate flag 'posting-service-fee'.
 * Its variant keys map onto the local arm names:
 *
 *   PostHog 'test'    -> 'fee'
 *   PostHog 'control' -> 'control'
 *   false / missing   -> 'control'   (outside the rollout, flag off, or
 *                                     PostHog unavailable)
 *
 * DETERMINISM
 * -----------
 * Two independent mechanisms keep a user on one arm, which the rollout
 * requires:
 *
 *   1. PostHog's own rollout hashing is a pure function of
 *      (flag key, distinct_id), so a 20% rollout puts the same distinct_id in
 *      the same bucket on every evaluation, on every device, forever. It does
 *      not re-roll per session.
 *   2. The resolved arm is persisted to AsyncStorage on first resolution, so
 *      even a flag-config change, a PostHog outage, or a distinct_id change
 *      after an identify() cannot move a user who has already seen one arm.
 *
 * (2) is the one that matters for this experiment specifically: the treatment
 * arm takes money. A user who paid a $1 fee on Monday must not be told posting
 * is free on Tuesday, and — more importantly — must not be re-bucketed mid-way
 * through a posting attempt they have already been charged for.
 *
 * WHAT THIS FLAG DOES AND DOES NOT CONTROL
 * ----------------------------------------
 * It controls whether the composer SHOWS the checkout step. It is not, and
 * must never become, the authority on what the poster is charged. The server
 * re-derives the fee from its own constant inside
 * `/payments/posting-checkout/intent` and the PaymentIntent it returns is what
 * is actually collected — so a forged or stale client flag cannot change the
 * price, only whether this device offers the flow at all.
 *
 * Likewise it does NOT decide the bounty's funding mode. The client asks for
 * 'at_post' after a settled checkout, but trg_bounties_normalize_funding_mode
 * re-decides at INSERT and is the authority; useBountyPublish reads the
 * granted mode back off the created row before deciding whether to escrow.
 *
 * Resolution order deliberately mirrors
 * lib/experiments/deferred-funding-variant.ts, because the posting flow has
 * the same "must not block on the network" constraint.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import {
  getFeatureFlag,
  onFeatureFlags,
  setPersonProperties,
  type FeatureFlagValue,
} from '../posthog';

export type PostingFeeVariant = 'control' | 'fee';

/** PostHog flag key backing the $1 posting-fee experiment. */
export const POSTING_FEE_FLAG_KEY = 'posting-service-fee';

const STORAGE_KEY = '@bounty_posting_fee_variant';

/** Longest the posting flow will wait on the first /flags response. */
const FLAG_WAIT_MS = 400;

let cachedVariant: PostingFeeVariant | null = null;
let resolvePromise: Promise<PostingFeeVariant> | null = null;

function toVariant(flagValue: FeatureFlagValue | undefined): PostingFeeVariant {
  return flagValue === 'test' ? 'fee' : 'control';
}

/**
 * Stamp the arm as a PostHog PERSON property.
 *
 * The events that matter most for this experiment's downstream half —
 * application_accepted, escrow_funded, bounty_completed — fire from screens
 * this feature never touches. Rather than threading a variant prop through
 * the accept and completion paths (and inevitably missing one), the arm is
 * recorded on the person, so every one of those events is filterable by arm at
 * query time with no instrumentation on those paths at all.
 *
 * Best-effort and non-throwing: an analytics write must never be able to fail
 * a posting attempt.
 */
function stampVariantOnPerson(variant: PostingFeeVariant): void {
  try {
    setPersonProperties({ posting_fee_variant: variant });
  } catch {
    /* analytics is best-effort */
  }
}

function readFlag(): Promise<FeatureFlagValue | undefined> {
  const immediate = getFeatureFlag(POSTING_FEE_FLAG_KEY);
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
    unsubscribe = onFeatureFlags(() => finish(getFeatureFlag(POSTING_FEE_FLAG_KEY)));
    // onFeatureFlags may fire synchronously if flags landed mid-subscribe.
    if (settled) unsubscribe();
  });
}

/** Resolves this device's arm. Exported for non-React callers. */
export async function resolvePostingFeeVariant(): Promise<PostingFeeVariant> {
  if (cachedVariant) return cachedVariant;

  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'control' || stored === 'fee') {
      cachedVariant = stored;
      // Re-stamp on every cold start rather than only on first assignment:
      // person properties do not survive a reset() at sign-out, so a returning
      // user would otherwise lose arm attribution on all downstream events.
      stampVariantOnPerson(stored);
      return stored;
    }
  } catch {
    // Fall through to a fresh flag read.
  }

  const flagValue = await readFlag();
  if (flagValue === undefined) {
    // Flags never arrived. Run control for this session WITHOUT persisting, so
    // a later launch can still enroll the device. Running control on an
    // unresolved flag is the safe direction for a paid arm: the poster gets
    // today's free flow rather than a charge this build cannot confirm they
    // were enrolled for.
    return 'control';
  }

  const assigned = toVariant(flagValue);
  cachedVariant = assigned;
  stampVariantOnPerson(assigned);
  AsyncStorage.setItem(STORAGE_KEY, assigned).catch(() => {
    /* best-effort persistence */
  });
  return assigned;
}

export interface PostingFeeVariantState {
  /** Defaults to 'control' until the persisted/flag value resolves. */
  variant: PostingFeeVariant;
  /** True once `variant` reflects the real resolved arm. */
  ready: boolean;
}

export function usePostingFeeVariant(): PostingFeeVariantState {
  const [state, setState] = useState<PostingFeeVariantState>({
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
    if (!resolvePromise) resolvePromise = resolvePostingFeeVariant();
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
export function __resetPostingFeeVariantCacheForTests(): void {
  cachedVariant = null;
  resolvePromise = null;
}
