import { isSupabaseConfigured, supabase } from 'lib/supabase';
import type { MyRatingStatus, UserRating } from 'lib/types';
import { logger } from 'lib/utils/error-logger';
import { getReachableApiBaseUrl } from 'lib/utils/network';

// Ratings are reputation only when they trace back to a completed transaction
// (supabase/migrations/20261002160000_rating_reputation_integrity.sql). Reads
// go through the server functions that apply that rule -- get_user_reviews for
// the list, get_profile_activity_stats for the average -- so a count and the
// reviews behind it always agree. There is no second ratings store.

// API Configuration
function getApiBaseUrl() {
  const preferred =
    (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined) ||
    (process.env.API_BASE_URL as string | undefined) ||
    'http://localhost:3001';
  const base = getReachableApiBaseUrl(preferred, 3001);
  return base;
}

// Simple once-per-key logger to avoid spamming console
const emitted: Record<string, boolean> = {};
function logOnce(key: string, level: 'error' | 'warn', message: string, meta?: any) {
  if (emitted[key]) return;
  emitted[key] = true;
  if (level === 'error') {
    logger.error(message, meta);
  } else {
    if (typeof (logger as any).warning === 'function') {
      (logger as any).warning(message, meta);
    } else {
      logger.error(message, meta);
    }
  }
}

// PostgREST "function not found": the RPC isn't deployed to this environment yet.
const isMissingFunction = (error: any) => error?.code === 'PGRST202' || error?.code === '42883';

