import type { UserRating } from "lib/types";
import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from "lib/utils/error-logger";
import { getReachableApiBaseUrl } from 'lib/utils/network';

// API Configuration
function getApiBaseUrl() {
  const preferred = (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined)
    || (process.env.API_BASE_URL as string | undefined)
    || 'http://localhost:3001'
  const base = getReachableApiBaseUrl(preferred, 3001)
  return base
}

// Simple once-per-key logger to avoid spamming console
const emitted: Record<string, boolean> = {}
function logOnce(key: string, level: 'error' | 'warn', message: string, meta?: any) {
  if (emitted[key]) return
  emitted[key] = true
  if (level === 'error') {
    logger.error(message, meta)
  } else {
    if (typeof (logger as any).warning === 'function') {
      (logger as any).warning(message, meta)
    } else {
      logger.error(message, meta)
    }
  }
}

export const ratingsService = {
  /**
   * Create a new rating
   */
  async create(rating: Omit<UserRating, "id" | "createdAt">): Promise<UserRating | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('user_ratings')
          .insert({
            user_id: rating.user_id,
            rater_id: rating.rater_id,
            bounty_id: rating.bountyId,
            score: rating.score,
            comment: rating.comment,
          })
          .select('*')
          .single()

        if (error) throw error
        return this.mapFromDb(data)
      }

      const API_URL = `${getApiBaseUrl()}/api/ratings`
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(rating),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create rating: ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logOnce('ratings:create', 'error', 'Error creating rating', { rating, error })
      throw error
    }
  },

  /**
   * Get ratings for a user (as ratee)
   */
  async getByUserId(userId: string, options?: { limit?: number; offset?: number }): Promise<UserRating[]> {
    try {
      if (isSupabaseConfigured) {
        let query = supabase
          .from('user_ratings')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })

        const limit = options?.limit ?? 20
        const offset = options?.offset ?? 0
        query = query.range(offset, offset + limit - 1)

        const { data, error } = await query
        if (error) throw error
        return (data || []).map(this.mapFromDb)
      }

      const API_URL = `${getApiBaseUrl()}/api/ratings`
      const params = new URLSearchParams()
      params.append('user_id', userId)
      if (options?.limit) params.append('limit', String(options.limit))
      if (options?.offset) params.append('offset', String(options.offset))

      const response = await fetch(`${API_URL}?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch ratings: ${response.statusText}`)
      }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logOnce('ratings:getByUserId', 'error', 'Error fetching ratings', { userId, error })
      return []
    }
  },

  /**
   * Get aggregated rating stats for a user
   */
  async getAggregatedStats(userId: string): Promise<{ averageRating: number; ratingCount: number }> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .rpc('get_user_rating_stats', { target_user_id: userId })

        if (error) throw error
        if (data && typeof data === 'object' && 'average_rating' in data && 'rating_count' in data) {
          return {
            averageRating: Number(data.average_rating) || 0,
            ratingCount: Number(data.rating_count) || 0,
          }
        }
      }

      // Fallback: fetch all ratings and compute locally
      const ratings = await this.getByUserId(userId, { limit: 1000 })
      if (ratings.length === 0) {
        return { averageRating: 0, ratingCount: 0 }
      }

      const sum = ratings.reduce((acc, r) => acc + r.score, 0)
      return {
        averageRating: sum / ratings.length,
        ratingCount: ratings.length,
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logOnce('ratings:getAggregatedStats', 'error', 'Error getting aggregated stats', { userId, error })
      return { averageRating: 0, ratingCount: 0 }
    }
  },

  /**
   * Check if a rating exists for a bounty and user pair
   */
  async hasRated(raterId: string, bountyId: string, userId: string): Promise<boolean> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('user_ratings')
          .select('id')
          .eq('rater_id', raterId)
          .eq('bounty_id', bountyId)
          .eq('user_id', userId)
          .single()

        if (error && error.code !== 'PGRST116') throw error // PGRST116 = not found
        return !!data
      }

      const API_URL = `${getApiBaseUrl()}/api/ratings/check`
      const params = new URLSearchParams()
      params.append('rater_id', raterId)
      params.append('bounty_id', bountyId)
      params.append('user_id', userId)

      const response = await fetch(`${API_URL}?${params.toString()}`)
      if (!response.ok) return false
      const json = await response.json()
      return json.exists === true
    } catch (err) {
      logOnce('ratings:hasRated', 'error', 'Error checking if rated', { raterId, bountyId, userId })
      return false
    }
  },

  /**
   * Map database record to domain type
   */
  mapFromDb(record: any): UserRating {
    return {
      id: record.id,
      user_id: record.user_id,
      rater_id: record.rater_id,
      bountyId: record.bounty_id,
      score: record.score,
      comment: record.comment,
      createdAt: record.created_at,
    }
  },
}
