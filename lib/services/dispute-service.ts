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

      // Update cancellation status to disputed
      const { error: updateError } = await supabase
        .from('bounty_cancellations')
        .update({ status: 'disputed' })
        .eq('id', cancellationId);

      if (updateError) {
        logger.error('Error updating cancellation to disputed', { error: updateError });
        throw updateError;
      }

      // Create the dispute record
      const disputeData = {
        cancellation_id: cancellationId,
        bounty_id: cancellation.bountyId,
        initiator_id: initiatorId,
        reason,
        evidence_json: evidence ? JSON.stringify(evidence) : null,
        status: 'open',
      };

      const { data, error } = await supabase
        .from('bounty_disputes')
        .insert(disputeData)
        .select('*')
        .single();

      if (error) {
        logger.error('Error creating dispute', { error, disputeData });
        throw error;
      }

      // Transform to match BountyDispute interface
      const dispute: BountyDispute = {
        id: data.id,
        cancellationId: data.cancellation_id,
        bountyId: String(data.bounty_id),
        initiatorId: data.initiator_id,
        reason: data.reason,
        evidence: data.evidence_json ? JSON.parse(data.evidence_json) : [],
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
        evidence: data.evidence_json ? JSON.parse(data.evidence_json) : [],
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
        evidence: data.evidence_json ? JSON.parse(data.evidence_json) : [],
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

  /**
   * Upload evidence to a dispute using the new evidence table
   */
  async uploadEvidence(
    disputeId: string,
    userId: string,
    evidenceData: {
      type: 'text' | 'image' | 'document' | 'link';
      content: string;
      description?: string;
      mimeType?: string;
      fileSize?: number;
    }
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { error } = await supabase
        .from('dispute_evidence')
        .insert({
          dispute_id: disputeId,
          uploaded_by: userId,
          type: evidenceData.type,
          content: evidenceData.content,
          description: evidenceData.description,
          mime_type: evidenceData.mimeType,
          file_size: evidenceData.fileSize,
        });

      if (error) {
        logger.error('Error uploading evidence', { error, disputeId });
        throw error;
      }

      // Log audit event
      await this.logAuditEvent(disputeId, 'evidence_added', userId, 'user', {
        evidenceType: evidenceData.type,
      });

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in uploadEvidence', { disputeId, error: { message: error.message } });
      return false;
    }
  },

  /**
   * Get all evidence for a dispute
   */
  async getDisputeEvidence(disputeId: string): Promise<any[]> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('dispute_evidence')
        .select('*')
        .eq('dispute_id', disputeId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Error fetching dispute evidence', { error, disputeId });
        return [];
      }

      return data || [];
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getDisputeEvidence', { disputeId, error: { message: error.message } });
      return [];
    }
  },

  /**
   * Add a comment to a dispute
   */
  async addComment(
    disputeId: string,
    userId: string,
    comment: string,
    isInternal: boolean = false
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { error } = await supabase
        .from('dispute_comments')
        .insert({
          dispute_id: disputeId,
          user_id: userId,
          comment,
          is_internal: isInternal,
        });

      if (error) {
        logger.error('Error adding comment', { error, disputeId });
        throw error;
      }

      // Log audit event
      await this.logAuditEvent(disputeId, 'comment_added', userId, isInternal ? 'admin' : 'user', {
        isInternal,
      });

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in addComment', { disputeId, error: { message: error.message } });
      return false;
    }
  },

  /**
   * Get all comments for a dispute
   */
  async getDisputeComments(disputeId: string, includeInternal: boolean = false): Promise<any[]> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      let query = supabase
        .from('dispute_comments')
        .select('*, profiles:user_id(username, avatar)')
        .eq('dispute_id', disputeId);

      if (!includeInternal) {
        query = query.eq('is_internal', false);
      }

      const { data, error } = await query.order('created_at', { ascending: true });

      if (error) {
        logger.error('Error fetching dispute comments', { error, disputeId });
        return [];
      }

      return data || [];
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getDisputeComments', { disputeId, error: { message: error.message } });
      return [];
    }
  },

  /**
   * Make a resolution decision with fund distribution
   */
  async makeResolutionDecision(
    disputeId: string,
    adminId: string,
    decision: {
      outcome: 'release' | 'refund' | 'split' | 'other';
      amountToHunter?: number;
      amountToPoster?: number;
      rationale: string;
      metadata?: Record<string, any>;
    }
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Get the dispute and bounty details
      const dispute = await this.getDisputeById(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      const bounty = await bountyService.getById(dispute.bountyId);
      if (!bounty) {
        throw new Error('Bounty not found');
      }

      // Check if this is an honor bounty (no monetary value)
      const isHonorBounty = bounty.is_for_honor || !bounty.amount || bounty.amount <= 0;

      // Calculate amounts based on outcome
      let amountToHunter = decision.amountToHunter || 0;
      let amountToPoster = decision.amountToPoster || 0;

      // Only allocate funds for non-honor bounties
      if (!isHonorBounty) {
        if (decision.outcome === 'release') {
          // Full payment to hunter
          amountToHunter = bounty.amount || 0;
          amountToPoster = 0;
        } else if (decision.outcome === 'refund') {
          // Full refund to poster
          amountToHunter = 0;
          amountToPoster = bounty.amount || 0;
        }
      } else {
        // For honor bounties, ensure no funds are allocated
        amountToHunter = 0;
        amountToPoster = 0;
      }

      // Create resolution record
      const { error: resolutionError } = await supabase
        .from('dispute_resolutions')
        .insert({
          dispute_id: disputeId,
          admin_id: adminId,
          outcome: decision.outcome,
          amount_to_hunter: amountToHunter,
          amount_to_poster: amountToPoster,
          rationale: decision.rationale,
          metadata: decision.metadata,
        })
        .select()
        .single();

      if (resolutionError) {
        logger.error('Error creating resolution', { error: resolutionError, disputeId });
        throw resolutionError;
      }

      // Update dispute status (this will send notifications to all parties)
      await this.resolveDispute(disputeId, decision.rationale, adminId);

      // Log audit event
      await this.logAuditEvent(disputeId, 'resolution_decision', adminId, 'admin', {
        outcome: decision.outcome,
        amountToHunter,
        amountToPoster,
      });

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in makeResolutionDecision', { 
        disputeId, 
        error: { message: error.message } 
      });
      return false;
    }
  },

  /**
   * Get resolution for a dispute
   */
  async getResolution(disputeId: string): Promise<any | null> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('dispute_resolutions')
        .select('*, admin:admin_id(username, avatar)')
        .eq('dispute_id', disputeId)
        .maybeSingle();

      if (error) {
        logger.error('Error fetching resolution', { error, disputeId });
        return null;
      }

      return data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getResolution', { disputeId, error: { message: error.message } });
      return null;
    }
  },

  /**
   * Create an appeal for a resolved dispute
   */
  async createAppeal(
    disputeId: string,
    appellantId: string,
    reason: string
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Verify dispute is resolved
      const dispute = await this.getDisputeById(disputeId);
      if (!dispute || dispute.status !== 'resolved') {
        throw new Error('Can only appeal resolved disputes');
      }

      const { error } = await supabase
        .from('dispute_appeals')
        .insert({
          dispute_id: disputeId,
          appellant_id: appellantId,
          reason,
          status: 'pending',
        });

      if (error) {
        logger.error('Error creating appeal', { error, disputeId });
        throw error;
      }

      // Log audit event
      await this.logAuditEvent(disputeId, 'appeal_created', appellantId, 'user', {
        reason: reason.substring(0, 100),
      });

      // Send notification to admins (this would need admin notification system)
      // For now, just log it
      console.log('New appeal created', { disputeId, appellantId });

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in createAppeal', { disputeId, error: { message: error.message } });
      return false;
    }
  },

  /**
   * Get appeals for a dispute
   */
  async getAppeals(disputeId: string): Promise<any[]> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('dispute_appeals')
        .select('*, appellant:appellant_id(username, avatar)')
        .eq('dispute_id', disputeId)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Error fetching appeals', { error, disputeId });
        return [];
      }

      return data || [];
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getAppeals', { disputeId, error: { message: error.message } });
      return [];
    }
  },

  /**
   * Auto-close stale disputes (no response after 7 days)
   */
  async autoCloseStaleDisputes(): Promise<number> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const now = new Date().toISOString();

      // Find disputes that should be auto-closed
      const { data: staleDisputes, error: fetchError } = await supabase
        .from('bounty_disputes')
        .select('*')
        .in('status', ['open', 'under_review'])
        .lte('auto_close_at', now);

      if (fetchError) {
        logger.error('Error fetching stale disputes', { error: fetchError });
        return 0;
      }

      if (!staleDisputes || staleDisputes.length === 0) {
        return 0;
      }

      // Close each dispute
      let closedCount = 0;
      for (const dispute of staleDisputes) {
        const { error: updateError } = await supabase
          .from('bounty_disputes')
          .update({
            status: 'closed',
            resolution: 'Auto-closed due to inactivity after 7 days',
            resolved_at: now,
          })
          .eq('id', dispute.id);

        if (updateError) {
          logger.error('Error auto-closing dispute', { error: updateError, disputeId: dispute.id });
          continue;
        }

        // Log audit event
        await this.logAuditEvent(dispute.id, 'auto_closed', null, 'system', {
          reason: 'No activity for 7 days',
        });

        // Send notification - use snake_case as returned from direct DB query
        try {
          await sendNotification(
            dispute.initiator_id,
            'dispute_resolved',
            'Dispute Auto-Closed',
            'Your dispute was automatically closed due to inactivity.',
            {
              disputeId: dispute.id,
              bountyId: dispute.bounty_id,
            }
          );
        } catch (notifError) {
          logger.error('Error sending auto-close notification', { error: notifError });
        }

        closedCount++;
      }

      console.log(`Auto-closed ${closedCount} stale disputes`);
      return closedCount;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in autoCloseStaleDisputes', { error: { message: error.message } });
      return 0;
    }
  },

  /**
   * Escalate unresolved disputes after 14 days
   */
  async escalateUnresolvedDisputes(): Promise<number> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      // Find disputes that should be escalated
      const { data: unresolvedDisputes, error: fetchError } = await supabase
        .from('bounty_disputes')
        .select('*')
        .in('status', ['open', 'under_review'])
        .eq('escalated', false)
        .lte('created_at', fourteenDaysAgo.toISOString());

      if (fetchError) {
        logger.error('Error fetching unresolved disputes', { error: fetchError });
        return 0;
      }

      if (!unresolvedDisputes || unresolvedDisputes.length === 0) {
        return 0;
      }

      // Escalate each dispute
      let escalatedCount = 0;
      for (const dispute of unresolvedDisputes) {
        const { error: updateError } = await supabase
          .from('bounty_disputes')
          .update({
            escalated: true,
            escalated_at: new Date().toISOString(),
          })
          .eq('id', dispute.id);

        if (updateError) {
          logger.error('Error escalating dispute', { error: updateError, disputeId: dispute.id });
          continue;
        }

        // Log audit event
        await this.logAuditEvent(dispute.id, 'escalated', null, 'system', {
          reason: 'Unresolved for 14 days',
        });

        escalatedCount++;
      }

      console.log(`Escalated ${escalatedCount} unresolved disputes`);
      return escalatedCount;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in escalateUnresolvedDisputes', { error: { message: error.message } });
      return 0;
    }
  },

  /**
   * Calculate suggested resolution based on evidence
   */
  async calculateSuggestedResolution(disputeId: string): Promise<{
    suggestedOutcome: 'release' | 'refund' | 'split';
    confidence: number;
    reasoning: string;
  }> {
    try {
      // Get dispute and evidence
      const dispute = await this.getDisputeById(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      const evidence = await this.getDisputeEvidence(disputeId);

      // Simple heuristic-based suggestion
      // In a production system, this could use ML or more sophisticated logic
      
      // Evidence scoring weights
      const EVIDENCE_SCORE_IMAGE = 3;
      const EVIDENCE_SCORE_DOCUMENT = 2;
      const EVIDENCE_SCORE_TEXT = 1;
      
      let hunterScore = 0;
      let posterScore = 0;

      // Count evidence submitted by each party
      const bounty = await bountyService.getById(dispute.bountyId);
      if (bounty) {
        evidence.forEach((ev: any) => {
          const scoreValue = ev.type === 'image' 
            ? EVIDENCE_SCORE_IMAGE 
            : ev.type === 'document' 
            ? EVIDENCE_SCORE_DOCUMENT 
            : EVIDENCE_SCORE_TEXT;
            
          // Use poster_id and hunter_id as returned by bountyService.getById
          if (ev.uploaded_by === bounty.hunter_id) {
            hunterScore += scoreValue;
          } else if (ev.uploaded_by === bounty.poster_id) {
            posterScore += scoreValue;
          }
        });
      }

      // Determine outcome
      let suggestedOutcome: 'release' | 'refund' | 'split';
      let confidence: number;
      let reasoning: string;

      const totalScore = hunterScore + posterScore;
      if (totalScore === 0) {
        reasoning = 'Insufficient evidence from both parties. Recommend splitting the bounty.';
        suggestedOutcome = 'split';
        confidence = 0.3;
      } else if (hunterScore > posterScore * 2) {
        reasoning = 'Hunter provided significantly more evidence. Recommend releasing funds to hunter.';
        suggestedOutcome = 'release';
        confidence = Math.min(0.8, 0.5 + (hunterScore / (totalScore + 1)) * 0.3);
      } else if (posterScore > hunterScore * 2) {
        reasoning = 'Poster provided significantly more evidence. Recommend refunding to poster.';
        suggestedOutcome = 'refund';
        confidence = Math.min(0.8, 0.5 + (posterScore / (totalScore + 1)) * 0.3);
      } else {
        reasoning = 'Both parties provided comparable evidence. Recommend splitting the bounty.';
        suggestedOutcome = 'split';
        confidence = 0.6;
      }

      return {
        suggestedOutcome,
        confidence,
        reasoning,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in calculateSuggestedResolution', { 
        disputeId, 
        error: { message: error.message } 
      });
      return {
        suggestedOutcome: 'split',
        confidence: 0.5,
        reasoning: 'Unable to calculate suggestion due to error.',
      };
    }
  },

  /**
   * Get audit log for a dispute
   */
  async getAuditLog(disputeId: string): Promise<any[]> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('dispute_audit_log')
        .select('*, actor:actor_id(username, avatar)')
        .eq('dispute_id', disputeId)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Error fetching audit log', { error, disputeId });
        return [];
      }

      return data || [];
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getAuditLog', { disputeId, error: { message: error.message } });
      return [];
    }
  },

  /**
   * Log an audit event
   */
  async logAuditEvent(
    disputeId: string,
    action: string,
    actorId: string | null,
    actorType: 'user' | 'admin' | 'system',
    details?: Record<string, any>
  ): Promise<void> {
    try {
      if (!isSupabaseConfigured) {
        return;
      }

      await supabase.from('dispute_audit_log').insert({
        dispute_id: disputeId,
        action,
        actor_id: actorId,
        actor_type: actorType,
        details,
      });
    } catch (err) {
      // Don't throw errors from audit logging
      logger.error('Error logging audit event', { error: err });
    }
  },
};
