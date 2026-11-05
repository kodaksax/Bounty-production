/**
 * Saved-card charge at acceptance: runs the real
 * supabase/functions/accept-bounty-request/logic.ts against a fake Stripe and a
 * fake wallet that follows apply_deposit / apply_refund's idempotency.
 */
import {
  blockedAccountCode,
  fundAcceptanceFromCard,
  isDefinitiveAcceptFailure,
  mayChargeCard,
  shortfallToCents,
  unwindChargeAfterFailedAccept,
  type AcceptFundingDeps,
} from '../../supabase/functions/accept-bounty-request/logic';

const input = { requestId: 'req_1', bountyId: 'bounty_1', posterId: 'poster_1' };

function setup(
  over: Partial<AcceptFundingDeps> = {},
  opts: { intent?: any; createError?: any } = {}
) {
  const deposits = new Map<string, number>();
  const refunds = new Map<string, number>();
  const stripeRefunds: any[] = [];
  const intent = opts.intent ?? {
    id: 'pi_abcdefgh1234',
    amount: 1300,
    currency: 'usd',
    status: 'succeeded',
    metadata: { purpose: 'wallet_deposit', user_id: 'poster_1' },
    latest_charge: 'ch_1',
  };
  const stripe = {
    paymentMethods: {
      retrieve: jest.fn(async (id: string) => ({ id, type: 'card', customer: 'cus_poster' })),
      list: jest.fn(async () => ({ data: [{ id: 'pm_listed' }] })),
    },
    paymentIntents: {
      create: jest.fn(async () => {
        if (opts.createError) throw opts.createError;
        return intent;
      }),
    },
    refunds: {
      create: jest.fn(async () => {
        const r = { id: 're_1', status: 'succeeded', amount: 1300 };
        if (!stripeRefunds.length) stripeRefunds.push(r);
        return r;
      }),
      list: jest.fn(async () => ({ data: stripeRefunds })),
    },
  };
  const deps: AcceptFundingDeps = {
    stripe,
    getShortfall: jest.fn(async () => 13),
    getBountyStatus: jest.fn(async () => 'open'),
    getProfileCustomerId: jest.fn(async () => 'cus_poster'),
    getDefaultCardId: jest.fn(async () => 'pm_default'),
    getRequestStatus: jest.fn(async () => 'pending'),
    applyDeposit: jest.fn(async ({ amount, paymentIntentId }) => {
      if (!deposits.has(paymentIntentId)) deposits.set(paymentIntentId, amount);
    }),
    applyRefund: jest.fn(async ({ amount, refundId }) => {
      if (!refunds.has(refundId)) refunds.set(refundId, amount);
    }),
    alertAdmins: jest.fn(async () => {}),
    log: { warn: jest.fn(), error: jest.fn() },
    ...over,
  };
  const balanceDelta = () =>
    [...deposits.values(), ...refunds.values()].reduce((sum, n) => sum + n, 0);
  return { deps, stripe, deposits, refunds, balanceDelta };
}

const charged = { paymentIntentId: 'pi_abcdefgh1234', chargeId: 'ch_1', amount: 13 };

