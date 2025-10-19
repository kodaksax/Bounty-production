/**
 * Blocking Service
 * Handles user blocking functionality
 */

import { supabase } from '../supabase';
import { getCurrentUserId } from '../utils/data-utils';

export const blockingService = {
  /**
   * Block a user
   */
  async blockUser(blockedId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const blockerId = getCurrentUserId();
      if (!blockerId) {
        return { success: false, error: 'User not authenticated' };
      }

      if (blockerId === blockedId) {
        return { success: false, error: 'Cannot block yourself' };
      }

      const { error } = await supabase.from('blocked_users').insert({
        blocker_id: blockerId,
        blocked_id: blockedId,
      });

      if (error) {
        // Check if already blocked (unique constraint violation)
        if (error.code === '23505') {
          return { success: false, error: 'User is already blocked' };
        }
        console.error('Error blocking user:', error);
        return { success: false, error: error.message };
      }

      console.log(`🚫 User ${blockedId} blocked by ${blockerId}`);
      return { success: true };
    } catch (error) {
      console.error('Error blocking user:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to block user',
      };
    }
  },

  /**
   * Unblock a user
   */
  async unblockUser(blockedId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const blockerId = getCurrentUserId();
      if (!blockerId) {
        return { success: false, error: 'User not authenticated' };
      }

      const { error } = await supabase
        .from('blocked_users')
        .delete()
        .eq('blocker_id', blockerId)
        .eq('blocked_id', blockedId);

      if (error) {
        console.error('Error unblocking user:', error);
        return { success: false, error: error.message };
      }

      console.log(`✅ User ${blockedId} unblocked by ${blockerId}`);
      return { success: true };
    } catch (error) {
      console.error('Error unblocking user:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to unblock user',
      };
    }
  },

  /**
   * Check if a user is blocked
   */
  async isUserBlocked(userId: string): Promise<{ isBlocked: boolean; error?: string }> {
    try {
      const currentUserId = getCurrentUserId();
      if (!currentUserId) {
        return { isBlocked: false };
      }

      const { data, error } = await supabase
        .from('blocked_users')
        .select('id')
        .eq('blocker_id', currentUserId)
        .eq('blocked_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows found, which is fine
        console.error('Error checking block status:', error);
        return { isBlocked: false, error: error.message };
      }

      return { isBlocked: !!data };
    } catch (error) {
      console.error('Error checking block status:', error);
      return {
        isBlocked: false,
        error: error instanceof Error ? error.message : 'Failed to check block status',
      };
    }
  },

  /**
   * Get all users blocked by current user
   */
  async getBlockedUsers(): Promise<{ success: boolean; blockedUsers?: any[]; error?: string }> {
    try {
      const blockerId = getCurrentUserId();
      if (!blockerId) {
        return { success: false, error: 'User not authenticated' };
      }

      const { data, error } = await supabase
        .from('blocked_users')
        .select('*, profiles!blocked_users_blocked_id_fkey(id, username, avatar)')
        .eq('blocker_id', blockerId);

      if (error) {
        console.error('Error fetching blocked users:', error);
        return { success: false, error: error.message };
      }

      return { success: true, blockedUsers: data || [] };
    } catch (error) {
      console.error('Error fetching blocked users:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch blocked users',
      };
    }
  },
};
