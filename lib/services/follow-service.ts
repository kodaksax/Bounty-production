import type { Follow } from '../types';

// In-memory storage
let follows: Follow[] = [];

// Seed data
const seedFollows: Follow[] = [
  {
    id: 'f1',
    followerId: 'current-user',
    followingId: 'user-1',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'f2',
    followerId: 'current-user',
    followingId: 'user-2',
    createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'f3',
    followerId: 'user-1',
    followingId: 'current-user',
    createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// Initialize with seed data
const initializeData = () => {
  if (follows.length === 0) {
    follows = [...seedFollows];
  }
};

export const followService = {
  /**
   * Check if user is following another user
   */
  isFollowing: async (followerId: string, followingId: string): Promise<boolean> => {
    initializeData();
    return follows.some(f => f.followerId === followerId && f.followingId === followingId);
  },

  /**
   * Follow a user (optimistic update)
   */
  follow: async (followerId: string, followingId: string): Promise<{ success: boolean; error?: string }> => {
    initializeData();

    // Check if already following
    const existing = follows.find(f => f.followerId === followerId && f.followingId === followingId);
    if (existing) {
      return { success: false, error: 'Already following' };
    }

    const follow: Follow = {
      id: `f${Date.now()}`,
      followerId,
      followingId,
      createdAt: new Date().toISOString(),
    };

    follows.push(follow);

    // Simulate 5% failure rate for testing
    const shouldFail = Math.random() < 0.05;
    if (shouldFail) {
      // Rollback
      setTimeout(() => {
        follows = follows.filter(f => f.id !== follow.id);
      }, 500);
      return { success: false, error: 'Network error' };
    }

    return { success: true };
  },

  /**
   * Unfollow a user (optimistic update)
   */
  unfollow: async (followerId: string, followingId: string): Promise<{ success: boolean; error?: string }> => {
    initializeData();

    const existing = follows.find(f => f.followerId === followerId && f.followingId === followingId);
    if (!existing) {
      return { success: false, error: 'Not following' };
    }

    // Remove from array
    follows = follows.filter(f => !(f.followerId === followerId && f.followingId === followingId));

    // Simulate 5% failure rate for testing
    const shouldFail = Math.random() < 0.05;
    if (shouldFail) {
      // Rollback
      setTimeout(() => {
        follows.push(existing);
      }, 500);
      return { success: false, error: 'Network error' };
    }

    return { success: true };
  },

  /**
   * Get followers for a user
   */
  getFollowers: async (userId: string): Promise<Follow[]> => {
    initializeData();
    return follows.filter(f => f.followingId === userId);
  },

  /**
   * Get users that a user is following
   */
  getFollowing: async (userId: string): Promise<Follow[]> => {
    initializeData();
    return follows.filter(f => f.followerId === userId);
  },

  /**
   * Get follower count
   */
  getFollowerCount: async (userId: string): Promise<number> => {
    const followers = await followService.getFollowers(userId);
    return followers.length;
  },

  /**
   * Get following count
   */
  getFollowingCount: async (userId: string): Promise<number> => {
    const following = await followService.getFollowing(userId);
    return following.length;
  },
};
