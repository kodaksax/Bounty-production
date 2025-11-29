import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { bountyService as baseBountyService } from 'lib/services/bounty-service';
import type { Bounty } from 'lib/services/database.types';
import { isSupabaseConfigured, supabaseEnv } from 'lib/supabase';
import { getCurrentUserId } from 'lib/utils/data-utils';
import { analyticsService } from 'lib/services/analytics-service';
import { performanceService } from 'lib/services/performance-service';

export interface CreateBountyPayload {
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  location: string;
  work_type: 'online' | 'in_person';
  timeline?: string;
  skills_required?: string;
  poster_id: string;
  status: 'open';
}

export const bountyService = {
  /**
   * Delete a bounty by ID
   * This is used for rollback when fund deduction fails after bounty creation
   */
  async deleteBounty(id: number | string): Promise<boolean> {
    try {
      return await baseBountyService.delete(typeof id === 'string' ? parseInt(id, 10) : id);
    } catch (error) {
      console.error('Error deleting bounty:', error);
      return false;
    }
  },

  /**
   * Create a bounty from draft data
   */
  async createBounty(draft: BountyDraft): Promise<Bounty | null> {
    // Start performance measurement
    performanceService.startMeasurement('bounty_create', 'bounty_create', {
      workType: draft.workType,
      isForHonor: draft.isForHonor,
      hasAttachments: (draft.attachments?.length || 0) > 0,
    });

    try {
      // Enforce posting to Supabase only for this guided flow
      if (!isSupabaseConfigured) {
        const reasons: string[] = []
        if (!supabaseEnv.hasUrl) reasons.push('EXPO_PUBLIC_SUPABASE_URL is missing')
        if (!supabaseEnv.hasKey) reasons.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is missing')
        if (supabaseEnv.mismatch) reasons.push('Project ref mismatch between URL and key')
        throw new Error(
          `Supabase is not configured. This action requires posting directly to Supabase.\n\n` +
          `Please set the following environment variables and restart the app:\n` +
          `- EXPO_PUBLIC_SUPABASE_URL\n- EXPO_PUBLIC_SUPABASE_ANON_KEY\n\n` +
          (reasons.length ? `Detected issues: ${reasons.join('; ')}` : '')
        )
      }

      const payload: Omit<Bounty, 'id' | 'created_at'> & { attachments?: any[] } = {
        title: draft.title,
        description: draft.description,
        amount: draft.isForHonor ? 0 : draft.amount,
        is_for_honor: draft.isForHonor,
        location: draft.workType === 'in_person' ? draft.location : '',
        work_type: draft.workType,
        timeline: draft.timeline || '',
        skills_required: draft.skills || '',
        poster_id: getCurrentUserId(),
        user_id: getCurrentUserId(),
        status: 'open',
        // Include attachments from draft so they get persisted to attachments_json
        attachments: draft.attachments || [],
      };

      // Call the base bounty service to create
      const result = await baseBountyService.create(payload);

      if (!result) {
        throw new Error('Failed to create bounty');
      }

      // Track bounty creation event
      await analyticsService.trackEvent('bounty_created', {
        bountyId: result.id,
        workType: draft.workType,
        isForHonor: draft.isForHonor,
        amount: draft.isForHonor ? 0 : draft.amount,
        hasLocation: !!draft.location,
        hasTimeline: !!draft.timeline,
        hasSkills: !!draft.skills,
        hasAttachments: (draft.attachments?.length || 0) > 0,
        attachmentCount: draft.attachments?.length || 0,
      });

      // Increment user property for bounties created
      await analyticsService.incrementUserProperty('bounties_created');

      // End performance measurement
      await performanceService.endMeasurement('bounty_create', {
        success: true,
        bountyId: result.id,
      });

      return result;
    } catch (error) {
      console.error('Error creating bounty:', error);

      // End performance measurement with error
      await performanceService.endMeasurement('bounty_create', {
        success: false,
        error: String(error),
      });

      throw error;
    }
  },

  /**
   * Check network connectivity (simple check)
   */
  async checkConnectivity(): Promise<boolean> {
    try {
      // Simple ping to check if network is available
      const response = await fetch('https://www.google.com', {
        method: 'HEAD',
        mode: 'no-cors',
      });
      return true;
    } catch (error) {
      return false;
    }
  },
};

export default bountyService;