export const ratingsService = {
  /**
   * Create a new rating. The server verifies the transaction and rejects
   * anything else; there is no fallback table.
   */
  async create(rating: Omit<UserRating, 'id' | 'createdAt'>): Promise<UserRating | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('ratings')
          .insert({
            to_user_id: rating.user_id,
            from_user_id: rating.rater_id,
            bounty_id: rating.bountyId,
            rating: rating.score,
            comment: rating.comment,
          })
          .select('*')
          .single();

        if (error) throw error;
        return this.mapFromRatingsDb(data);
      }

      const API_URL = `${getApiBaseUrl()}/api/ratings`;
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rating),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create rating: ${errorText}`);
      }

      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logOnce('ratings:create', 'error', 'Error creating rating', { rating, error });
      throw error;
    }
  },

  /**
   * Reviews received by a user that count as reputation, newest first, each
   * with the transaction it came from. Star-only ratings are included.
   */
  async getByUserId(
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<UserRating[]> {
    try {
      if (isSupabaseConfigured) {
        const limit = options?.limit ?? 20;
        const offset = options?.offset ?? 0;

        const { data, error } = await supabase.rpc('get_user_reviews', {
          p_user_id: userId,
          p_limit: limit,
          p_offset: offset,
        });
        if (!error) return ((data as any[]) || []).map((row) => this.mapFromReviewRpc(row, userId));
        if (!isMissingFunction(error)) throw error;

        // Environment without get_user_reviews yet: the raw table (RLS-filtered
        // once the migration lands), without transaction context.
        const { data: rows, error: rowsError } = await supabase
          .from('ratings')
          .select('*')
          .eq('to_user_id', userId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);
        if (rowsError) throw rowsError;
        return (rows || []).map(this.mapFromRatingsDb);
      }

      const API_URL = `${getApiBaseUrl()}/api/ratings`;
      const params = new URLSearchParams();
      params.append('user_id', userId);
      if (options?.limit) params.append('limit', String(options.limit));
      if (options?.offset) params.append('offset', String(options.offset));

      const response = await fetch(`${API_URL}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch ratings: ${response.statusText}`);
      }
      return await response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      // Log as a warning to avoid surfacing as a fatal error in dev overlays
      logOnce('ratings:getByUserId', 'warn', 'Error fetching ratings', { userId, error });
      return [];
    }
  },

  /**
   * Average and count of the ratings a user received that count as
   * reputation -- the same figures as get_profile_activity_stats.
   */
  async getAggregatedStats(
    userId: string
  ): Promise<{ averageRating: number; ratingCount: number }> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .rpc('get_profile_activity_stats', { target_user_id: userId })
          .single();
        if (error) throw error;
        const row = (data || {}) as { rating_avg?: number | string | null; rating_count?: number | null };
        const ratingCount = Number(row.rating_count) || 0;
        return {
          averageRating: ratingCount > 0 && row.rating_avg != null ? Number(row.rating_avg) : 0,
          ratingCount,
        };
      }

      // Fallback: fetch all ratings and compute locally
      const ratings = await this.getByUserId(userId, { limit: 1000 });
      if (ratings.length === 0) {
        return { averageRating: 0, ratingCount: 0 };
      }

      const sum = ratings.reduce((acc, r) => acc + r.score, 0);
      return {
        averageRating: sum / ratings.length,
        ratingCount: ratings.length,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      // Non-fatal: surface as a warning instead of error to reduce dev overlay noise
      logOnce('ratings:getAggregatedStats', 'warn', 'Error getting aggregated stats', {
        userId,
        error,
      });
      return { averageRating: 0, ratingCount: 0 };
    }
  },

  /**
   * Check if a rating exists for a bounty and user pair
   */
  async hasRated(raterId: string, bountyId: string, userId: string): Promise<boolean> {
    try {
      if (isSupabaseConfigured) {
        // A rater can always read their own ratings (ratings_select_reputation).
        const { data, error } = await supabase
          .from('ratings')
          .select('id')
          .eq('from_user_id', raterId)
          .eq('bounty_id', bountyId)
          .eq('to_user_id', userId)
          .maybeSingle();

        if (error) throw error;
        return !!data;
      }

      const API_URL = `${getApiBaseUrl()}/api/ratings/check`;
      const params = new URLSearchParams();
      params.append('rater_id', raterId);
      params.append('bounty_id', bountyId);
      params.append('user_id', userId);

      const response = await fetch(`${API_URL}?${params.toString()}`);
      if (!response.ok) return false;
      const json = await response.json();
      return json.exists === true;
    } catch (err) {
      logOnce('ratings:hasRated', 'error', 'Error checking if rated', {
        raterId,
        bountyId,
        userId,
      });
      return false;
    }
  },

  /**
   * The signed-in user's side of one bounty's rating: who they would rate,
   * whether the transaction is complete enough to rate, and whether they
   * already did. Null when they are not a party (or on any failure -- the
   * rating prompt is optional and must never block a screen).
   */
  async getMyRatingStatus(bountyId: string): Promise<MyRatingStatus | null> {
    if (!bountyId || !isSupabaseConfigured) return null;
    try {
      const { data, error } = await supabase
        .rpc('get_my_rating_status', { p_bounty_id: bountyId })
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as any;
      return {
        raterRole: row.rater_role,
        rateeId: row.ratee_id,
        rateeName: row.ratee_username ?? null,
        eligible: !!row.eligible,
        alreadyRated: !!row.already_rated,
      };
    } catch (err) {
      logOnce('ratings:getMyRatingStatus', 'warn', 'Error getting rating status', { bountyId, error: err });
      return null;
    }
  },

  mapFromRatingsDb(record: any): UserRating {
    return {
      id: record.id,
      user_id: record.to_user_id,
      rater_id: record.from_user_id,
      bountyId: record.bounty_id,
      score: Number(record.rating) as UserRating['score'],
      comment: record.comment ?? undefined,
      createdAt: record.created_at,
      raterRole: record.rater_role ?? undefined,
    };
  },

  mapFromReviewRpc(record: any, rateeId: string): UserRating {
    return {
      id: record.id,
      user_id: rateeId,
      rater_id: record.rater_id,
      bountyId: record.bounty_id,
      score: Number(record.rating) as UserRating['score'],
      comment: record.comment ?? undefined,
      createdAt: record.created_at,
      raterRole: record.rater_role ?? undefined,
      raterName: record.rater_username ?? null,
      raterAvatar: record.rater_avatar ?? null,
      bountyTitle: record.bounty_title ?? null,
      bountyCompletedAt: record.bounty_completed_at ?? null,
      isForHonor: !!record.is_for_honor,
    };
  },
};
