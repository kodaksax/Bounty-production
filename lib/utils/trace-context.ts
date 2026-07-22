/**
 * Trace Context — end-to-end observability correlation
 *
 * Generalizes the auth-only `generateCorrelationId` into a workflow-scoped
 * trace context that can be propagated across every tier of a request:
 *
 *   Client → Supabase Edge Function → Database → Stripe → Push → Realtime
 *
 * A single `correlationId` follows a workflow from start to finish so any
 * production issue can be traced end-to-end. The helpers here produce the
 * right carrier shape for each tier:
 *   - `traceHeaders()`   → HTTP headers for edge functions / REST / Stripe API
 *   - `stripeMetadata()` → Stripe `metadata` (string-only, snake_case)
 *   - `realtimeTag()`    → fields to embed in realtime broadcast payloads
 *   - `pushDataTag()`    → data payload fields for push notifications
 *
 * Mobile-safe: no web-only or native imports at module-eval time.
 */

import { generateCorrelationId } from './auth-errors';

export type WorkflowName =
  | 'auth'
  | 'onboarding'
  | 'payment'
  | 'bounty'
  | 'application'
  | 'messaging'
  | 'completion'
  | 'withdrawal';

export type TraceStatus = 'ok' | 'error' | 'cancelled';

export interface TraceContext {
  /** Stable ID that follows the workflow across every tier. */
  readonly correlationId: string;
  /** Logical workflow this trace belongs to. */
  readonly workflow: WorkflowName;
  /** ID unique to this span (a step within the workflow). */
  readonly spanId: string;
  /** Parent span ID, when this is a child span. */
  readonly parentSpanId?: string;
  /** ms-epoch when the span started. */
  readonly startedAt: number;
}

/** HTTP header names used to carry trace context across tiers. */
export const TRACE_HEADERS = {
  correlationId: 'x-correlation-id',
  workflow: 'x-workflow',
  spanId: 'x-span-id',
  parentSpanId: 'x-parent-span-id',
} as const;

function randomSpanId(): string {
  // Short, collision-resistant enough for span identity within one correlation.
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Begin a new trace for a workflow. Pass an existing `correlationId` (e.g.
 * extracted from an inbound request) to continue a trace instead of starting
 * a fresh one.
 */
export function startTrace(
  workflow: WorkflowName,
  opts?: { correlationId?: string; parentSpanId?: string }
): TraceContext {
  return {
    correlationId: opts?.correlationId ?? generateCorrelationId(workflow),
    workflow,
    spanId: randomSpanId(),
    parentSpanId: opts?.parentSpanId,
    startedAt: Date.now(),
  };
}

/**
 * Derive a child span that shares the same `correlationId` but represents a
 * distinct step (e.g. "escrow" within the "payment" workflow). Preserves the
 * end-to-end correlation while allowing per-step timing/attribution.
 */
export function childSpan(parent: TraceContext, workflow?: WorkflowName): TraceContext {
  return {
    correlationId: parent.correlationId,
    workflow: workflow ?? parent.workflow,
    spanId: randomSpanId(),
    parentSpanId: parent.spanId,
    startedAt: Date.now(),
  };
}

/** HTTP headers carrying the trace, for edge functions / REST / Stripe API. */
export function traceHeaders(trace: TraceContext): Record<string, string> {
  const headers: Record<string, string> = {
    [TRACE_HEADERS.correlationId]: trace.correlationId,
    [TRACE_HEADERS.workflow]: trace.workflow,
    [TRACE_HEADERS.spanId]: trace.spanId,
  };
  if (trace.parentSpanId) {
    headers[TRACE_HEADERS.parentSpanId] = trace.parentSpanId;
  }
  return headers;
}

/**
 * Extract a trace from inbound HTTP headers so a downstream tier (edge fn)
 * can continue the same correlation. Returns null if no correlation is present.
 * Header lookup is case-insensitive.
 */
export function traceFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  fallbackWorkflow: WorkflowName
): TraceContext | null {
  const get = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) {
        const v = headers[key];
        return Array.isArray(v) ? v[0] : v;
      }
    }
    return undefined;
  };

  const correlationId = get(TRACE_HEADERS.correlationId);
  if (!correlationId) {
    return null;
  }
  const workflow = (get(TRACE_HEADERS.workflow) as WorkflowName) || fallbackWorkflow;
  return {
    correlationId,
    workflow,
    spanId: randomSpanId(),
    parentSpanId: get(TRACE_HEADERS.spanId),
    startedAt: Date.now(),
  };
}

/**
 * Stripe `metadata` fields. Stripe metadata values MUST be strings, so the
 * correlation is stored under snake_case keys that are queryable in the
 * Stripe dashboard and echoed back on webhooks.
 */
export function stripeMetadata(trace: TraceContext): Record<string, string> {
  return {
    correlation_id: trace.correlationId,
    workflow: trace.workflow,
  };
}

/** Fields to embed inside a realtime broadcast payload for trace continuity. */
export function realtimeTag(trace: TraceContext): {
  _correlationId: string;
  _workflow: WorkflowName;
} {
  return { _correlationId: trace.correlationId, _workflow: trace.workflow };
}

/** Fields to embed inside a push notification `data` payload. */
export function pushDataTag(trace: TraceContext): {
  correlationId: string;
  workflow: WorkflowName;
} {
  return { correlationId: trace.correlationId, workflow: trace.workflow };
}

/**
 * A structured, single-line log record for a completed span. Callers forward
 * this to their logger/Sentry/PostHog of choice. Kept as a pure function so it
 * is trivially testable and free of side effects.
 */
export function traceLogRecord(
  trace: TraceContext,
  status: TraceStatus,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    correlationId: trace.correlationId,
    workflow: trace.workflow,
    spanId: trace.spanId,
    parentSpanId: trace.parentSpanId,
    status,
    durationMs: Date.now() - trace.startedAt,
    ...extra,
  };
}
