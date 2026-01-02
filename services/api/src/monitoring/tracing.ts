// services/api/src/monitoring/tracing.ts
// Distributed tracing implementation with request ID propagation

import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../services/logger';
import { randomBytes } from 'crypto';

// Simple UUID v4 generator
function generateId(): string {
  return randomBytes(16).toString('hex');
}

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'success' | 'error';
  tags: Record<string, string | number | boolean>;
  logs: Array<{ timestamp: number; message: string; level: string }>;
}

class TracingService {
  private spans: Map<string, Span> = new Map();
  private maxSpans = 10000; // Prevent memory leaks

  /**
   * Start a new trace span
   */
  startSpan(name: string, traceId?: string, parentSpanId?: string): Span {
    const span: Span = {
      traceId: traceId || generateId(),
      spanId: generateId(),
      parentSpanId,
      name,
      startTime: Date.now(),
      status: 'success',
      tags: {},
      logs: []
    };

    // Prevent memory leaks by limiting stored spans
    if (this.spans.size >= this.maxSpans) {
      const oldestKey = this.spans.keys().next().value;
      if (oldestKey) {
        this.spans.delete(oldestKey);
      }
    }

    this.spans.set(span.spanId, span);
    return span;
  }

  /**
   * End a span
   */
  endSpan(spanId: string, status: 'success' | 'error' = 'success'): void {
    const span = this.spans.get(spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;

    logger.debug({
      traceId: span.traceId,
      spanId: span.spanId,
      name: span.name,
      duration: span.duration,
      status: span.status
    }, '[tracing] Span completed');
  }

  /**
   * Add tags to a span
   */
  addTags(spanId: string | undefined, tags: Record<string, string | number | boolean>): void {
    if (!spanId) return;
    const span = this.spans.get(spanId);
    if (!span || !tags) return;

    Object.assign(span.tags, tags);
  }

  /**
   * Add a log entry to a span
   */
  addLog(spanId: string, message: string, level: string = 'info'): void {
    const span = this.spans.get(spanId);
    if (!span) return;

    span.logs.push({
      timestamp: Date.now(),
      message,
      level
    });
  }

  /**
   * Get span by ID
   */
  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }

  /**
   * Get all spans for a trace
   */
  getTrace(traceId: string): Span[] {
    return Array.from(this.spans.values()).filter(span => span.traceId === traceId);
  }

  /**
   * Get span as JSON for export
   */
  exportSpan(spanId: string): any {
    const span = this.spans.get(spanId);
    if (!span) return null;

    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      timestamp: span.startTime,
      duration: span.duration || 0,
      tags: span.tags,
      logs: span.logs
    };
  }

  /**
   * Clear old spans (for cleanup)
   */
  cleanup(olderThanMs: number = 3600000): void {
    const cutoffTime = Date.now() - olderThanMs;
    for (const [spanId, span] of this.spans.entries()) {
      if (span.startTime < cutoffTime) {
        this.spans.delete(spanId);
      }
    }
  }
}

// Global tracing instance
export const tracing = new TracingService();

/**
 * Middleware to add request ID and start trace span
 */
export async function tracingMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Get or create trace ID from headers
  const traceId = (request.headers['x-trace-id'] as string) || generateId();
  const parentSpanId = request.headers['x-parent-span-id'] as string;

  // Start a span for this request
  const span = tracing.startSpan(
    `${request.method} ${request.url}`,
    traceId,
    parentSpanId
  );

  // Add tags
  tracing.addTags(span.spanId, {
    'http.method': request.method,
    'http.url': request.url,
    'http.host': request.hostname,
    'http.user_agent': request.headers['user-agent'] || 'unknown'
  });

  // Store span ID in request for access in handlers
  (request as any).spanId = span.spanId;
  (request as any).traceId = traceId;

  // Add trace headers to response
  reply.header('X-Trace-Id', traceId);
  reply.header('X-Span-Id', span.spanId);

  // End span when response finishes (use done callback)
  const originalSend = reply.send;
  (reply.send as any) = function(this: any, payload: any) {
    tracing.addTags(span.spanId, {
      'http.status_code': reply.statusCode
    });
    
    const status = reply.statusCode >= 400 ? 'error' : 'success';
    tracing.endSpan(span.spanId, status);
    
    return originalSend.call(this, payload);
  };
}

/**
 * Helper to trace external API calls
 */
export async function traceExternalCall<T>(
  spanId: string,
  serviceName: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const parentSpan = tracing.getSpan(spanId);
  if (!parentSpan) {
    // No parent span, just execute
    return fn();
  }

  const span = tracing.startSpan(
    `${serviceName}.${operation}`,
    parentSpan.traceId,
    spanId
  );

  tracing.addTags(span.spanId, {
    'external.service': serviceName,
    'external.operation': operation
  });

  try {
    const result = await fn();
    tracing.endSpan(span.spanId, 'success');
    return result;
  } catch (error) {
    tracing.addLog(span.spanId, error instanceof Error ? error.message : String(error), 'error');
    tracing.endSpan(span.spanId, 'error');
    throw error;
  }
}

/**
 * Helper to trace database operations
 */
export async function traceDatabaseQuery<T>(
  spanId: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  return traceExternalCall(spanId, 'database', operation, fn);
}

logger.info('[tracing] Distributed tracing initialized');
