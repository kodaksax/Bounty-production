import { supabase } from './supabase';
import type { Bounty } from './database.types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export class StaleBountyService {
  /**
   * Fetch all stale bounties for the current user (as poster)
   */
  async getStaleBounties(): Promise<Bounty[]> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`${API_BASE_URL}/stale-bounties`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch stale bounties');
      }

      const data = await response.json();
      return data.bounties || [];
    } catch (error) {
      console.error('Error fetching stale bounties:', error);
      return [];
    }
  }

  /**
   * Cancel a stale bounty and request refund
   */
  async cancelStaleBounty(bountyId: string | number): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`${API_BASE_URL}/stale-bounties/${bountyId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to cancel stale bounty',
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Error cancelling stale bounty:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel stale bounty',
      };
    }
  }

  /**
   * Repost a stale bounty (reset to open status)
   */
  async repostStaleBounty(bountyId: string | number): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`${API_BASE_URL}/stale-bounties/${bountyId}/repost`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to repost stale bounty',
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Error reposting stale bounty:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to repost stale bounty',
      };
    }
  }

  /**
   * Check if a bounty is stale (helper method)
   */
  isBountyStale(bounty: Bounty): boolean {
    return bounty.is_stale === true;
  }

  /**
   * Get the reason why a bounty is stale
   */
  getStaleReason(bounty: Bounty): string {
    if (!bounty.is_stale) return '';
    
    switch (bounty.stale_reason) {
      case 'hunter_deleted':
        return 'The hunter deleted their account';
      default:
        return 'This bounty needs attention';
    }
  }
}

export const staleBountyService = new StaleBountyService();
