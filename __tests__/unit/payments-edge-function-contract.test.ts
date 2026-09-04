import * as fs from 'fs';
import * as path from 'path';

const paymentsSource = fs.readFileSync(
  path.join(__dirname, '../../supabase/functions/payments/index.ts'),
  'utf8'
);

function extractRoute(source: string, marker: string, nextMarker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${marker} not found`);
  const end = source.indexOf(nextMarker, start + marker.length);
  if (end === -1) throw new Error(`${nextMarker} not found`);
  return source.slice(start, end);
}

describe('payments edge function request/error contract', () => {
  const createPaymentIntentRoute = extractRoute(
    paymentsSource,
    "if (req.method === 'POST' && subPath === '/create-payment-intent')",
    '// POST /payments/create-setup-intent'
  );

  it('accepts and returns a request id for payment diagnostics', () => {
    expect(paymentsSource).toContain("req.headers.get('x-request-id')");
    expect(paymentsSource).toContain("'X-Request-Id': requestId");
    expect(paymentsSource).toContain('generateRequestId');
    expect(paymentsSource).toContain('x-request-id');
  });

  it('returns stable error codes from create-payment-intent validation exits', () => {
    expect(createPaymentIntentRoute).toContain("code: 'invalid_amount'");
    expect(createPaymentIntentRoute).toContain("code: 'invalid_currency'");
    expect(createPaymentIntentRoute).toContain("code: 'payment_method_required'");
    expect(createPaymentIntentRoute).toContain("code: 'payment_method_not_found'");
    expect(createPaymentIntentRoute).toContain("code: 'invalid_payment_method_type'");
    expect(createPaymentIntentRoute).toContain("code: 'bank_verification_failed'");
  });

  it('keeps create-payment-intent responses on the request-id reply helper', () => {
    expect(createPaymentIntentRoute).not.toContain('return jsonResponse(');
    expect(createPaymentIntentRoute).toContain('return reply({');
  });

  it('outer handler returns sanitized errors with request ids', () => {
    const catchStart = paymentsSource.indexOf('} catch (error: unknown) {');
    expect(catchStart).toBeGreaterThan(-1);
    const catchBlock = paymentsSource.slice(catchStart, catchStart + 1000);
    expect(catchBlock).toContain('requestId');
    expect(catchBlock).toContain("code: 'db_timeout'");
    expect(catchBlock).toContain("code: err.code ?? 'payment_service_error'");
    expect(catchBlock).toContain('Payment service temporarily unavailable. Please try again.');
  });
});
