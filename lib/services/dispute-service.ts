import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from 'lib/utils/error-logger';
import { isPhase2Bounty, isStripeNativeBounty, isV3Bounty } from 'lib/utils/payment-architecture';
import type { BountyDispute, DisputeEvidence, LocalDisputeEvidence } from '../types';
import { analyticsService } from './analytics-service';
import { failureEventProps } from '../utils/stripe-error';
import { bountyPaymentsService } from './bounty-payments-service';
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

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return false;

    return session.user.app_metadata?.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Helper to send notification via SECURITY DEFINER RPC so we can notify
 * users other than the currently authenticated one without violating the
 * `notifications_insert_own` RLS policy.
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

    const { error } = await supabase.rpc('send_system_notification', {
      p_user_id: userId,
      p_type: type,
      p_title: title,
      p_body: body,
      p_data: data ?? null,
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
async function notifyAdminsOfDispute(
  disputeId: string,
  bountyId: string,
  reason: string
): Promise<void> {
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
 * Normalize dispute id for RPCs: if the id is a pure integer (number or numeric
 * string), return it as a JS number so PostgREST calls the integer-typed RPC.
 * Otherwise return the original value (keeps tests and UUID-based schemas working).
 */
function normalizeDisputeIdParam(id: string | number): number | string {
  if (id === null || id === undefined) return id as any;
  if (typeof id === 'number' && Number.isInteger(id)) return id;
  const s = String(id).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isInteger(n)) return n;
  }
  return id;
}

/**
 * Service for handling bounty dispute lifecycle
 */

/**
 * `bounty_disputes.evidence_json` is a text column, and these mappers used a
 * bare `JSON.parse` on it. A single malformed row would throw and blank the
 * whole dispute list rather than degrading that one record, so parsing is
 * isolated per row.
 */
function parseEvidenceJson(raw: unknown): DisputeEvidence[] | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(raw);
    // The column has held both a bare array and, in older rows, a single
    // object. Anything else is not usable evidence.
    if (Array.isArray(parsed)) return parsed as DisputeEvidence[];
    if (parsed && typeof parsed === 'object') return [parsed as DisputeEvidence];
    return undefined;
  } catch {
    logger.error('Unparseable evidence_json on a dispute row; leaving it undefined');
    return undefined;
  }
}

/**
 * bounty_disputes.reason_code (CHECK-constrained in the database). The category
 * support filters on; the free-text `reason` still carries the detail.
 */
export type DisputeReasonCode =
  | 'hunter_unresponsive'
  | 'poster_unresponsive'
  | 'work_quality'
  | 'scope_disagreement'
  | 'missed_deadline'
  | 'communication'
  | 'other';

/**
 * What happened to the escrow when a dispute was decided.
 *  - released / refunded: money moved in this call
 *  - already_settled:     a release or refund was already on the ledger
 *  - pending_confirmation: Stripe accepted a transfer request, awaiting webhook confirmation
 *  - canceled:            an uncaptured payment authorization was canceled
 *  - nothing_held:        no escrow record to move (check Transactions)
 *  - not_applicable:      no winner, or an honor / unpaid bounty
 *  - failed:              a confirmed rejection; no money moved
 *  - unknown:             settlement may have occurred; reconcile before retrying
 */
export type DisputeSettlementStatus =
  | 'released'
  | 'refunded'
  | 'already_settled'
  | 'pending_confirmation'
  | 'canceled'
  | 'nothing_held'
  | 'not_applicable'
  | 'unknown'
  | 'failed';

export interface DisputeSettlement {
  status: DisputeSettlementStatus;
  /** Operator-facing explanation, set when settlement needs attention. */
  detail?: string;
}

export interface DisputeResolutionOutcome {
  /** The dispute row carries the resolved status (and winner, if any). */
  resolved: boolean;
  settlement: DisputeSettlement;
  /** Why the resolution itself failed, when resolved is false. */
  error?: string;
}

