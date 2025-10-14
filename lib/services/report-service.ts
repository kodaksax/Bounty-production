/**
 * Report Service
 * Handles reporting of bounties and other content for moderation
 */

export interface ReportReason {
  id: string;
  label: string;
}

export const REPORT_REASONS: ReportReason[] = [
  { id: 'spam', label: 'Spam or misleading' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'scam', label: 'Scam or fraud' },
  { id: 'duplicate', label: 'Duplicate posting' },
  { id: 'other', label: 'Other' },
];

export const reportService = {
  /**
   * Report a bounty for moderation review
   */
  async reportBounty(
    bountyId: string | number,
    reason?: string,
    details?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // In a real app, this would send to a moderation queue/backend
      console.log(`🚨 Bounty ${bountyId} reported`, { reason, details });
      
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // TODO: In production, POST to /api/reports/bounty with:
      // - bountyId
      // - reason
      // - details
      // - reporter user_id (from auth context)
      // - timestamp
      
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
    reason?: string,
    details?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🚨 User ${userId} reported`, { reason, details });
      await new Promise(resolve => setTimeout(resolve, 500));
      return { success: true };
    } catch (error) {
      console.error('Error reporting user:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to report user',
      };
    }
  },
};
