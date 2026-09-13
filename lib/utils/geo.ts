import type { LocationCoordinates } from '../types';

// Matches a bounty/profile `location` string that happens to be stored as
// "lat, lng" (e.g. the onboarding location fallback when reverse geocoding
// fails). Real posted bounties almost always store a human-readable address
// instead, so callers must treat a null result as "unknown", not "far away".
const COORD_PATTERN = /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/;

/**
 * Parses a "lat, lng" formatted location string into coordinates, or null if
 * the string is a human-readable address (or empty/invalid).
 */
export function parseCoordsFromLocation(location: string | null | undefined): LocationCoordinates | null {
  if (!location) return null;
  const match = location.match(COORD_PATTERN);
  if (!match) return null;
  const latitude = parseFloat(match[1]);
  const longitude = parseFloat(match[2]);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  return { latitude, longitude };
}

const US_ZIP_PATTERN = /^\d{5}$/;

/** Validates a 5-digit US ZIP code — the format expected before geocoding it. */
export function isValidUsZip(zip: string): boolean {
  return US_ZIP_PATTERN.test(zip.trim());
}

const ZIP_TOKEN_PATTERN = /\b\d{5}\b/g;

/**
 * Pulls a 5-digit ZIP out of free-text like "5018 Painters Mill Road, Owings
 * Mills, MD 21117" or a reverse-geocoded "<street>, <city>, <region>, <zip>"
 * string. Takes the LAST standalone 5-digit token rather than the first, since
 * a US street number (e.g. "5018") comes before the ZIP, not after it. Returns
 * null for text with no such token (e.g. "Bmore", "DMV", a bare city name) —
 * callers should fall back to another source rather than guess.
 */
export function extractZipFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const matches = text.match(ZIP_TOKEN_PATTERN);
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
}
