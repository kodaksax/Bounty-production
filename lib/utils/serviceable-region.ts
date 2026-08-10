import { getDeviceLocale } from '../utils';

const SERVICEABLE_COUNTRY_CODES = new Set(['US']);

type RegionContext = {
  country_code?: string;
  region?: string;
  is_serviceable_region?: boolean;
};

export function isServiceableCountry(countryCode?: string): boolean {
  if (!countryCode) return false;
  return SERVICEABLE_COUNTRY_CODES.has(countryCode.toUpperCase());
}

export function getDeviceServiceabilityContext(): RegionContext {
  const locale = getDeviceLocale();
  const countryCode = extractCountryCodeFromLocale(locale);

  return {
    country_code: countryCode,
    region: locale,
    is_serviceable_region: countryCode ? isServiceableCountry(countryCode) : undefined,
  };
}

export function buildServiceabilityContext(input: {
  countryCode?: string;
  region?: string;
}): RegionContext {
  const normalizedCountryCode = input.countryCode?.trim().toUpperCase();

  return {
    country_code: normalizedCountryCode,
    region: input.region,
    is_serviceable_region: normalizedCountryCode
      ? isServiceableCountry(normalizedCountryCode)
      : undefined,
  };
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

function extractCountryCodeFromLocale(locale: string): string | undefined {
  const normalized = locale.replace('_', '-');
  const parts = normalized
    .split('-')
    .map(part => part.trim())
    .filter(Boolean);
  const candidate = parts.length > 1 ? parts[parts.length - 1] : undefined;

  if (!candidate) return undefined;
  if (/^[a-zA-Z]{2}$/.test(candidate)) return candidate.toUpperCase();

  return undefined;
}
