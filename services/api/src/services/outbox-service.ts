import { db } from '../db/connection';
import { outboxEvents } from '../db/schema';
import { CreateOutboxEventInput, OutboxEvent, OutboxEventStatus } from '@bountyexpo/domain-types';
import { eq, and } from 'drizzle-orm';

export class OutboxService {
  /**
   * Create a new outbox event
   */
  async createEvent(input: CreateOutboxEventInput): Promise<OutboxEvent> {
    const event = await db.insert(outboxEvents).values({
      type: input.type,
      payload: input.payload,
      status: input.status || 'pending',
    }).returning();

    return this.mapToOutboxEvent(event[0]);
  }

  /**
   * Get pending events for processing
   */
  async getPendingEvents(): Promise<OutboxEvent[]> {
    const events = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.status, 'pending'))
      .orderBy(outboxEvents.created_at);

    return events.map(this.mapToOutboxEvent);
  }

  /**
   * Mark an event as processing
   */
  async markProcessing(eventId: string): Promise<OutboxEvent | null> {
    const result = await db
      .update(outboxEvents)
      .set({ 
        status: 'processing',
      })
      .where(and(
        eq(outboxEvents.id, eventId),
        eq(outboxEvents.status, 'pending')
      ))
      .returning();

    return result.length > 0 ? this.mapToOutboxEvent(result[0]) : null;
  }

  /**
   * Mark an event as completed
   */
  async markCompleted(eventId: string): Promise<OutboxEvent | null> {
    const result = await db
      .update(outboxEvents)
      .set({ 
        status: 'completed',
        processed_at: new Date(),
      })
      .where(eq(outboxEvents.id, eventId))
      .returning();

    return result.length > 0 ? this.mapToOutboxEvent(result[0]) : null;
  }

  /**
   * Mark an event as failed
   */
  async markFailed(eventId: string): Promise<OutboxEvent | null> {
    const result = await db
      .update(outboxEvents)
      .set({ 
        status: 'failed',
        processed_at: new Date(),
      })
      .where(eq(outboxEvents.id, eventId))
      .returning();

    return result.length > 0 ? this.mapToOutboxEvent(result[0]) : null;
  }

  /**
   * Map database record to domain type
   */
  private mapToOutboxEvent(record: any): OutboxEvent {
    return {
      id: record.id,
      type: record.type,
      payload: record.payload,
      status: record.status,
      created_at: record.created_at.toISOString(),
      processed_at: record.processed_at?.toISOString(),
    };
  }
}

export const outboxService = new OutboxService();