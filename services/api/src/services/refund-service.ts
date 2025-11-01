import { db } from '../db/connection';
import { bounties, walletTransactions } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { stripeConnectService } from './stripe-connect-service';
import { outboxService } from './outbox-service';

export interface RefundRequest {
  bountyId: string;
  reason?: string;
  cancelledBy: string;
}

export interface RefundResponse {
  success: boolean;
  refundId?: string;
  amount?: number;
  error?: string;
}

export class RefundService {
  /**
   * Process a refund for a cancelled bounty
   */
  async processRefund(request: RefundRequest): Promise<RefundResponse> {
    try {
      // Get bounty details
      const bountyRecord = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, request.bountyId))
        .limit(1);

      if (!bountyRecord.length) {
        return {
          success: false,
          error: 'Bounty not found',
        };
      }

      const bounty = bountyRecord[0];

      // Validate bounty can be refunded
      if (bounty.status === 'completed') {
        return {
          success: false,
          error: 'Cannot refund a completed bounty',
        };
      }

      if (bounty.is_for_honor) {
        return {
          success: false,
          error: 'Cannot refund honor-only bounties (no funds escrowed)',
        };
      }

      if (!bounty.payment_intent_id) {
        return {
          success: false,
          error: 'No payment intent found for this bounty',
        };
      }

      // Check if already refunded
      const existingRefund = await db
        .select()
        .from(walletTransactions)
        .where(and(
          eq(walletTransactions.bounty_id, request.bountyId),
          eq(walletTransactions.type, 'refund')
        ))
        .limit(1);

      if (existingRefund.length > 0) {
        return {
          success: false,
          error: 'Bounty has already been refunded',
        };
      }

      // Process the Stripe refund
      const refundResult = await stripeConnectService.refundPaymentIntent(
        bounty.payment_intent_id,
        request.bountyId,
        request.reason
      );

      if (!refundResult.success) {
        // Create outbox event for retry
        await outboxService.createEvent({
          type: 'REFUND_RETRY',
          payload: {
            bountyId: request.bountyId,
            paymentIntentId: bounty.payment_intent_id,
            reason: request.reason,
            error: refundResult.error,
            attempt_timestamp: new Date().toISOString(),
          },
        });

        return {
          success: false,
          error: refundResult.error || 'Refund failed',
        };
      }

      // Record the refund transaction in a database transaction
      await db.transaction(async (tx) => {
        // Create refund transaction record
        await tx.insert(walletTransactions).values({
          bounty_id: request.bountyId,
          user_id: bounty.creator_id, // Refund goes back to creator
          type: 'refund',
          amount_cents: refundResult.amount || bounty.amount_cents,
          stripe_transfer_id: refundResult.refundId,
          platform_fee_cents: 0, // No fee on refunds
        });

        // Update bounty status to cancelled
        await tx
          .update(bounties)
          .set({ 
            status: 'cancelled',
            updated_at: new Date(),
          })
          .where(eq(bounties.id, request.bountyId));
      });

      // Create outbox event for notifications
      await outboxService.createEvent({
        type: 'BOUNTY_REFUNDED',
        payload: {
          bountyId: request.bountyId,
          creatorId: bounty.creator_id,
          amount: refundResult.amount || bounty.amount_cents,
          refundId: refundResult.refundId,
          reason: request.reason,
          title: bounty.title,
        },
      });

      console.log(`✅ Successfully processed refund for bounty ${request.bountyId}: ${refundResult.refundId}`);

      return {
        success: true,
        refundId: refundResult.refundId,
        amount: (refundResult.amount || bounty.amount_cents) / 100, // Convert to dollars
      };

    } catch (error) {
      console.error(`❌ Error processing refund for bounty ${request.bountyId}:`, error);
      
      // Create outbox event for retry
      await outboxService.createEvent({
        type: 'REFUND_RETRY',
        payload: {
          bountyId: request.bountyId,
          reason: request.reason,
          error: error instanceof Error ? error.message : 'Unknown error',
          attempt_timestamp: new Date().toISOString(),
        },
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process refund from outbox event (for retry mechanism)
   */
  async processRefundFromOutbox(payload: any): Promise<boolean> {
    try {
      const request: RefundRequest = {
        bountyId: payload.bountyId,
        reason: payload.reason,
        cancelledBy: payload.cancelledBy || 'system',
      };

      const result = await this.processRefund(request);
      
      if (result.success) {
        console.log(`✅ Successfully processed refund from outbox for bounty ${request.bountyId}`);
        return true;
      } else {
        console.error(`❌ Failed to process refund from outbox for bounty ${request.bountyId}: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.error('Error processing refund from outbox:', error);
      return false;
    }
  }

  /**
   * Check if a bounty has already been refunded
   */
  async isAlreadyRefunded(bountyId: string): Promise<boolean> {
    const existingRefund = await db
      .select()
      .from(walletTransactions)
      .where(and(
        eq(walletTransactions.bounty_id, bountyId),
        eq(walletTransactions.type, 'refund')
      ))
      .limit(1);

    return existingRefund.length > 0;
  }

  /**
   * Get refund transaction details for a bounty
   */
  async getRefundTransaction(bountyId: string) {
    const refundTransaction = await db
      .select()
      .from(walletTransactions)
      .where(and(
        eq(walletTransactions.bounty_id, bountyId),
        eq(walletTransactions.type, 'refund')
      ))
      .limit(1);

    return refundTransaction.length > 0 ? refundTransaction[0] : null;
  }
}

// Export singleton instance
export const refundService = new RefundService();
