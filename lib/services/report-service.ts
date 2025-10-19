/**
 * Report Service
 * Handles reporting of bounties and other content for moderation
 */

import { supabase } from '../supabase';
import { getCurrentUserId } from '../utils/data-utils';

export interface ReportReason {
  id: 'spam' | 'harassment' | 'inappropriate' | 'fraud';
  label: string;
}

export const REPORT_REASONS: ReportReason[] = [
  { id: 'spam', label: 'Spam or misleading' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'fraud', label: 'Scam or fraud' },
];

export const reportService = {
  /**
   * Report a bounty for moderation review
   */
  async reportBounty(
    bountyId: string | number,
    reason: 'spam' | 'harassment' | 'inappropriate' | 'fraud',
    details?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const userId = getCurrentUserId();
      if (!userId) {
        return { success: false, error: 'User not authenticated' };
      }

      const { error } = await supabase.from('reports').insert({
        user_id: userId,
        content_type: 'bounty',
        content_id: String(bountyId),
        reason,
        details: details || '',
        status: 'pending',
      });

      if (error) {
        console.error('Error submitting bounty report:', error);
        return { success: false, error: error.message };
      }

      console.log(`🚨 Bounty ${bountyId} reported`, { reason, details });
      return { success: true };
    } catch (error) {
      console.error('Error reporting bounty:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to report bounty',
      };
    }
  },

  /**
   * Report a user profile
   */
  async reportUser(
    userId: string,
    reason: 'spam' | 'harassment' | 'inappropriate' | 'fraud',
    details?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const reporterId = getCurrentUserId();
      if (!reporterId) {
        return { success: false, error: 'User not authenticated' };
      }

      const { error } = await supabase.from('reports').insert({
        user_id: reporterId,
        content_type: 'profile',
        content_id: userId,
        reason,
        details: details || '',
        status: 'pending',
      });

      if (error) {
        console.error('Error submitting user report:', error);
        return { success: false, error: error.message };
      }

      console.log(`🚨 User ${userId} reported`, { reason, details });
      return { success: true };
    } catch (error) {
      console.error('Error reporting user:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to report user',
      };
    }
  },

  /**
   * Report a message for moderation review
   */
  async reportMessage(
    messageId: string,
    reason: 'spam' | 'harassment' | 'inappropriate' | 'fraud',
    details?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const userId = getCurrentUserId();
      if (!userId) {
        return { success: false, error: 'User not authenticated' };
      }

      const { error } = await supabase.from('reports').insert({
        user_id: userId,
        content_type: 'message',
        content_id: messageId,
        reason,
        details: details || '',
        status: 'pending',
      });

      if (error) {
        console.error('Error submitting message report:', error);
        return { success: false, error: error.message };
      }

      console.log(`🚨 Message ${messageId} reported`, { reason, details });
      return { success: true };
    } catch (error) {
      console.error('Error reporting message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to report message',
      };
    }
  },

  /**
   * Get all reports (admin only)
   */
  async getAllReports(filters?: {
    status?: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
    content_type?: 'bounty' | 'profile' | 'message';
  }): Promise<{ success: boolean; reports?: any[]; error?: string }> {
    try {
      let query = supabase.from('reports').select('*').order('created_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.content_type) {
        query = query.eq('content_type', filters.content_type);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching reports:', error);
        return { success: false, error: error.message };
      }

      return { success: true, reports: data || [] };
    } catch (error) {
      console.error('Error fetching reports:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch reports',
      };
    }
  },

  /**
   * Update report status (admin only)
   */
  async updateReportStatus(
    reportId: string,
    status: 'reviewed' | 'resolved' | 'dismissed'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('reports')
        .update({ status })
        .eq('id', reportId);

      if (error) {
        console.error('Error updating report status:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating report status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update report',
      };
    }
  },
};
