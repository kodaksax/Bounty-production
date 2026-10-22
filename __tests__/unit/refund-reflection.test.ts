/**
 * How Stripe refunds are reflected into bounty_payments (v2) and the wallet
 * ledger (v1): supabase/functions/_shared/refund-reflection.ts.
 *
 * The production defect these guard: the webhook pins apiVersion 2023-10-16,
 * under which `charge.refunded` payloads carry no `refunds` list. Every stored
 * charge.refunded event in production lacks the key. The handler read
 * `charge.refunds?.data ?? []`, so v2 refunds were all written as
 * `refund_pending` with no refund id (5 rows, $71, refunded by Stripe in
 * September and still shown as "on its way"), and v1 deposit refunds were
 * skipped, leaving the refunded money on the wallet balance.
 *
 * The decision functions run here for real; the wiring into
 * supabase/functions/webhooks/index.ts is asserted at source level in
 * webhooks-contract.test.ts, the convention for the Deno edge functions.
 */
import {
  bountyPaymentRefundUpdate,
  liveRefunds,
  resolveChargeRefunds,
  succeededRefunds,
  type RefundLike,
} from '../../supabase/functions/_shared/refund-reflection';

const refund = (over: Partial<RefundLike> = {}): RefundLike => ({
  id: 're_1',
  status: 'succeeded',
  amount: 1500,
  created: 100,
  ...over,
});

describe('resolveChargeRefunds', () => {
  it('asks Stripe when the event payload has no refunds key (the production shape)', async () => {
    const listed = [refund()];
    const list = jest.fn().mockResolvedValue(listed);
    await expect(resolveChargeRefunds({ id: 'ch_1' }, list)).resolves.toBe(listed);
    expect(list).toHaveBeenCalledWith('ch_1');
  });

  it('asks Stripe when the embedded list is empty, never treating it as "no refunds"', async () => {
    const list = jest.fn().mockResolvedValue([refund()]);
    await resolveChargeRefunds({ id: 'ch_1', refunds: { data: [] } }, list);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('uses an embedded list without a Stripe call', async () => {
    const embedded = [refund({ id: 're_embedded' })];
    const list = jest.fn();
    await expect(resolveChargeRefunds({ id: 'ch_1', refunds: { data: embedded } }, list)).resolves.toBe(embedded);
    expect(list).not.toHaveBeenCalled();
  });

  it('propagates a failed lookup so the webhook 500s and Stripe retries', async () => {
    const list = jest.fn().mockRejectedValue(new Error('stripe down'));
    await expect(resolveChargeRefunds({ id: 'ch_1' }, list)).rejects.toThrow('stripe down');
  });
});

describe('liveRefunds / succeededRefunds (v1 wallet debit)', () => {
  it('debits for succeeded and pending refunds, never for failed or canceled ones', () => {
    const all = [
      refund({ id: 're_ok', created: 3 }),
      refund({ id: 're_pending', status: 'pending', created: 2 }),
      refund({ id: 're_failed', status: 'failed', created: 1 }),
      refund({ id: 're_canceled', status: 'canceled', created: 4 }),
    ];
    expect(liveRefunds(all).map(r => r.id)).toEqual(['re_pending', 're_ok']);
    expect(succeededRefunds(all).map(r => r.id)).toEqual(['re_ok']);
  });
});

describe('bountyPaymentRefundUpdate (v2 bounty_payments)', () => {
  it('marks a fully refunded payment refunded, with the refund id', () => {
    expect(bountyPaymentRefundUpdate(15, [refund({ id: 're_full' })])).toEqual({
      status: 'refunded',
      stripeRefundId: 're_full',
    });
  });

  it('keeps a still-pending refund at refund_pending, carrying its id for the later refund.updated', () => {
    expect(bountyPaymentRefundUpdate(15, [refund({ id: 're_p', status: 'pending' })])).toEqual({
      status: 'refund_pending',
      stripeRefundId: 're_p',
    });
  });

  it('needs succeeded refunds to cover the whole amount; a partial refund is not "refunded"', () => {
    expect(bountyPaymentRefundUpdate(15, [refund({ amount: 500 })])?.status).toBe('refund_pending');
    expect(
      bountyPaymentRefundUpdate(15, [refund({ id: 'a', amount: 500, created: 1 }), refund({ id: 'b', amount: 1000, created: 2 })])
    ).toEqual({ status: 'refunded', stripeRefundId: 'b' });
  });

  it('compares in cents, so $35 refunded as 3500 is complete', () => {
    expect(bountyPaymentRefundUpdate(35, [refund({ amount: 3500 })])?.status).toBe('refunded');
    expect(bountyPaymentRefundUpdate('16.00' as unknown as number, [refund({ amount: 1600 })])?.status).toBe(
      'refunded'
    );
  });

  it('changes nothing when every refund failed or was canceled', () => {
    expect(bountyPaymentRefundUpdate(15, [refund({ status: 'failed' }), refund({ status: 'canceled' })])).toBeNull();
    expect(bountyPaymentRefundUpdate(15, [])).toBeNull();
  });

  it('ignores a failed refund alongside a successful one', () => {
    expect(
      bountyPaymentRefundUpdate(15, [refund({ id: 'bad', status: 'failed', created: 1 }), refund({ id: 'good', created: 2 })])
    ).toEqual({ status: 'refunded', stripeRefundId: 'good' });
  });
});
