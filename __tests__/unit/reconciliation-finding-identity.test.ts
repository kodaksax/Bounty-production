/**
 * Reconciliation finding identity, two-hop correlation, and invariant
 * classification.
 *
 * These cover the three defects behind the 2026-08-31 "288 critical financial
 * mismatches" figure:
 *
 *   1. findings had no identity, so one problem produced one row per run and
 *      the backlog counter tracked cron frequency rather than the system;
 *   2. a single webhook-delivery gap was reported as two unrelated finding
 *      types (orphan payout + stale pending withdrawal);
 *   3. a known, grandfathered historical backlog was re-raised as CRITICAL on
 *      every run.
 */

import fs from 'fs';
import path from 'path';

import {
  buildFindingKey,
  findingSubject,
  correlatePayoutToPendingWithdrawal,
  splitInvariantViolations,
  INVARIANT_GRANDFATHER_CUTOFF_ISO,
  type PendingWithdrawalCandidate,
} from '../../supabase/functions/reconciliation/reconciliation-logic';

describe('finding identity', () => {
  it('gives two observations of one problem the same key', () => {
    const first = { payoutId: 'po_abc', ageHours: 6, amountCents: 1000 };
    const later = { payoutId: 'po_abc', ageHours: 66, amountCents: 1000 };

    const k1 = buildFindingKey('orphan_stripe_payout', findingSubject('orphan_stripe_payout', first));
    const k2 = buildFindingKey('orphan_stripe_payout', findingSubject('orphan_stripe_payout', later));

    expect(k1).toBe('orphan_stripe_payout:po_abc');
    // The age changed between runs; the identity must not.
    expect(k2).toBe(k1);
  });

  it('gives two different problems different keys', () => {
    const a = buildFindingKey('orphan_stripe_payout', findingSubject('orphan_stripe_payout', { payoutId: 'po_a' }));
    const b = buildFindingKey('orphan_stripe_payout', findingSubject('orphan_stripe_payout', { payoutId: 'po_b' }));
    expect(a).not.toBe(b);
  });

  it('does not collide across finding types sharing a subject', () => {
    const orphan = buildFindingKey('orphan_stripe_payout', findingSubject('orphan_stripe_payout', { payoutId: 'po_x' }));
    const ledger = buildFindingKey('orphan_ledger_withdrawal', findingSubject('orphan_ledger_withdrawal', { payoutId: 'po_x' }));
    expect(orphan).not.toBe(ledger);
  });

  it('keys rollups on the type so there is one open rollup, not one per run', () => {
    const runA = findingSubject('completed_withdrawal_without_payout_total', { count: 25, totalCents: 52665 });
    const runB = findingSubject('completed_withdrawal_without_payout_total', { count: 26, totalCents: 55000 });
    expect(buildFindingKey('completed_withdrawal_without_payout_total', runA)).toBe(
      buildFindingKey('completed_withdrawal_without_payout_total', runB)
    );
  });

  it('returns null rather than a bogus shared key when there is no durable subject', () => {
    expect(findingSubject('some_future_finding_type', { foo: 'bar' })).toBeNull();
    expect(buildFindingKey('x', null)).toBeNull();
    expect(buildFindingKey('x', '   ')).toBeNull();
  });
});

describe('two-hop payout correlation', () => {
  const base: PendingWithdrawalCandidate = {
    id: 'tx_1',
    userId: 'user_1',
    amountCents: 1000,
    createdAtMs: Date.parse('2026-08-28T19:59:00Z'),
    hasPayoutId: false,
    hasTransferId: true,
  };
  const payout = {
    userId: 'user_1',
    amountCents: 1000,
    createdAtMs: Date.parse('2026-08-30T01:30:00Z'),
  };

  it('explains the production case: paid payout, pending transfer-only withdrawal', () => {
    expect(correlatePayoutToPendingWithdrawal(payout, [base])).toEqual({
      kind: 'unique',
      transactionId: 'tx_1',
    });
  });

  it('refuses to guess when two withdrawals match equally', () => {
    const twin = { ...base, id: 'tx_2' };
    const result = correlatePayoutToPendingWithdrawal(payout, [base, twin]);
    expect(result.kind).toBe('ambiguous');
    expect(result.kind === 'ambiguous' && result.transactionIds.sort()).toEqual(['tx_1', 'tx_2']);
  });

  it('does not match a payout that predates the withdrawal', () => {
    // The 2026-07-27 misfire: a dashboard payout attached to a withdrawal
    // eleven days older. Ordering alone must rule this out in reverse.
    const later = { ...base, createdAtMs: Date.parse('2026-09-01T00:00:00Z') };
    expect(correlatePayoutToPendingWithdrawal(payout, [later])).toEqual({ kind: 'none' });
  });

  it('does not match across users', () => {
    expect(
      correlatePayoutToPendingWithdrawal(payout, [{ ...base, userId: 'someone_else' }])
    ).toEqual({ kind: 'none' });
  });

  it('does not match on a different amount', () => {
    expect(correlatePayoutToPendingWithdrawal(payout, [{ ...base, amountCents: 999 }])).toEqual({
      kind: 'none',
    });
  });

  it('ignores rows that already carry a payout id', () => {
    expect(
      correlatePayoutToPendingWithdrawal(payout, [{ ...base, hasPayoutId: true }])
    ).toEqual({ kind: 'none' });
  });

  it('ignores rows with no transfer, which are not the two-hop shape', () => {
    expect(
      correlatePayoutToPendingWithdrawal(payout, [{ ...base, hasTransferId: false }])
    ).toEqual({ kind: 'none' });
  });

  it('returns none for an empty candidate set', () => {
    expect(correlatePayoutToPendingWithdrawal(payout, [])).toEqual({ kind: 'none' });
  });
});

