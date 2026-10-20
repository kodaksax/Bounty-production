// SBA-05, option B: hooks/usePostingCardGate.
//
// Invariants under test:
//   * the decision (needsCardAtPost) asks only a first-time poster the server
//     says needs a card, and never when a card is saved, the balance covers
//     the reward, iOS has Apple Pay ready, on web, for $0/for-honor, or under
//     Stripe-native funding;
//   * it fails open: no server answer means publish;
//   * when a card is needed, nothing is published until one exists, and the
//     publish then happens once, with no extra tap;
//   * closing the sheet without a card publishes nothing and says why;
//   * the decision waits for its reads instead of using whatever is loaded.

import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockGetRequirement = jest.fn();
const mockTrackEvent = jest.fn();
const mockApplePayAvailable = jest.fn();
const mockLoadPaymentMethods = jest.fn();
const mockStripe: { paymentMethods: { id: string; type: string }[]; isLoading: boolean } = {
  paymentMethods: [],
  isLoading: false,
};
let mockBalance = 0;
let mockStripeNative = false;

jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: jest.fn().mockResolvedValue({ data: null, error: null }) },
}));
jest.mock('lib/services/bounty-funding-service', () => {
  const actual = jest.requireActual('lib/services/bounty-funding-service');
  return {
    ...actual,
    getPostingCardRequirement: (...args: unknown[]) => mockGetRequirement(...args),
  };
});
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => mockTrackEvent(...args) },
}));
jest.mock('lib/services/apple-pay-service', () => ({
  applePayService: { isAvailable: () => mockApplePayAvailable() },
}));
jest.mock('lib/stripe-context', () => ({
  useStripe: () => ({
    paymentMethods: mockStripe.paymentMethods,
    isLoading: mockStripe.isLoading,
    loadPaymentMethods: mockLoadPaymentMethods,
  }),
}));
jest.mock('lib/wallet-context', () => ({ useWallet: () => ({ balance: mockBalance }) }));
jest.mock('lib/utils/payment-architecture', () => ({
  shouldUseStripeNativeFunding: () => mockStripeNative,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { usePostingCardGate, needsCardAtPost } = require('hooks/usePostingCardGate');

const REQUIRED = { cardRequired: true, firstTimePoster: true, chargedAtHire: true };
const NOT_REQUIRED = { cardRequired: false, firstTimePoster: false, chargedAtHire: true };
const CARD = { id: 'pm_card', type: 'card' };
const PAYMENT = { amount: 40, isForHonor: false };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(props: { amount?: number; isForHonor?: boolean } = {}) {
  return renderHook(
    (p: { amount: number; isForHonor: boolean }) =>
      usePostingCardGate({ amount: p.amount, isForHonor: p.isForHonor, surface: 'create_flow' }),
    { initialProps: { amount: props.amount ?? 40, isForHonor: props.isForHonor ?? false } }
  );
}

const outcomes = () =>
  mockTrackEvent.mock.calls
    .filter(([name]) => name === 'posting_card_required')
    .map(([, props]) => props.outcome);

beforeEach(() => {
  jest.clearAllMocks();
  RN.Platform.OS = 'android';
  mockStripe.paymentMethods = [];
  mockStripe.isLoading = false;
  mockBalance = 0;
  mockStripeNative = false;
  mockApplePayAvailable.mockResolvedValue(false);
  mockLoadPaymentMethods.mockResolvedValue(undefined);
  mockGetRequirement.mockResolvedValue(REQUIRED);
});

afterAll(() => {
  RN.Platform.OS = 'ios';
});

describe('needsCardAtPost', () => {
  const base = {
    requirement: REQUIRED,
    platform: 'android' as const,
    amount: 40,
    isForHonor: false,
    balance: 0,
    hasCard: false,
    applePayReady: false,
    stripeNativeFunding: false,
  };

  it('asks a first-time poster with no card, no balance and no Apple Pay', () => {
    expect(needsCardAtPost(base)).toBe(true);
    expect(needsCardAtPost({ ...base, platform: 'ios' })).toBe(true);
  });

  it.each([
    ['the server did not answer', { requirement: null }],
    ['the server says no', { requirement: NOT_REQUIRED }],
    ['a card is already saved', { hasCard: true }],
    ['the balance covers the reward', { balance: 40 }],
    ['iOS has Apple Pay ready', { platform: 'ios', applePayReady: true }],
    ['web (Stripe is stubbed)', { platform: 'web' }],
    ['for honor', { isForHonor: true }],
    ['$0', { amount: 0 }],
    ['Stripe-native funding (charged at post)', { stripeNativeFunding: true }],
  ])('does not ask when %s', (_label, override) => {
    expect(needsCardAtPost({ ...base, ...override })).toBe(false);
  });

  it('Apple Pay only exempts on iOS', () => {
    expect(needsCardAtPost({ ...base, platform: 'android', applePayReady: true })).toBe(true);
  });

  it('a balance one cent short still asks', () => {
    expect(needsCardAtPost({ ...base, balance: 39.99 })).toBe(true);
  });
});

describe('usePostingCardGate', () => {
  it('publishes at once, with no network read, when a card is saved', () => {
    mockStripe.paymentMethods = [CARD];
    const { result } = setup();
    const proceed = jest.fn();
    act(() => result.current.requestPublish(PAYMENT, proceed));
    expect(proceed).toHaveBeenCalledWith(PAYMENT);
    expect(mockLoadPaymentMethods).not.toHaveBeenCalled();
    expect(result.current.showCardSheet).toBe(false);
  });

  it('publishes at once when the balance covers the reward', () => {
    mockBalance = 50;
    const { result } = setup();
    const proceed = jest.fn();
    act(() => result.current.requestPublish(PAYMENT, proceed));
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('publishes at once on iOS with Apple Pay ready', async () => {
    RN.Platform.OS = 'ios';
    mockApplePayAvailable.mockResolvedValue(true);
    const { result } = setup();
    await waitFor(() => expect(mockApplePayAvailable).toHaveBeenCalled());
    await act(async () => {});
    const proceed = jest.fn();
    act(() => result.current.requestPublish(PAYMENT, proceed));
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('fails open when the server does not answer', async () => {
    mockGetRequirement.mockResolvedValue(null);
    const { result } = setup();
    const proceed = jest.fn();
    act(() => result.current.requestPublish(PAYMENT, proceed));
    await waitFor(() => expect(proceed).toHaveBeenCalledWith(PAYMENT));
    expect(result.current.showCardSheet).toBe(false);
    expect(outcomes()).toEqual([]);
  });

  it('publishes without asking when the server says this poster is not first-time', async () => {
    mockGetRequirement.mockResolvedValue(NOT_REQUIRED);
    const { result } = setup();
    const proceed = jest.fn();
    act(() => result.current.requestPublish(PAYMENT, proceed));
    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1));
    expect(result.current.showCardSheet).toBe(false);
  });

  it('waits for its reads: nothing is decided while the requirement is in flight', async () => {
    const pending = deferred<typeof REQUIRED>();
    mockGetRequirement.mockReturnValue(pending.promise);
    const { result } = setup();
    const proceed = jest.fn();
    act(() => result.current.requestPublish(PAYMENT, proceed));
    expect(result.current.checking).toBe(true);
    await act(async () => {});
    expect(proceed).not.toHaveBeenCalled();
    expect(result.current.showCardSheet).toBe(false);

    await act(async () => pending.resolve(REQUIRED));
    await waitFor(() => expect(result.current.showCardSheet).toBe(true));
    expect(proceed).not.toHaveBeenCalled();
  });

  it('opens the card sheet, then publishes once on its own when a card is saved', async () => {
    const { result, rerender } = setup();
    const proceed = jest.fn();
    act(() => result.current.requestPublish(PAYMENT, proceed));
    await waitFor(() => expect(result.current.showCardSheet).toBe(true));
    expect(proceed).not.toHaveBeenCalled();
    expect(mockLoadPaymentMethods).toHaveBeenCalled();

    // AddCardModal saved a card; the Stripe context refreshes its list.
    mockStripe.paymentMethods = [CARD];
    rerender({ amount: 40, isForHonor: false });

    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1));
    expect(proceed).toHaveBeenCalledWith(PAYMENT);
    expect(result.current.showCardSheet).toBe(false);
    expect(outcomes()).toEqual(['prompted', 'saved']);
  });

  it('publishes when the sheet is closed after a card was added', async () => {
    const { result, rerender } = setup();
    const proceed = jest.fn();
    act(() => result.current.requestPublish(PAYMENT, proceed));
    await waitFor(() => expect(result.current.showCardSheet).toBe(true));

    // The re-read on close is what reveals the card.
    mockLoadPaymentMethods.mockImplementationOnce(async () => {
      mockStripe.paymentMethods = [CARD];
    });
    act(() => result.current.onCardSheetClose());
    rerender({ amount: 40, isForHonor: false });

    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1));
    expect(result.current.dismissed).toBe(false);
  });

  it('closing the sheet with no card publishes nothing and says why', async () => {
    const { result } = setup();
    const proceed = jest.fn();
    act(() => result.current.requestPublish(PAYMENT, proceed));
    await waitFor(() => expect(result.current.showCardSheet).toBe(true));

    act(() => result.current.onCardSheetClose());
    await waitFor(() => expect(result.current.dismissed).toBe(true));
    expect(proceed).not.toHaveBeenCalled();
    expect(result.current.showCardSheet).toBe(false);
    expect(result.current.checking).toBe(false);
    expect(outcomes()).toEqual(['prompted', 'dismissed']);

    // Tapping again clears the notice and asks again.
    act(() => result.current.requestPublish(PAYMENT, proceed));
    expect(result.current.dismissed).toBe(false);
    await waitFor(() => expect(result.current.showCardSheet).toBe(true));
  });

  it('a second tap while a check is running is ignored', async () => {
    const pending = deferred<typeof REQUIRED>();
    mockGetRequirement.mockReturnValue(pending.promise);
    const { result } = setup();
    const first = jest.fn();
    const second = jest.fn();
    act(() => result.current.requestPublish(PAYMENT, first));
    act(() => result.current.requestPublish(PAYMENT, second));
    await act(async () => pending.resolve(NOT_REQUIRED));
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(second).not.toHaveBeenCalled();
  });

  it('cardStepExpected tracks the prefetched answer, for the copy', async () => {
    jest.useFakeTimers();
    try {
      const { result } = setup();
      expect(result.current.cardStepExpected).toBe(false);
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      await act(async () => {});
      expect(mockGetRequirement).toHaveBeenCalledWith(40);
      expect(result.current.cardStepExpected).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never reads the requirement for for-honor or web', async () => {
    jest.useFakeTimers();
    try {
      setup({ isForHonor: true, amount: 0 });
      RN.Platform.OS = 'web';
      setup();
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      expect(mockGetRequirement).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
