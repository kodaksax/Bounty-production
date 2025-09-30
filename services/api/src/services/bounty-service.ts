import { db } from '../db/connection';
import { bounties } from '../db/schema';
import { eq } from 'drizzle-orm';
import { outboxService } from './outbox-service';
import { walletService } from './wallet-service';
import { realtimeService } from './realtime-service';

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

        // Update bounty status to in_progress
        await tx
          .update(bounties)
          .set({ 
            status: 'in_progress',
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

        return { success: true };
      });
    } catch (error) {
      console.error('Error accepting bounty:', error);
      return { success: false, error: 'Failed to accept bounty' };
    }
  }

  /**
   * Complete a bounty - transitions from 'in_progress' to 'completed'
   * Creates BOUNTY_COMPLETED outbox event and release transaction
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

        // Update bounty status to completed
        await tx
          .update(bounties)
          .set({ 
            status: 'completed',
            updated_at: new Date(),
          })
          .where(eq(bounties.id, bountyId));

        // Create release transaction if bounty had amount
        if (bounty.amount_cents > 0) {
          await walletService.createTransaction({
            user_id: completedBy, // Payment goes to the hunter who completed it
            bountyId: bountyId,
            type: 'release',
            amount: bounty.amount_cents / 100, // Convert cents to dollars
          });
        }

        // Create outbox event for BOUNTY_COMPLETED
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
        await realtimeService.publishBountyStatusChange(bountyId, 'completed');

        return { success: true };
      });
    } catch (error) {
      console.error('Error completing bounty:', error);
      return { success: false, error: 'Failed to complete bounty' };
    }
  }
}

export const bountyService = new BountyService();