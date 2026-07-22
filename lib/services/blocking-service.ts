/**
 * Blocking Service
 * Handles user blocking functionality
 */

import { logger } from '../utils/error-logger';
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
        const pgError = error as { code?: string; message?: string };
        if (pgError.code === '23505') {
          return { success: false, error: 'User is already blocked' };
        }
        logger.error('Error blocking user:', { error });
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      logger.error('Error blocking user:', { error });
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
        logger.error('Error unblocking user:', { error });
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      logger.error('Error unblocking user:', { error });
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

      // Some DB schemas may not expose an `id` column on the relationship.
      // Selecting a concrete column (blocker_id) avoids Postgres "column ... does not exist" errors.
      const { data, error } = await supabase
        .from('blocked_users')
        .select('blocker_id')
        .eq('blocker_id', currentUserId)
        .eq('blocked_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows found, which is fine
        logger.error('Error checking block status:', { error });
        return { isBlocked: false, error: error.message };
      }

      return { isBlocked: !!data };
    } catch (error) {
      logger.error('Error checking block status:', { error });
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

      // No `profiles` embed: blocked users are by definition OTHER users, and
      // the base table's SELECT RLS is self-only (`auth.uid() = id`), so the
      // embed resolved to null for every row. Enrich from the `public_profiles`
      // view instead. See docs/withdrawals/08-profiles-rls-migration-strategy.md.
      const { data, error } = await supabase
        .from('blocked_users')
        .select('*')
        .eq('blocker_id', blockerId);

      if (error) {
        logger.error('Error fetching blocked users:', { error });
        return { success: false, error: error.message };
      }

      const rows = data || [];
      const blockedIds = Array.from(
        new Set(rows.map((r: any) => r.blocked_id).filter(Boolean))
      );

      let profileMap = new Map<string, any>();
      if (blockedIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('public_profiles')
          .select('id, username, avatar')
          .in('id', blockedIds);

        if (profilesError) {
          // Non-fatal: the block itself is still in effect, we just cannot
          // render a name for it.
          logger.warning('Could not fetch blocked-user profiles', { error: profilesError });
        } else {
          profileMap = new Map((profiles || []).map((p: any) => [String(p.id), p]));
        }
      }

      const blockedUsers = rows.map((r: any) => ({
        ...r,
        profiles: profileMap.get(String(r.blocked_id)) ?? null,
      }));

      return { success: true, blockedUsers };
    } catch (error) {
      logger.error('Error fetching blocked users:', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch blocked users',
      };
    }
  },
};
