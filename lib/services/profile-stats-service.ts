import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from 'lib/utils/error-logger';

export interface ProfileActivityStats {
  /** Bounties this user has POSTED (any non-removed status: open/in_progress/completed). */
  bountiesPosted: number;
  /** Of the bounties this user POSTED, how many reached 'completed'. Poster-side, not a hunter stat. */
  bountiesCompleted: number;
  /** Bounties this user completed AS THE HUNTER (accepted_by = user AND status = 'completed'). This is "Jobs Completed". */
  hunterCompleted: number;
  firstBountyPostedAt: string | null;
  /** Average of ratings RECEIVED by this user, straight from the `ratings` table. Null with zero ratings -- see lib/utils/trust-summary.ts's MIN_RATING_SAMPLE before displaying it. */
  ratingAvg: number | null;
  /** Count of ratings RECEIVED by this user. */
  ratingCount: number;
}

const EMPTY_STATS: ProfileActivityStats = {
  bountiesPosted: 0,
  bountiesCompleted: 0,
  hunterCompleted: 0,
  firstBountyPostedAt: null,
  ratingAvg: null,
  ratingCount: 0,
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
        hunterCompleted: Number((data as any).hunter_completed) || 0,
        firstBountyPostedAt: (data as any).first_bounty_posted_at || null,
        ratingAvg: (data as any).rating_avg == null ? null : Number((data as any).rating_avg),
        ratingCount: Number((data as any).rating_count) || 0,
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
