/**
 * lib/services/posting-checkout-service.ts
 *
 * Two behaviours matter here, both defensive:
 *
 *   1. assertServerTotalsMatch — the poster has just read an itemised total on
 *      screen and is about to authorise a card. If the server's split
 *      disagrees with what was displayed (a half-deployed release, a tuned
 *      server constant, a stale build), the honest outcome is a hard failure
 *      they can retry, NOT charging a number they never saw.
 *   2. findReusablePaidCheckout — must degrade to "no prior payment" on any
 *      read failure, including an environment where the migration has not been
 *      applied. A read failure must never be the reason a poster cannot post,
 *      and the attempt-id/idempotency machinery still prevents a double charge.
 */

const mockInvokePayments = jest.fn();
jest.mock('../../../lib/services/stripe-internal', () => ({
  invokePayments: (...a: unknown[]) => mockInvokePayments(...a),
}));

const mockMaybeSingle = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: (...a: unknown[]) => mockMaybeSingle(...a) }),
            }),
          }),
        }),
      }),
    }),
  },
}));

jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warning: jest.fn() },
}));

import {
  assertServerTotalsMatch,
  createPostingAttemptId,
  findReusablePaidCheckout,
  openPostingCheckout,
  settlePostingCheckout,
} from '../../../lib/services/posting-checkout-service';

const REWARD = 5000;
const FEE = 100;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createPostingAttemptId', () => {
  it('produces a v4-shaped uuid the edge function will accept', () => {
    const id = createPostingAttemptId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('produces distinct ids across attempts', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createPostingAttemptId()));
    expect(ids.size).toBe(50);
  });
});

describe('assertServerTotalsMatch', () => {
  it('accepts a correctly itemised checkout', () => {
    expect(() =>
      assertServerTotalsMatch(
        { feeCents: FEE, rewardCents: REWARD, totalCents: FEE + REWARD },
        REWARD
      )
    ).not.toThrow();
  });

  it('rejects a fee that is not the $1 the poster was shown', () => {
    expect(() =>
      assertServerTotalsMatch({ feeCents: 500, rewardCents: REWARD, totalCents: 5500 }, REWARD)
    ).toThrow(/total changed/i);
  });

  it('rejects a reward that is not the amount the poster chose', () => {
    expect(() =>
      assertServerTotalsMatch({ feeCents: FEE, rewardCents: 9900, totalCents: 10000 }, REWARD)
    ).toThrow(/total changed/i);
  });

  it('rejects a total that is not the sum of its parts', () => {
    expect(() =>
      assertServerTotalsMatch(
        { feeCents: FEE, rewardCents: REWARD, totalCents: 99999 },
        REWARD
      )
    ).toThrow(/total changed/i);
  });

  it('carries a machine-readable code for the failure funnel', () => {
    try {
      assertServerTotalsMatch({ feeCents: 700, rewardCents: REWARD, totalCents: 5700 }, REWARD);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.code).toBe('posting_checkout_total_mismatch');
    }
  });
});

describe('openPostingCheckout', () => {
  it('sends the attempt id and reward, and validates what comes back', async () => {
    mockInvokePayments.mockResolvedValue({
      alreadyPaid: false,
      clientSecret: 'cs_1',
      feeCents: FEE,
      rewardCents: REWARD,
      totalCents: FEE + REWARD,
    });

    const result = await openPostingCheckout({
      postingAttemptId: 'attempt-1',
      rewardCents: REWARD,
      paymentMethodId: 'pm_1',
      accessToken: 'tok',
    });

    expect(mockInvokePayments).toHaveBeenCalledWith('payments/posting-checkout/intent', {
      body: {
        postingAttemptId: 'attempt-1',
        rewardAmountCents: REWARD,
        paymentMethodId: 'pm_1',
      },
      accessToken: 'tok',
    });
    expect(result.clientSecret).toBe('cs_1');
  });

  it('throws rather than returning a client secret for a mismatched total', async () => {
    // The dangerous case: the server would happily charge this, and the poster
    // never saw the number.
    mockInvokePayments.mockResolvedValue({
      alreadyPaid: false,
      clientSecret: 'cs_1',
      feeCents: 2500,
      rewardCents: REWARD,
      totalCents: 7500,
    });

    await expect(
      openPostingCheckout({ postingAttemptId: 'attempt-1', rewardCents: REWARD })
    ).rejects.toThrow(/total changed/i);
  });

  it('omits paymentMethodId when the poster has no saved card', async () => {
    mockInvokePayments.mockResolvedValue({
      alreadyPaid: false,
      clientSecret: 'cs_1',
      feeCents: FEE,
      rewardCents: REWARD,
      totalCents: FEE + REWARD,
    });

    await openPostingCheckout({ postingAttemptId: 'attempt-1', rewardCents: REWARD });

    expect(mockInvokePayments.mock.calls[0][1].body).not.toHaveProperty('paymentMethodId');
  });
});

describe('settlePostingCheckout', () => {
  it('posts only the attempt id — the server re-derives everything else', async () => {
    mockInvokePayments.mockResolvedValue({ status: 'paid', paid: true });

    const result = await settlePostingCheckout({
      postingAttemptId: 'attempt-1',
      accessToken: 'tok',
    });

    expect(mockInvokePayments).toHaveBeenCalledWith('payments/posting-checkout/settle', {
      body: { postingAttemptId: 'attempt-1' },
      accessToken: 'tok',
    });
    expect(result.paid).toBe(true);
  });
});

describe('findReusablePaidCheckout', () => {
  it('returns a paid, unconsumed checkout for reuse', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        posting_attempt_id: 'attempt-9',
        status: 'paid',
        fee_amount_cents: FEE,
        reward_amount_cents: REWARD,
        total_amount_cents: FEE + REWARD,
        created_at: '2026-09-21T00:00:00Z',
      },
      error: null,
    });

    await expect(findReusablePaidCheckout('poster-1')).resolves.toEqual({
      postingAttemptId: 'attempt-9',
      status: 'paid',
      feeCents: FEE,
      rewardCents: REWARD,
      totalCents: FEE + REWARD,
      createdAt: '2026-09-21T00:00:00Z',
    });
  });

  it('returns null when there is nothing to reuse', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(findReusablePaidCheckout('poster-1')).resolves.toBeNull();
  });

  it('returns null on a read error rather than blocking the post', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(findReusablePaidCheckout('poster-1')).resolves.toBeNull();
  });

  it('returns null when the table does not exist yet (migration unapplied)', async () => {
    mockMaybeSingle.mockRejectedValue(
      new Error('relation "bounty_posting_checkouts" does not exist')
    );
    await expect(findReusablePaidCheckout('poster-1')).resolves.toBeNull();
  });
});
