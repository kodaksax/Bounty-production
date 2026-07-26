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
