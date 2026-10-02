/**
 * Public (pre-acceptance) location presentation.
 *
 * The database is the real boundary: since
 * 20261001160000_bounty_location_privacy.sql, `bounties.location` only ever
 * holds a "City, ST" label and the exact address lives in
 * bounty_private_locations, readable through get_bounty_exact_location()
 * (poster, or the accepted hunter while the job is active).
 *
 * These helpers mirror the SQL label functions so the UI stays safe for rows
 * that didn't come from the scrubbed column — cached feed data from before the
 * migration, realtime payloads, drafts — and so every surface formats the
 * public location the same way. Both implementations are checked against
 * __tests__/fixtures/public-location-label-cases.json.
 */

const COUNTRY = /^(usa|us|u\.s\.a?\.?|united states( of america)?)$/i;
const UNIT_WORD = /\b(apt|apartment|suite|ste|unit|floor|bldg|building|room|po box|p\.o\. box|lot|trlr|trailer)\b/i;
const STREET_SUFFIX =
  /\S\s+(st|street|rd|road|ave|av|avenue|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|ter|terrace|cir|circle|trl|trail|aly|alley|expy|expressway|tpke|turnpike|pike)\.?$/i;

function normalize(part: string): string {
  return part
    .trim()
    .replace(/\s*[0-9]{5}(-[0-9]{4})?$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mirrors public.fn_location_component_is_public. */
export function isPublicLocationComponent(component: string | null | undefined): boolean {
  const c = component ?? '';
  return (
    c !== '' &&
    !/[0-9#]/.test(c) &&
    !COUNTRY.test(c) &&
    !UNIT_WORD.test(c) &&
    !STREET_SUFFIX.test(c)
  );
}

/**
 * Mirrors public.fn_public_location_label:
 * "1234 Painters Mill Road, Owings Mills, MD 21117, USA" -> "Owings Mills, MD".
 */
export function publicLocationLabel(raw: string | null | undefined): string | null {
  const kept = (raw ?? '')
    .split(',')
    .map(normalize)
    .filter(isPublicLocationComponent);
  const label = kept.slice(-2).join(', ');
  return label === '' ? null : label;
}

/** Mirrors public.fn_public_neighborhood: a single public component or null. */
export function publicNeighborhood(raw: string | null | undefined): string | null {
  if (raw == null || raw.includes(',')) return null;
  const n = raw.replace(/\s+/g, ' ').trim();
  return isPublicLocationComponent(n) ? n : null;
}

export interface PublicLocationSource {
  neighborhood?: string | null;
  location?: string | null;
}

/**
 * The one string any non-participant sees for a bounty's location:
 * "Fells Point · Baltimore, MD", "Baltimore, MD", "Fells Point", or null.
 * Never returns a street, house number, unit or coordinates.
 */
export function formatPublicLocation(source: PublicLocationSource | null | undefined): string | null {
  if (!source) return null;
  const neighborhood = publicNeighborhood(source.neighborhood);
  const label = publicLocationLabel(source.location);
  if (neighborhood && label) {
    return label.toLowerCase().startsWith(neighborhood.toLowerCase()) ? label : `${neighborhood} · ${label}`;
  }
  return neighborhood || label || null;
}
