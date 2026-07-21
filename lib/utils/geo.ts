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
