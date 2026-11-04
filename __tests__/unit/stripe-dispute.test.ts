/**
 * Stripe chargeback attribution: supabase/functions/_shared/stripe-dispute.ts.
 *
 * Production defects these guard (found 2026-11-04, Stripe dev-workflow audit):
 *
 *  1. charge.dispute.created looked the payer up ONLY in wallet_transactions.
 *     v2 escrow (bounty_payments) and v3 (bounty_v3_funding) charges have no
 *     such row — 11 of 11 v2 PaymentIntents in production — so a chargeback on
 *     any escrow-funded bounty was logged and dropped.
 *  2. The dispute row was written with `stripe_payment_intent_id`, a column
 *     production's bounty_disputes does not have (it has `payment_intent_id`,
 *     which every DB function reads). The insert failed and Stripe retried
 *     forever without the dispute ever being recorded.
 *
 * Behaviour runs for real here; the webhook wiring is asserted at source level
 * at the bottom, matching webhooks-contract.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  buildStripeDisputeRow,
  decideDisputeLossAction,
  disputeChargeRef,
  resolveDisputePayer,
  type DisputePayerLookups,
  type PayerRow,
} from '../../supabase/functions/_shared/stripe-dispute';

const POSTER = '11111111-1111-4111-8111-111111111111';
const BOUNTY = '22222222-2222-4222-8222-222222222222';

function lookups(over: Partial<Record<keyof DisputePayerLookups, PayerRow | null | Error>> = {}) {
  const calls: string[] = [];
  const make =
    (name: keyof DisputePayerLookups) =>
    async (): Promise<PayerRow | null> => {
      calls.push(name);
      const v = over[name];
      if (v instanceof Error) throw v;
      return v ?? null;
    };
  const l: DisputePayerLookups = {
    walletDepositByCharge: make('walletDepositByCharge'),
    bountyPaymentByCharge: make('bountyPaymentByCharge'),
    v3FundingByCharge: make('v3FundingByCharge'),
  };
  return { l, calls };
}

const ref = { paymentIntentId: 'pi_1', chargeId: 'ch_1' };

describe('disputeChargeRef', () => {
  it('accepts string ids', () => {
    expect(disputeChargeRef({ payment_intent: 'pi_x', charge: 'ch_x' })).toEqual({
      paymentIntentId: 'pi_x',
      chargeId: 'ch_x',
    });
  });
  it('accepts expanded objects and nulls', () => {
    expect(disputeChargeRef({ payment_intent: { id: 'pi_y' }, charge: null })).toEqual({
      paymentIntentId: 'pi_y',
      chargeId: null,
    });
    expect(disputeChargeRef({})).toEqual({ paymentIntentId: null, chargeId: null });
  });
});

describe('resolveDisputePayer', () => {
  it('finds a v1 wallet-deposit payer first (unchanged behaviour)', async () => {
    const { l, calls } = lookups({
      walletDepositByCharge: { userId: POSTER, bountyId: null },
      bountyPaymentByCharge: { userId: 'someone-else', bountyId: BOUNTY },
    });
    await expect(resolveDisputePayer(ref, l)).resolves.toEqual({
      userId: POSTER,
      bountyId: null,
      source: 'wallet_transaction',
    });
    expect(calls).toEqual(['walletDepositByCharge']);
  });

  it('REGRESSION: finds the poster of a v2 escrow charge (no wallet row exists)', async () => {
    const { l } = lookups({ bountyPaymentByCharge: { userId: POSTER, bountyId: BOUNTY } });
    await expect(resolveDisputePayer(ref, l)).resolves.toEqual({
      userId: POSTER,
      bountyId: BOUNTY,
      source: 'bounty_payment',
    });
  });

  it('REGRESSION: finds the poster of a v3 funding charge', async () => {
    const { l, calls } = lookups({ v3FundingByCharge: { userId: POSTER, bountyId: BOUNTY } });
    await expect(resolveDisputePayer(ref, l)).resolves.toMatchObject({
      source: 'bounty_v3_funding',
      bountyId: BOUNTY,
    });
    expect(calls).toEqual(['walletDepositByCharge', 'bountyPaymentByCharge', 'v3FundingByCharge']);
  });

  it('skips a matching row that has no owner rather than attributing it to nobody', async () => {
    const { l } = lookups({
      walletDepositByCharge: { userId: null, bountyId: null },
      bountyPaymentByCharge: { userId: POSTER, bountyId: BOUNTY },
    });
    await expect(resolveDisputePayer(ref, l)).resolves.toMatchObject({ source: 'bounty_payment' });
  });

  it('returns null for a charge no Bounty record owns (e.g. a CLI-triggered test charge)', async () => {
    const { l } = lookups();
    await expect(resolveDisputePayer(ref, l)).resolves.toBeNull();
  });

  it('does not query at all when the dispute carries neither a PI nor a charge', async () => {
    const { l, calls } = lookups({ walletDepositByCharge: { userId: POSTER, bountyId: null } });
    await expect(resolveDisputePayer({ paymentIntentId: null, chargeId: null }, l)).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it('propagates a lookup error so Stripe retries instead of reading an outage as "no payer"', async () => {
    const { l } = lookups({ bountyPaymentByCharge: new Error('connection reset') });
    await expect(resolveDisputePayer(ref, l)).rejects.toThrow('connection reset');
  });
});

describe('buildStripeDisputeRow', () => {
  const row = buildStripeDisputeRow('dp_1', ref, {
    userId: POSTER,
    bountyId: BOUNTY,
    source: 'bounty_payment',
  });

  it('REGRESSION: writes the PI to payment_intent_id — the column production has', () => {
    expect(row.payment_intent_id).toBe('pi_1');
    expect(row).not.toHaveProperty('stripe_payment_intent_id');
  });

  it('links the bounty so the trust review queue and lifecycle events get it', () => {
    expect(row.bounty_id).toBe(BOUNTY);
  });

  it('opens as a Stripe dispute against the payer', () => {
    expect(row).toMatchObject({
      initiator_id: POSTER,
      status: 'stripe_dispute',
      stripe_dispute_id: 'dp_1',
      dispute_stage: 'cancellation',
    });
  });
});

describe('decideDisputeLossAction', () => {
  it('keeps the automatic wallet deduction for a v1 deposit chargeback', () => {
    expect(
      decideDisputeLossAction({ userId: POSTER, bountyId: null, source: 'wallet_transaction' })
    ).toEqual({ kind: 'deduct_from_wallet' });
  });

  it.each(['bounty_payment', 'bounty_v3_funding'] as const)(
    'never debits the wallet for a %s chargeback — that money never entered it',
    source => {
      expect(decideDisputeLossAction({ userId: POSTER, bountyId: BOUNTY, source }).kind).toBe(
        'manual_review'
      );
    }
  );

  it('sends an unattributable loss to manual review', () => {
    expect(decideDisputeLossAction(null).kind).toBe('manual_review');
  });
});

describe('webhooks/index.ts wiring (source-level)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/webhooks/index.ts'),
    'utf8'
  );
  const caseBody = (name: string, next: string) => {
    const start = src.indexOf(`case '${name}':`);
    const end = src.indexOf(`case '${next}':`, start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it('charge.dispute.created resolves the payer across v1/v2/v3 and builds the row via the shared module', () => {
    const body = caseBody('charge.dispute.created', 'charge.dispute.closed');
    expect(body).toContain('resolveDisputePayer(');
    expect(body).toContain('buildStripeDisputeRow(');
    expect(body).not.toMatch(/stripe_payment_intent_id:\s*disputePaymentIntentId/);
    expect(body).toMatch(/throw payerLookupError/);
  });

  it('charge.dispute.closed only debits the wallet when decideDisputeLossAction allows it', () => {
    const body = caseBody('charge.dispute.closed', 'balance.available');
    expect(body).toContain('decideDisputeLossAction(');
    const review = body.indexOf("closedLossAction.kind === 'manual_review'");
    const debit = body.indexOf("'apply_dispute_loss_transaction'");
    expect(review).toBeGreaterThan(-1);
    expect(debit).toBeGreaterThan(review);
  });

  it('the payer lookups cover all three payment tables', () => {
    const start = src.indexOf('function disputePayerLookups(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    for (const table of ['wallet_transactions', 'bounty_payments', 'bounty_v3_funding']) {
      expect(body).toContain(`'${table}'`);
    }
    expect(body).toMatch(/if \(error\) throw error/);
  });
});
