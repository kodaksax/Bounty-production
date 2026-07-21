/**
 * Ranking logic for the hunter onboarding "nearby bounties" discovery step
 * (components/onboarding/HunterLocationPrompt.tsx + HunterSampleBountyScreen.tsx).
 *
 * Bounties only carry a free-text `location` string today (no lat/lng
 * columns), so a real distance can only be computed for the rare bounty whose
 * location happens to be stored as "lat, lng" (see lib/utils/geo.ts). Rather
 * than inventing a fake distance for everything else, unmeasurable bounties
 * are kept (sorted by recency) instead of dropped — previewBounties.ts already
 * falls back to showing the bounty's raw location text when `distance` is
 * unset, so this never displays a fabricated number.
 */
import type { Bounty } from '../services/database.types';
import { locationService } from '../services/location-service';
import type { LocationCoordinates } from '../types';
import { parseCoordsFromLocation } from '../utils/geo';

/** Default search radius for the hunter onboarding "nearby" discovery step. */
export const NEARBY_SEARCH_RADIUS_MILES = 25;

/** Bounties reserved for in-person/local work — a missing work_type defaults to local, matching bounty creation's default. */
export function isLocalBounty(bounty: Bounty): boolean {
  return bounty.work_type !== 'online';
}

/** Attaches a real computed `distance` (miles) when the bounty's location is parseable coordinates; otherwise returns the bounty unchanged. */
export function withComputedDistance(bounty: Bounty, userCoords: LocationCoordinates | null): Bounty {
  if (!userCoords) return bounty;
  const bountyCoords = parseCoordsFromLocation(bounty.location);
  if (!bountyCoords) return bounty;
  const distance = locationService.calculateDistance(userCoords, bountyCoords, 'miles');
  return { ...bounty, distance };
}

/**
 * Ranks local (in-person) bounties for the hunter discovery step: bounties
 * within the search radius sorted nearest-first, then bounties whose distance
 * couldn't be measured, sorted most-recent-first.
 */
export function rankNearbyBounties(
  bounties: Bounty[],
  userCoords: LocationCoordinates | null,
  radiusMiles: number = NEARBY_SEARCH_RADIUS_MILES
): Bounty[] {
  const candidates = bounties
    .filter(isLocalBounty)
    .map((bounty) => withComputedDistance(bounty, userCoords))
    .filter((bounty) => bounty.distance == null || bounty.distance <= radiusMiles);

  const measured = candidates.filter((bounty) => typeof bounty.distance === 'number');
  const unmeasured = candidates.filter((bounty) => typeof bounty.distance !== 'number');

  measured.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  unmeasured.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return [...measured, ...unmeasured];
}