describe('invariant violation classification', () => {
  const cutoff = Date.parse(INVARIANT_GRANDFATHER_CUTOFF_ISO);

  it('treats the pre-cutoff historical set as grandfathered, not as a live incident', () => {
    const rows = [
      { id: 'old_1', createdAtMs: Date.parse('2026-07-16T01:24:00Z'), amountCents: 5000 },
      { id: 'old_2', createdAtMs: Date.parse('2026-08-14T14:44:00Z'), amountCents: 2000 },
    ];
    const split = splitInvariantViolations(rows);
    expect(split.grandfathered).toHaveLength(2);
    expect(split.current).toHaveLength(0);
  });

  it('flags a post-cutoff violation as current — the invariant is being bypassed', () => {
    const rows = [{ id: 'new_1', createdAtMs: Date.parse('2026-08-20T00:00:00Z'), amountCents: 1000 }];
    const split = splitInvariantViolations(rows);
    expect(split.current.map(r => r.id)).toEqual(['new_1']);
    expect(split.grandfathered).toHaveLength(0);
  });

  it('does not hide a new violation behind a large historical backlog', () => {
    const historical = Array.from({ length: 25 }, (_, i) => ({
      id: `old_${i}`,
      createdAtMs: cutoff - 86_400_000,
      amountCents: 2106,
    }));
    const split = splitInvariantViolations([
      ...historical,
      { id: 'new_1', createdAtMs: cutoff + 1, amountCents: 1000 },
    ]);
    expect(split.current.map(r => r.id)).toEqual(['new_1']);
    expect(split.grandfathered).toHaveLength(25);
  });

  it('puts a row exactly on the cutoff on the current side', () => {
    const split = splitInvariantViolations([{ id: 'edge', createdAtMs: cutoff, amountCents: 1 }]);
    expect(split.current).toHaveLength(1);
  });
});

/**
 * These assert how index.ts is WIRED, not what the decision logic computes.
 *
 * The logic itself is imported from ./reconciliation-logic.ts by both the edge
 * function and the tests above, so there is one implementation and nothing to
 * keep "in sync" — an earlier revision duplicated it into index.ts and guarded
 * the copy by string-matching this file's source, which could pass while the
 * two copies diverged in behaviour and broke whenever the file was reformatted.
 *
 * Source matching survives here only for integration facts that cannot be
 * expressed any other way: index.ts is a Deno module importing `https://` URLs,
 * so Jest cannot load it, and these assertions are about which call it makes
 * rather than what a function returns.
 */
describe('reconciliation edge function wiring', () => {
  const indexSource = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/reconciliation/index.ts'),
    'utf8'
  );

  it('imports its decision logic instead of carrying a copy', () => {
    expect(indexSource).toMatch(/from '\.\/reconciliation-logic\.ts'/);
    // The duplication this file used to police must not come back.
    expect(indexSource).not.toMatch(/^function correlatePayoutToPendingWithdrawal/m);
    expect(indexSource).not.toMatch(/^(export )?function normalizeStripeStatus/m);
    expect(indexSource).not.toMatch(/^(export )?function isSafeStatusRepair/m);
    expect(indexSource).not.toMatch(/^const INVARIANT_GRANDFATHER_CUTOFF_ISO/m);
  });

  it('persists findings through the idempotent recorder, never a raw insert', () => {
    // Whitespace-tolerant: the call is formatted across lines, and the point of
    // this assertion is WHICH function is called, not how the call is wrapped.
    // Either recorder is acceptable — the batch form calls the singular one.
    expect(indexSource).toMatch(/supabase\s*\.rpc\(\s*'record_reconciliation_findings?'/);
    expect(indexSource).not.toContain("from('reconciliation_findings').insert");
  });

  it('persists the whole finding set in one round trip', () => {
    // A per-finding loop made the cost scale with the backlog the sweep exists
    // to detect, inside a 55s cron timeout.
    expect(indexSource).toMatch(/supabase\s*\.rpc\(\s*'record_reconciliation_findings'/);
    expect(indexSource).not.toMatch(/for \(const f of findings\)[\s\S]{0,200}\.rpc\(/);
  });

  it('compares stored severities case-insensitively in the health summary', () => {
    // Two different severity vocabularies live in this file. In-memory
    // Finding.severity is the uppercase `Severity` union, so comparing it to
    // 'CRITICAL' is correct. Rows read back from reconciliation_findings are
    // lowercase (CHECK severity IN ('info','warning','critical')), and the
    // health handler compared THOSE to 'CRITICAL' — so criticalOpen and
    // warningOpen were always 0 and health could never escalate on an open
    // finding. Scope the assertion to the DB-read block so this test guards
    // the real bug without forbidding the correct in-memory comparisons.
    const healthBlock = indexSource.slice(
      indexSource.indexOf("if (action === 'health')"),
      indexSource.indexOf("if (action !== 'run')")
    );
    expect(healthBlock.length).toBeGreaterThan(0);
    expect(healthBlock).toContain("sev(f) === 'critical'");
    expect(healthBlock).toContain("sev(f) === 'warning'");
    expect(healthBlock).not.toContain("f.severity === 'CRITICAL'");
    expect(healthBlock).not.toContain("f.severity === 'WARNING'");
  });

  it('does not double-report a correlated withdrawal as stale-pending', () => {
    expect(indexSource).toContain('correlatedTxIds.has(row.id as string)');
  });
});
