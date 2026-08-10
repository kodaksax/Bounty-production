/**
 * App version gate.
 *
 * Compares the installed *native* build against a floor we publish ourselves,
 * so old clients can be nudged — or blocked — without waiting for a store
 * review or scraping App Store / Play listings.
 *
 * Why a self-served floor rather than the iTunes lookup API:
 *  - iTunes lookup caches for hours after a release, so a fresh version is
 *    invisible exactly when the prompt matters most.
 *  - Google Play has no official endpoint; libraries scrape the HTML and break.
 *  - Only a floor we control lets us hard-gate a build we know is broken —
 *    the case that matters for an app moving money through escrow and Stripe.
 *
 * This is a pure-JS check (expo-application is already a dependency), so it
 * ships over the air and does not require a new binary to take effect.
 */

import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { supabase } from '../supabase';
import { logger } from '../utils/error-logger';

export interface VersionRequirement {
  /** Newest version in the store — below this we nudge. */
  latest: string;
  /** Oldest version still allowed to run — below this we block. */
  minimum: string;
  /** Optional copy shown in the blocking state (e.g. "Fixes a payout issue"). */
  message?: string;
  /** Optional deep link to the store listing; falls back to the platform default. */
  storeUrl?: string;
}

export type VersionGateStatus = 'ok' | 'update-available' | 'update-required';

export interface VersionGateResult {
  status: VersionGateStatus;
  installedVersion: string | null;
  requirement: VersionRequirement | null;
}

/**
 * Compare dotted numeric versions ("2.0.10" > "2.0.9").
 * Returns >0 when `a` is newer, <0 when older, 0 when equal.
 *
 * Missing segments count as 0, so "2.0" and "2.0.0" are equal. Non-numeric
 * segments (e.g. a "-beta" suffix) are treated as 0 rather than NaN, which
 * would otherwise poison every comparison into a false "up to date".
 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    String(value ?? '')
      .split('.')
      .map((part) => {
        const n = parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The currently installed native version, e.g. "2.0.4". */
export function getInstalledVersion(): string | null {
  return Application.nativeApplicationVersion ?? null;
}

export function getStoreUrl(requirement?: VersionRequirement | null): string {
  if (requirement?.storeUrl) return requirement.storeUrl;
  return Platform.select({
    ios: 'https://apps.apple.com/app/id6499645223',
    android: 'https://play.google.com/store/apps/details?id=app.bountyfinder.BOUNTYExpo',
    default: 'https://bountyfinder.app',
  }) as string;
}

/**
 * Read the floor for this platform. Returns null on any failure — a version
 * gate must fail open, since a network blip should never lock users out.
 */
export async function fetchVersionRequirement(): Promise<VersionRequirement | null> {
  try {
    const platform = Platform.OS === 'android' ? 'android' : 'ios';
    const { data, error } = await supabase
      .from('app_version_requirements')
      .select('latest_version, minimum_version, message, store_url')
      .eq('platform', platform)
      .maybeSingle();

    if (error || !data) return null;

    return {
      latest: data.latest_version,
      minimum: data.minimum_version,
      message: data.message ?? undefined,
      storeUrl: data.store_url ?? undefined,
    };
  } catch (error) {
    logger.warning('Version requirement fetch failed', { error: String(error) });
    return null;
  }
}

/**
 * Resolve the gate. Always returns 'ok' when anything is unknown — an
 * unreachable config or an unreadable version must never block the app.
 */
export async function evaluateVersionGate(): Promise<VersionGateResult> {
  const installedVersion = getInstalledVersion();
  const requirement = await fetchVersionRequirement();

  if (!installedVersion || !requirement) {
    return { status: 'ok', installedVersion, requirement };
  }

  if (compareVersions(installedVersion, requirement.minimum) < 0) {
    return { status: 'update-required', installedVersion, requirement };
  }
  if (compareVersions(installedVersion, requirement.latest) < 0) {
    return { status: 'update-available', installedVersion, requirement };
  }
  return { status: 'ok', installedVersion, requirement };
}
