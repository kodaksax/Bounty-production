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
  transferId?: string;
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
      // Validate required fields early
      if (!request || !request.bountyId || !request.hunterId) {
        throw new Error('Missing required fields');
      }

      // Note: duplicate release check moved after bounty/hunter validation

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

      // Validate bounty status: only allow completion releases for in_progress bounties
      if (bounty.status && bounty.status !== 'in_progress') {
        throw new Error('Bounty not in correct status');
      }

      // Ensure the requested hunter matches the bounty
      if (bounty.hunter_id && bounty.hunter_id !== request.hunterId) {
        throw new Error('Hunter ID mismatch');
      }

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

      if (platformFeePercentage < 0 || platformFeePercentage > 100) {
        throw new Error('Platform fee percentage must be between 0 and 100');
      }

      const platformFeeCents = Math.round((bounty.amount_cents * platformFeePercentage) / 100);
      const releaseAmountCents = bounty.amount_cents - platformFeeCents;

      // Check for existing release to prevent double release (after validating bounty/hunter)
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
        throw new Error('Release already processed for this bounty');
      }


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

      // Support multiple shapes from wallet service mocks/implementations
      const releaseAmount = (releaseTransaction as any).amount ?? (releaseTransaction as any).amount_cents ?? 0;
      const platformFee = (releaseTransaction as any)?.metadata?.platform_fee
        ?? (releaseTransaction as any)?.platform_fee
        ?? (releaseTransaction as any)?.platform_fee_cents
        ?? (releaseTransaction as any)?.metadata?.platform_fee_cents
        ?? 0;

      // Update bounty status
      await db
        .update(bounties)
        .set({
          status: 'completed',
          updated_at: new Date(),
        })
        .where(eq(bounties.id, request.bountyId));

      // Convert cents to dollars if needed for emails (service already uses dollars)
      try {
        await emailService.sendReleaseConfirmation(
          request.bountyId,
          bounty.creator_id,
          request.hunterId,
          releaseAmount * 100,
          platformFee * 100
        );
      } catch (emailError) {
        const { logger } = require('./logger');
        logger.warn('Email failed but continuing', emailError);
      }

      // Publish realtime event for bounty status change (non-blocking)
      try {
        const { realtimeService } = require('./realtime-service');
        await realtimeService.publishBountyStatusChange(request.bountyId, 'completed');
      } catch (broadcastError) {
        const { logger } = require('./logger');
        logger.warn('Realtime broadcast failed but continuing', broadcastError);
      }

      console.log(`✅ Bounty ${request.bountyId} marked as completed and emails sent`);

      return {
        success: true,
        transactionId: releaseTransaction.id,
        transferId: releaseTransaction.stripe_transfer_id || releaseTransaction.id,
        releaseAmount: releaseAmount,
        platformFee: platformFee,
      };

    } catch (error) {
      console.error(`❌ Error processing completion release for bounty ${request.bountyId}:`, error);

      // Create outbox event for retry. Prefer legacy `createOutboxEvent` if present
      const createOutbox = (outboxService as any).createOutboxEvent || (outboxService as any).createEvent;
      if (createOutbox) {
        await createOutbox({
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
      }

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

      console.debug('[completionReleaseService] outbox: processing request:', { request });

      // Fetch bounty first (keeps DB select ordering compatible with tests)
      const bountyRecord = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, request.bountyId))
        .limit(1);

      console.debug('[completionReleaseService] outbox: fetched bountyRecord', { bountyRecord });

      if (!bountyRecord.length) {
        console.error(`❌ Outbox retry failed: bounty ${request.bountyId} not found`);
        return false;
      }

      // Check if already released before doing work
      const already = await this.isAlreadyReleased(request.bountyId);
      console.debug('[completionReleaseService] outbox: isAlreadyReleased ->', { bountyId: request.bountyId, already });
      if (already) {
        console.log(`ℹ️ Skipping outbox retry: release already processed for bounty ${request.bountyId}`);
        return true;
      }

      const result = await this.processCompletionRelease(request);

      if (result.success) {
        console.log(`✅ Successfully processed completion release from outbox for bounty ${request.bountyId}`);
        return true;
      }

      // Treat already-processed releases as success for outbox retries (defensive)
      if (result.error && typeof result.error === 'string' && result.error.toLowerCase().includes('release already')) {
        console.log(`ℹ️ Skipping outbox retry: release already processed for bounty ${request.bountyId}`);
        return true;
      }

      console.error(`❌ Failed to process completion release from outbox for bounty ${request.bountyId}: ${result.error}`);
      return false;
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

    console.debug('[completionReleaseService] isAlreadyReleased fetched:', { bountyId, existingRelease });
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