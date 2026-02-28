import { createClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { outboxEvents } from '../db/schema';

// If Supabase service role key + URL are present, prefer using Supabase client to
// read/write the outbox table via PostgREST. This avoids opening a direct TCP
// Postgres connection when the environment still contains legacy values that
// may point to a different DB type/port.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
// Relax typing to avoid PostgREST `never` inference when table models are partial
const supabase = useSupabase ? createClient<any>(SUPABASE_URL as string, SUPABASE_SERVICE_ROLE_KEY as string) : null;

// Define types directly here to avoid import issues
export type OutboxEventType = 
  | 'BOUNTY_ACCEPTED' 
  | 'BOUNTY_COMPLETED' 
  | 'ESCROW_HOLD' 
  | 'COMPLETION_RELEASE'
  | 'REFUND_RETRY'
  | 'BOUNTY_REFUNDED'
  | 'BOUNTY_STALE'
  | 'STALE_BOUNTY_REFUND'
  | 'BOUNTY_REPOSTED';

export interface CreateOutboxEventInput {
  type: OutboxEventType;
  payload: Record<string, any>;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  retry_count?: number;
  retry_metadata?: Record<string, any>;
}

export interface OutboxEvent {
  id: string;
  type: OutboxEventType;
  payload: Record<string, any>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retry_count: number;
  retry_metadata?: Record<string, any>;
  created_at: string;
  processed_at?: string;
}

export class OutboxService {
  /**
   * Create a new outbox event
   */
  async createEvent(input: CreateOutboxEventInput): Promise<OutboxEvent> {
    if (useSupabase && supabase) {
      const { data, error: supabaseError } = await supabase
        .from('outbox_events')
        .insert([{ 
          type: input.type,
          payload: input.payload,
          status: input.status || 'pending',
          retry_count: input.retry_count || 0,
          retry_metadata: input.retry_metadata || null,
        }])
        .select()
        .limit(1);

      if (supabaseError) throw supabaseError;
      return this.mapToOutboxEvent(data![0]);
    }

    const event = await db.insert(outboxEvents).values({
      type: input.type,
      payload: input.payload,
      status: input.status || 'pending',
      retry_count: input.retry_count || 0,
      retry_metadata: input.retry_metadata,
    }).returning();

    return this.mapToOutboxEvent(event[0]);
  }

  /**
   * Get pending events for processing (respects retry delay)
   */
  async getPendingEvents(): Promise<OutboxEvent[]> {
    const now = new Date();
    let events: any[] = [];

    if (useSupabase && supabase) {
      const { data, error: supabaseError } = await supabase
        .from('outbox_events')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (supabaseError) throw supabaseError;
      events = data || [];
    } else {
      events = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.status, 'pending'))
        .orderBy(outboxEvents.created_at);
    }

    // Filter out events that are still in backoff period
    const readyEvents = events.filter(event => {
      if (!event.retry_metadata || typeof event.retry_metadata !== 'object' || !('next_retry_at' in event.retry_metadata)) {
        return true; // First attempt, no backoff
      }
      
      const nextRetryAt = new Date(event.retry_metadata.next_retry_at as string);
      return now >= nextRetryAt;
    });

    return readyEvents.map(this.mapToOutboxEvent);
  }

  /**
   * Mark an event as processing
   */
  async markProcessing(eventId: string): Promise<OutboxEvent | null> {
    if (useSupabase && supabase) {
      const { data, error: supabaseError } = await supabase
        .from('outbox_events')
        .update({ status: 'processing' })
        .eq('id', eventId)
        .eq('status', 'pending')
        .select()
        .limit(1);
      if (supabaseError) throw supabaseError;
      return (data && data[0]) ? this.mapToOutboxEvent(data[0]) : null;
    }

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
    if (useSupabase && supabase) {
      const { data, error: supabaseError } = await supabase
        .from('outbox_events')
        .update({ 
          status: 'completed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', eventId)
        .select()
        .limit(1);
      if (supabaseError) throw supabaseError;
      return (data && data[0]) ? this.mapToOutboxEvent(data[0]) : null;
    }

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
   * Mark an event as failed with retry logic
   */
  async markFailedWithRetry(eventId: string, errMessage: string, maxRetries: number = 3): Promise<OutboxEvent | null> {
    const currentEvent = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId))
      .limit(1);

    if (currentEvent.length === 0) {
      return null;
    }

    const event = currentEvent[0];
    const retryCount = event.retry_count + 1;
    
    if (retryCount >= maxRetries) {
      // Max retries reached, mark as permanently failed
      if (useSupabase && supabase) {
        const { data, error: supabaseError } = await supabase
          .from('outbox_events')
          .update({
            status: 'failed',
            retry_count: retryCount,
            retry_metadata: {
              ...(event.retry_metadata || {}),
              error: errMessage,
              max_retries_reached: true,
              failed_at: new Date().toISOString(),
            },
            processed_at: new Date().toISOString(),
          })
          .eq('id', eventId)
          .select()
          .limit(1);
        if (supabaseError) throw supabaseError;
        return (data && data[0]) ? this.mapToOutboxEvent(data[0]) : null;
      }

      const result = await db
        .update(outboxEvents)
        .set({ 
          status: 'failed',
          retry_count: retryCount,
          retry_metadata: {
            ...(event.retry_metadata || {}),
            error: errMessage,
            max_retries_reached: true,
            failed_at: new Date().toISOString(),
          },
          processed_at: new Date(),
        })
        .where(eq(outboxEvents.id, eventId))
        .returning();

      return result.length > 0 ? this.mapToOutboxEvent(result[0]) : null;
    }

    // Calculate exponential backoff: 2^retry_count * 1000ms (1s, 2s, 4s, 8s, ...)
    const backoffMs = Math.pow(2, retryCount) * 1000;
    const nextRetryAt = new Date(Date.now() + backoffMs);

    if (useSupabase && supabase) {
      const { data, error: supabaseError } = await supabase
        .from('outbox_events')
        .update({
          status: 'pending',
          retry_count: retryCount,
          retry_metadata: {
            ...(event.retry_metadata || {}),
            error: errMessage,
            next_retry_at: nextRetryAt.toISOString(),
            backoff_ms: backoffMs,
          },
        })
        .eq('id', eventId)
        .select()
        .limit(1);
      if (supabaseError) throw supabaseError;
      return (data && data[0]) ? this.mapToOutboxEvent(data[0]) : null;
    }

    const result = await db
      .update(outboxEvents)
      .set({ 
        status: 'pending',
        retry_count: retryCount,
        retry_metadata: {
          ...(event.retry_metadata || {}),
          error: errMessage,
          next_retry_at: nextRetryAt.toISOString(),
          backoff_ms: backoffMs,
        },
      })
      .where(eq(outboxEvents.id, eventId))
      .returning();

    return result.length > 0 ? this.mapToOutboxEvent(result[0]) : null;
  }

  /**
   * Map database record to domain type
   */
  private mapToOutboxEvent(record: any): OutboxEvent {
    // Supabase returns timestamps as strings; drizzle returns Date objects
    const createdAt = record.created_at ? (typeof record.created_at === 'string' ? record.created_at : record.created_at.toISOString()) : new Date().toISOString();
    const processedAt = record.processed_at ? (typeof record.processed_at === 'string' ? record.processed_at : record.processed_at.toISOString()) : undefined;

    return {
      id: record.id,
      type: record.type,
      payload: record.payload,
      status: record.status,
      retry_count: record.retry_count || 0,
      retry_metadata: record.retry_metadata,
      created_at: createdAt,
      processed_at: processedAt,
    };
  }
}

export const outboxService = new OutboxService();