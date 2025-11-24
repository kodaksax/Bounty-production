import { db } from '../db/connection';
import { bounties, users, walletTransactions } from '../db/schema';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';
import { outboxService } from './outbox-service';
import { notificationService } from './notification-service';
import { walletService } from './wallet-service';

export class StaleBountyService {
  /**
   * Detect and mark bounties as stale when their hunter's account is deleted
   * This should be called when a user account is being deleted
   */
  async detectStaleBounties(deletedUserId: string): Promise<{ success: boolean; staleBountyCount: number; error?: string }> {
    try {
      return await db.transaction(async (tx) => {
        // Find all bounties where this user is the hunter and bounty is in progress
        const affectedBounties = await tx
          .select()
          .from(bounties)
          .where(
            and(
              eq(bounties.hunter_id, deletedUserId),
              eq(bounties.status, 'in_progress'),
              eq(bounties.is_stale, false)
            )
          );

        if (affectedBounties.length === 0) {
          return { success: true, staleBountyCount: 0 };
        }

        // Mark each bounty as stale
        for (const bounty of affectedBounties) {
          await tx
            .update(bounties)
            .set({
              is_stale: true,
              stale_reason: 'hunter_deleted',
              stale_detected_at: new Date(),
              updated_at: new Date(),
            })
            .where(eq(bounties.id, bounty.id));

          // Create outbox event for stale bounty notification
          await outboxService.createEvent({
            type: 'BOUNTY_STALE',
            payload: {
              bountyId: bounty.id,
              creatorId: bounty.creator_id,
              hunterId: deletedUserId,
              title: bounty.title,
              amount: bounty.amount_cents,
              reason: 'hunter_deleted',
            },
            status: 'pending',
          });

          // Send notification to the bounty poster
          try {
            await notificationService.notifyBountyStale(
              bounty.creator_id,
              bounty.id,
              bounty.title
            );
          } catch (error) {
            console.error(`Failed to send stale bounty notification for bounty ${bounty.id}:`, error);
          }
        }

        console.log(`✅ Marked ${affectedBounties.length} bounties as stale for deleted user ${deletedUserId}`);
        return { success: true, staleBountyCount: affectedBounties.length };
      });
    } catch (error) {
      console.error('Error detecting stale bounties:', error);
      return { success: false, staleBountyCount: 0, error: 'Failed to detect stale bounties' };
    }
  }

  /**
   * Get all stale bounties for a specific poster
   */
  async getStaleBountiesForPoster(posterId: string): Promise<any[]> {
    try {
      const staleBounties = await db
        .select()
        .from(bounties)
        .where(
          and(
            eq(bounties.creator_id, posterId),
            eq(bounties.is_stale, true)
          )
        );

      return staleBounties;
    } catch (error) {
      console.error('Error fetching stale bounties:', error);
      return [];
    }
  }

  /**
   * Cancel a stale bounty and process refund to the poster
   */
  async cancelStaleBounty(bountyId: string, posterId: string): Promise<{ success: boolean; error?: string }> {
    try {
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

        // Verify the requester is the bounty creator
        if (bounty.creator_id !== posterId) {
          return { success: false, error: 'Only the bounty poster can cancel this bounty' };
        }

        // Verify the bounty is stale
        if (!bounty.is_stale) {
          return { success: false, error: 'This bounty is not marked as stale' };
        }

        // Update bounty status to cancelled
        await tx
          .update(bounties)
          .set({
            status: 'cancelled',
            is_stale: false, // Clear stale flag as it's now resolved
            updated_at: new Date(),
          })
          .where(eq(bounties.id, bountyId));

        // Process refund if bounty has escrow funds
        if (bounty.amount_cents > 0 && !bounty.is_for_honor && bounty.payment_intent_id) {
          // Create STALE_BOUNTY_REFUND outbox event
          await outboxService.createEvent({
            type: 'STALE_BOUNTY_REFUND',
            payload: {
              bountyId,
              creatorId: bounty.creator_id,
              amount: bounty.amount_cents,
              paymentIntentId: bounty.payment_intent_id,
              title: bounty.title,
            },
            status: 'pending',
          });

          // Create refund transaction record
          await walletService.createTransaction({
            user_id: bounty.creator_id,
            bountyId: bountyId,
            type: 'refund',
            amount: bounty.amount_cents / 100, // Convert cents to dollars
          });
        }

        // Send notification to poster about successful cancellation
        try {
          await notificationService.notifyStaleBountyCancelled(
            bounty.creator_id,
            bountyId,
            bounty.title
          );
        } catch (error) {
          console.error('Failed to send cancellation notification:', error);
        }

        console.log(`✅ Cancelled stale bounty ${bountyId} with refund processing`);
        return { success: true };
      });
    } catch (error) {
      console.error('Error cancelling stale bounty:', error);
      return { success: false, error: 'Failed to cancel stale bounty' };
    }
  }

  /**
   * Repost a stale bounty - reset it to open status with a new hunter
   */
  async repostStaleBounty(bountyId: string, posterId: string): Promise<{ success: boolean; error?: string }> {
    try {
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

        // Verify the requester is the bounty creator
        if (bounty.creator_id !== posterId) {
          return { success: false, error: 'Only the bounty poster can repost this bounty' };
        }

        // Verify the bounty is stale
        if (!bounty.is_stale) {
          return { success: false, error: 'This bounty is not marked as stale' };
        }

        // Reset bounty to open status
        await tx
          .update(bounties)
          .set({
            status: 'open',
            hunter_id: null, // Clear the deleted hunter
            is_stale: false, // Clear stale flag as it's now resolved
            stale_reason: null,
            stale_detected_at: null,
            updated_at: new Date(),
          })
          .where(eq(bounties.id, bountyId));

        // Create outbox event for bounty reposted
        await outboxService.createEvent({
          type: 'BOUNTY_REPOSTED',
          payload: {
            bountyId,
            creatorId: bounty.creator_id,
            title: bounty.title,
            amount: bounty.amount_cents,
            previousStaleReason: bounty.stale_reason,
          },
          status: 'pending',
        });

        // Send notification to poster about successful repost
        try {
          await notificationService.notifyStaleBountyReposted(
            bounty.creator_id,
            bountyId,
            bounty.title
          );
        } catch (error) {
          console.error('Failed to send repost notification:', error);
        }

        console.log(`✅ Reposted stale bounty ${bountyId} - now open for new hunters`);
        return { success: true };
      });
    } catch (error) {
      console.error('Error reposting stale bounty:', error);
      return { success: false, error: 'Failed to repost stale bounty' };
    }
  }
}

export const staleBountyService = new StaleBountyService();
