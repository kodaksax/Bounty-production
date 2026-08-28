/**
 * The posting half of the "post first, pay at accept" experiment
 * (app/screens/CreateBounty/useBountyPublish).
 *
 * Unlike create-bounty-flow-insufficient-balance.test.tsx, this suite runs the
 * REAL useFormSubmission and the real submit body, because the things worth
 * pinning down all live inside it: which funding mode is requested, whether the
 * post-time escrow call is made, and what the poster is told afterwards.
 *
 * The invariants:
 *   * control arm behaviour is bit-for-bit what it was — balance gate, escrow
 *     at post, no eligibility RPC at all;
 *   * a granted deferral posts with NO balance check and NO escrow call;
 *   * the SERVER's answer decides, not ours: a silently downgraded insert is
 *     treated as a funded post, so the "you'll be charged later" copy can never
 *     appear on a bounty that was charged immediately.
 */

import { act, renderHook } from '@testing-library/react-native';

let mockVariant: 'control' | 'deferred' = 'control';
const mockCanDefer = jest.fn();
const mockCreateBounty = jest.fn();
const mockDeleteBounty = jest.fn();
const mockCreateEscrow = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock('lib/experiments/deferred-funding-variant', () => ({
  useDeferredFundingVariant: () => ({ variant: mockVariant, ready: true }),
}));

jest.mock('lib/services/bounty-funding-service', () => ({
  canDeferBountyFunding: (...a: unknown[]) => mockCanDefer(...a),
  amountBucket: (n: number) => (n < 25 ? 'lt_25' : n < 50 ? '25_49' : '50_99'),
}));

jest.mock('app/services/bountyService', () => ({
  bountyService: {
    createBounty: (...a: unknown[]) => mockCreateBounty(...a),
    deleteBounty: (...a: unknown[]) => mockDeleteBounty(...a),
  },
}));

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: unknown[]) => mockTrackEvent(...a) },
}));

