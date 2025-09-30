import { outboxService } from './outbox-service';
import { OutboxEvent } from '@bountyexpo/domain-types';

export class OutboxWorker {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

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
      
      // Mark event as failed
      await outboxService.markFailed(event.id);
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
   * Handle BOUNTY_COMPLETED events
   */
  private async handleBountyCompleted(event: OutboxEvent): Promise<void> {
    const { bountyId, completedBy, creatorId, amount, title } = event.payload;
    
    console.log(`🏆 BOUNTY_COMPLETED: Bounty "${title}" (${bountyId}) completed by ${completedBy}`);
    console.log(`💰 Payment: ${amount > 0 ? `$${amount / 100} released` : 'Honor earned'}`);
    
    // In the future, this could:
    // - Release escrow funds
    // - Send completion notifications
    // - Update reputation scores
    // - Trigger external integrations
    // - Generate invoices/receipts
    
    // For now, just log the event
    console.log(`📝 Logged BOUNTY_COMPLETED event for bounty ${bountyId}`);
  }
}

export const outboxWorker = new OutboxWorker();