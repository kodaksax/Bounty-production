import { completionReleaseService } from './completion-release-service';
import { OutboxEvent, outboxService } from './outbox-service';
import { stripeConnectService } from './stripe-connect-service';
import { refundService } from './refund-service';
import { emailService } from './email-service';

export class OutboxWorker {
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * Start the worker loop
   */
  async start(intervalMs: number = 5000): Promise<void> {
    if (this.isRunning) {
      console.log('📦 Outbox worker is already running');
      return;
    }

    this.isRunning = true;
    console.log(`📦 Starting outbox worker with ${intervalMs}ms interval`);

    // Process events immediately
    await this.processEvents();

    // Set up interval for continuous processing
    this.intervalId = setInterval(async () => {
      try {
        await this.processEvents();
      } catch (error) {
        console.error('❌ Error in outbox worker interval:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop the worker loop
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('📦 Stopping outbox worker');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Process pending outbox events
   */
  private async processEvents(): Promise<void> {
    try {
      const pendingEvents = await outboxService.getPendingEvents();
      
      if (pendingEvents.length === 0) {
        return; // No events to process
      }

      console.log(`📦 Processing ${pendingEvents.length} outbox events`);

      for (const event of pendingEvents) {
        await this.processEvent(event);
      }
    } catch (error) {
      console.error('❌ Error processing outbox events:', error);
    }
  }

  /**
   * Process a single outbox event
   */
  private async processEvent(event: OutboxEvent): Promise<void> {
    try {
      // Mark event as processing to prevent duplicate processing
      const processingEvent = await outboxService.markProcessing(event.id);
      if (!processingEvent) {
        console.log(`⚠️  Event ${event.id} already being processed by another worker`);
        return;
      }

      console.log(`📦 Processing event ${event.id} of type ${event.type}`);

      // Process the event based on its type
      await this.handleEvent(event);

      // Mark event as completed
      await outboxService.markCompleted(event.id);
      console.log(`✅ Successfully processed event ${event.id}`);

    } catch (error) {
      console.error(`❌ Error processing event ${event.id}:`, error);
      
      // Mark event as failed with retry logic
      await outboxService.markFailedWithRetry(event.id, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Handle different types of outbox events
   */
  private async handleEvent(event: OutboxEvent): Promise<void> {
    switch (event.type) {
      case 'BOUNTY_ACCEPTED':
        await this.handleBountyAccepted(event);
        break;
      
      case 'BOUNTY_COMPLETED':
        await this.handleBountyCompleted(event);
        break;
      
      case 'ESCROW_HOLD':
        await this.handleEscrowHold(event);
        break;
      
      case 'COMPLETION_RELEASE':
        await this.handleCompletionRelease(event);
        break;
      
      case 'REFUND_RETRY':
        await this.handleRefundRetry(event);
        break;
      
      case 'BOUNTY_REFUNDED':
        await this.handleBountyRefunded(event);
        break;
      
      default:
        console.warn(`⚠️  Unknown event type: ${event.type}`);
    }
  }

  /**
   * Handle BOUNTY_ACCEPTED events
   */
  private async handleBountyAccepted(event: OutboxEvent): Promise<void> {
    const { bountyId, hunterId, creatorId, amount, title } = event.payload;
    
    console.log(`🎯 BOUNTY_ACCEPTED: Bounty "${title}" (${bountyId}) accepted by hunter ${hunterId}`);
    console.log(`💰 Amount: ${amount > 0 ? `$${amount / 100}` : 'Honor only'}`);
    
    // In the future, this could:
    // - Send notifications to creator and hunter
    // - Update external systems
    // - Trigger webhook calls
    // - Log analytics events
    // - Create calendar entries
    
    // For now, just log the event
    console.log(`📝 Logged BOUNTY_ACCEPTED event for bounty ${bountyId}`);
  }

  /**
   * Handle ESCROW_HOLD events - Create PaymentIntent for bounty escrow
   */
  private async handleEscrowHold(event: OutboxEvent): Promise<void> {
    const { bountyId, creatorId, amount, title } = event.payload;
    
    console.log(`🔒 ESCROW_HOLD: Creating PaymentIntent for bounty "${title}" (${bountyId})`);
    console.log(`💰 Amount: ${amount > 0 ? `$${amount / 100}` : 'Zero amount'}`);
    
    try {
      // Create PaymentIntent for escrow
      const paymentIntent = await stripeConnectService.createEscrowPaymentIntent(bountyId);
      
      console.log(`✅ ESCROW_HELD: PaymentIntent ${paymentIntent.paymentIntentId} created for bounty ${bountyId}`);
      console.log(`🎯 Status: ${paymentIntent.status}, Amount: $${paymentIntent.amount / 100}`);
      
      // Log success event
      console.log(`📝 Logged ESCROW_HELD event for bounty ${bountyId}`);
      
    } catch (error) {
      console.error(`❌ Failed to create escrow for bounty ${bountyId}:`, error);
      throw error; // Re-throw to trigger retry mechanism
    }
  }

  /**
   * Handle COMPLETION_RELEASE events - Transfer funds to hunter
   */
  private async handleCompletionRelease(event: OutboxEvent): Promise<void> {
    const { bountyId, hunterId, paymentIntentId, title } = event.payload;
    
    console.log(`💸 COMPLETION_RELEASE: Processing release for bounty "${title}" (${bountyId})`);
    console.log(`🎯 Hunter: ${hunterId}, PaymentIntent: ${paymentIntentId}`);
    
    try {
      // Check if already released to prevent double processing
      const alreadyReleased = await completionReleaseService.isAlreadyReleased(bountyId);
      if (alreadyReleased) {
        console.log(`⚠️  Bounty ${bountyId} already released, skipping`);
        return;
      }

      // Process the completion release
      const success = await completionReleaseService.processCompletionReleaseFromOutbox(event.payload);
      
      if (success) {
        console.log(`✅ COMPLETION_RELEASED: Funds transferred for bounty ${bountyId}`);
      } else {
        throw new Error('Failed to process completion release');
      }
      
    } catch (error) {
      console.error(`❌ Failed to process completion release for bounty ${bountyId}:`, error);
      throw error; // Re-throw to trigger retry mechanism
    }
  }

  /**
   * Handle BOUNTY_COMPLETED events
   * Note: This is for notifications only. The actual payment release is handled by COMPLETION_RELEASE event.
   */
  private async handleBountyCompleted(event: OutboxEvent): Promise<void> {
    const { bountyId, completedBy, creatorId, amount, isForHonor, title } = event.payload;
    
    console.log(`🏆 BOUNTY_COMPLETED: Bounty "${title}" (${bountyId}) completed by ${completedBy}`);
    console.log(`💰 Payment: ${amount > 0 && !isForHonor ? `$${amount / 100} being released via COMPLETION_RELEASE` : 'Honor earned'}`);
    
    // Send completion notification
    try {
      // The completion-release-service will send payment notifications after successful transfer
      // For honor-only bounties, we can congratulate the hunter here
      if (isForHonor || amount === 0) {
        console.log(`🎉 Honor-only bounty completed - sending congratulations`);
      }
      
      // In the future, this could:
      // - Update reputation scores
      // - Trigger external integrations
      // - Generate completion certificates
      // - Update calendar/timeline
      
    } catch (error) {
      console.error(`❌ Failed to handle completion for bounty ${bountyId}:`, error);
      // Don't throw - notification failure shouldn't prevent event completion
    }
    
    console.log(`📝 Logged BOUNTY_COMPLETED event for bounty ${bountyId}`);
  }

  /**
   * Handle REFUND_RETRY events - Retry failed refund processing
   */
  private async handleRefundRetry(event: OutboxEvent): Promise<void> {
    const { bountyId, reason } = event.payload;
    
    console.log(`🔄 REFUND_RETRY: Retrying refund for bounty ${bountyId}`);
    
    try {
      // Check if already refunded to prevent double processing
      const alreadyRefunded = await refundService.isAlreadyRefunded(bountyId);
      if (alreadyRefunded) {
        console.log(`⚠️  Bounty ${bountyId} already refunded, skipping`);
        return;
      }

      // Process the refund
      const success = await refundService.processRefundFromOutbox(event.payload);
      
      if (success) {
        console.log(`✅ REFUND_PROCESSED: Refund completed for bounty ${bountyId}`);
      } else {
        throw new Error('Failed to process refund');
      }
      
    } catch (error) {
      console.error(`❌ Failed to process refund retry for bounty ${bountyId}:`, error);
      throw error; // Re-throw to trigger retry mechanism
    }
  }

  /**
   * Handle BOUNTY_REFUNDED events - Post-refund notifications
   */
  private async handleBountyRefunded(event: OutboxEvent): Promise<void> {
    const { bountyId, creatorId, amount, refundId, reason, title } = event.payload;
    
    console.log(`💸 BOUNTY_REFUNDED: Refund processed for bounty "${title}" (${bountyId})`);
    console.log(`💰 Refund Amount: $${amount / 100}, Refund ID: ${refundId}`);
    
    try {
      // Send refund confirmation email
      await emailService.sendRefundConfirmation(bountyId, creatorId, amount, reason);
      
      console.log(`📧 Refund confirmation email sent to creator ${creatorId}`);
      
      // In the future, this could:
      // - Send push notifications
      // - Update external systems
      // - Trigger webhook calls
      // - Log analytics events
      
      console.log(`📝 Logged BOUNTY_REFUNDED event for bounty ${bountyId}`);
      
    } catch (error) {
      console.error(`❌ Failed to send refund notification for bounty ${bountyId}:`, error);
      // Don't throw - email failure shouldn't prevent event completion
    }
  }
}

export const outboxWorker = new OutboxWorker();