/**
 * Distance from the viewer to a bounty, for the feed cards.
 *
 * Bounties only expose a public approximate point (approx_latitude /
 * approx_longitude: the exact address jittered 120-350 m once, see
 * 20261001160000_bounty_location_privacy). Good to a couple of tenths of a
 * mile, so the label never claims more precision than that and never goes
 * below "< 1 mi" — a precise short distance would help triangulate the
 * address.
 */
import type { LocationCoordinates } from '../types';
import { parseCoordsFromLocation } from './geo';

const EARTH_RADIUS_MI = 3958.8;

export interface BountyDistanceFields {
  work_type?: string | null;
  distance_miles?: number | null;
  approx_latitude?: number | null;
  approx_longitude?: number | null;
  location?: string | null;
}

function isCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function haversineMiles(from: LocationCoordinates, to: LocationCoordinates): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLon = rad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Miles from `viewer` to the bounty, or null when it can't be known (online
 * work, viewer location off, bounty has no point). Prefers the distance
 * search_bounties_nearby already computed server-side.
 */
export function bountyDistanceMiles(
  bounty: BountyDistanceFields,
  viewer: LocationCoordinates | null | undefined
): number | null {
  if (bounty.work_type === 'online') return null;
  if (isCoord(bounty.distance_miles)) return bounty.distance_miles;
  if (!viewer || !isCoord(viewer.latitude) || !isCoord(viewer.longitude)) return null;

  const point =
    isCoord(bounty.approx_latitude) && isCoord(bounty.approx_longitude)
      ? { latitude: bounty.approx_latitude, longitude: bounty.approx_longitude }
      : parseCoordsFromLocation(bounty.location);
  if (!point) return null;
  return haversineMiles(viewer, point);
}

/** "< 1 mi", "2.4 mi", "18 mi" — or null when the distance isn't known. */
export function formatDistanceMiles(miles: number | null | undefined): string | null {
  if (!isCoord(miles) || miles < 0) return null;
  if (miles < 1) return '< 1 mi';
  if (miles < 10) return `${(Math.round(miles * 10) / 10).toFixed(1)} mi`;
  return `${Math.round(miles).toLocaleString('en-US')} mi`;
}

/**
 * The card's "where" line for in-person work: distance first (what a hunter
 * scans for), then the public neighborhood label. Null when neither is known.
 */
export function formatBountyWhere(
  distance: number | null | undefined,
  location: string | null | undefined
): string | null {
  const parts = [formatDistanceMiles(distance), location?.trim() || null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}