function settlementErrorOutcome(err: unknown): DisputeSettlement {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  if (code === 'release_pending' || /transfer requested\. waiting for stripe confirmation/i.test(message)) {
    return {
      status: 'pending_confirmation',
      detail: 'Stripe has a transfer request pending confirmation. Wait for Stripe confirmation before taking another action.',
    };
  }
  if (code === 'not_poster' || /only the poster/i.test(message)) {
    return {
      status: 'failed',
      detail: 'The payment service only lets the poster release or cancel this Stripe payment, so it cannot be settled from the admin console yet. No money moved.',
    };
  }
  return {
    status: 'unknown',
    detail: `${message || 'Unknown error'}. The settlement outcome could not be confirmed. Contact support for reconciliation; do not retry.`,
  };
}

/**
 * Move the escrow for a decided dispute. Never throws: every path ends in a
 * DisputeSettlement so the caller can tell the admin exactly what happened.
 */
async function settleDisputeEscrow(
  disputeId: string,
  bountyId: string,
  bounty: Bounty,
  winner: 'hunter' | 'poster'
): Promise<DisputeSettlement> {
  const isHonorBounty = bounty.is_for_honor || !bounty.amount || bounty.amount <= 0;
  if (isHonorBounty) return { status: 'not_applicable' };
  const isPhase2 = isPhase2Bounty(bounty);
  const architecture = isV3Bounty(bounty) ? 'v3' : 'v2';

  try {
    await analyticsService.trackEvent('payment_architecture_routed', {
      bountyId,
      version: isV3Bounty(bounty) ? 3 : isPhase2 ? 2 : 1,
      context: 'dispute_resolution',
    });
  } catch {
    /* analytics is best-effort */
  }

  try {
    if (isPhase2) {
      // Stripe-native Phase 2 escrow (bounty_payments) — see
      // lib/services/bounty-payments-service.ts.
      if (winner === 'hunter') {
        try {
          const result = await bountyPaymentsService.releaseBountyPayment(bountyId);
          if (result.released) {
            if (result.reused) return { status: 'already_settled' };
            await analyticsService.trackEvent('escrow_released', {
              bountyId,
              architecture,
              via: 'dispute_resolution',
            });
            return { status: 'released' };
          }
          if (result.status === 'release_pending') {
            return {
              status: 'pending_confirmation',
              detail: 'Stripe accepted the transfer request. Payment is pending Stripe confirmation; no funds-released notice was sent.',
            };
          }
          return {
            status: 'unknown',
            detail: `The payment service returned an unconfirmed release status (${result.status || 'unknown'}). Contact support for reconciliation; do not retry.`,
          };
        } catch (releaseErr) {
          logger.error('Failed to release Phase 2 escrow to hunter during dispute resolution', {
            disputeId,
            bountyId,
            error: releaseErr,
          });
          await analyticsService.trackEvent('payment_failed', {
            bountyId,
            architecture,
            stage: 'dispute_release',
            ...failureEventProps(releaseErr),
          });
          return settlementErrorOutcome(releaseErr);
        }
      }
      try {
        const result = await bountyPaymentsService.cancelBountyPayment(bountyId);
        const status = result.status.toLowerCase();
        if (status === 'canceled') {
          return {
            status: 'canceled',
            detail: 'The payment authorization was canceled before capture; no refund was needed.',
          };
        }
        if (status !== 'refunded') {
          return {
            status: 'unknown',
            detail: `The payment service returned an unconfirmed cancellation status (${status || 'unknown'}). Contact support for reconciliation; do not retry.`,
          };
        }
        if (result.reused) return { status: 'already_settled' };
        await analyticsService.trackEvent('escrow_refunded', {
          bountyId,
          architecture,
          via: 'dispute_resolution',
        });
        return { status: 'refunded' };
      } catch (refundErr) {
        logger.error('Failed to refund Phase 2 escrow to poster during dispute resolution', {
          disputeId,
          bountyId,
          error: refundErr,
        });
        await analyticsService.trackEvent('payment_failed', {
          bountyId,
          architecture,
          stage: 'dispute_cancel',
          ...failureEventProps(refundErr),
        });
        return settlementErrorOutcome(refundErr);
      }
    }

    if (bounty.payment_intent_id) {
      const result =
        winner === 'hunter'
          ? await paymentService.releaseEscrow(bounty.payment_intent_id)
          : await paymentService.refundEscrow(bounty.payment_intent_id);
      if (!result.success) {
        logger.error(
          winner === 'hunter'
            ? 'Failed to release escrow to hunter during dispute resolution'
            : 'Failed to refund escrow to poster during dispute resolution',
          {
            disputeId,
            bountyId,
            escrowId: bounty.payment_intent_id,
            error: result.error,
          }
        );
        return {
          ...settlementErrorOutcome(result.error ?? 'Payment service refused'),
        };
      }
      return { status: winner === 'hunter' ? 'released' : 'refunded' };
    }

    // Wallet-escrow path (no Stripe PaymentIntent). Funds were deducted from
    // the poster's wallet and live in the wallet ledger. Both RPCs are
    // SECURITY DEFINER, atomic and idempotent, and return
    // { applied, transaction_id, <amount> }.
    const rpcName =
      winner === 'poster'
        ? 'fn_refund_wallet_escrow_for_dispute'
        : 'fn_release_wallet_escrow_for_dispute';
    const { data, error: rpcError } = await (supabase as any).rpc(rpcName, {
      p_dispute_id: normalizeDisputeIdParam(disputeId),
    });
    if (rpcError) {
      logger.error(
        winner === 'poster'
          ? 'Failed to refund wallet escrow to poster during dispute resolution'
          : 'Failed to release wallet escrow to hunter during dispute resolution',
        { disputeId, bountyId, error: rpcError }
      );
      return settlementErrorOutcome(rpcError);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.applied) {
      return { status: winner === 'hunter' ? 'released' : 'refunded' };
    }
    if (row?.transaction_id) {
      // No-op because a release/refund is already on the ledger.
      return { status: 'already_settled' };
    }
    logger.warning(`${rpcName} found nothing to settle`, { disputeId, bountyId });
    return {
      status: 'nothing_held',
      detail:
        'No escrow record was found for this bounty, so no money moved. Check Transactions before closing this out.',
    };
  } catch (escrowError) {
    logger.error('Error executing escrow action during dispute resolution', {
      disputeId,
      winner,
      error: escrowError instanceof Error ? escrowError.message : String(escrowError),
    });
    return settlementErrorOutcome(escrowError);
  }
}

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

      // Explicitly call fn_open_dispute_hold to freeze the poster's wallet balance.
      // If the hold cannot be placed, roll back by deleting the dispute and return null
      // so the caller is not left with an orphaned dispute that has no escrow hold.
      const _pDisputeId = normalizeDisputeIdParam(data.id);
      const { error: holdError } = await supabase.rpc('fn_open_dispute_hold', {
        p_dispute_id: _pDisputeId,
      });

      if (holdError) {
        logger.error('Error placing dispute hold; rolling back dispute', {
          error: holdError,
          disputeId: data.id,
        });
        await supabase.from('bounty_disputes').delete().eq('id', data.id);
        return null;
      }

      // Update the cancellation status now that the dispute row exists.
      const { error: updateError } = await supabase
        .from('bounty_cancellations')
        .update({ status: 'disputed' })
        .eq('id', cancellationId);

      if (updateError) {
        // Log but do not fail the overall operation — dispute exists even if cancellation update failed.
        logger.error('Error updating cancellation to disputed', {
          error: updateError,
          cancellationId,
        });
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

      // Funnel: dispute opened. Emit after the wallet hold has been placed
      // and the cancellation has been linked, so we only count fully-formed
      // disputes (not rolled-back orphan inserts).
      try {
        await analyticsService.trackEvent('dispute_started', {
          dispute_id: String(data.id),
          bounty_id: String(data.bounty_id),
          cancellation_id: String(cancellationId),
          initiator_id: String(initiatorId),
          stage: 'cancellation',
          has_evidence: !!(evidence && evidence.length > 0),
          evidence_count: evidence?.length || 0,
        });
      } catch {
        /* analytics is best-effort */
      }

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
          if (
            cancellation.requesterId &&
            cancellation.requesterId !== initiatorId &&
            cancellation.requesterId !== bounty.user_id
          ) {
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
        error: { message: error.message },
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
      logger.error('Error in getDisputeByCancellationId', {
        cancellationId,
        error: { message: error.message },
      });
      return null;
    }
  },

  /**
   * Update dispute status
   */
  async updateDisputeStatus(
    disputeId: string,
    status:
      | 'open'
      | 'under_review'
      | 'resolved'
      | 'closed'
      | 'cancelled'
      | 'resolved_poster_wins'
      | 'resolved_hunter_wins'
  ): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Verify the current user has admin role
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id || !(await verifyAdminRole())) {
        logger.error('Non-admin attempted to update dispute status', { disputeId, status });
        throw new Error('Unauthorized: admin role required');
      }

      // For terminal statuses that have a defined hold-release semantic,
      // delegate to fn_close_dispute_hold which atomically releases the
      // balance_on_hold AND updates the dispute status in one DB transaction.
      const terminalStatuses = [
        'resolved',
        'closed',
        'cancelled',
        'resolved_poster_wins',
        'resolved_hunter_wins',
      ];
      if (terminalStatuses.includes(status)) {
        const _pDisputeId = normalizeDisputeIdParam(disputeId);
        const { error: rpcError } = await (supabase as any).rpc('fn_close_dispute_hold', {
          p_dispute_id: _pDisputeId,
          p_new_status: status,
        });

        if (rpcError) {
          // Treat hold-release failure as fatal for terminal transitions: surfacing
          // this error ensures the admin UI can show that the financial side did not
          // finalize, rather than silently leaving balance_on_hold stranded.
          logger.error('Error releasing dispute hold via fn_close_dispute_hold', {
            rpcError,
            disputeId,
            status,
          });
          throw rpcError;
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
        error: { message: error.message },
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

      // bounty_disputes has no escalated_at column (prod or staging); writing
      // it made PostgREST reject the whole update, so this button never worked.
      const { error } = await supabase
        .from('bounty_disputes')
        .update({ escalated: true, last_activity_at: new Date().toISOString() })
        .eq('id', disputeId);

      if (error) {
        logger.error('Error setting dispute escalated flag', { error, disputeId });
        throw error;
      }

      // Log audit event
      await this.logAuditEvent(disputeId, 'escalated', null, 'admin', {
        reason: reason || 'manual',
      });

      // Notify admins
      try {
        // Attempt to fetch dispute to include bounty id
        const d = await this.getDisputeById(disputeId);
        await notifyAdminsOfDispute(
          disputeId,
          d?.bountyId || '',
          reason || 'Manually escalated by admin'
        );
      } catch (notifyErr) {
        logger.error('Failed to notify admins after manual escalation', {
          error: notifyErr,
          disputeId,
        });
      }

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in escalateDispute', { disputeId, error: { message: error.message } });
      return false;
    }
  },

  /**
   * Ask support to prioritise a dispute (participant action).
   *
   * Participants cannot change a dispute's status (only admins decide), so
   * this flags the dispute through the request_dispute_escalation RPC instead
   * of the old direct `status: 'under_review'` update, which RLS now rejects.
   * Throws on failure so the caller never reports a no-op as success.
   */
  async requestEscalation(disputeId: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('request_dispute_escalation', {
      p_dispute_id: normalizeDisputeIdParam(disputeId),
    });
    if (error) {
      logger.error('Error requesting dispute escalation', { error, disputeId });
      throw error;
    }
  },

  /**
   * Resolve a dispute.
   *
   * Returns true once the dispute row is resolved, whatever happened to the
   * money. Use resolveDisputeWithOutcome() wherever the caller tells a person
   * what happened: it reports the settlement separately.
   * @param prefetchedBounty - Optional pre-fetched bounty to avoid redundant DB call
   */
  async resolveDispute(
    disputeId: string,
    resolution: string,
    winner?: 'hunter' | 'poster' | null,
    prefetchedBounty?: Bounty | null
  ): Promise<boolean> {
    const outcome = await this.resolveDisputeWithOutcome(
      disputeId,
      resolution,
      winner,
      prefetchedBounty
    );
    return outcome.resolved;
  },

  /**
   * Resolve a dispute and report what actually happened to the money.
   *
   * The dispute row is resolved first (the wallet escrow RPCs only pay out
   * against a dispute that already says resolved_hunter_wins /
   * resolved_poster_wins), then the escrow is settled. Those are separate
   * steps, so the outcome reports them separately: `resolved: true` with
   * `settlement.status: 'failed'` means the decision is recorded but NO money
   * moved, and retryDisputeSettlement() can finish the job.
   */
  async resolveDisputeWithOutcome(
    disputeId: string,
    resolution: string,
    winner?: 'hunter' | 'poster' | null,
    prefetchedBounty?: Bounty | null
  ): Promise<DisputeResolutionOutcome> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Verify the resolving user has admin role and derive resolved_by from session
      if (!(await verifyAdminRole())) {
        logger.error('Non-admin attempted to resolve dispute', { disputeId });
        throw new Error('Unauthorized: admin role required');
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
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

      // Fetch the bounty early — we need it both to choose the correct hold-release
      // strategy and for the Stripe escrow action further below.
      const bounty = prefetchedBounty || (await bountyService.getById(dispute.bountyId));
      if (!bounty && winner) {
        const detail = 'Failed to load the bounty and payment state. The dispute was not resolved; retry after the lookup succeeds.';
        return { resolved: false, settlement: { status: 'failed', detail }, error: detail };
      }
      const isHonorBounty = bounty?.is_for_honor || !bounty?.amount || bounty.amount <= 0;
      const hasStripeEscrow = bounty && !isHonorBounty && !!bounty.payment_intent_id;
      const isPhase2 = !!bounty && !isHonorBounty && isPhase2Bounty(bounty);
      const isStripeNative = !!bounty && !isHonorBounty && isStripeNativeBounty(bounty);

      // Map the winner to the new application-level resolution status and
      // atomically release the balance_on_hold via fn_close_dispute_hold.
      const resolvedStatus =
        winner === 'hunter'
          ? 'resolved_hunter_wins'
          : winner === 'poster'
          ? 'resolved_poster_wins'
          : 'resolved';

      // For Stripe-backed bounties resolved in the hunter's favour, fn_close_dispute_hold
      // must NOT deduct from the poster's wallet.  The wallet hold was placed purely to
      // prevent withdrawal during the dispute — the actual hunter payment is handled by
      // the escrow settlement below.  Passing 'resolved' releases only the
      // balance_on_hold without triggering the balance deduction that 'resolved_hunter_wins'
      // would cause, which would double-charge the poster (once via Stripe, once via wallet).
      // The dispute row's status is corrected to resolvedStatus by the update() call below.
      const holdReleaseStatus =
        winner === 'hunter' && (hasStripeEscrow || isStripeNative) ? 'resolved' : resolvedStatus;

      const _pDisputeId = normalizeDisputeIdParam(disputeId);
      const { error: holdRpcError } = await (supabase as any).rpc('fn_close_dispute_hold', {
        p_dispute_id: _pDisputeId,
        p_new_status: holdReleaseStatus,
      });

      if (holdRpcError) {
        logger.error('Error releasing dispute hold via fn_close_dispute_hold', {
          holdRpcError,
          disputeId,
          resolvedStatus,
        });
        throw holdRpcError;
      }

      updateData.status = resolvedStatus;

      // Write the extra metadata fields (resolution text, resolved_by, winner).
      const { error } = await supabase
        .from('bounty_disputes')
        .update(updateData)
        .eq('id', disputeId);

      if (error) {
        logger.error('Error resolving dispute', { error, disputeId });
        throw error;
      }

      // Funnel: dispute resolved. Emitted after the DB row is updated and
      // the wallet hold has been released; escrow side-effects (release/
      // refund) are tracked separately via payment_completed.
      try {
        await analyticsService.trackEvent('dispute_resolved', {
          disputeId: String(disputeId),
          bountyId: String(dispute.bountyId),
          initiatorId: String(dispute.initiatorId),
          winner: winner || undefined,
          resolvedStatus,
          isHonorBounty: !!isHonorBounty,
          hasStripeEscrow: !!hasStripeEscrow,
          paymentArchitectureVersion: isV3Bounty(bounty) ? 3 : isPhase2 ? 2 : 1,
        });
      } catch {
        /* analytics is best-effort */
      }

      const settlement = winner
        ? await settleDisputeEscrow(disputeId, String(dispute.bountyId), bounty!, winner)
        : ({ status: 'not_applicable' } as DisputeSettlement);

      await this.logAuditEvent(disputeId, 'resolved', resolvedBy, 'admin', {
        winner: winner ?? null,
        resolved_status: resolvedStatus,
        settlement: settlement.status,
        settlement_detail: settlement.detail ?? null,
      });

      // Determine winner label for notifications
      const winnerLabel =
        winner === 'hunter'
          ? 'Funds released to hunter.'
          : winner === 'poster'
          ? 'Funds refunded to poster.'
          : '';
      const escrowActionExecuted =
        settlement.status === 'released' || settlement.status === 'refunded';

      // Send notifications to involved parties
      try {
        if (bounty) {
          // Only include funds outcome if escrow action actually executed
          const outcomeMessage =
            escrowActionExecuted && winnerLabel ? ` Outcome: ${winnerLabel}` : '';

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
          const cancellation = dispute.cancellationId
            ? await cancellationService.getCancellationById(dispute.cancellationId)
            : null;
          if (
            cancellation &&
            cancellation.requesterId &&
            cancellation.requesterId !== dispute.initiatorId &&
            cancellation.requesterId !== bounty.user_id
          ) {
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

      return { resolved: true, settlement };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error in resolveDispute', {
        disputeId,
        error: { message: error.message },
      });
      return { resolved: false, settlement: { status: 'not_applicable' }, error: error.message };
    }
  },

  /**
   * Finish the money side of a dispute that is already resolved but whose
   * escrow did not move (resolveDisputeWithOutcome returned settlement
   * 'failed'). Safe to repeat: the wallet RPCs refuse to settle twice and
   * only act on a dispute whose status and winner agree.
   */
  async retryDisputeSettlement(disputeId: string): Promise<DisputeSettlement> {
    if (!isSupabaseConfigured) {
      return { status: 'failed', detail: 'Supabase not configured' };
    }
    if (!(await verifyAdminRole())) {
      return { status: 'failed', detail: 'Admin role required' };
    }
    const dispute = await this.getDisputeById(disputeId);
    if (!dispute) {
      return { status: 'failed', detail: 'Dispute not found' };
    }
    const winner =
      dispute.status === 'resolved_hunter_wins' && dispute.winner === 'hunter'
        ? 'hunter'
        : dispute.status === 'resolved_poster_wins' && dispute.winner === 'poster'
        ? 'poster'
        : null;
    if (!winner) {
      return {
        status: 'failed',
        detail: 'Only a dispute resolved for the hunter or the poster can be settled.',
      };
    }
    const bounty = await bountyService.getById(dispute.bountyId);
    if (!bounty) {
      return {
        status: 'failed',
        detail: 'Failed to load the bounty and payment state. No settlement was attempted; retry after the lookup succeeds.',
      };
    }
    const settlement = await settleDisputeEscrow(
      disputeId,
      String(dispute.bountyId),
      bounty,
      winner
    );
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await this.logAuditEvent(disputeId, 'settlement_retried', session?.user?.id ?? null, 'admin', {
      winner,
      settlement: settlement.status,
      settlement_detail: settlement.detail ?? null,
    });
    return settlement;
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
        evidence: parseEvidenceJson(item.evidence_json),
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

      // Bounded: this backs the admin dispute queue and previously had no
      // LIMIT. Oldest-first is deliberate — the queue is worked in age order,
      // so a cap keeps the most overdue disputes rather than dropping them.
      const { data, error } = await supabase
        .from('bounty_disputes')
        .select('*')
        .in('status', ['open', 'under_review'])
        .order('created_at', { ascending: true })
        .limit(200);

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
        evidence: parseEvidenceJson(item.evidence_json),
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

      const { error } = await supabase.from('dispute_evidence').insert({
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

      const { error } = await supabase.from('dispute_comments').insert({
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

      // No `profiles` embed: comment authors are other participants/admins, and
      // the base table's SELECT RLS is self-only (`auth.uid() = id`), so the
      // embed resolved to null for every comment the caller did not write.
      // Author display data comes from `public_profiles`.
      // See docs/withdrawals/08-profiles-rls-migration-strategy.md.
      let query = supabase
        .from('dispute_comments')
        .select('*')
        .eq('dispute_id', disputeId);

      if (!includeInternal) {
        query = query.eq('is_internal', false);
      }

      const { data, error } = await query.order('created_at', { ascending: true });

      if (error) {
        logger.error('Error fetching dispute comments', { error, disputeId });
        return [];
      }

      const comments = data || [];
      const authorIds = Array.from(
        new Set(comments.map((c: any) => c.user_id).filter(Boolean))
      );
      if (authorIds.length === 0) return comments;

      const { data: profiles, error: profilesError } = await supabase
        .from('public_profiles')
        .select('id, username, avatar')
        .in('id', authorIds);

      if (profilesError) {
        // Non-fatal — return the comments unenriched rather than losing them.
        logger.warning('Could not fetch dispute comment author profiles', {
          error: profilesError,
          disputeId,
        });
        return comments;
      }

      const profileMap = new Map((profiles || []).map((p: any) => [String(p.id), p]));
      return comments.map((c: any) => ({
        ...c,
        profiles: profileMap.get(String(c.user_id)) ?? null,
      }));
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
      const winner =
        decision.outcome === 'release'
          ? ('hunter' as const)
          : decision.outcome === 'refund'
            ? ('poster' as const)
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
        error: { message: error.message },
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
  async createAppeal(disputeId: string, appellantId: string, reason: string): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Verify dispute is resolved
      const dispute = await this.getDisputeById(disputeId);
      const resolvedStatuses = ['resolved', 'resolved_hunter_wins', 'resolved_poster_wins'];
      if (!dispute || !resolvedStatuses.includes(dispute.status)) {
        throw new Error('Can only appeal resolved disputes');
      }

      const { error } = await supabase.from('dispute_appeals').insert({
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
        // Use fn_close_dispute_hold to atomically update the status AND release
        // any balance_on_hold on the poster's wallet. A plain .update() would
        // skip the hold-release, permanently locking poster funds.
        const { error: rpcError } = await (supabase as any).rpc('fn_close_dispute_hold', {
          p_dispute_id: dispute.id,
          p_new_status: 'closed',
        });

        if (rpcError) {
          logger.error('Error auto-closing dispute via fn_close_dispute_hold', {
            error: rpcError,
            disputeId: dispute.id,
          });
          continue;
        }

        // Set audit fields that fn_close_dispute_hold does not write.
        const { error: auditError } = await supabase
          .from('bounty_disputes')
          .update({
            resolution: 'Auto-closed due to inactivity after 7 days',
            resolved_at: now,
          })
          .eq('id', dispute.id);

        if (auditError) {
          logger.error('Error setting auto-close audit fields', {
            error: auditError,
            disputeId: dispute.id,
          });
          // Non-fatal: the status and hold were already released successfully.
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
          await notifyAdminsOfDispute(
            String(dispute.id),
            String(dispute.bounty_id),
            'Unresolved for 14 days'
          );
        } catch (notifyErr) {
          logger.error('Error notifying admins about escalated dispute', {
            error: notifyErr,
            disputeId: dispute.id,
          });
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
      const cancellation = dispute.cancellationId
        ? await cancellationService.getCancellationById(dispute.cancellationId)
        : null;

      const hunterId =
        cancellation?.requesterId ||
        (hasHunterId(bounty)
          ? bounty.hunter_id
          : hasAcceptedBy(bounty)
            ? bounty.accepted_by
            : undefined);

      const posterId = hasUserId(bounty)
        ? bounty.user_id
        : hasPosterId(bounty)
          ? bounty.poster_id
          : undefined;

      if (bounty) {
        evidence.forEach((ev: any) => {
          const scoreValue =
            ev.type === 'image'
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
        reasoning =
          'Hunter provided significantly more evidence. Recommend releasing funds to hunter.';
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
        error: { message: error.message },
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

      // PostgREST reports a rejected insert in `error`, it does not throw;
      // without this check a failed audit write vanished silently.
      const { error } = await supabase.from('dispute_audit_log').insert({
        dispute_id: disputeId,
        action,
        actor_id: actorId,
        actor_type: actorType,
        details,
      });
      if (error) {
        logger.error('dispute_audit_log insert failed', { disputeId, action, error });
      }
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
    evidence?: LocalDisputeEvidence[],
    reasonCode?: DisputeReasonCode
  ): Promise<BountyDispute | null> {
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase not configured');
      }

      // Check for existing active dispute on this bounty
      const existing = await this.getDisputeByBountyId(bountyId);
      if (existing) {
        logger.error('Active dispute already exists for this bounty', {
          bountyId,
          existingId: existing.id,
        });
        throw new Error('A dispute is already active for this bounty');
      }

      const disputeData: Record<string, unknown> = {
        bounty_id: bountyId,
        initiator_id: initiatorId,
        respondent_id: respondentId,
        reason,
        dispute_stage: stage,
        // cancellation_id is null for workflow disputes
        evidence_json: null,
        status: 'open',
        // Lets support filter the queue (e.g. "Hunter hasn't responded").
        // See 20261002120100_review_window_and_recourse_queue.sql.
        ...(reasonCode ? { reason_code: reasonCode } : {}),
      };

      let { data, error } = await supabase
        .from('bounty_disputes')
        .insert(disputeData)
        .select('*')
        .single();

      // A database without the reason_code column yet (PGRST204) must still
      // accept the dispute: the category is a filter, the dispute is the point.
      if (error && reasonCode && (error as { code?: string }).code === 'PGRST204') {
        const { reason_code: _omit, ...withoutCode } = disputeData;
        ({ data, error } = await supabase
          .from('bounty_disputes')
          .insert(withoutCode)
          .select('*')
          .single());
      }

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

      // Canonical `dispute_started` — workflow-stage dispute (no cancellation).
      // Previously this path emitted nothing, so in-progress / review-verify
      // disputes were invisible in analytics. `stage` distinguishes it from
      // the cancellation-derived dispute above.
      try {
        await analyticsService.trackEvent('dispute_started', {
          dispute_id: String(data.id),
          bounty_id: String(bountyId),
          initiator_id: String(initiatorId),
          respondent_id: String(respondentId),
          stage,
          has_evidence: !!(evidence && evidence.length > 0),
          evidence_count: evidence?.length || 0,
        });
      } catch {
        /* analytics is best-effort */
      }

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
      logger.error('Error in getDisputeByBountyId', {
        bountyId,
        error: { message: error.message },
      });
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
        evidence: parseEvidenceJson(item.evidence_json),
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
