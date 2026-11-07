/**
 * Two ways a financial check went quiet while still looking healthy.
 *
 * Edge Function handlers take live clients and run inside Deno.serve, so as in
 * withdrawal-payout-integrity.test.ts the wiring is asserted on the source, and
 * the decision itself is tested on the real shared module.
 */
import * as fs from 'fs';
import * as path from 'path';
import { runReportOutcome } from '../../supabase/functions/reconciliation/reconciliation-logic';

const FN = path.join(__dirname, '../../supabase/functions');
const reconciliationSource = fs.readFileSync(path.join(FN, 'reconciliation/index.ts'), 'utf8');
const withdrawalsSource = fs.readFileSync(path.join(FN, 'admin-withdrawals/index.ts'), 'utf8');

/** Both markers must exist, or an empty slice would pass every assertion below. */
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('runReportOutcome', () => {
  it('leaves a run alone when every finding was stored', () => {
    expect(runReportOutcome('GREEN', 0, 2)).toEqual({ health: 'GREEN', error: null });
    expect(runReportOutcome('YELLOW', 0, 0)).toEqual({ health: 'YELLOW', error: null });
  });

  it('never lets lost findings read as a clean pass', () => {
    expect(runReportOutcome('GREEN', 2, 2)).toEqual({
      health: 'RED',
      error: 'findings_persist_failed: 2 of 2',
    });
  });

  it('reports a partial loss too', () => {
    expect(runReportOutcome('YELLOW', 1, 3).error).toBe('findings_persist_failed: 1 of 3');
  });
});

describe('reconciliation run report', () => {
  const run = between(reconciliationSource, 'const computedHealth = computeHealth', 'return jsonResponse(report)');

  it('counts failed findings before deciding the outcome', () => {
    expect(run.indexOf('failedFindings = persistErrors.length')).toBeGreaterThanOrEqual(0);
    expect(run.indexOf('failedFindings = persistErrors.length')).toBeLessThan(
      run.indexOf('runReportOutcome(')
    );
  });

  it('writes the error job health watches', () => {
    const insert = between(run, "from('reconciliation_reports').insert", '});');
    expect(insert).toContain('error: reportError');
  });
});

describe('balance drift dedupe', () => {
  const lookups = [
    ['platform', 'async function comparePlatformBalance', "finding_type: 'platform_balance_drift'"],
    ['connect', 'async function compareConnectAccountBalance', "finding_type: 'connect_account_balance_drift'"],
  ];

  it.each(lookups)('%s: only an open finding of the same severity covers a new one', (_scope, start, end) => {
    const lookup = between(withdrawalsSource, start, end);
    expect(lookup).toContain(".is('resolved_at', null)");
    expect(lookup).toContain(".is('acknowledged_at', null)");
    expect(lookup).toContain(".eq('severity', severity)");
  });
});
