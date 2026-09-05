import { useEffect, useState } from 'react';
import { profileStatsService, type ProfileActivityStats } from 'lib/services/profile-stats-service';

const EMPTY_STATS: ProfileActivityStats = {
  bountiesPosted: 0,
  bountiesCompleted: 0,
  firstBountyPostedAt: null,
};

/**
 * Marketplace activity stats (bounties posted/completed) for a profile —
 * own or another user's. Replaces the three previously-duplicated
 * stats-fetching useEffects in app/profile/[userId].tsx and
 * app/tabs/profile-screen.tsx, and fixes the "Jobs Completed" stat, which
 * was hardcoded to 0 in one screen and silently wrong (showed accepted, not
 * completed, jobs) in the other.
 */
export function useProfileActivityStats(userId: string | undefined) {
  const [stats, setStats] = useState<ProfileActivityStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    if (!userId) {
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await profileStatsService.getActivityStats(userId);
    setStats(result);
    setLoading(false);
  };

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { stats, loading, refresh: fetchStats };
}
