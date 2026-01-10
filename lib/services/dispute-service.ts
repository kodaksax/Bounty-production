import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from 'lib/utils/error-logger';
import type { BountyDispute, DisputeEvidence } from '../types';
import { bountyService } from './bounty-service';
import { cancellationService } from './cancellation-service';

/**
 * Helper to send notification via Supabase direct insert
 */
async function sendNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<void> {
  try {
    if (!isSupabaseConfigured) {
      logger.error('Supabase not configured for sending notification');
      return;
    }

    const { error } = await supabase.from('notifications').insert({
      user_id: userId,
      type,
      title,
      body,
      data: data || null,
      read: false,
    });

    if (error) {
      logger.error('Error sending notification', { error, userId, type });
    }
  } catch (error) {
    logger.error('Error sending notification', { error });
  }
}

/**
 * Service for handling bounty dispute lifecycle
 */
export const disputeService = {
  /**
   * Create a dispute from a cancellation request
   */
  async createDispute(
    cancellationId: string,
    initiatorId: string,
    reason: string,
    evidence?: DisputeEvidence[]
  ): Promise<BountyDispute | null> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Get the cancellation to verify it exists and get bounty ID
      const cancellation = await cancellationService.getCancellationById(cancellationId);
      if (!cancellation) {
        throw new Error('Cancellation not found');
      }

      // Prepare dispute data
      const disputeData = {
        cancellation_id: cancellationId,
        bounty_id: cancellation.bountyId,
        initiator_id: initiatorId,
        reason,
        evidence_json: evidence ? JSON.stringify(evidence) : null,
        status: 'open',
      };

      // Create the dispute record first. If this fails, do not touch the cancellation.
      const { data, error } = await supabase
        .from('bounty_disputes')
        .insert(disputeData)
        .select('*')
        .single();

      if (error || !data) {
        logger.error('Error creating dispute', { error, disputeData, data });
        return null;
      }

      // Only update the cancellation status after dispute was created successfully.
      const { error: updateError } = await supabase
        .from('bounty_cancellations')
        .update({ status: 'disputed' })
        .eq('id', cancellationId);

      if (updateError) {
        // Log but do not fail the overall operation — dispute exists even if cancellation update failed.
        logger.error('Error updating cancellation to disputed', { error: updateError, cancellationId });
      }

      // Transform to match BountyDispute interface
      const dispute: BountyDispute = {
        id: data.id,
        cancellationId: data.cancellation_id,
        bountyId: String(data.bounty_id),
        initiatorId: data.initiator_id,
        reason: data.reason,
        evidence: data.evidence_json ? JSON.parse(data.evidence_json) : undefined,
        status: data.status,
        resolution: data.resolution,
        resolvedBy: data.resolved_by,
        resolvedAt: data.resolved_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };

      // Send notifications to involved parties
      try {
        const bounty = await bountyService.getById(String(data.bounty_id));
        if (bounty) {
          // Notify the bounty poster
          if (bounty.user_id && bounty.user_id !== initiatorId) {
            await sendNotification(
              String(bounty.user_id),
              'dispute_created',
              'Dispute Created',
              `A dispute has been opened for bounty: ${bounty.title}`,
              {
                bountyId: String(data.bounty_id),
                disputeId: data.id,
                cancellationId: cancellationId,
              }
            );
          }
          
          // If there's a hunter involved (from cancellation), notify them too
          if (cancellation.requesterId && 
              cancellation.requesterId !== initiatorId && 
              cancellation.requesterId !== bounty.user_id) {
            await sendNotification(
              String(cancellation.requesterId),
              'dispute_created',
              'Dispute Created',
              `A dispute has been opened for bounty: ${bounty.title}`,
              {
                bountyId: String(data.bounty_id),
                disputeId: data.id,
                cancellationId: cancellationId,
              }
            );
          }
        }
      } catch (notifError) {
        // Log but don't fail the dispute creation if notification fails
        logger.error('Error sending dispute creation notifications', { error: notifError });
      }

      return dispute;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in createDispute', { 
        cancellationId, 
        initiatorId, 
        error: { message: error.message } 
      });
      return null;
    }
  },

  /**
   * Get dispute by ID
   */
  async getDisputeById(disputeId: string): Promise<BountyDispute | null> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('bounty_disputes')
        .select('*')
        .eq('id', disputeId)
        .single();

      if (error) {
        logger.error('Error fetching dispute', { error, disputeId });
        return null;
      }

      const dispute: BountyDispute = {
        id: data.id,
        cancellationId: data.cancellation_id,
        bountyId: String(data.bounty_id),
        initiatorId: data.initiator_id,
        reason: data.reason,
        evidence: data.evidence_json ? JSON.parse(data.evidence_json) : undefined,
        status: data.status,
        resolution: data.resolution,
        resolvedBy: data.resolved_by,
        resolvedAt: data.resolved_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };

      return dispute;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getDisputeById', { disputeId, error: { message: error.message } });
      return null;
    }
  },

  /**
   * Get dispute by cancellation ID
   */
  async getDisputeByCancellationId(cancellationId: string): Promise<BountyDispute | null> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('bounty_disputes')
        .select('*')
        .eq('cancellation_id', cancellationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('Error fetching dispute by cancellation', { error, cancellationId });
        return null;
      }

      if (!data) {
        return null;
      }

      const dispute: BountyDispute = {
        id: data.id,
        cancellationId: data.cancellation_id,
        bountyId: String(data.bounty_id),
        initiatorId: data.initiator_id,
        reason: data.reason,
        evidence: data.evidence_json ? JSON.parse(data.evidence_json) : undefined,
        status: data.status,
        resolution: data.resolution,
        resolvedBy: data.resolved_by,
        resolvedAt: data.resolved_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };

      return dispute;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getDisputeByCancellationId', { cancellationId, error: { message: error.message } });
      return null;
    }
  },

  /**
   * Add evidence to an existing dispute
   */
  async addEvidence(
    disputeId: string,
    evidence: DisputeEvidence
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Get current dispute
      const dispute = await this.getDisputeById(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      // Add new evidence to existing evidence array
      const updatedEvidence = [...(dispute.evidence || []), evidence];

      // Update the dispute
      const { error } = await supabase
        .from('bounty_disputes')
        .update({ evidence_json: JSON.stringify(updatedEvidence) })
        .eq('id', disputeId);

      if (error) {
        logger.error('Error adding evidence', { error, disputeId });
        throw error;
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in addEvidence', { disputeId, error: { message: error.message } });
      return false;
    }
  },

  /**
   * Update dispute status
   */
  async updateDisputeStatus(
    disputeId: string,
    status: 'open' | 'under_review' | 'resolved' | 'closed'
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { error } = await supabase
        .from('bounty_disputes')
        .update({ status })
        .eq('id', disputeId);

      if (error) {
        logger.error('Error updating dispute status', { error, disputeId, status });
        throw error;
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in updateDisputeStatus', { 
        disputeId, 
        status, 
        error: { message: error.message } 
      });
      return false;
    }
  },

  /**
   * Resolve a dispute
   */
  async resolveDispute(
    disputeId: string,
    resolution: string,
    resolvedBy: string
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Get the dispute first to access its data
      const dispute = await this.getDisputeById(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      const { error } = await supabase
        .from('bounty_disputes')
        .update({
          status: 'resolved',
          resolution,
          resolved_by: resolvedBy,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', disputeId);

      if (error) {
        logger.error('Error resolving dispute', { error, disputeId });
        throw error;
      }

      // Send notifications to involved parties
      try {
        const bounty = await bountyService.getById(dispute.bountyId);
        if (bounty) {
          // Notify the dispute initiator
          await sendNotification(
            dispute.initiatorId,
            'dispute_resolved',
            'Dispute Resolved',
            `Your dispute for bounty "${bounty.title}" has been resolved.`,
            {
              bountyId: dispute.bountyId,
              disputeId: disputeId,
              resolution: resolution.substring(0, 100), // Truncate for notification
            }
          );

          // Notify the bounty poster if different from initiator
          if (bounty.user_id && bounty.user_id !== dispute.initiatorId) {
            await sendNotification(
              String(bounty.user_id),
              'dispute_resolved',
              'Dispute Resolved',
              `A dispute for bounty "${bounty.title}" has been resolved.`,
              {
                bountyId: dispute.bountyId,
                disputeId: disputeId,
                resolution: resolution.substring(0, 100),
              }
            );
          }

          // Get cancellation to notify other party if exists
          const cancellation = await cancellationService.getCancellationById(dispute.cancellationId);
          if (cancellation && 
              cancellation.requesterId && 
              cancellation.requesterId !== dispute.initiatorId && 
              cancellation.requesterId !== bounty.user_id) {
            await sendNotification(
              cancellation.requesterId,
              'dispute_resolved',
              'Dispute Resolved',
              `A dispute for bounty "${bounty.title}" has been resolved.`,
              {
                bountyId: dispute.bountyId,
                disputeId: disputeId,
                resolution: resolution.substring(0, 100),
              }
            );
          }
        }
      } catch (notifError) {
        // Log but don't fail the resolution if notification fails
        logger.error('Error sending dispute resolution notifications', { error: notifError });
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in resolveDispute', { 
        disputeId, 
        error: { message: error.message } 
      });
      return false;
    }
  },

  /**
   * Get all disputes for a user
   */
  async getDisputesByUserId(userId: string): Promise<BountyDispute[]> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('bounty_disputes')
        .select('*')
        .eq('initiator_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Error fetching user disputes', { error, userId });
        return [];
      }

      return (data || []).map((item: any) => ({
        id: item.id,
        cancellationId: item.cancellation_id,
        bountyId: String(item.bounty_id),
        initiatorId: item.initiator_id,
        reason: item.reason,
        evidence: item.evidence_json ? JSON.parse(item.evidence_json) : undefined,
        status: item.status,
        resolution: item.resolution,
        resolvedBy: item.resolved_by,
        resolvedAt: item.resolved_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getDisputesByUserId', { userId, error: { message: error.message } });
      return [];
    }
  },

  /**
   * Get all active disputes (open and under review) for admin review
   */
  async getAllActiveDisputes(): Promise<BountyDispute[]> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('bounty_disputes')
        .select('*')
        .in('status', ['open', 'under_review'])
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Error fetching active disputes', { error });
        return [];
      }

      return (data || []).map((item: any) => ({
        id: item.id,
        cancellationId: item.cancellation_id,
        bountyId: String(item.bounty_id),
        initiatorId: item.initiator_id,
        reason: item.reason,
        evidence: item.evidence_json ? JSON.parse(item.evidence_json) : undefined,
        status: item.status,
        resolution: item.resolution,
        resolvedBy: item.resolved_by,
        resolvedAt: item.resolved_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getAllActiveDisputes', { error: { message: error.message } });
      return [];
    }
  },
};
