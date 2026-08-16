/**
 * Unit tests for the Phase 8 reconciliation decision logic.
 *
 * These rules decide whether an automated process may rewrite a financial
 * record. The bar for "safe repair" is the single most important thing in the
 * reconciliation system: too permissive and it silently destroys evidence of
 * real problems; too strict and drift accumulates unnoticed.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  PAYOUT_PENDING_CRITICAL_HOURS,
  PAYOUT_PENDING_WARN_HOURS,
  STALE_PENDING_WARN_HOURS,
  TRANSFER_PENDING_WARN_HOURS,
  computeHealth,
  isSafeStatusRepair,
  normalizeStripeStatus,
  payoutAgeSeverity,
  stalePendingSeverity,
  transferAgeSeverity,
} from '../../supabase/functions/reconciliation/reconciliation-logic';

describe('normalizeStripeStatus', () => {
  it.each([
    ['paid', 'completed'],
    ['pending', 'pending'],
    ['in_transit', 'pending'],
    ['failed', 'failed'],
    ['canceled', 'cancelled'],
  ])('maps Stripe %s to ledger %s', (stripe, ledger) => {
    expect(normalizeStripeStatus(stripe)).toBe(ledger);
  });

  it('never maps in_transit to completed', () => {
    // Money in flight is not money delivered. This is the legacy bug the
    // whole migration exists to remove.
    expect(normalizeStripeStatus('in_transit')).not.toBe('completed');
  });

  it('passes an unknown status through instead of guessing', () => {
    // A new Stripe status must surface as a mismatch, not be coerced into a
    // plausible-looking known value.
    expect(normalizeStripeStatus('some_future_status')).toBe('some_future_status');
  });
});

describe('isSafeStatusRepair', () => {
  it('allows advancing a pending ledger row to paid', () => {
    expect(isSafeStatusRepair('paid', 'pending')).toBe(true);
  });

  it.each(['failed', 'canceled'])(
    'allows failed/canceled auto-repair only for Connect-native payouts (%s)',
    stripeStatus => {
      expect(isSafeStatusRepair(stripeStatus, 'pending', { connect_native: true })).toBe(true);
      expect(isSafeStatusRepair(stripeStatus, 'pending')).toBe(false);
    }
  );

  it.each(['pending', 'in_transit'])(
    'refuses to repair while Stripe is still in flight (%s)',
    stripeStatus => {
      expect(isSafeStatusRepair(stripeStatus, 'pending')).toBe(false);
    }
  );

  it('refuses to overwrite a ledger row that already claims completed', () => {
    // Ledger says done, Stripe says failed. That is a genuine conflict —
    // overwriting it would erase the evidence of whichever side is wrong.
    expect(isSafeStatusRepair('failed', 'completed')).toBe(false);
  });

  it('refuses to overwrite a ledger row that already claims failed', () => {
    expect(isSafeStatusRepair('paid', 'failed')).toBe(false);
  });

  it('refuses to overwrite a cancelled ledger row', () => {
    expect(isSafeStatusRepair('paid', 'cancelled')).toBe(false);
  });

  it('never repairs away from a terminal ledger state, for any Stripe status', () => {
    const terminalLedger = ['completed', 'failed', 'cancelled'];
    const allStripe = ['pending', 'in_transit', 'paid', 'failed', 'canceled', 'weird'];
    for (const ledger of terminalLedger) {
      for (const stripe of allStripe) {
        expect(isSafeStatusRepair(stripe, ledger)).toBe(false);
      }
    }
  });

  it('refuses an unknown Stripe status even from pending', () => {
    // We cannot know a novel status is terminal.
    expect(isSafeStatusRepair('some_future_status', 'pending')).toBe(false);
  });
});

describe('computeHealth', () => {
  const clean = {
    mismatched: 0,
    orphanStripe: 0,
    orphanLedger: 0,
    stalePending: 0,
    deltaCents: 0,
    criticalFindings: 0,
  };

  it('is GREEN when nothing was found', () => {
    expect(computeHealth(clean)).toBe('GREEN');
  });

  it('is RED on an orphan Stripe payout — real money with no record', () => {
    expect(computeHealth({ ...clean, orphanStripe: 1 })).toBe('RED');
  });

  it('is RED on an orphan ledger withdrawal', () => {
    expect(computeHealth({ ...clean, orphanLedger: 1 })).toBe('RED');
  });

  it('is RED on any non-zero amount delta, in either direction', () => {
    expect(computeHealth({ ...clean, deltaCents: 1 })).toBe('RED');
    expect(computeHealth({ ...clean, deltaCents: -1 })).toBe('RED');
  });

  it('is RED on any critical finding', () => {
    expect(computeHealth({ ...clean, criticalFindings: 1 })).toBe('RED');
  });

  it('is YELLOW on status mismatch alone', () => {
    expect(computeHealth({ ...clean, mismatched: 1 })).toBe('YELLOW');
  });

  it('is YELLOW on stale pending alone', () => {
    expect(computeHealth({ ...clean, stalePending: 1 })).toBe('YELLOW');
  });

  it('reports the worst signal, not the most recent', () => {
    expect(computeHealth({ ...clean, mismatched: 5, orphanStripe: 1 })).toBe('RED');
  });
});

describe('age-based severities', () => {
  it('does not warn on a fresh payout', () => {
    expect(payoutAgeSeverity(1)).toBeNull();
    expect(payoutAgeSeverity(PAYOUT_PENDING_WARN_HOURS)).toBeNull();
  });

  it('warns past the payout threshold', () => {
    expect(payoutAgeSeverity(PAYOUT_PENDING_WARN_HOURS + 1)).toBe('WARNING');
  });

  it('escalates a long-stuck payout to critical', () => {
    expect(payoutAgeSeverity(PAYOUT_PENDING_CRITICAL_HOURS + 1)).toBe('CRITICAL');
  });

  it('allows a standard payout its normal 1-2 business days without alarming', () => {
    // 24h is normal for a standard payout; alerting at that point would make
    // the alerts meaningless.
    expect(payoutAgeSeverity(20)).toBeNull();
  });

  it('warns on stale pending far sooner than on a real payout', () => {
    expect(stalePendingSeverity(STALE_PENDING_WARN_HOURS + 1)).toBe('WARNING');
    expect(stalePendingSeverity(1)).toBeNull();
    // A row with no payout id at all is suspicious much earlier than a payout
    // that Stripe has acknowledged and is working on.
    expect(STALE_PENDING_WARN_HOURS).toBeLessThan(PAYOUT_PENDING_WARN_HOURS);
  });

  it('warns quickly on an unsettled transfer', () => {
    expect(transferAgeSeverity(TRANSFER_PENDING_WARN_HOURS + 1)).toBe('WARNING');
    expect(transferAgeSeverity(1)).toBeNull();
  });
});

describe('reconciliation edge function contract (inlined logic stays in sync)', () => {
  const indexSource = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/reconciliation/index.ts'),
    'utf8'
  );

  it('inlines the same in_transit mapping', () => {
    expect(indexSource).toContain("case 'in_transit':");
    expect(indexSource).toContain("return 'pending'");
  });

  it('inlines the same safe-repair rule', () => {
    expect(indexSource).toContain("if (ledgerStatus !== 'pending') return false");
    expect(indexSource).toContain("metadata?.connect_native === true");
  });

  it('only ever repairs a row that is still pending (compare-and-set)', () => {
    // The UPDATE must re-assert status='pending' so a concurrent webhook that
    // already advanced the row cannot be clobbered.
    expect(indexSource).toContain(".eq('status', 'pending')");
  });

  it('never writes to profiles.balance', () => {
    expect(indexSource).not.toContain("from('profiles').update");
    expect(indexSource).not.toContain('update_balance');
    expect(indexSource).not.toContain('withdraw_balance');
  });

  it('never creates Stripe objects', () => {
    expect(indexSource).not.toContain('stripe.payouts.create');
    expect(indexSource).not.toContain('stripe.transfers.create');
    expect(indexSource).not.toContain('stripe.paymentIntents.create');
  });

  it('writes a report even when the run throws', () => {
    const catchIdx = indexSource.indexOf('catch (runError)');
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = indexSource.slice(catchIdx, catchIdx + 900);
    expect(catchBlock).toContain('reconciliation_reports');
    expect(catchBlock).toContain("health: 'RED'");
  });

  it('treats orphans on both sides as CRITICAL', () => {
    expect(indexSource).toContain("findingType: 'orphan_stripe_payout'");
    expect(indexSource).toContain("findingType: 'orphan_ledger_withdrawal'");
    const orphanStripeIdx = indexSource.indexOf("findingType: 'orphan_stripe_payout'");
    expect(indexSource.slice(orphanStripeIdx, orphanStripeIdx + 200)).toContain("'CRITICAL'");
  });

  it('never auto-repairs an amount mismatch', () => {
    const idx = indexSource.indexOf("findingType: 'amount_mismatch'");
    expect(idx).toBeGreaterThan(-1);
    const block = indexSource.slice(idx, idx + 600);
    expect(block).toContain("'CRITICAL'");
    expect(block).not.toContain('.update(');
  });

  it('requires cron secret or admin role', () => {
    expect(indexSource).toContain('RECONCILIATION_CRON_SECRET');
    expect(indexSource).toContain("role === 'admin'");
    expect(indexSource).toContain("jsonResponse({ error: 'Unauthorized' }, 401)");
  });

  it('treats a stale job as RED rather than reporting GREEN without evidence', () => {
    expect(indexSource).toContain('jobStale');
    expect(indexSource).toContain("if (jobStale) health = 'RED'");
  });
});
