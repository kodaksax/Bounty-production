import { useEffect, useRef, useState } from 'react';
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
  const mountedRef = useRef(true);
  const togglingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchFollowStatus = async () => {
    try {
      setLoading(true);
      setError(null);

      const [following, followers, following_] = await Promise.all([
        followService.isFollowing(currentUserId, userId),
        followService.getFollowerCount(userId),
        followService.getFollowingCount(userId),
      ]);

      if (!mountedRef.current) return;
      setIsFollowing(following);
      setFollowerCount(followers);
      setFollowingCount(following_);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load follow status');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const toggleFollow = async () => {
    // Guards against a rapid double-tap firing two concurrent toggles: without
    // this, both requests race the backend and whichever resolves last wins,
    // leaving isFollowing/followerCount out of sync with the server with no
    // reconciliation.
    if (togglingRef.current) return;
    togglingRef.current = true;

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

      if (!mountedRef.current) return;

      if (!result.success) {
        // Rollback on failure
        setIsFollowing(previousFollowing);
        setFollowerCount(previousFollowerCount);
        setError(result.error || 'Operation failed');
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // Rollback on error
      setIsFollowing(previousFollowing);
      setFollowerCount(previousFollowerCount);
      setError(err instanceof Error ? err.message : 'Failed to update follow status');
    } finally {
      togglingRef.current = false;
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
