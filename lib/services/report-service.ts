/**
 * Report Service
 * Handles reporting of bounties and other content for moderation
 */

import { supabase } from '../supabase';
import { getCurrentUserId } from '../utils/data-utils';

export type ReportReasonId = 'spam' | 'harassment' | 'inappropriate' | 'fraud';
export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed';
export type ReportContentType = 'bounty' | 'profile' | 'message';

export interface ReportReason {
  id: ReportReasonId;
  label: string;
}

/** Shape of a report record from the database */
export interface ReportRecord {
  id: string;
  user_id: string;
  content_type: ReportContentType;
  content_id: string;
  reason: ReportReasonId;
  details?: string;
  status: ReportStatus;
  created_at: string;
  reviewed_at?: string;
  resolution_notes?: string;
}

export const REPORT_REASONS: ReportReason[] = [
  { id: 'spam', label: 'Spam or misleading' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'fraud', label: 'Scam or fraud' },
];

/**
 * Send admin notification about a new report
 * This creates a notification record for admins to review
 */
async function notifyAdminsOfReport(
  contentType: 'bounty' | 'profile' | 'message',
  contentId: string,
  reason: ReportReasonId,
  reporterId: string
): Promise<void> {
  try {
    // Create an admin notification record (if notifications table exists)
    // This is a best-effort notification - don't block the report submission
    const { error } = await supabase.from('admin_notifications').insert({
      type: 'new_report',
      title: `New ${contentType} report: ${reason}`,
      message: `A ${contentType} has been reported for ${reason}. Content ID: ${contentId}`,
      content_type: contentType,
      content_id: contentId,
      reporter_id: reporterId,
      priority: reason === 'fraud' || reason === 'harassment' ? 'high' : 'normal',
      read: false,
      created_at: new Date().toISOString(),
    });

    if (error) {
      // Log but don't throw - notification is non-critical
      console.warn('Could not create admin notification:', error.message);
    } else {
      console.log(`📧 Admin notification sent for ${contentType} report`);
    }
  } catch (err) {
    // Silently fail for notifications - the report itself is what matters
    console.warn('Admin notification failed:', err);
  }
}

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

      // Send admin notification
      await notifyAdminsOfReport('bounty', String(bountyId), reason, userId);

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

      // Send admin notification
      await notifyAdminsOfReport('profile', userId, reason, reporterId);

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

      // Send admin notification
      await notifyAdminsOfReport('message', messageId, reason, userId);

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
    status: 'reviewed' | 'resolved' | 'dismissed',
    resolutionNotes?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updateData: Record<string, any> = { 
        status,
        reviewed_at: new Date().toISOString(),
      };
      
      if (resolutionNotes) {
        updateData.resolution_notes = resolutionNotes;
      }

      const { error } = await supabase
        .from('reports')
        .update(updateData)
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

  /**
   * Get report statistics for admin dashboard
   */
  async getReportStats(): Promise<{ 
    success: boolean; 
    stats?: {
      pending: number;
      reviewed: number;
      resolved: number;
      dismissed: number;
      highPriority: number;
    }; 
    error?: string 
  }> {
    try {
      // Use parallel count queries for each status and high-priority reasons
      const [pending, reviewed, resolved, dismissed, highPriority] = await Promise.all([
        supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'reviewed'),
        supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'resolved'),
        supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'dismissed'),
        supabase.from('reports').select('*', { count: 'exact', head: true }).in('reason', ['fraud', 'harassment']),
      ]);

      // Check for errors in any of the queries
      if (
        pending.error ||
        reviewed.error ||
        resolved.error ||
        dismissed.error ||
        highPriority.error
      ) {
        const errorMsg =
          pending.error?.message ||
          reviewed.error?.message ||
          resolved.error?.message ||
          dismissed.error?.message ||
          highPriority.error?.message ||
          'Unknown error';
        return { success: false, error: errorMsg };
      }

      const stats = {
        pending: pending.count ?? 0,
        reviewed: reviewed.count ?? 0,
        resolved: resolved.count ?? 0,
        dismissed: dismissed.count ?? 0,
        highPriority: highPriority.count ?? 0,
      };
      return { success: true, stats };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get stats',
      };
    }
  },
};
