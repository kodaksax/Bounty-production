import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from 'lib/utils/error-logger';
import type { BountyCancellation } from '../types';
import type { Bounty } from './database.types';
import { bountyService } from './bounty-service';

/**
 * Service for handling bounty cancellation requests and responses
 */
export const cancellationService = {
  /**
   * Create a cancellation request for a bounty
   */
  async createCancellationRequest(
    bountyId: string | number,
    requesterId: string,
    requesterType: 'poster' | 'hunter',
    reason: string,
    refundPercentage?: number
  ): Promise<BountyCancellation | null> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // First, update the bounty status to 'cancellation_requested'
      const bountyUpdateResult = await bountyService.update(bountyId, {
        status: 'cancellation_requested',
      });

      if (!bountyUpdateResult) {
        throw new Error('Failed to update bounty status');
      }

      // Create the cancellation record
      const cancellationData = {
        bounty_id: bountyId,
        requester_id: requesterId,
        requester_type: requesterType,
        reason,
        status: 'pending',
        refund_percentage: refundPercentage,
      };

      const { data, error } = await supabase
        .from('bounty_cancellations')
        .insert(cancellationData)
        .select('*')
        .single();

      if (error) {
        logger.error('Error creating cancellation request', { error, cancellationData });
        throw error;
      }

      // Transform to match BountyCancellation interface
      const cancellation: BountyCancellation = {
        id: data.id,
        bountyId: String(data.bounty_id),
        requesterId: data.requester_id,
        requesterType: data.requester_type,
        reason: data.reason,
        status: data.status,
        responderId: data.responder_id,
        responseMessage: data.response_message,
        refundAmount: data.refund_amount,
        refundPercentage: data.refund_percentage,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        resolvedAt: data.resolved_at,
      };

      return cancellation;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in createCancellationRequest', { 
        bountyId, 
        requesterId, 
        requesterType, 
        error: { message: error.message } 
      });
      return null;
    }
  },

  /**
   * Get cancellation request by ID
   */
  async getCancellationById(cancellationId: string): Promise<BountyCancellation | null> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('bounty_cancellations')
        .select('*')
        .eq('id', cancellationId)
        .single();

      if (error) {
        logger.error('Error fetching cancellation', { error, cancellationId });
        return null;
      }

      const cancellation: BountyCancellation = {
        id: data.id,
        bountyId: String(data.bounty_id),
        requesterId: data.requester_id,
        requesterType: data.requester_type,
        reason: data.reason,
        status: data.status,
        responderId: data.responder_id,
        responseMessage: data.response_message,
        refundAmount: data.refund_amount,
        refundPercentage: data.refund_percentage,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        resolvedAt: data.resolved_at,
      };

      return cancellation;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getCancellationById', { cancellationId, error: { message: error.message } });
      return null;
    }
  },

  /**
   * Get cancellation request for a specific bounty
   */
  async getCancellationByBountyId(bountyId: string | number): Promise<BountyCancellation | null> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('bounty_cancellations')
        .select('*')
        .eq('bounty_id', bountyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('Error fetching cancellation by bounty', { error, bountyId });
        return null;
      }

      if (!data) {
        return null;
      }

      const cancellation: BountyCancellation = {
        id: data.id,
        bountyId: String(data.bounty_id),
        requesterId: data.requester_id,
        requesterType: data.requester_type,
        reason: data.reason,
        status: data.status,
        responderId: data.responder_id,
        responseMessage: data.response_message,
        refundAmount: data.refund_amount,
        refundPercentage: data.refund_percentage,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        resolvedAt: data.resolved_at,
      };

      return cancellation;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getCancellationByBountyId', { bountyId, error: { message: error.message } });
      return null;
    }
  },

  /**
   * Accept a cancellation request
   */
  async acceptCancellation(
    cancellationId: string,
    responderId: string,
    responseMessage?: string,
    walletRefundCallback?: (bountyId: string, title: string, refundPercentage: number) => Promise<boolean>
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Get the cancellation to determine refund details
      const cancellation = await this.getCancellationById(cancellationId);
      if (!cancellation) {
        throw new Error('Cancellation not found');
      }

      // Get the bounty to calculate refund amount
      const bounty = await bountyService.getById(cancellation.bountyId);
      if (!bounty) {
        throw new Error('Bounty not found');
      }

      // Calculate refund amount based on percentage or default to full refund
      const refundPercentage = cancellation.refundPercentage ?? 100;
      const refundAmount = (bounty.amount * refundPercentage) / 100;

      // Update the cancellation record
      const { error: updateError } = await supabase
        .from('bounty_cancellations')
        .update({
          status: 'accepted',
          responder_id: responderId,
          response_message: responseMessage,
          refund_amount: refundAmount,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', cancellationId);

      if (updateError) {
        logger.error('Error accepting cancellation', { error: updateError, cancellationId });
        throw updateError;
      }

      // Update bounty status to 'cancelled'
      await bountyService.update(cancellation.bountyId, {
        status: 'cancelled',
      });

      // Process wallet refund if callback provided
      if (walletRefundCallback) {
        try {
          await walletRefundCallback(cancellation.bountyId, bounty.title, refundPercentage);
        } catch (walletError) {
          logger.error('Error processing wallet refund', { error: walletError, cancellationId });
          // Don't fail the entire operation if wallet refund fails
        }
      }

      // Update requester's stats
      await this.updateUserStats(cancellation.requesterId, 
        cancellation.requesterType === 'hunter' ? 'withdrawal' : 'cancellation');

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in acceptCancellation', { 
        cancellationId, 
        responderId, 
        error: { message: error.message } 
      });
      return false;
    }
  },

  /**
   * Reject a cancellation request
   */
  async rejectCancellation(
    cancellationId: string,
    responderId: string,
    responseMessage: string
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Get the cancellation
      const cancellation = await this.getCancellationById(cancellationId);
      if (!cancellation) {
        throw new Error('Cancellation not found');
      }

      // Update the cancellation record
      const { error: updateError } = await supabase
        .from('bounty_cancellations')
        .update({
          status: 'rejected',
          responder_id: responderId,
          response_message: responseMessage,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', cancellationId);

      if (updateError) {
        logger.error('Error rejecting cancellation', { error: updateError, cancellationId });
        throw updateError;
      }

      // Revert bounty status back to 'in_progress' or 'open'
      const bounty = await bountyService.getById(cancellation.bountyId);
      const revertStatus = bounty?.accepted_by ? 'in_progress' : 'open';
      
      await bountyService.update(cancellation.bountyId, {
        status: revertStatus as any,
      });

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in rejectCancellation', { 
        cancellationId, 
        responderId, 
        error: { message: error.message } 
      });
      return false;
    }
  },

  /**
   * Calculate recommended refund percentage based on bounty progress
   */
  calculateRecommendedRefund(bountyStatus: string, hasAcceptedHunter: boolean): number {
    if (bountyStatus === 'open') {
      return 100; // Full refund if no one accepted
    }
    if (bountyStatus === 'in_progress') {
      return hasAcceptedHunter ? 50 : 100; // 50% if work started, 100% otherwise
    }
    if (bountyStatus === 'completed') {
      return 0; // No refund for completed work
    }
    return 50; // Default to 50% for other cases
  },

  /**
   * Get all cancellations for a user (as requester or responder)
   */
  async getCancellationsByUserId(userId: string): Promise<BountyCancellation[]> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('bounty_cancellations')
        .select('*')
        .or(`requester_id.eq.${userId},responder_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Error fetching user cancellations', { error, userId });
        return [];
      }

      return (data || []).map((item: any) => ({
        id: item.id,
        bountyId: String(item.bounty_id),
        requesterId: item.requester_id,
        requesterType: item.requester_type,
        reason: item.reason,
        status: item.status,
        responderId: item.responder_id,
        responseMessage: item.response_message,
        refundAmount: item.refund_amount,
        refundPercentage: item.refund_percentage,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        resolvedAt: item.resolved_at,
      }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getCancellationsByUserId', { userId, error: { message: error.message } });
      return [];
    }
  },

  /**
   * Update reputation/withdrawal counts after cancellation
   */
  async updateUserStats(userId: string, type: 'withdrawal' | 'cancellation'): Promise<void> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const field = type === 'withdrawal' ? 'withdrawal_count' : 'cancellation_count';
      
      // Increment the count
      const { error } = await supabase.rpc('increment_user_stat', {
        user_id: userId,
        stat_field: field,
      });

      if (error) {
        // If RPC doesn't exist, fallback to manual update
        const { data: profile, error: fetchError } = await supabase
          .from('profiles')
          .select(field)
          .eq('id', userId)
          .single();

        if (!fetchError && profile) {
          const currentCount = (profile as any)[field] || 0;
          await supabase
            .from('profiles')
            .update({ [field]: currentCount + 1 })
            .eq('id', userId);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error updating user stats', { userId, type, error: { message: error.message } });
    }
  },
};
