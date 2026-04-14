import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from 'lib/utils/error-logger';
import type { BountyDispute, LocalDisputeEvidence } from '../types';
import { bountyService } from './bounty-service';
import { cancellationService } from './cancellation-service';
import type { Bounty } from './database.types';
import { paymentService } from './payment-service';

/**
 * Verify that the current session user has admin role via app_metadata
 */
async function verifyAdminRole(): Promise<boolean> {
  try {
    if (!isSupabaseConfigured) return false;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return false;

    return session.user.app_metadata?.role === 'admin';
  } catch {
    return false;
  }
}

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
 * Helper to create an admin notification for disputes
 */
async function notifyAdminsOfDispute(disputeId: string, bountyId: string, reason: string): Promise<void> {
  try {
    if (!isSupabaseConfigured) {
      logger.error('Supabase not configured for admin notifications');
      return;
    }

    const { error } = await supabase.from('admin_notifications').insert({
      type: 'dispute_escalated',
      title: `Dispute escalated: ${disputeId.substring(0, 8)}`,
      message: `Dispute ${disputeId} for bounty ${bountyId} was escalated: ${reason}`,
      content_type: 'dispute',
      content_id: disputeId,
      reporter_id: null,
      priority: 'high',
      read: false,
      created_at: new Date().toISOString(),
    });

    if (error) {
      logger.error('Could not create admin notification for dispute', { error, disputeId });
    }
  } catch (err) {
    logger.error('Error notifying admins of dispute', { error: err });
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
    evidence?: LocalDisputeEvidence[]
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
      // We do not persist client-side/unsynced evidence directly into the
      // canonical `dispute_evidence` table. The client should call
      // `uploadEvidence` per-item after the dispute is created. To avoid
      // storing partial/unsynced objects as `DisputeEvidence` in the
      // dispute row, we leave `evidence_json` null here.
      const disputeData = {
        cancellation_id: cancellationId,
        bounty_id: cancellation.bountyId,
        initiator_id: initiatorId,
        reason,
        evidence_json: null,
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

      // Place a wallet hold on the poster's balance for the disputed bounty amount.
      // fn_open_dispute_hold is idempotent and a no-op for honor/zero-amount bounties.
      try {
        await (supabase as any).rpc('fn_open_dispute_hold', { p_dispute_id: data.id });
      } catch (holdErr) {
        // Log but do not fail dispute creation if the hold RPC fails.
        logger.error('Error placing dispute wallet hold', { error: holdErr, disputeId: data.id });
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
        evidence: [], // evidence should be uploaded via `uploadEvidence` and fetched separately
        status: data.status,
        resolution: data.resolution,
        winner: data.winner || null,
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
        winner: data.winner || null,
        resolvedBy: data.resolved_by,
        resolvedAt: data.resolved_at,
        escalated: data.escalated || false,
        escalatedAt: data.escalated_at,
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
        winner: data.winner || null,
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
   * Update dispute status
   */
  async updateDisputeStatus(
    disputeId: string,
    status: 'open' | 'under_review' | 'resolved' | 'closed' | 'cancelled' | 'resolved_poster_wins' | 'resolved_hunter_wins'
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Verify the current user has admin role
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id || !(await verifyAdminRole())) {
        logger.error('Non-admin attempted to update dispute status', { disputeId, status });
        throw new Error('Unauthorized: admin role required');
      }

      // For terminal statuses that have a defined hold-release semantic,
      // delegate to fn_close_dispute_hold which atomically releases the
      // balance_on_hold AND updates the dispute status in one DB transaction.
      const terminalStatuses = ['resolved', 'closed', 'cancelled', 'resolved_poster_wins', 'resolved_hunter_wins'];
      if (terminalStatuses.includes(status)) {
        const { error: rpcError } = await (supabase as any).rpc('fn_close_dispute_hold', {
          p_dispute_id: disputeId,
          p_new_status: status,
        });

        if (rpcError) {
          logger.error('Error releasing dispute hold via fn_close_dispute_hold', { rpcError, disputeId, status });
          // Fall through to plain status update so the dispute is still resolved.
          const { error } = await supabase
            .from('bounty_disputes')
            .update({ status })
            .eq('id', disputeId);

          if (error) {
            logger.error('Error updating dispute status (fallback)', { error, disputeId, status });
            throw error;
          }
        }

        return true;
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
   * Manually escalate a dispute (admin action)
   */
  async escalateDispute(disputeId: string, reason?: string): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase not configured');

      // Only admins may mark the official escalation flag
      if (!(await verifyAdminRole())) {
        logger.error('Non-admin attempted to escalate dispute', { disputeId });
        throw new Error('Unauthorized: admin role required');
      }

      const { error } = await supabase
        .from('bounty_disputes')
        .update({ escalated: true, escalated_at: new Date().toISOString() })
        .eq('id', disputeId);

      if (error) {
        logger.error('Error setting dispute escalated flag', { error, disputeId });
        throw error;
      }

      // Log audit event
      await this.logAuditEvent(disputeId, 'escalated', null, 'admin', { reason: reason || 'manual' });

      // Notify admins
      try {
        // Attempt to fetch dispute to include bounty id
        const d = await this.getDisputeById(disputeId);
        await notifyAdminsOfDispute(disputeId, d?.bountyId || '', reason || 'Manually escalated by admin');
      } catch (notifyErr) {
        logger.error('Failed to notify admins after manual escalation', { error: notifyErr, disputeId });
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in escalateDispute', { disputeId, error: { message: error.message } });
      return false;
    }
  },

  /**
   * Resolve a dispute
   * @param prefetchedBounty - Optional pre-fetched bounty to avoid redundant DB call
   */
  async resolveDispute(
    disputeId: string,
    resolution: string,
    winner?: 'hunter' | 'poster' | null,
    prefetchedBounty?: Bounty | null
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Verify the resolving user has admin role and derive resolved_by from session
      if (!(await verifyAdminRole())) {
        logger.error('Non-admin attempted to resolve dispute', { disputeId });
        throw new Error('Unauthorized: admin role required');
      }
      const { data: { session } } = await supabase.auth.getSession();
      const resolvedBy = session!.user!.id;

      // Get the dispute first to access its data
      const dispute = await this.getDisputeById(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      const updateData: Record<string, any> = {
        resolution,
        resolved_by: resolvedBy,
        resolved_at: new Date().toISOString(),
      };

      if (winner) {
        updateData.winner = winner;
      }

      // Map the winner to the new application-level resolution status and
      // atomically release the balance_on_hold via fn_close_dispute_hold.
      const resolvedStatus = winner === 'hunter'
        ? 'resolved_hunter_wins'
        : winner === 'poster'
          ? 'resolved_poster_wins'
          : 'resolved';

      const { error: holdRpcError } = await (supabase as any).rpc('fn_close_dispute_hold', {
        p_dispute_id: disputeId,
        p_new_status: resolvedStatus,
      });

      if (holdRpcError) {
        // Log and fall through — still apply the full updateData via plain update.
        logger.error('Error releasing dispute hold via fn_close_dispute_hold', {
          holdRpcError,
          disputeId,
          resolvedStatus,
        });
        updateData.status = 'resolved';
      }

      // Always write the extra metadata fields (resolution text, resolved_by, winner).
      const { error } = await supabase
        .from('bounty_disputes')
        .update(updateData)
        .eq('id', disputeId);

      if (error) {
        logger.error('Error resolving dispute', { error, disputeId });
        throw error;
      }

      // Use pre-fetched bounty if provided, otherwise fetch
      const bounty = prefetchedBounty || await bountyService.getById(dispute.bountyId);

      // Determine winner label for notifications
      const winnerLabel = winner === 'hunter'
        ? 'Funds released to hunter.'
        : winner === 'poster'
        ? 'Funds refunded to poster.'
        : '';

      // Execute escrow action based on winner
      let escrowActionExecuted = false;
      if (winner) {
        try {
          const isHonorBounty = bounty?.is_for_honor || !bounty?.amount || bounty.amount <= 0;

          if (bounty && !isHonorBounty && bounty.payment_intent_id) {
            if (winner === 'hunter') {
              const releaseResult = await paymentService.releaseEscrow(bounty.payment_intent_id);
              if (!releaseResult.success) {
                logger.error('Failed to release escrow to hunter during dispute resolution', {
                  disputeId,
                  bountyId: dispute.bountyId,
                  escrowId: bounty.payment_intent_id,
                  error: releaseResult.error,
                });
              } else {
                escrowActionExecuted = true;
              }
            } else if (winner === 'poster') {
              const refundResult = await paymentService.refundEscrow(bounty.payment_intent_id);
              if (!refundResult.success) {
                logger.error('Failed to refund escrow to poster during dispute resolution', {
                  disputeId,
                  bountyId: dispute.bountyId,
                  escrowId: bounty.payment_intent_id,
                  error: refundResult.error,
                });
              } else {
                escrowActionExecuted = true;
              }
            }
          } else if (bounty && !isHonorBounty && !bounty.payment_intent_id) {
            logger.warning('Dispute resolved with winner but bounty has no payment_intent_id — escrow action skipped', {
              disputeId,
              bountyId: dispute.bountyId,
              winner,
            });
          }
        } catch (escrowError) {
          // Log but don't fail the resolution if escrow action fails
          logger.error('Error executing escrow action during dispute resolution', {
            disputeId,
            winner,
            error: escrowError instanceof Error ? escrowError.message : String(escrowError),
          });
        }
      }

      // Send notifications to involved parties
      try {
        if (bounty) {
          // Only include funds outcome if escrow action actually executed
          const outcomeMessage = escrowActionExecuted && winnerLabel
            ? ` Outcome: ${winnerLabel}`
            : '';

          // Notify the dispute initiator
          await sendNotification(
            dispute.initiatorId,
            'dispute_resolved',
            'Dispute Resolved',
            `Your dispute for bounty "${bounty.title}" has been resolved.${outcomeMessage}`,
            {
              bountyId: dispute.bountyId,
              disputeId: disputeId,
              resolution: resolution.substring(0, 100), // Truncate for notification
              winner: winner || undefined,
            }
          );

          // Notify the bounty poster if different from initiator
          if (bounty.user_id && bounty.user_id !== dispute.initiatorId) {
            await sendNotification(
              String(bounty.user_id),
              'dispute_resolved',
              'Dispute Resolved',
              `A dispute for bounty "${bounty.title}" has been resolved.${outcomeMessage}`,
              {
                bountyId: dispute.bountyId,
                disputeId: disputeId,
                resolution: resolution.substring(0, 100),
                winner: winner || undefined,
              }
            );
          }

          // Get cancellation to notify other party if exists
          const cancellation = dispute.cancellationId ? await cancellationService.getCancellationById(dispute.cancellationId) : null;
          if (cancellation && 
              cancellation.requesterId && 
              cancellation.requesterId !== dispute.initiatorId && 
              cancellation.requesterId !== bounty.user_id) {
            await sendNotification(
              cancellation.requesterId,
              'dispute_resolved',
              'Dispute Resolved',
              `A dispute for bounty "${bounty.title}" has been resolved.${outcomeMessage}`,
              {
                bountyId: dispute.bountyId,
                disputeId: disputeId,
                resolution: resolution.substring(0, 100),
                winner: winner || undefined,
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
        winner: item.winner || null,
        resolvedBy: item.resolved_by,
        resolvedAt: item.resolved_at,
        escalated: item.escalated || false,
        escalatedAt: item.escalated_at,
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
        winner: item.winner || null,
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
      // Map decision outcome to winner for escrow action
      const winner = decision.outcome === 'release' ? 'hunter' as const
        : decision.outcome === 'refund' ? 'poster' as const
        : null;
      await this.resolveDispute(disputeId, decision.rationale, winner, bounty);

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

        // Notify admins about escalation
        try {
          await notifyAdminsOfDispute(String(dispute.id), String(dispute.bounty_id), 'Unresolved for 14 days');
        } catch (notifyErr) {
          logger.error('Error notifying admins about escalated dispute', { error: notifyErr, disputeId: dispute.id });
        }

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
      const hasUserId = (bounty: unknown): bounty is { user_id: string } =>
        typeof (bounty as any)?.user_id === 'string';
      const hasPosterId = (bounty: unknown): bounty is { poster_id: string } =>
        typeof (bounty as any)?.poster_id === 'string';
      const hasHunterId = (bounty: unknown): bounty is { hunter_id: string } =>
        typeof (bounty as any)?.hunter_id === 'string';
      const hasAcceptedBy = (bounty: unknown): bounty is { accepted_by: string } =>
        typeof (bounty as any)?.accepted_by === 'string';

      const bounty = await bountyService.getById(dispute.bountyId);
      // Resolve cancellation to identify the hunter who requested it
      const cancellation = dispute.cancellationId ? await cancellationService.getCancellationById(dispute.cancellationId) : null;
      
      const hunterId =
        cancellation?.requesterId ||
        (hasHunterId(bounty) ? bounty.hunter_id :
        hasAcceptedBy(bounty) ? bounty.accepted_by :
        undefined);

      const posterId =
        hasUserId(bounty) ? bounty.user_id :
        hasPosterId(bounty) ? bounty.poster_id :
        undefined;

      if (bounty) {
        evidence.forEach((ev: any) => {
          const scoreValue = ev.type === 'image'
            ? EVIDENCE_SCORE_IMAGE
            : ev.type === 'document'
            ? EVIDENCE_SCORE_DOCUMENT
            : EVIDENCE_SCORE_TEXT;

          if (hunterId && ev.uploaded_by === hunterId) {
            hunterScore += scoreValue;
          } else if (posterId && ev.uploaded_by === posterId) {
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

  /**
   * Create a workflow-stage dispute (no cancellation required).
   * Can be initiated by either poster or hunter during 'in_progress' or 'review_verify' stages.
   */
  async createWorkflowDispute(
    bountyId: string,
    initiatorId: string,
    respondentId: string,
    stage: 'in_progress' | 'review_verify',
    reason: string,
    evidence?: LocalDisputeEvidence[]
  ): Promise<BountyDispute | null> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Check for existing active dispute on this bounty
      const existing = await this.getDisputeByBountyId(bountyId);
      if (existing) {
        logger.error('Active dispute already exists for this bounty', { bountyId, existingId: existing.id });
        throw new Error('A dispute is already active for this bounty');
      }

      const disputeData = {
        bounty_id: bountyId,
        initiator_id: initiatorId,
        respondent_id: respondentId,
        reason,
        dispute_stage: stage,
        // cancellation_id is null for workflow disputes
        evidence_json: null,
        status: 'open',
      };

      const { data, error } = await supabase
        .from('bounty_disputes')
        .insert(disputeData)
        .select('*')
        .single();

      if (error || !data) {
        logger.error('Error creating workflow dispute', { error, disputeData });
        return null;
      }

      const dispute: BountyDispute = {
        id: data.id,
        cancellationId: data.cancellation_id || undefined,
        bountyId: String(data.bounty_id),
        initiatorId: data.initiator_id,
        respondentId: data.respondent_id || undefined,
        reason: data.reason,
        evidence: [],
        status: data.status,
        disputeStage: data.dispute_stage || 'cancellation',
        resolution: data.resolution,
        winner: data.winner || null,
        resolvedBy: data.resolved_by,
        resolvedAt: data.resolved_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };

      // Upload evidence items if provided
      if (evidence && evidence.length > 0) {
        for (const ev of evidence) {
          await this.uploadEvidence(dispute.id, initiatorId, {
            type: ev.type,
            content: ev.content,
            description: ev.description,
          });
        }
      }

      // Send notifications to the respondent
      try {
        const bounty = await bountyService.getById(bountyId);
        if (bounty) {
          await sendNotification(
            respondentId,
            'workflow_dispute_created',
            'Dispute Raised',
            `A dispute has been raised for bounty: ${bounty.title}`,
            {
              bountyId,
              disputeId: data.id,
              stage,
            }
          );
        }
      } catch (notifError) {
        logger.error('Error sending workflow dispute notification', { error: notifError });
      }

      // Log audit event
      await this.logAuditEvent(dispute.id, 'workflow_dispute_created', initiatorId, 'user', {
        stage,
        bountyId,
        respondentId,
      });

      return dispute;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in createWorkflowDispute', {
        bountyId,
        initiatorId,
        error: { message: error.message },
      });
      return null;
    }
  },

  /**
   * Get any active dispute for a bounty, optionally filtered by stage.
   */
  async getDisputeByBountyId(
    bountyId: string,
    stage?: 'in_progress' | 'review_verify' | 'cancellation'
  ): Promise<BountyDispute | null> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      let query = supabase
        .from('bounty_disputes')
        .select('*')
        .eq('bounty_id', bountyId)
        .in('status', ['open', 'under_review'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (stage) {
        query = query.eq('dispute_stage', stage);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        logger.error('Error fetching dispute by bounty', { error, bountyId, stage });
        return null;
      }

      if (!data) {
        return null;
      }

      return {
        id: data.id,
        cancellationId: data.cancellation_id || undefined,
        bountyId: String(data.bounty_id),
        initiatorId: data.initiator_id,
        respondentId: data.respondent_id || undefined,
        reason: data.reason,
        evidence: data.evidence_json ? JSON.parse(data.evidence_json) : [],
        status: data.status,
        disputeStage: data.dispute_stage || 'cancellation',
        resolution: data.resolution,
        winner: data.winner || null,
        resolvedBy: data.resolved_by,
        resolvedAt: data.resolved_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getDisputeByBountyId', { bountyId, error: { message: error.message } });
      return null;
    }
  },

  /**
   * Get all disputes for a user (as initiator OR respondent).
   */
  async getDisputesForUser(userId: string): Promise<BountyDispute[]> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      const { data, error } = await supabase
        .from('bounty_disputes')
        .select('*')
        .or(`initiator_id.eq.${userId},respondent_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Error fetching disputes for user', { error, userId });
        return [];
      }

      return (data || []).map((item: any) => ({
        id: item.id,
        cancellationId: item.cancellation_id || undefined,
        bountyId: String(item.bounty_id),
        initiatorId: item.initiator_id,
        respondentId: item.respondent_id || undefined,
        reason: item.reason,
        evidence: item.evidence_json ? JSON.parse(item.evidence_json) : undefined,
        status: item.status,
        disputeStage: item.dispute_stage || 'cancellation',
        resolution: item.resolution,
        winner: item.winner || null,
        resolvedBy: item.resolved_by,
        resolvedAt: item.resolved_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in getDisputesForUser', { userId, error: { message: error.message } });
      return [];
    }
  },
};
