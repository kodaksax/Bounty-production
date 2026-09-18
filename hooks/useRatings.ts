import { useEffect, useState } from 'react';
import type { UserRating } from 'lib/types';
import { ratingsService } from 'lib/services/ratings';

export interface RatingStats {
  averageRating: number;
  ratingCount: number;
}

export interface UseRatingsOptions {
  /** Max individual ratings to fetch for the `ratings` list. Default 10 -- this is a
   * capped surface (e.g. a profile's "recent reviews"), not a full history/pagination API. */
  limit?: number;
  /** Fetch the individual `ratings` list at all. Default true -- set false for callers
   * that only read `stats` (e.g. an average-rating badge), so they don't pay for rows
   * they never render. */
  includeRatings?: boolean;
  /** Fetch aggregated `stats` (average/count) at all. Default true -- set false for
   * callers that only read `ratings` (e.g. a reviews list), since getAggregatedStats
   * scans every rating row for the user and is wasted work if the average is never shown. */
  includeStats?: boolean;
}

export function useRatings(userId: string | undefined, options?: UseRatingsOptions) {
  const limit = options?.limit ?? 10;
  const includeRatings = options?.includeRatings ?? true;
  const includeStats = options?.includeStats ?? true;

  const [ratings, setRatings] = useState<UserRating[]>([]);
  const [stats, setStats] = useState<RatingStats>({ averageRating: 0, ratingCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRatings = async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [ratingsData, statsData] = await Promise.all([
        includeRatings ? ratingsService.getByUserId(userId, { limit }) : Promise.resolve([]),
        includeStats
          ? ratingsService.getAggregatedStats(userId)
          : Promise.resolve({ averageRating: 0, ratingCount: 0 }),
      ]);

      setRatings(ratingsData);
      setStats(statsData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch ratings';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRatings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, limit, includeRatings, includeStats]);

  return {
    ratings,
    stats,
    loading,
    error,
    refresh: fetchRatings,
  };
}
