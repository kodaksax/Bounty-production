/**
 * The money-safety contract of hooks/usePostingCheckout.
 *
 * This hook decides whether a bounty may be created, so every assertion here
 * is about one of two failure modes, both of which cost real money:
 *
 *   OVER-CHARGING  — the poster is billed twice for one post.
 *   UNDER-GATING   — a bounty is created against a charge that did not land,
 *                    so the reward is escrowed from money nobody paid.
 *
 * `pay()` must therefore resolve true ONLY after the server has verified the
 * charge with Stripe and credited the reward. A closed payment sheet is not
 * sufficient, and neither is a charge that is still processing.
 */

const mockTrackEvent = jest.fn();
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: unknown[]) => mockTrackEvent(...a) },
}));

const mockOpen = jest.fn();
const mockSettle = jest.fn();
jest.mock('../../../lib/services/posting-checkout-service', () => ({
  createPostingAttemptId: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  openPostingCheckout: (...a: unknown[]) => mockOpen(...a),
  settlePostingCheckout: (...a: unknown[]) => mockSettle(...a),
}));

const mockPresentSheet = jest.fn();
const mockConfirm = jest.fn();
jest.mock('../../../lib/services/stripe-service', () => ({
  stripeService: {
    presentPaymentSheet: (...a: unknown[]) => mockPresentSheet(...a),
    confirmPaymentSecure: (...a: unknown[]) => mockConfirm(...a),
  },
}));

let mockPaymentMethods: { id: string }[] = [{ id: 'pm_saved' }];
jest.mock('../../../lib/stripe-context', () => ({
  useStripe: () => ({ paymentMethods: mockPaymentMethods }),
}));

jest.mock('../../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({
    session: { access_token: 'tok', user: { id: 'user-1' } },
  }),
}));

jest.mock('../../../lib/utils/error-messages', () => ({
  getUserFriendlyError: (e: any) => ({
    title: 'Error',
    message: e?.message ?? 'Something went wrong',
  }),
}));

import { act, renderHook } from '@testing-library/react-native';
import { usePostingCheckout } from '../../../hooks/usePostingCheckout';

const REWARD_CENTS = 5000; // $50 bounty
const FEE_CENTS = 100; // $1 fee

function setup() {
  return renderHook(() =>
    usePostingCheckout({ rewardDollars: 50, surface: 'create_flow', variant: 'fee' })
  );
}

/** A normal, successful checkout. */
function happyPath() {
  mockOpen.mockResolvedValue({
    alreadyPaid: false,
    clientSecret: 'pi_123_secret_abc',
    paymentIntentId: 'pi_123',
    feeCents: FEE_CENTS,
    rewardCents: REWARD_CENTS,
    totalCents: FEE_CENTS + REWARD_CENTS,
  });
  mockPresentSheet.mockResolvedValue({ success: true });
  mockSettle.mockResolvedValue({ status: 'paid', paid: true });
}

function eventNames() {
  return mockTrackEvent.mock.calls.map(c => c[0]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPaymentMethods = [{ id: 'pm_saved' }];
});

describe('itemisation', () => {
  it('splits the total into the reward and the $1 fee', () => {
    const { result } = setup();
    expect(result.current.totals).toEqual({
      rewardCents: REWARD_CENTS,
      feeCents: FEE_CENTS,
      totalCents: 5100,
    });
  });

  it('starts idle, not busy, and not paid', () => {
    const { result } = setup();
    expect(result.current.state).toBe('idle');
    expect(result.current.isBusy).toBe(false);
  });
});

describe('successful checkout', () => {
  it('charges once, verifies server-side, and reports paid', async () => {
    happyPath();
    const { result } = setup();

    let paid: boolean | undefined;
    await act(async () => {
      paid = await result.current.pay();
    });

    expect(paid).toBe(true);
    expect(result.current.state).toBe('paid');
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockPresentSheet).toHaveBeenCalledTimes(1);
    // The settle call is the gate — a closed sheet alone must never authorise
    // creating the bounty.
    expect(mockSettle).toHaveBeenCalledTimes(1);
  });

  it('asks the server for exactly the reward it displayed', async () => {
    happyPath();
    const { result } = setup();
    await act(async () => {
      await result.current.pay();
    });
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ rewardCents: REWARD_CENTS })
    );
  });

  it('emits the funnel in order and carries no payment identifiers', async () => {
    happyPath();
    const { result } = setup();
    await act(async () => {
      await result.current.pay();
    });

    expect(eventNames()).toEqual(['posting_checkout_started', 'posting_checkout_succeeded']);

    const payloads = mockTrackEvent.mock.calls.map(c => JSON.stringify(c[1]));
    for (const p of payloads) {
      expect(p).not.toContain('secret');
      expect(p).not.toContain('pi_123');
      expect(p).not.toContain('pm_saved');
    }
  });
});

