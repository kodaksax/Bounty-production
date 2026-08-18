import { supabase } from '../supabase';
import { logger } from '../utils/error-logger';

export interface ExactBountyLocation {
  location: string;
  latitude: number;
  longitude: number;
  unit: string | null;
}

export interface NearbyBounty {
  id: string;
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  category: string | null;
  status: string;
  neighborhood: string | null;
  approx_latitude: number | null;
  approx_longitude: number | null;
  poster_id: string;
  username: string | null;
  avatar: string | null;
  created_at: string;
  deadline: string | null;
  distance_miles: number | null;
}

/**
 * Fetches a bounty's exact address/coordinates/unit via the
 * get_bounty_exact_location() RPC, which is scoped server-side to the
 * bounty's poster or its accepted hunter. Returns null for anyone else
 * (including other users browsing the open feed) — that is expected, not
 * an error, so callers should treat null as "not revealed yet," not fail.
 */
export async function getBountyExactLocation(bountyId: string): Promise<ExactBountyLocation | null> {
  try {
    const { data, error } = await supabase.rpc('get_bounty_exact_location', { p_bounty_id: bountyId });
    if (error) {
      logger.error('get_bounty_exact_location rpc error', { error, bountyId });
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.latitude == null || row.longitude == null) return null;
    return row as ExactBountyLocation;
  } catch (error) {
    logger.error('get_bounty_exact_location threw', { error, bountyId });
    return null;
  }
}

/**
 * Radius search/sort over open bounties via search_bounties_nearby(). Returns
 * only coarse/safe fields — never the exact address, coordinates, or unit.
 * p_radius_miles = undefined/null means "Anywhere" (no distance constraint).
 */
export async function searchBountiesNearby(params: {
  latitude?: number;
  longitude?: number;
  radiusMiles?: number | null;
  category?: string | null;
  limit?: number;
  offset?: number;
}): Promise<NearbyBounty[]> {
  try {
    const { data, error } = await supabase.rpc('search_bounties_nearby', {
      p_lat: params.latitude ?? null,
      p_lng: params.longitude ?? null,
      p_radius_miles: params.radiusMiles ?? null,
      p_category: params.category ?? null,
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    });
    if (error) {
      logger.error('search_bounties_nearby rpc error', { error, params });
      return [];
    }
    return Array.isArray(data) ? (data as NearbyBounty[]) : [];
  } catch (error) {
    logger.error('search_bounties_nearby threw', { error, params });
    return [];
  }
}

/**
 * Radius, in miles, behind the feed's "N active hunters in your area" pill.
 * The RPC clamps to 5-100 regardless of what is sent, so changing this alone
 * cannot widen the window past the server's ceiling.
 */
export const ACTIVE_HUNTERS_RADIUS_MILES = 30;

/**
 * How many recently-active users are within ACTIVE_HUNTERS_RADIUS_MILES of a
 * point, excluding the caller.
 *
 * Returns a count and never any rows — the underlying function is definer-only
 * precisely so this can be answered without exposing anyone's coordinates.
 * Resolves to null (not 0) when the count cannot be determined, so the caller
 * can hide the pill instead of claiming an empty area.
 */
export async function countActiveHuntersNearby(params: {
  latitude: number;
  longitude: number;
  radiusMiles?: number;
  activeWithinDays?: number;
}): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('fn_count_active_hunters_nearby', {
      p_lat: params.latitude,
      p_lng: params.longitude,
      p_radius_miles: params.radiusMiles ?? ACTIVE_HUNTERS_RADIUS_MILES,
      p_active_within: `${params.activeWithinDays ?? 7} days`,
    });
    if (error) {
      logger.error('fn_count_active_hunters_nearby rpc error', { error, params });
      return null;
    }
    return typeof data === 'number' ? data : null;
  } catch (error) {
    logger.error('fn_count_active_hunters_nearby threw', { error, params });
    return null;
  }
}

/**
 * Persists the signed-in user's coordinates so they can be counted by other
 * people's nearby queries.
 *
 * This exists because nothing else in the app writes profiles.latitude /
 * longitude — all 249 production rows are NULL, which is why geom is NULL for
 * every row and why any radius feature reads zero until coordinates start
 * landing. Callers must only invoke this when location permission is granted.
 *
 * latitude/longitude are not in the protected-column set enforced by
 * prevent_client_writes_to_protected_profile_columns, so an own-row update is
 * allowed; geom is then derived by fn_profiles_sync_geom. Coordinates are not
 * exposed by public_profiles, so storing them does not make them readable by
 * other users — only the aggregate count is.
 */
export async function updateMyCoordinates(params: {
  userId: string;
  latitude: number;
  longitude: number;
}): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ latitude: params.latitude, longitude: params.longitude })
      .eq('id', params.userId);
    if (error) {
      logger.error('updateMyCoordinates failed', { error, userId: params.userId });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('updateMyCoordinates threw', { error, userId: params.userId });
    return false;
  }
}
