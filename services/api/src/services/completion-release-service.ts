import { and, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../db/connection';
import { bounties, users, walletTransactions } from '../db/schema';
import * as ConsolidatedWalletService from './consolidated-wallet-service';
import { emailService } from './email-service';
import { outboxService } from './outbox-service';

export interface CompletionReleaseRequest {
  bountyId: string;
  hunterId: string;
  paymentIntentId?: string; // Optional in new flow
  platformFeePercentage?: number; // Service now has a default
  idempotencyKey?: string;
}

export interface CompletionReleaseResponse {
  success: boolean;
  transactionId?: string;
  releaseAmount: number;
  platformFee: number;
  error?: string;
}

export class CompletionReleaseService {
  private stripe: Stripe | null = null;
  private isConfigured: boolean = false;
  private readonly DEFAULT_PLATFORM_FEE_PERCENTAGE = 5; // 5%

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (secretKey) {
      this.stripe = new Stripe(secretKey);
      this.isConfigured = true;
    } else {
      console.warn('[CompletionReleaseService] STRIPE_SECRET_KEY not configured. Service will be disabled.');
    }
  }

  private ensureConfigured() {
    if (!this.isConfigured || !this.stripe) {
      throw new Error('Stripe service not configured. Set STRIPE_SECRET_KEY environment variable.');
    }
  }

  /**
   * Process completion release when bounty is completed and PaymentIntent succeeded
   */
  async processCompletionRelease(request: CompletionReleaseRequest): Promise<CompletionReleaseResponse> {
    try {
      // Check for existing release to prevent double release
      const existingRelease = await db
        .select()
        .from(walletTransactions)
        .where(and(
          eq(walletTransactions.bounty_id, request.bountyId),
          eq(walletTransactions.type, 'release')
        ))
        .limit(1);

      if (existingRelease.length > 0) {
        console.warn(`⚠️ Attempted double release for bounty ${request.bountyId}. Existing release: ${existingRelease[0].id}`);
        return {
          success: false,
          releaseAmount: 0,
          platformFee: 0,
          error: 'Release already processed for this bounty',
        };
      }

      // Get bounty details
      const bountyRecord = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, request.bountyId))
        .limit(1);

      if (!bountyRecord.length) {
        throw new Error('Bounty not found');
      }

      const bounty = bountyRecord[0];

      if (bounty.is_for_honor) {
        throw new Error('Cannot process completion release for honor-only bounties');
      }

      if (bounty.amount_cents <= 0) {
        throw new Error('Cannot process completion release for zero amount bounties');
      }

      // Get hunter details
      const hunterRecord = await db
        .select()
        .from(users)
        .where(eq(users.id, request.hunterId))
        .limit(1);

      if (!hunterRecord.length) {
        throw new Error('Hunter not found');
      }

      const hunter = hunterRecord[0];

      if (!hunter.stripe_account_id) {
        throw new Error('Hunter does not have a Stripe Connect account');
      }

      // Calculate amounts
      const platformFeePercentage = request.platformFeePercentage || this.DEFAULT_PLATFORM_FEE_PERCENTAGE;
      const platformFeeCents = Math.round((bounty.amount_cents * platformFeePercentage) / 100);
      const releaseAmountCents = bounty.amount_cents - platformFeeCents;

      console.log(`💰 Processing completion release for bounty ${request.bountyId}:`, {
        totalAmount: bounty.amount_cents,
        platformFee: platformFeeCents,
        releaseAmount: releaseAmountCents,
        hunterId: request.hunterId,
        hunterStripeAccountId: hunter.stripe_account_id,
      });

      // Use consolidated wallet service for the release
      // This handles: balance updates, transaction creation, platform fees, and Stripe transfers
      const releaseTransaction = await ConsolidatedWalletService.releaseEscrow(
        request.bountyId,
        request.hunterId,
        request.idempotencyKey
      );

      const releaseAmount = releaseTransaction.amount;
      const platformFee = releaseTransaction.metadata?.platform_fee || 0;

      // Update bounty status
      await db
        .update(bounties)
        .set({
          status: 'completed',
          updated_at: new Date(),
        })
        .where(eq(bounties.id, request.bountyId));

      // Convert cents to dollars if needed for emails (service already uses dollars)
      await emailService.sendReleaseConfirmation(
        request.bountyId,
        bounty.creator_id,
        request.hunterId,
        releaseAmount * 100,
        platformFee * 100
      );

      // Publish realtime event for bounty status change
      const { realtimeService } = require('./realtime-service');
      await realtimeService.publishBountyStatusChange(request.bountyId, 'completed');

      console.log(`✅ Bounty ${request.bountyId} marked as completed and emails sent`);

      return {
        success: true,
        transactionId: releaseTransaction.id,
        releaseAmount: releaseAmount,
        platformFee: platformFee,
      };

    } catch (error) {
      console.error(`❌ Error processing completion release for bounty ${request.bountyId}:`, error);

      // Create outbox event for retry
      await outboxService.createEvent({
        type: 'COMPLETION_RELEASE',
        payload: {
          bountyId: request.bountyId,
          hunterId: request.hunterId,
          paymentIntentId: request.paymentIntentId,
          platformFeePercentage: request.platformFeePercentage,
          error: error instanceof Error ? error.message : 'Unknown error',
          attempt_timestamp: new Date().toISOString(),
        },
      });

      return {
        success: false,
        releaseAmount: 0,
        platformFee: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process completion release from outbox event (for retry mechanism)
   */
  async processCompletionReleaseFromOutbox(payload: any): Promise<boolean> {
    try {
      const request: CompletionReleaseRequest = {
        bountyId: payload.bountyId,
        hunterId: payload.hunterId,
        paymentIntentId: payload.paymentIntentId,
        platformFeePercentage: payload.platformFeePercentage,
      };

      const result = await this.processCompletionRelease(request);

      if (result.success) {
        console.log(`✅ Successfully processed completion release from outbox for bounty ${request.bountyId}`);
        return true;
      } else {
        console.error(`❌ Failed to process completion release from outbox for bounty ${request.bountyId}: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.error('Error processing completion release from outbox:', error);
      return false;
    }
  }

  /**
   * Check if a bounty has already been released
   */
  async isAlreadyReleased(bountyId: string): Promise<boolean> {
    const existingRelease = await db
      .select()
      .from(walletTransactions)
      .where(and(
        eq(walletTransactions.bounty_id, bountyId),
        eq(walletTransactions.type, 'release')
      ))
      .limit(1);

    return existingRelease.length > 0;
  }

  /**
   * Get release transaction details for a bounty
   */
  async getReleaseTransaction(bountyId: string) {
    const releaseTransaction = await db
      .select()
      .from(walletTransactions)
      .where(and(
        eq(walletTransactions.bounty_id, bountyId),
        eq(walletTransactions.type, 'release')
      ))
      .limit(1);

    return releaseTransaction.length > 0 ? releaseTransaction[0] : null;
  }
}

// Export singleton instance
export const completionReleaseService = new CompletionReleaseService();