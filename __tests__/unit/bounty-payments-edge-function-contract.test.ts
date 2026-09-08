import * as fs from 'fs';
import * as path from 'path';

const bountyPaymentsSource = fs.readFileSync(
  path.join(__dirname, '../../supabase/functions/bounty-payments/index.ts'),
  'utf8'
);

function extractRoute(source: string, marker: string, nextMarker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${marker} not found`);
  const end = source.indexOf(nextMarker, start + marker.length);
  if (end === -1) throw new Error(`${nextMarker} not found`);
  return source.slice(start, end);
}

describe('bounty-payments edge function request/error contract', () => {
  const createRoute = extractRoute(
    bountyPaymentsSource,
    "if (req.method === 'POST' && subPath === '/create')",
    '// POST /bounty-payments/release'
  );
  const releaseRoute = extractRoute(
    bountyPaymentsSource,
    "if (req.method === 'POST' && subPath === '/release')",
    '// POST /bounty-payments/cancel'
  );
  const cancelRoute = extractRoute(
    bountyPaymentsSource,
    "if (req.method === 'POST' && subPath === '/cancel')",
    "return reply({ error: 'Not found'"
  );

  it('accepts and returns a request id for bounty payment diagnostics', () => {
    expect(bountyPaymentsSource).toContain("req.headers.get('x-request-id')");
    expect(bountyPaymentsSource).toContain("'X-Request-Id': requestId");
    expect(bountyPaymentsSource).toContain('generateRequestId');
    expect(bountyPaymentsSource).toContain('x-request-id');
  });

  it('routes in-handler responses through the request-aware helper', () => {
    const handlerStart = bountyPaymentsSource.indexOf('Deno.serve(async (req: Request) => {');
    const handlerBody = bountyPaymentsSource.slice(handlerStart);
    expect(handlerBody).not.toContain('return jsonResponse(');
    expect(handlerBody).toContain('return reply(');
  });

  it('returns stable error codes from create validation and recording exits', () => {
    for (const code of [
      'bounty_id_required',
      'bounty_load_failed',
      'bounty_not_found',
      'not_poster',
      'is_for_honor',
      'invalid_amount',
      'amount_too_small',
      'customer_resolution_failed',
      'payment_record_failed',
      'payment_record_conflict_in_flight',
    ]) {
      expect(createRoute).toContain(`code: '${code}'`);
    }
  });

  it('threads request ids into Stripe and ledger metadata for create and release', () => {
    expect(createRoute).toContain('request_id: requestId');
    expect(releaseRoute).toContain('request_id: requestId');
    expect(cancelRoute).toContain('request_id: requestId');
  });

  it('critical release and refund failures are retryable and do not expose provider detail', () => {
    expect(releaseRoute).toContain("code: 'transfer_failed'");
    expect(releaseRoute).toContain("code: 'record_update_failed'");
    expect(releaseRoute).toContain('retryable: true');
    expect(releaseRoute).not.toContain('detail: transferErr?.message');

    expect(cancelRoute).toContain("code: 'refund_failed'");
    expect(cancelRoute).toContain('retryable: true');
    expect(cancelRoute).not.toContain('detail: refundErr?.message');
  });

  it('outer handler returns sanitized errors with request ids', () => {
    const catchStart = bountyPaymentsSource.lastIndexOf('} catch (err: any) {');
    expect(catchStart).toBeGreaterThan(-1);
    const catchBlock = bountyPaymentsSource.slice(catchStart, catchStart + 1000);
    expect(catchBlock).toContain('requestId');
    expect(catchBlock).toContain("code: 'db_timeout'");
    expect(catchBlock).toContain("code: err?.code ?? 'bounty_payment_service_error'");
    expect(catchBlock).toContain('Payment service temporarily unavailable. Please try again.');
  });
});
