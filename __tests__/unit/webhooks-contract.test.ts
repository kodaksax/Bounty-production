/**
 * Static contract tests for supabase/functions/webhooks/index.ts.
 *
 * The webhook handlers aren't structured as pure, exported functions (no
 * local-import support in the Supabase bundler applies here too, plus they
 * take live Supabase/Stripe clients), so — matching the existing convention
 * in withdrawal-validation.test.ts's "connect edge function contract" suite
 * — these are source-level regression guards, not behavioral tests.
 */
import * as fs from 'fs';
import * as path from 'path';

const webhooksSource = fs.readFileSync(
  path.join(__dirname, '../../supabase/functions/webhooks/index.ts'),
  'utf8'
);

function extractFunctionBody(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}(`);
  if (start === -1) throw new Error(`function ${functionName} not found`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`unterminated body for ${functionName}`);
}

describe("case 'payout.created'", () => {
  test('is handled, and its backfill never throws (payout.paid/failed/canceled remain the source of truth)', () => {
    const start = webhooksSource.indexOf("case 'payout.created':");
    expect(start).toBeGreaterThan(-1);
    const nextCase = webhooksSource.indexOf("case 'payout.paid':", start);
    expect(nextCase).toBeGreaterThan(start);
    const body = webhooksSource.slice(start, nextCase);
    expect(body).toContain('findCandidateWithdrawalTx');
    expect(body).toContain('catch (backfillError)');
    expect(body).not.toMatch(/throw\s+backfillError/);
  });
});

describe('handleUndeliveredPayout (payout.failed / payout.canceled)', () => {
  const body = extractFunctionBody(webhooksSource, 'handleUndeliveredPayout');

  test('does not reference payoutAmountDollars — that identifier only exists inside findCandidateWithdrawalTx and throws a ReferenceError here', () => {
    expect(body).not.toContain('payoutAmountDollars');
  });

  test('logs the payout amount by recomputing it from the Stripe Payout object in scope', () => {
    expect(body).toContain('payout.amount / 100');
  });
});
