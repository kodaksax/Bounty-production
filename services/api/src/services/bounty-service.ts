import { db } from '../db/connection';
import { bounties } from '../db/schema';
import { eq } from 'drizzle-orm';
import { outboxService } from './outbox-service';
import { walletService } from './wallet-service';
import { realtimeService } from './realtime-service';
import { emailService } from './email-service';
import { notificationService } from './notification-service';

export class BountyService {
  /**
   * Accept a bounty - transitions from 'open' to 'in_progress'
   * Creates BOUNTY_ACCEPTED outbox event and escrow transaction
   */
  async acceptBounty(bountyId: string, hunterId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Start a transaction
      return await db.transaction(async (tx) => {
        // Get the bounty
        const bountyResult = await tx
          .select()
          .from(bounties)
          .where(eq(bounties.id, bountyId))
          .limit(1);

        if (bountyResult.length === 0) {
          return { success: false, error: 'Bounty not found' };
        }

        const bounty = bountyResult[0];

        if (bounty.status !== 'open') {
          return { success: false, error: `Cannot accept bounty with status: ${bounty.status}` };
        }

        // Update bounty status to in_progress and set hunter
        await tx
          .update(bounties)
          .set({ 
            status: 'in_progress',
            hunter_id: hunterId,
            updated_at: new Date(),
          })
          .where(eq(bounties.id, bountyId));

        // Create escrow transaction if bounty has amount
        if (bounty.amount_cents > 0 && !bounty.is_for_honor) {
          // Create ESCROW_HOLD outbox event for PaymentIntent creation
          await outboxService.createEvent({
            type: 'ESCROW_HOLD',
            payload: {
              bountyId,
              creatorId: bounty.creator_id,
              amount: bounty.amount_cents,
              title: bounty.title,
            },
            status: 'pending',
          });

          // Create escrow transaction record
          await walletService.createTransaction({
            user_id: bounty.creator_id,
            bountyId: bountyId,
            type: 'escrow',
            amount: bounty.amount_cents / 100, // Convert cents to dollars
          });

          // Send escrow confirmation email
          await emailService.sendEscrowConfirmation(bountyId, bounty.creator_id);
        }

        // Create outbox event for BOUNTY_ACCEPTED
        await outboxService.createEvent({
          type: 'BOUNTY_ACCEPTED',
          payload: {
            bountyId,
            hunterId,
            creatorId: bounty.creator_id,
            amount: bounty.amount_cents,
            isForHonor: bounty.is_for_honor,
            title: bounty.title,
          },
          status: 'pending',
        });

        // Publish realtime event
        await realtimeService.publishBountyStatusChange(bountyId, 'in_progress');

        // Send notification to hunter
        try {
          await notificationService.notifyBountyAcceptance(hunterId, bountyId, bounty.title);
        } catch (error) {
          console.error('Failed to send acceptance notification:', error);
        }

        return { success: true };
      });
    } catch (error) {
      console.error('Error accepting bounty:', error);
      return { success: false, error: 'Failed to accept bounty' };
    }
  }

  /**
   * Complete a bounty - transitions from 'in_progress' to 'completed'
   * Creates COMPLETION_RELEASE outbox event to trigger fund transfer to hunter
   */
  async completeBounty(bountyId: string, completedBy: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Start a transaction
      return await db.transaction(async (tx) => {
        // Get the bounty
        const bountyResult = await tx
          .select()
          .from(bounties)
          .where(eq(bounties.id, bountyId))
          .limit(1);

        if (bountyResult.length === 0) {
          return { success: false, error: 'Bounty not found' };
        }

        const bounty = bountyResult[0];

        if (bounty.status !== 'in_progress') {
          return { success: false, error: `Cannot complete bounty with status: ${bounty.status}` };
        }

        // Verify that the person completing is the hunter who accepted it
        if (bounty.hunter_id && bounty.hunter_id !== completedBy) {
          return { 
            success: false, 
            error: 'Only the hunter who accepted this bounty can mark it as complete' 
          };
        }

        // Note: We do NOT update bounty status to 'completed' here.
        // The completion-release-service will update it after successful payment transfer.
        // This prevents race conditions where the bounty is marked complete before payment processes.

        // Create COMPLETION_RELEASE outbox event if bounty has payment
        if (bounty.amount_cents > 0 && !bounty.is_for_honor) {
          // Verify payment_intent_id exists
          if (!bounty.payment_intent_id) {
            return { success: false, error: 'No payment intent found for this bounty. Cannot process completion.' };
          }

          // Create outbox event for fund release
          await outboxService.createEvent({
            type: 'COMPLETION_RELEASE',
            payload: {
              bountyId,
              hunterId: completedBy,
              paymentIntentId: bounty.payment_intent_id,
              creatorId: bounty.creator_id,
              amount: bounty.amount_cents,
              title: bounty.title,
            },
            status: 'pending',
          });

          console.log(`💸 Created COMPLETION_RELEASE event for bounty ${bountyId}`);
        } else {
          // For honor-only bounties, mark as completed immediately
          await tx
            .update(bounties)
            .set({ 
              status: 'completed',
              updated_at: new Date(),
            })
            .where(eq(bounties.id, bountyId));
        }

        // Create outbox event for notifications
        await outboxService.createEvent({
          type: 'BOUNTY_COMPLETED',
          payload: {
            bountyId,
            completedBy,
            creatorId: bounty.creator_id,
            amount: bounty.amount_cents,
            isForHonor: bounty.is_for_honor,
            title: bounty.title,
          },
          status: 'pending',
        });

        // Publish realtime event
        await realtimeService.publishBountyStatusChange(bountyId, 'pending_payment'); // Work complete, payment pending

        // Send notifications
        try {
          // Notify the poster that bounty work is complete (pending payment for paid bounties)
          await notificationService.notifyBountyCompletion(bounty.creator_id, bountyId, bounty.title);
        } catch (error) {
          console.error('Failed to send completion notifications:', error);
        }

        return { success: true };
      });
    } catch (error) {
      console.error('Error completing bounty:', error);
      return { success: false, error: 'Failed to complete bounty' };
    }
  }
}

export const bountyService = new BountyService();