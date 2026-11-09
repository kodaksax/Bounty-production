/**
 * Whether someone is inside the service area, and how we know.
 *
 * The country comes from the reverse-geocoded GPS fix, then the request's IP
 * country (the `geo-country` edge function), else it is unknown. The phone's
 * language setting is never used: a phone set to en-US in Queretaro is in
 * Mexico. Resolving lives in lib/services/serviceability-service.ts; this file
 * holds the rules and the latest answer, so analytics can read it synchronously.
 */

const SERVICEABLE_COUNTRY_CODES = new Set(['US']);

export type ServiceableSource = 'gps' | 'ip' | 'unknown';

export type RegionContext = {
  country_code?: string;
  region?: string;
  is_serviceable_region?: boolean;
  serviceable_source: ServiceableSource;
};

const UNKNOWN_REGION: RegionContext = Object.freeze({ serviceable_source: 'unknown' });

export function isServiceableCountry(countryCode?: string): boolean {
  if (!countryCode) return false;
  return SERVICEABLE_COUNTRY_CODES.has(countryCode.toUpperCase());
}

export function buildServiceabilityContext(input: {
  countryCode?: string | null;
  region?: string | null;
  source: Exclude<ServiceableSource, 'unknown'>;
}): RegionContext {
  const countryCode = input.countryCode?.trim().toUpperCase();
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) return UNKNOWN_REGION;

  return {
    country_code: countryCode,
    region: input.region || undefined,
    is_serviceable_region: isServiceableCountry(countryCode),
    serviceable_source: input.source,
  };
}

/** True only for a known location outside the service area. Unknown is never out of area. */
export function isOutOfServiceArea(context: RegionContext): boolean {
  return context.serviceable_source !== 'unknown' && context.is_serviceable_region === false;
}

let currentContext: RegionContext = UNKNOWN_REGION;
const listeners = new Set<() => void>();

/** The latest answer. `unknown` until something has resolved it. */
export function getServiceabilityContext(): RegionContext {
  return currentContext;
}

export function setServiceabilityContext(context: RegionContext): void {
  if (context === currentContext) return;
  currentContext = context;
  listeners.forEach(listener => listener());
}

export function subscribeServiceability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function __resetServiceabilityContextForTests(): void {
  currentContext = UNKNOWN_REGION;
  listeners.clear();
}

const STREET_SUFFIX_RE = /\b(street|road|avenue|boulevard|lane|drive|court|highway)\b/i;

/**
 * Coarsens a free-text location string (e.g. profile.location or a bounty's
 * draft address) down to a "City, State"-shaped analytics value, mirroring
 * `public.coarse_analytics_region` in
 * supabase/migrations/20260808000000_add_posthog_person_property_sync.sql —
 * keep the two in sync. Anything that looks like it still contains a street
 * address is rejected rather than guessed at (analytics, not geocoding).
 */
export function coarseRegionFromLocationText(location?: string | null): string | undefined {
  const trimmed = location?.trim();
  if (!trimmed) return undefined;

  const parts = trimmed.split(/\s*,\s*/).filter(Boolean);
  const count = parts.length;
  const hasDigit = /\d/.test(trimmed);

  if (count >= 3) return `${parts[count - 2]}, ${parts[count - 1]}`;
  if (count === 2 && !hasDigit && !STREET_SUFFIX_RE.test(parts[0])) {
    return `${parts[0]}, ${parts[1]}`;
  }
  if (count === 1 && !hasDigit) return trimmed;

  return undefined;
}