jest.mock('lib/services/bounty-payments-service', () => ({
  bountyPaymentsService: { createBountyPayment: jest.fn(), cancelBountyPayment: jest.fn() },
}));
jest.mock('lib/services/stripe-service', () => ({
  stripeService: { confirmPaymentSecure: jest.fn() },
}));
jest.mock('lib/services/offline-queue-service', () => ({
  offlineQueueService: { getOnlineStatus: () => true },
}));
jest.mock('lib/utils/payment-architecture', () => ({
  shouldFundNewBountiesWithPhase2: () => false,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useBountyPublish } = require('app/screens/CreateBounty/useBountyPublish');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Alert } = require('react-native');

const DRAFT = {
  title: 'Walk my dog',
  description: 'Twice round the block',
  amount: 50,
  isForHonor: false,
  category: 'errands',
  workType: 'in_person',
  attachments: [],
};

// Async because useBountyPublish PREFETCHES deferred-funding eligibility in an
// effect rather than resolving it on the publish tap (publish() is deliberately
// synchronous, so it reads an already-resolved answer). Every test must let that
// effect settle first, otherwise it would be asserting against the
// "not answered yet" default rather than the server's real answer.
async function setup(overrides: Record<string, unknown> = {}) {
  const onPublished = jest.fn();
  const onEditAmount = jest.fn();
  const { result } = renderHook(() =>
    useBountyPublish({
      surface: 'create_flow',
      draft: DRAFT,
      clearDraft: jest.fn().mockResolvedValue(undefined),
      balance: 0,
      createEscrow: mockCreateEscrow,
      paymentMethods: [{ id: 'pm_1' }],
      sessionUserId: 'poster-1',
      canPostBounties: true,
      onPublished,
      onEditAmount,
      ...overrides,
    })
  );
  await act(async () => {});
  return { result, onPublished, onEditAmount };
}

const eventNames = () => mockTrackEvent.mock.calls.map(c => c[0]);
const propsFor = (name: string) => mockTrackEvent.mock.calls.find(c => c[0] === name)?.[1];

describe('useBountyPublish — deferred funding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVariant = 'control';
    mockCanDefer.mockResolvedValue(false);
    mockCreateBounty.mockResolvedValue({
      bounty: { id: 'b1', funding_mode: 'at_post' },
      created: true,
    });
    mockCreateEscrow.mockResolvedValue(undefined);
    // The global Alert mock never invokes its buttons; drive the first one so
    // the success path's onPublished callback actually runs.
    (Alert.alert as jest.Mock).mockImplementation((_t: string, _m: string, buttons: any[]) => {
      buttons?.[0]?.onPress?.();
    });
  });

  // Formerly the PostHog "control arm". Pay-at-accept is now the default, so
  // these cases are the ones where the SERVER declines to defer: the kill
  // switch is off, the bounty is v2 Stripe-native, or it is for-honor/$0.
  describe('server declines to defer', () => {
    test('always asks the server about eligibility', async () => {
      const { result } = await setup({ balance: 100 });
      await act(async () => {
        await result.current.publish();
      });
      // The PostHog variant no longer short-circuits this RPC — that
      // short-circuit was what kept the whole mechanism inert in production.
      expect(mockCanDefer).toHaveBeenCalledWith(50);
    });

    test('an unfundable draft still routes to the balance gate', async () => {
      const { result } = await setup({ balance: 0 });
      await act(async () => {
        await result.current.publish();
      });

      expect(result.current.funding.showInsufficientBalance).toBe(true);
      expect(mockCreateBounty).not.toHaveBeenCalled();
      expect(eventNames()).toContain('post_amount_blocked_by_balance');
    });

    test('a funded post asks for at_post and escrows at post time', async () => {
      const { result } = await setup({ balance: 100 });
      await act(async () => {
        await result.current.publish();
      });

      expect(mockCreateBounty).toHaveBeenCalledWith(DRAFT, { fundingMode: 'at_post' });
      expect(mockCreateEscrow).toHaveBeenCalledWith('b1', 50, 'Walk my dog', 'poster-1');
      expect(eventNames()).not.toContain('bounty_posted_unfunded');
      expect(propsFor('post_published')).toMatchObject({ funded: true, fundingMode: 'at_post' });
    });
  });

  describe('deferred arm', () => {
    beforeEach(() => {
      mockVariant = 'deferred';
      mockCanDefer.mockResolvedValue(true);
      mockCreateBounty.mockResolvedValue({
        bounty: { id: 'b1', funding_mode: 'at_accept' },
        created: true,
      });
    });

    test('posts with a zero balance, no gate and no escrow', async () => {
      const { result, onPublished } = await setup({ balance: 0 });
      await act(async () => {
        await result.current.publish();
      });

      expect(result.current.funding.showInsufficientBalance).toBe(false);
      expect(mockCreateBounty).toHaveBeenCalledWith(DRAFT, { fundingMode: 'at_accept' });
      // The whole point: no money is taken at post time.
      expect(mockCreateEscrow).not.toHaveBeenCalled();
      expect(onPublished).toHaveBeenCalledWith('b1', expect.objectContaining({ amountCents: 5000 }));
    });

    test('emits the unfunded-post funnel step with a bucketed amount', async () => {
      const { result } = await setup({ balance: 0 });
      await act(async () => {
        await result.current.publish();
      });

      const props = propsFor('bounty_posted_unfunded');
      expect(props).toMatchObject({
        bountyId: 'b1',
        fundingMode: 'at_accept',
        variant: 'deferred',
        firstBounty: true,
        amountBucket: '50_99',
      });
      expect(JSON.stringify(props)).not.toContain('"amount"');
      // post_published must report the real funding state, not "paid == funded".
      expect(propsFor('post_published')).toMatchObject({ funded: false, fundingMode: 'at_accept' });
    });

    test('tells the poster they will be charged when they choose someone', async () => {
      const { result } = await setup({ balance: 0 });
      await act(async () => {
        await result.current.publish();
      });

      const [, message] = (Alert.alert as jest.Mock).mock.calls[0];
      expect(message).toMatch(/only be charged when you choose someone/i);
    });

    test('falls back to the balance gate when the server refuses the deferral', async () => {
      mockCanDefer.mockResolvedValue(false);
      const { result } = await setup({ balance: 0 });
      await act(async () => {
        await result.current.publish();
      });

      expect(result.current.funding.showInsufficientBalance).toBe(true);
      expect(mockCreateBounty).not.toHaveBeenCalled();
    });

    test('falls back to the balance gate when the eligibility check fails', async () => {
      mockCanDefer.mockRejectedValue(new Error('offline'));
      const { result } = await setup({ balance: 0 });
      await act(async () => {
        await result.current.publish();
      });

      // Failing open here would post an unfunded bounty the server never
      // authorised; failing closed just costs this poster the old flow.
      expect(result.current.funding.showInsufficientBalance).toBe(true);
      expect(mockCreateBounty).not.toHaveBeenCalled();
    });

    test('treats a server-downgraded insert as a funded post', async () => {
      // We asked for at_accept; trg_bounties_normalize_funding_mode said no and
      // the row came back at_post (the poster had the balance, so the insert
      // still succeeded and the trigger took the money).
      mockCreateBounty.mockResolvedValue({
        bounty: { id: 'b1', funding_mode: 'at_post' },
        created: true,
      });
      const { result } = await setup({ balance: 100 });
      await act(async () => {
        await result.current.publish();
      });

      expect(eventNames()).not.toContain('bounty_posted_unfunded');
      expect(propsFor('post_published')).toMatchObject({ funded: true, fundingMode: 'at_post' });
      const [, message] = (Alert.alert as jest.Mock).mock.calls[0];
      expect(message).not.toMatch(/only be charged when you choose someone/i);
    });

    test('never escrows at post when the server did not report funding_mode', async () => {
      // Regression: an offline publish (and any insert whose returned row omits
      // the column) leaves funding_mode undefined. The client used to fall back
      // to what it ASKED for, but the server now grants at_accept from the
      // bounty's own columns regardless of the request — so falling back to
      // at_post debited the poster at post time for a bounty the server had
      // actually deferred. Unknown must mean "assume deferred, do not escrow":
      // if the server really chose at_post, its AFTER INSERT trigger already
      // took the money and this client call is redundant anyway.
      mockCanDefer.mockResolvedValue(false); // client believes it is NOT deferring
      mockCreateBounty.mockResolvedValue({
        bounty: { id: 'b1' }, // no funding_mode on the row
        created: true,
      });
      const { result } = await setup({ balance: 100 });
      await act(async () => {
        await result.current.publish();
      });

      expect(mockCreateEscrow).not.toHaveBeenCalled();
    });

    test('a for-honor draft is never deferred', async () => {
      const { result } = await setup({ balance: 0, draft: { ...DRAFT, isForHonor: true, amount: 0 } });
      await act(async () => {
        await result.current.publish();
      });

      expect(mockCanDefer).not.toHaveBeenCalled();
      expect(mockCreateBounty).toHaveBeenCalledWith(
        expect.objectContaining({ isForHonor: true }),
        { fundingMode: 'at_post' }
      );
    });
  });
});
