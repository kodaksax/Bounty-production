import { useEffect, useState } from 'react';
import type { UserRating } from 'lib/types';
import { ratingsService } from 'lib/services/ratings';

export interface RatingStats {
  averageRating: number;
  ratingCount: number;
}

export function useRatings(userId: string | undefined) {
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
        ratingsService.getByUserId(userId, { limit: 10 }),
        ratingsService.getAggregatedStats(userId),
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
  }, [userId]);

  return {
    ratings,
    stats,
    loading,
    error,
    refresh: fetchRatings,
  };
}
