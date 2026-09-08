import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from 'lib/utils/error-logger';

export interface ProfileActivityStats {
  bountiesPosted: number;
  bountiesCompleted: number;
  firstBountyPostedAt: string | null;
}

const EMPTY_STATS: ProfileActivityStats = {
  bountiesPosted: 0,
  bountiesCompleted: 0,
  firstBountyPostedAt: null,
};

// Simple once-per-key logger to avoid spamming console, mirroring
// lib/services/ratings.ts's logOnce pattern.
const emitted: Record<string, boolean> = {};
function logOnce(key: string, message: string, meta?: any) {
  if (emitted[key]) return;
  emitted[key] = true;
  if (typeof (logger as any).warning === 'function') {
    (logger as any).warning(message, meta);
  } else {
    logger.error(message, meta);
  }
}

export const profileStatsService = {
  /**
   * Fetches a user's marketplace activity stats via get_profile_activity_stats
   * (see supabase/migrations/20260905000000_profile_overhaul_banner_and_stats.sql).
   * Never throws — a stats-fetch hiccup must never block profile rendering, so
   * this returns safe zeroed defaults on any failure, same as
   * ratingsService.getAggregatedStats.
   */
  async getActivityStats(userId: string): Promise<ProfileActivityStats> {
    if (!userId || !isSupabaseConfigured) {
      return EMPTY_STATS;
    }

    try {
      const { data, error } = await supabase
        .rpc('get_profile_activity_stats', { target_user_id: userId })
        .single();

      if (error) {
        logOnce('profileStats:getActivityStats', 'Error fetching profile activity stats', {
          userId,
          error,
        });
        return EMPTY_STATS;
      }

      if (!data) return EMPTY_STATS;

      return {
        bountiesPosted: Number((data as any).bounties_posted) || 0,
        bountiesCompleted: Number((data as any).bounties_completed) || 0,
        firstBountyPostedAt: (data as any).first_bounty_posted_at || null,
      };
    } catch (err) {
      logOnce('profileStats:getActivityStats', 'Error fetching profile activity stats', {
        userId,
        error: err,
      });
      return EMPTY_STATS;
    }
  },
};