describe('fundAcceptanceFromCard', () => {
  it('charges exactly the shortfall off-session and credits the wallet', async () => {
    const { deps, stripe, deposits } = setup();
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toEqual({
      kind: 'charged',
      ...charged,
    });
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      {
        amount: 1300,
        currency: 'usd',
        customer: 'cus_poster',
        payment_method: 'pm_default',
        off_session: true,
        confirm: true,
        metadata: {
          purpose: 'wallet_deposit',
          user_id: 'poster_1',
          bounty_id: 'bounty_1',
          request_id: 'req_1',
        },
      },
      { idempotencyKey: 'fund_req_1_pm_default_1300' }
    );
    expect(deposits.get('pi_abcdefgh1234')).toBe(13);
  });

  it.each([
    ['no shortfall', { getShortfall: jest.fn(async () => 0) }],
    ['requirement unreadable', { getShortfall: jest.fn(async () => null) }],
    [
      'requirement lookup throws',
      {
        getShortfall: jest.fn(async () => {
          throw new Error('42501');
        }),
      },
    ],
    ['bounty no longer open', { getBountyStatus: jest.fn(async () => 'in_progress') }],
    ['no Stripe customer', { getProfileCustomerId: jest.fn(async () => null) }],
  ])('does not charge: %s', async (_name, over) => {
    const { deps, stripe } = setup(over as Partial<AcceptFundingDeps>);
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toEqual({ kind: 'not_charged' });
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('falls back to the Stripe list when there is no default row', async () => {
    const { deps, stripe } = setup({ getDefaultCardId: jest.fn(async () => null) });
    await fundAcceptanceFromCard(deps, input);
    expect(stripe.paymentMethods.list).toHaveBeenCalledWith({
      customer: 'cus_poster',
      type: 'card',
      limit: 1,
    });
    expect((stripe.paymentIntents.create.mock.calls as any)[0][0].payment_method).toBe('pm_listed');
  });

  it('no card anywhere: current behaviour', async () => {
    const { deps, stripe } = setup({ getDefaultCardId: jest.fn(async () => null) });
    stripe.paymentMethods.list.mockResolvedValueOnce({ data: [] });
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toEqual({ kind: 'not_charged' });
  });

  it("never charges a saved pm_ id belonging to someone else's customer", async () => {
    const { deps, stripe } = setup();
    stripe.paymentMethods.retrieve.mockResolvedValueOnce({
      id: 'pm_default',
      type: 'card',
      customer: 'cus_victim',
    });
    await fundAcceptanceFromCard(deps, input);
    const params = (stripe.paymentIntents.create.mock.calls as any)[0][0];
    expect(params.payment_method).toBe('pm_listed');
    expect(params.customer).toBe('cus_poster');
  });

  it.each([
    ['decline', { type: 'StripeCardError', code: 'card_declined', statusCode: 402 }],
    ['3DS needed', { type: 'StripeCardError', code: 'authentication_required', statusCode: 402 }],
    [
      'detached card',
      { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 400 },
    ],
    ['shortfall changed on key', { type: 'StripeIdempotencyError', statusCode: 400 }],
  ])('card_failed and no deposit: %s', async (_name, createError) => {
    const { deps, deposits } = setup({}, { createError });
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toMatchObject({
      kind: 'card_failed',
    });
    expect(deposits.size).toBe(0);
  });

  it('requires_action status is card_failed with no deposit', async () => {
    const { deps, deposits } = setup({}, { intent: { id: 'pi_x', status: 'requires_action' } });
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toMatchObject({
      kind: 'card_failed',
    });
    expect(deposits.size).toBe(0);
  });

  it('a shortfall under the Stripe minimum charges the minimum and credits what was charged', async () => {
    const { deps, stripe } = setup(
      { getShortfall: jest.fn(async () => 0.3) },
      {
        intent: {
          id: 'pi_abcdefgh1234',
          amount: 50,
          currency: 'usd',
          status: 'succeeded',
          metadata: { purpose: 'wallet_deposit', user_id: 'poster_1' },
          latest_charge: 'ch_1',
        },
      }
    );
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toMatchObject({
      kind: 'charged',
      amount: 0.5,
    });
    const [params, options] = (stripe.paymentIntents.create.mock.calls as any)[0];
    expect(params.amount).toBe(50);
    expect(options.idempotencyKey).toBe('fund_req_1_pm_default_50');
    expect(deps.applyDeposit).toHaveBeenCalledWith(expect.objectContaining({ amount: 0.5 }));
  });

  it('a different card or a different shortfall is a new key, so a fixed card can retry', async () => {
    const { deps, stripe } = setup();
    await fundAcceptanceFromCard(deps, input);
    (deps.getDefaultCardId as jest.Mock).mockResolvedValueOnce('pm_new');
    await fundAcceptanceFromCard(deps, input);
    (deps.getShortfall as jest.Mock).mockResolvedValueOnce(5);
    await fundAcceptanceFromCard(deps, input);
    const keys = (stripe.paymentIntents.create.mock.calls as any).map(
      (c: any) => c[1].idempotencyKey
    );
    expect(keys).toEqual([
      'fund_req_1_pm_default_1300',
      'fund_req_1_pm_new_1300',
      'fund_req_1_pm_default_500',
    ]);
  });

  it('a concurrent tap on the same key is in_progress', async () => {
    const { deps } = setup(
      {},
      {
        createError: {
          type: 'StripeIdempotencyError',
          code: 'idempotency_key_in_use',
          statusCode: 409,
        },
      }
    );
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toEqual({ kind: 'in_progress' });
  });

  it.each([
    ['StripeInvalidRequestError', 'idempotency_key_in_use', 409], // Stripe's real response
    ['StripeIdempotencyError', 'idempotency_key_in_use', 409],
    ['StripeInvalidRequestError', undefined, 409],
  ])('a concurrent tap is never read as a declined card: %s %s', async (type, code, statusCode) => {
    const { deps } = setup({}, { createError: { type, code, statusCode } });
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toEqual({ kind: 'in_progress' });
  });

  it('a network error leaves the charge unknown, not failed', async () => {
    const { deps } = setup({}, { createError: { type: 'StripeConnectionError' } });
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('apply_deposit failing does not refund: the webhook credits it', async () => {
    const { deps, stripe } = setup({
      applyDeposit: jest.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'deposit_not_applied',
    });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('double tap credits once', async () => {
    const { deps, balanceDelta } = setup();
    await fundAcceptanceFromCard(deps, input);
    await fundAcceptanceFromCard(deps, input);
    expect(balanceDelta()).toBe(13);
  });

  it('a retry after a refund does not treat the replayed success as money', async () => {
    const { deps, balanceDelta } = setup();
    await fundAcceptanceFromCard(deps, input);
    await unwindChargeAfterFailedAccept(deps, {
      ...input,
      charge: charged,
      rpcStatus: 400,
      rpcBody: '{"code":"P0001","message":"bounty_not_open"}',
    });
    expect(balanceDelta()).toBe(0);
    await expect(fundAcceptanceFromCard(deps, input)).resolves.toEqual({
      kind: 'card_failed',
      reason: 'previous_charge_refunded',
    });
    expect(balanceDelta()).toBe(0);
  });
});

describe('unwindChargeAfterFailedAccept', () => {
  const failure = { rpcStatus: 400, rpcBody: '{"code":"P0001","message":"bounty_not_open"}' };

  it('refunds and reverses through apply_refund', async () => {
    const { deps, stripe, balanceDelta } = setup();
    await fundAcceptanceFromCard(deps, input);
    await expect(
      unwindChargeAfterFailedAccept(deps, { ...input, charge: charged, ...failure })
    ).resolves.toBe('refunded');
    expect((stripe.refunds.create.mock.calls as any)[0][1]).toEqual({
      idempotencyKey: 'fund_refund_pi_abcdefgh1234',
    });
    expect(deps.applyRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -13, refundId: 're_1', chargeId: 'ch_1' })
    );
    expect(balanceDelta()).toBe(0);
  });

  it('race: the other tap won, so its escrow keeps the deposit', async () => {
    const { deps, stripe } = setup({ getRequestStatus: jest.fn(async () => 'accepted') });
    await expect(
      unwindChargeAfterFailedAccept(deps, {
        ...input,
        charge: charged,
        rpcStatus: 400,
        rpcBody: '{"code":"P0001","message":"request_not_pending"}',
      })
    ).resolves.toBe('kept_request_accepted');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('race: losing to another hunter on the bounty refunds this charge', async () => {
    const { deps } = setup({ getRequestStatus: jest.fn(async () => 'rejected') });
    await expect(
      unwindChargeAfterFailedAccept(deps, { ...input, charge: charged, ...failure })
    ).resolves.toBe('refunded');
  });

  it.each([
    ['network failure', 500, 'TypeError: fetch failed'],
    ['gateway timeout', 504, '<html>timeout</html>'],
  ])('%s: the hire may have committed, so no refund', async (_n, rpcStatus, rpcBody) => {
    const { deps, stripe } = setup();
    await expect(
      unwindChargeAfterFailedAccept(deps, { ...input, charge: charged, rpcStatus, rpcBody })
    ).resolves.toBe('kept_outcome_unknown');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('an unreadable request does not refund', async () => {
    const { deps, stripe } = setup({
      getRequestStatus: jest.fn(async () => {
        throw new Error('DB_TIMEOUT');
      }),
    });
    await expect(
      unwindChargeAfterFailedAccept(deps, { ...input, charge: charged, ...failure })
    ).resolves.toBe('kept_outcome_unknown');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('a Stripe refund failure leaves the ledger alone', async () => {
    const { deps, stripe } = setup();
    stripe.refunds.create.mockRejectedValueOnce(new Error('stripe down'));
    await expect(
      unwindChargeAfterFailedAccept(deps, { ...input, charge: charged, ...failure })
    ).resolves.toBe('kept_refund_failed');
    expect(deps.applyRefund).not.toHaveBeenCalled();
  });

  it('apply_refund failing pages the team, with ids and no customer detail', async () => {
    const { deps } = setup({
      applyRefund: jest.fn(async () => {
        throw new Error('Insufficient funds: new balance would be -13');
      }),
    });
    await expect(
      unwindChargeAfterFailedAccept(deps, {
        ...input,
        charge: charged,
        bountyId: 'bounty_1',
        ...failure,
      })
    ).resolves.toBe('refunded_ledger_pending');
    expect(deps.alertAdmins).toHaveBeenCalledTimes(1);
    const alert = (deps.alertAdmins as jest.Mock).mock.calls[0][0];
    expect(alert.bountyId).toBe('bounty_1');
    expect(alert.body).toContain('re_1');
    expect(alert.body).toContain('pi_abcdefgh1234');
    expect(alert.body).toContain('Insufficient funds');
  });

  it('a clean refund pages nobody', async () => {
    const { deps } = setup();
    await unwindChargeAfterFailedAccept(deps, { ...input, charge: charged, ...failure });
    expect(deps.alertAdmins).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it.each([
    ['pending', undefined, true], // poster-web sends no flag
    ['pending', true, true],
    ['pending', false, false], // the app
    ['pending', null, true],
    ['pending', 'false', true], // only an explicit false turns it off
    ['accepted', undefined, false],
    ['rejected', true, false],
  ])('mayChargeCard(%s, %s) = %s', (status, flag, expected) => {
    expect(mayChargeCard(status, flag)).toBe(expected);
  });

  it('blocks suspended and banned accounts only', () => {
    expect(blockedAccountCode('suspended')).toBe('account_suspended');
    expect(blockedAccountCode('banned')).toBe('account_banned');
    expect(blockedAccountCode('active')).toBeNull();
    expect(blockedAccountCode(null)).toBeNull();
  });

  it.each([
    [13, 1300],
    [19.99, 1999],
    [0.07, 7],
    [1.1, 110],
    [4.35, 435],
  ])('shortfallToCents(%s) = %s', (dollars, cents) => {
    expect(shortfallToCents(dollars)).toBe(cents);
  });

  it('classifies acceptance failures', () => {
    expect(isDefinitiveAcceptFailure(400, 'x')).toBe(true);
    expect(isDefinitiveAcceptFailure(500, '{"code":"XX000"}')).toBe(true);
    expect(isDefinitiveAcceptFailure(500, 'fetch failed')).toBe(false);
    expect(isDefinitiveAcceptFailure(502, '')).toBe(false);
  });
});
