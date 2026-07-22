import {
    childSpan,
    pushDataTag,
    realtimeTag,
    startTrace,
    stripeMetadata,
    TRACE_HEADERS,
    traceFromHeaders,
    traceHeaders,
    traceLogRecord,
} from '../../../lib/utils/trace-context';

describe('trace-context', () => {
  test('startTrace produces a workflow-scoped correlation id', () => {
    const t = startTrace('payment');
    expect(t.workflow).toBe('payment');
    expect(t.correlationId).toContain('payment_');
    expect(t.spanId).toBeTruthy();
    expect(t.parentSpanId).toBeUndefined();
    expect(typeof t.startedAt).toBe('number');
  });

  test('startTrace continues an existing correlation id when provided', () => {
    const t = startTrace('bounty', { correlationId: 'inbound_abc' });
    expect(t.correlationId).toBe('inbound_abc');
  });

  test('childSpan shares correlation id but gets a new span id and parent link', () => {
    const parent = startTrace('payment');
    const child = childSpan(parent);
    expect(child.correlationId).toBe(parent.correlationId);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(child.parentSpanId).toBe(parent.spanId);
  });

  test('childSpan can switch workflow while preserving correlation', () => {
    const parent = startTrace('bounty');
    const child = childSpan(parent, 'payment');
    expect(child.workflow).toBe('payment');
    expect(child.correlationId).toBe(parent.correlationId);
  });

  test('traceHeaders carries correlation across HTTP tiers', () => {
    const parent = startTrace('withdrawal');
    const child = childSpan(parent);
    const headers = traceHeaders(child);
    expect(headers[TRACE_HEADERS.correlationId]).toBe(parent.correlationId);
    expect(headers[TRACE_HEADERS.workflow]).toBe('withdrawal');
    expect(headers[TRACE_HEADERS.parentSpanId]).toBe(parent.spanId);
  });

  test('traceFromHeaders reconstructs a trace case-insensitively', () => {
    const origin = startTrace('application');
    const wire = traceHeaders(origin);
    // Simulate an edge function receiving upper-cased headers.
    const inbound: Record<string, string> = {
      'X-Correlation-Id': wire[TRACE_HEADERS.correlationId],
      'X-Workflow': wire[TRACE_HEADERS.workflow],
      'X-Span-Id': wire[TRACE_HEADERS.spanId],
    };
    const downstream = traceFromHeaders(inbound, 'application');
    expect(downstream).not.toBeNull();
    expect(downstream!.correlationId).toBe(origin.correlationId);
    expect(downstream!.workflow).toBe('application');
    expect(downstream!.parentSpanId).toBe(origin.spanId);
  });

  test('traceFromHeaders returns null when no correlation present', () => {
    expect(traceFromHeaders({}, 'auth')).toBeNull();
  });

  test('stripeMetadata emits string-only snake_case fields', () => {
    const t = startTrace('payment');
    const meta = stripeMetadata(t);
    expect(meta.correlation_id).toBe(t.correlationId);
    expect(meta.workflow).toBe('payment');
    Object.values(meta).forEach(v => expect(typeof v).toBe('string'));
  });

  test('realtimeTag and pushDataTag carry correlation into event/data payloads', () => {
    const t = startTrace('messaging');
    expect(realtimeTag(t)._correlationId).toBe(t.correlationId);
    expect(pushDataTag(t).correlationId).toBe(t.correlationId);
    expect(realtimeTag(t)._workflow).toBe('messaging');
  });

  test('traceLogRecord captures status and duration', () => {
    const t = startTrace('completion');
    const rec = traceLogRecord(t, 'ok', { bountyId: 'b1' });
    expect(rec.correlationId).toBe(t.correlationId);
    expect(rec.status).toBe('ok');
    expect(rec.bountyId).toBe('b1');
    expect(rec.durationMs).toBeGreaterThanOrEqual(0);
  });
});
