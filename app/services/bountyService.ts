import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { bountyService as baseBountyService } from 'lib/services/bounty-service';
import type { Bounty } from 'lib/services/database.types';
import { isSupabaseConfigured, supabaseEnv } from 'lib/supabase';
import { CURRENT_USER_ID } from 'lib/utils/data-utils';

export interface CreateBountyPayload {
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  location: string;
  work_type: 'online' | 'in_person';
  timeline?: string;
  skills_required?: string;
  user_id: string;
  status: 'open';
}

export const bountyService = {
  /**
   * Create a bounty from draft data
   */
  async createBounty(draft: BountyDraft): Promise<Bounty | null> {
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

      const payload: Omit<Bounty, 'id' | 'created_at'> = {
        title: draft.title,
        description: draft.description,
        amount: draft.isForHonor ? 0 : draft.amount,
        is_for_honor: draft.isForHonor,
        location: draft.workType === 'in_person' ? draft.location : '',
        work_type: draft.workType,
        timeline: draft.timeline || '',
        skills_required: draft.skills || '',
        user_id: CURRENT_USER_ID,
        status: 'open',
      };

      // Call the base bounty service to create
      const result = await baseBountyService.create(payload);

      if (!result) {
        throw new Error('Failed to create bounty');
      }

      return result;
    } catch (error) {
      console.error('Error creating bounty:', error);
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