describe('charged exactly once', () => {
  it('short-circuits a second pay() once paid, without re-opening a charge', async () => {
    happyPath();
    const { result } = setup();

    await act(async () => {
      await result.current.pay();
    });
    // This is the failed-publish retry: the composer calls pay() again.
    let second: boolean | undefined;
    await act(async () => {
      second = await result.current.pay();
    });

    expect(second).toBe(true);
    // The whole point: no second intent, no second sheet, no second settle.
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockPresentSheet).toHaveBeenCalledTimes(1);
    expect(mockSettle).toHaveBeenCalledTimes(1);
  });

  it('ignores a concurrent second tap while a charge is in flight', async () => {
    let releaseSheet: (v: unknown) => void = () => {};
    mockOpen.mockResolvedValue({
      alreadyPaid: false,
      clientSecret: 'pi_123_secret_abc',
      feeCents: FEE_CENTS,
      rewardCents: REWARD_CENTS,
      totalCents: 5100,
    });
    mockPresentSheet.mockReturnValue(
      new Promise(resolve => {
        releaseSheet = resolve;
      })
    );
    mockSettle.mockResolvedValue({ status: 'paid', paid: true });

    const { result } = setup();

    let firstResult: Promise<boolean>;
    let secondResult: boolean | undefined;
    await act(async () => {
      firstResult = result.current.pay();
      // Second tap lands while the sheet is still open.
      secondResult = await result.current.pay();
      releaseSheet({ success: true });
      await firstResult;
    });

    expect(secondResult).toBe(false);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('consumes an already-paid checkout instead of charging again', async () => {
    // The interrupted-checkout case: the poster paid, the app died before the
    // bounty was created, and they came back.
    mockOpen.mockResolvedValue({
      alreadyPaid: true,
      status: 'paid',
      feeCents: FEE_CENTS,
      rewardCents: REWARD_CENTS,
      totalCents: 5100,
    });

    const { result } = setup();
    let paid: boolean | undefined;
    await act(async () => {
      paid = await result.current.pay();
    });

    expect(paid).toBe(true);
    expect(result.current.state).toBe('paid');
    expect(result.current.prepaid).toBe(true);
    // No sheet was shown and nothing was charged.
    expect(mockPresentSheet).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
    // The duplicate-charge canary fires, and a success does NOT.
    expect(eventNames()).toContain('posting_checkout_reused');
    expect(eventNames()).not.toContain('posting_checkout_succeeded');
  });

  it('reuses the same attempt id across a failure and a retry', async () => {
    mockOpen
      .mockResolvedValueOnce({
        alreadyPaid: false,
        clientSecret: 'cs_1',
        feeCents: FEE_CENTS,
        rewardCents: REWARD_CENTS,
        totalCents: 5100,
      })
      .mockResolvedValueOnce({
        alreadyPaid: false,
        clientSecret: 'cs_1',
        feeCents: FEE_CENTS,
        rewardCents: REWARD_CENTS,
        totalCents: 5100,
      });
    mockPresentSheet
      .mockResolvedValueOnce({ success: false, error: { code: 'card_declined' } })
      .mockResolvedValueOnce({ success: true });
    mockSettle.mockResolvedValue({ status: 'paid', paid: true });

    const { result } = setup();
    const attemptId = result.current.attemptId;

    await act(async () => {
      await result.current.pay();
    });
    await act(async () => {
      await result.current.pay();
    });

    // Both requests carry the SAME attempt id, which is what makes the server's
    // deterministic Stripe idempotency key collapse them onto one charge.
    expect(mockOpen.mock.calls[0][0].postingAttemptId).toBe(attemptId);
    expect(mockOpen.mock.calls[1][0].postingAttemptId).toBe(attemptId);
    expect(result.current.attemptId).toBe(attemptId);
  });
});

describe('does not gate open on a charge that did not land', () => {
  it('returns false and stays unpaid when the card is declined', async () => {
    mockOpen.mockResolvedValue({
      alreadyPaid: false,
      clientSecret: 'cs_1',
      feeCents: FEE_CENTS,
      rewardCents: REWARD_CENTS,
      totalCents: 5100,
    });
    mockPresentSheet.mockResolvedValue({
      success: false,
      error: { code: 'card_declined', message: 'Your card was declined.' },
    });

    const { result } = setup();
    let paid: boolean | undefined;
    await act(async () => {
      paid = await result.current.pay();
    });

    expect(paid).toBe(false);
    expect(result.current.state).toBe('failed');
    expect(result.current.error).toBe('Your card was declined.');
    expect(result.current.failureCode).toBe('card_declined');
    // Never settled, so the composer cannot have been told to publish.
    expect(mockSettle).not.toHaveBeenCalled();
    expect(eventNames()).toContain('posting_checkout_failed');
  });

  it('records a dismissed sheet as ABANDONED, not failed, and returns to idle', async () => {
    mockOpen.mockResolvedValue({
      alreadyPaid: false,
      clientSecret: 'cs_1',
      feeCents: FEE_CENTS,
      rewardCents: REWARD_CENTS,
      totalCents: 5100,
    });
    mockPresentSheet.mockResolvedValue({ success: false, error: { code: 'canceled' } });

    const { result } = setup();
    let paid: boolean | undefined;
    await act(async () => {
      paid = await result.current.pay();
    });

    expect(paid).toBe(false);
    // Idle, not failed — a change of mind is not an error to apologise for.
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(eventNames()).toContain('posting_checkout_abandoned');
    expect(eventNames()).not.toContain('posting_checkout_failed');
  });

  it('refuses to publish on a still-processing charge', async () => {
    mockOpen.mockResolvedValue({
      alreadyPaid: false,
      clientSecret: 'cs_1',
      feeCents: FEE_CENTS,
      rewardCents: REWARD_CENTS,
      totalCents: 5100,
    });
    mockPresentSheet.mockResolvedValue({ success: true });
    // ACH and some wallets settle asynchronously; the reward is not in the
    // wallet yet, so the bounty INSERT would fail to escrow it.
    mockSettle.mockResolvedValue({ status: 'pending', paid: false, processing: true });

    const { result } = setup();
    let paid: boolean | undefined;
    await act(async () => {
      paid = await result.current.pay();
    });

    expect(paid).toBe(false);
    expect(result.current.failureCode).toBe('processing');
    expect(result.current.error).toMatch(/not be charged twice/i);
  });

  it('refuses to publish when settlement cannot be confirmed, and says so safely', async () => {
    mockOpen.mockResolvedValue({
      alreadyPaid: false,
      clientSecret: 'cs_1',
      feeCents: FEE_CENTS,
      rewardCents: REWARD_CENTS,
      totalCents: 5100,
    });
    mockPresentSheet.mockResolvedValue({ success: true });
    mockSettle.mockRejectedValue(Object.assign(new Error('network down'), { code: 'NETWORK' }));

    const { result } = setup();
    let paid: boolean | undefined;
    await act(async () => {
      paid = await result.current.pay();
    });

    expect(paid).toBe(false);
    expect(result.current.state).toBe('failed');
    // The poster's money may have moved, so the copy must not claim it did not.
    expect(result.current.error).toMatch(/may have gone through/i);
    expect(result.current.error).toMatch(/not be charged twice/i);
  });

  it('returns false when the intent request itself fails', async () => {
    mockOpen.mockRejectedValue(
      Object.assign(new Error('Server unavailable'), { code: 'checkout_record_failed' })
    );

    const { result } = setup();
    let paid: boolean | undefined;
    await act(async () => {
      paid = await result.current.pay();
    });

    expect(paid).toBe(false);
    expect(result.current.failureCode).toBe('checkout_record_failed');
    expect(mockPresentSheet).not.toHaveBeenCalled();
  });
});

describe('web fallback (no native payment sheet)', () => {
  it('confirms against a saved method when the sheet is unavailable', async () => {
    mockOpen.mockResolvedValue({
      alreadyPaid: false,
      clientSecret: 'cs_1',
      feeCents: FEE_CENTS,
      rewardCents: REWARD_CENTS,
      totalCents: 5100,
    });
    mockPresentSheet.mockResolvedValue({ success: false, error: { code: 'not_supported' } });
    mockConfirm.mockResolvedValue({ status: 'succeeded' });
    mockSettle.mockResolvedValue({ status: 'paid', paid: true });

    const { result } = setup();
    let paid: boolean | undefined;
    await act(async () => {
      paid = await result.current.pay();
    });

    expect(paid).toBe(true);
    expect(mockConfirm).toHaveBeenCalledWith('cs_1', 'pm_saved', undefined, {
      userId: 'user-1',
    });
  });

  it('fails with an actionable message when there is no sheet AND no saved card', async () => {
    mockPaymentMethods = [];
    mockOpen.mockResolvedValue({
      alreadyPaid: false,
      clientSecret: 'cs_1',
      feeCents: FEE_CENTS,
      rewardCents: REWARD_CENTS,
      totalCents: 5100,
    });
    mockPresentSheet.mockResolvedValue({ success: false, error: { code: 'not_supported' } });

    const { result } = setup();
    let paid: boolean | undefined;
    await act(async () => {
      paid = await result.current.pay();
    });

    expect(paid).toBe(false);
    expect(result.current.failureCode).toBe('no_payment_method');
    expect(result.current.error).toMatch(/add a payment method/i);
  });
});

describe('reset', () => {
  it('clears a failure so the CTA returns to its normal label', async () => {
    mockOpen.mockRejectedValue(new Error('boom'));
    const { result } = setup();
    await act(async () => {
      await result.current.pay();
    });
    expect(result.current.state).toBe('failed');

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('refuses to un-pay a paid checkout', async () => {
    happyPath();
    const { result } = setup();
    await act(async () => {
      await result.current.pay();
    });

    act(() => {
      result.current.reset();
    });

    // Resetting to idle here would offer the poster a second charge for money
    // they have already handed over.
    expect(result.current.state).toBe('paid');
  });
});
