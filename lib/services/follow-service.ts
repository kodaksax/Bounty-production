import { supabase } from '../supabase';
import type { Follow } from '../types';

/**
 * Real, Supabase-backed follow service against public.user_follows -- see
 * 20260726010000_add_user_follows_rls_and_notifications.sql (RLS + self-follow
 * CHECK constraint + notification trigger) and 20251001_baseline_schema.sql
 * (original table definition, which had RLS enabled but zero policies until
 * that migration).
 *
 * Replaces a previous in-memory mock that seeded fake data and injected a
 * random 5% failure rate. Public API is unchanged so hooks/useFollow.ts and
 * every other caller keep working without modification.
 */

interface UserFollowRow {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
}

function mapRow(row: UserFollowRow): Follow {
  return {
    id: row.id,
    followerId: row.follower_id,
    followingId: row.following_id,
    createdAt: row.created_at,
  };
}

export const followService = {
  /**
   * Check if user is following another user
   */
  isFollowing: async (followerId: string, followingId: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from('user_follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .maybeSingle();

    if (error) {
      console.error('[followService] isFollowing failed', error);
      return false;
    }
    return !!data;
  },

  /**
   * Follow a user
   */
  follow: async (followerId: string, followingId: string): Promise<{ success: boolean; error?: string }> => {
    if (followerId === followingId) {
      return { success: false, error: 'You cannot follow yourself.' };
    }

    const { error } = await supabase
      .from('user_follows')
      .insert({ follower_id: followerId, following_id: followingId });

    if (error) {
      // 23505 = unique_violation (already following), 23514 = check_violation
      // (user_follows_no_self_follow, though the guard above should catch
      // that case first).
      if (error.code === '23505') {
        return { success: false, error: 'You are already following this user.' };
      }
      if (error.code === '23514') {
        return { success: false, error: 'You cannot follow yourself.' };
      }
      console.error('[followService] follow failed', error);
      return { success: false, error: 'Something went wrong. Please try again.' };
    }

    return { success: true };
  },

  /**
   * Unfollow a user
   */
  unfollow: async (followerId: string, followingId: string): Promise<{ success: boolean; error?: string }> => {
    const { error } = await supabase
      .from('user_follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', followingId);

    if (error) {
      console.error('[followService] unfollow failed', error);
      return { success: false, error: 'Something went wrong. Please try again.' };
    }

    return { success: true };
  },

  /**
   * Get followers for a user
   */
  getFollowers: async (userId: string): Promise<Follow[]> => {
    const { data, error } = await supabase
      .from('user_follows')
      .select('*')
      .eq('following_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[followService] getFollowers failed', error);
      return [];
    }
    return (data ?? []).map(mapRow);
  },

  /**
   * Get users that a user is following
   */
  getFollowing: async (userId: string): Promise<Follow[]> => {
    const { data, error } = await supabase
      .from('user_follows')
      .select('*')
      .eq('follower_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[followService] getFollowing failed', error);
      return [];
    }
    return (data ?? []).map(mapRow);
  },

  /**
   * Get follower count
   */
  getFollowerCount: async (userId: string): Promise<number> => {
    const { count, error } = await supabase
      .from('user_follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', userId);

    if (error) {
      console.error('[followService] getFollowerCount failed', error);
      return 0;
    }
    return count ?? 0;
  },

  /**
   * Get following count
   */
  getFollowingCount: async (userId: string): Promise<number> => {
    const { count, error } = await supabase
      .from('user_follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId);

    if (error) {
      console.error('[followService] getFollowingCount failed', error);
      return 0;
    }
    return count ?? 0;
  },
};
