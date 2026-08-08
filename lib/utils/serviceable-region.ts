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
