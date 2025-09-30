import { useEffect, useState } from 'react';
import { followService } from '../lib/services/follow-service';

interface UseFollowResult {
  isFollowing: boolean;
  loading: boolean;
  error: string | null;
  followerCount: number;
  followingCount: number;
  toggleFollow: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useFollow(userId: string, currentUserId: string = 'current-user'): UseFollowResult {
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  const fetchFollowStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [following, followers, following_] = await Promise.all([
        followService.isFollowing(currentUserId, userId),
        followService.getFollowerCount(userId),
        followService.getFollowingCount(userId),
      ]);
      
      setIsFollowing(following);
      setFollowerCount(followers);
      setFollowingCount(following_);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load follow status');
    } finally {
      setLoading(false);
    }
  };

  const toggleFollow = async () => {
    const previousFollowing = isFollowing;
    const previousFollowerCount = followerCount;

    try {
      setError(null);
      
      // Optimistic update
      setIsFollowing(!isFollowing);
      setFollowerCount(prev => isFollowing ? prev - 1 : prev + 1);

      const result = isFollowing
        ? await followService.unfollow(currentUserId, userId)
        : await followService.follow(currentUserId, userId);

      if (!result.success) {
        // Rollback on failure
        setIsFollowing(previousFollowing);
        setFollowerCount(previousFollowerCount);
        setError(result.error || 'Operation failed');
      }
    } catch (err) {
      // Rollback on error
      setIsFollowing(previousFollowing);
      setFollowerCount(previousFollowerCount);
      setError(err instanceof Error ? err.message : 'Failed to update follow status');
    }
  };

  const refresh = async () => {
    await fetchFollowStatus();
  };

  useEffect(() => {
    fetchFollowStatus();
  }, [userId, currentUserId]);

  return {
    isFollowing,
    loading,
    error,
    followerCount,
    followingCount,
    toggleFollow,
    refresh,
  };
}
