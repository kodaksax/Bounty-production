/**
 * The pay-at-accept sheet (components/accept-funding-gate.tsx).
 *
 * useAcceptFunding owns the state machine and is tested on its own; what this
 * suite pins down is the wiring between the sheet and the existing deposit
 * path (hooks/use-wallet-deposit), which is where a poster with no card, a
 * dismissed Apple Pay sheet, or a declined charge would otherwise fall through:
 *
 *   * balance covers it  -> one "Confirm & hire" tap -> gate.onConfirm
 *   * balance is short   -> "Pay $X & hire" charges EXACTLY the shortfall via
 *                           payWithCard / payWithApplePay, after telling the
 *                           gate a payment started
 *   * no card on file    -> the same button opens the Stripe Payment Sheet
 *                           (Apple Pay / Google Pay / new card); on web, where
 *                           there is no sheet, it links a card instead
 *   * card on file       -> "Use another card" opens the Payment Sheet
 *   * Stripe still loading -> the button waits rather than charging with an
 *                           empty method list
 *   * success            -> gate.onPaymentSucceeded with the captured amount,
 *                           with NO success modal in the way
 *   * cancel / decline   -> gate.onPaymentFailed('cancelled' | 'failed', failure);
 *                           the sheet stays up, explains a decline in plain
 *                           words and keeps the hunter selected
 *   * sub-minimum shortfall -> charged at Stripe's $0.50 floor, not refused
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';

const mockPayWithCard = jest.fn();
const mockPayWithApplePay = jest.fn();
const mockPayWithPaymentSheet = jest.fn();
const mockSetSuccessInfo = jest.fn();
const mockSetError = jest.fn();
const mockSetShowPaymentMethodsModal = jest.fn();
const mockLoadPaymentMethods = jest.fn().mockResolvedValue(undefined);

type DepositState = {
  isProcessing: boolean;
  error: any;
  successInfo: { amount: number; persisted: boolean; via: 'card' | 'applePay' } | null;
  paymentMethods: any[];
  stripeLoading: boolean;
  stripeError: any;
  showPaymentMethodsModal: boolean;
};

let depositState: DepositState;

const resetDepositState = (overrides: Partial<DepositState> = {}) => {
  depositState = {
    isProcessing: false,
    error: null,
    successInfo: null,
    paymentMethods: [{ id: 'pm_1', type: 'card', card: { brand: 'visa', last4: '4242' } }],
    stripeLoading: false,
    stripeError: null,
    showPaymentMethodsModal: false,
    ...overrides,
  };
};

jest.mock('hooks/use-wallet-deposit', () => ({
  useWalletDeposit: () => ({
    ...depositState,
    primaryCardPaymentMethod:
      depositState.paymentMethods.find((method: any) => method.type === 'card') ?? null,
    isApplePayAvailable: true,
    isGooglePayAvailable: false,
    walletName: 'Apple Pay',
    setError: mockSetError,
    setSuccessInfo: mockSetSuccessInfo,
    setShowPaymentMethodsModal: mockSetShowPaymentMethodsModal,
    loadPaymentMethods: mockLoadPaymentMethods,
    payWithCard: (...a: unknown[]) => mockPayWithCard(...a),
    payWithApplePay: (...a: unknown[]) => mockPayWithApplePay(...a),
    payWithPaymentSheet: (...a: unknown[]) => mockPayWithPaymentSheet(...a),
  }),
}));

jest.mock('lib/services/stripe-service', () => ({
  stripeService: { formatCardDisplay: () => 'Visa •••• 4242' },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('lib/services/focus-analytics', () => ({ trackWorkspacePrimaryTapped: jest.fn() }));
jest.mock('components/payment-methods-modal', () => ({ PaymentMethodsModal: () => null }));
jest.mock('components/error-banner', () => {
  const { Text } = require('react-native');
  return { ErrorBanner: ({ error }: any) => <Text>{`banner:${error?.message ?? ''}`}</Text> };
});
jest.mock('lib/utils/error-messages', () => ({
  getUserFriendlyError: (e: any) => ({ message: e?.message ?? String(e) }),
}));
jest.mock('components/ui/avatar', () => {
  const { View } = require('react-native');
  return {
    Avatar: ({ children }: any) => <View>{children}</View>,
    AvatarImage: () => null,
    AvatarFallback: ({ children }: any) => <View>{children}</View>,
  };
});
jest.mock('lib/constants/navigation', () => ({
  getBottomNavContentGap: () => 0,
  getBottomNavOccludedHeight: () => 0,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockPaymentPromiseOn = false;
jest.mock('lib/experiments/payment-promise-copy', () => ({
  usePaymentPromiseCopy: () => mockPaymentPromiseOn,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AcceptFundingGate, chargeAmountForShortfall, MIN_SHORTFALL_CHARGE } = require('components/accept-funding-gate');

const REQ = {
  bountyId: 'b1',
  fundingMode: 'at_accept' as const,
  requiresFunding: true,
  amountRequired: 50,
  alreadyFunded: false,
  posterBalance: 20,
  shortfall: 30,
};

function makeGate(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    stage: 'pay',
    requirement: REQ,
    hunterName: 'Ada',
    hunterAvatar: null,
    remainderAfterDeposit: false,
    paymentFailure: null,
    onConfirm: jest.fn(),
    onPaymentStarted: jest.fn(),
    onPaymentSucceeded: jest.fn(),
    onPaymentPending: jest.fn(),
    onPaymentFailed: jest.fn(),
    onCancel: jest.fn(),
    canLeavePending: false,
    onLeavePending: jest.fn(),
    ...overrides,
  };
}

describe('AcceptFundingGate', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDepositState();
    mockPaymentPromiseOn = false;
    Platform.OS = 'ios';
    // A charge that never settles unless a test says otherwise.
    const inFlight = () => new Promise(() => {});
    mockPayWithCard.mockImplementation(inFlight);
    mockPayWithApplePay.mockImplementation(inFlight);
    mockPayWithPaymentSheet.mockImplementation(inFlight);
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  describe('payment-promise-copy flag', () => {
    const HOLD =
      'We hold it until you approve the work. If something goes wrong, tap Report a problem and Bounty support decides; any refund goes to your Bounty balance.';
    const cardOnly = { ...REQ, amountRequired: 30, posterBalance: 0, shortfall: 30 };
    const balanceOnly = { ...REQ, amountRequired: 30, posterBalance: 80, shortfall: 0 };
    const both = { ...REQ, amountRequired: 30, posterBalance: 10, shortfall: 20 };

    describe('off', () => {
      test('the card-charge sheet is unchanged', () => {
        const { getByText, queryByText, queryByTestId } = render(<AcceptFundingGate gate={makeGate()} />);

        expect(getByText('Pay $30 and choose Ada')).toBeTruthy();
        expect(getByText('Not yet')).toBeTruthy();
        expect(getByText('Choose Ada for $50?')).toBeTruthy();
        expect(getByText(/\$30 from your (card|payment method)\./)).toBeTruthy();
        expect(getByText('Wallet balance')).toBeTruthy();
        expect(getByText(trustSafetyStrings.posterHire)).toBeTruthy();
        expect(queryByTestId('payment-promise-summary')).toBeNull();
        expect(queryByText('Fund and hire')).toBeNull();
        // Focus-first screen E names the back-out button "Not yet" too, so the
        // promise copy is told apart by its summary and "Fund and hire" above.
      });

      test('the balance-covered sheet is unchanged', () => {
        const gate = makeGate({ stage: 'confirm', requirement: balanceOnly });
        const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);

        expect(getByText('Choose Ada')).toBeTruthy();
        expect(getByText('After this hire')).toBeTruthy();
        expect(queryByText('Fund and hire')).toBeNull();
      });
    });

    describe('on', () => {
      beforeEach(() => {
        mockPaymentPromiseOn = true;
      });

      test.each([
        ['card only', cardOnly, 'pay', 'Your card is charged $30.00 now.'],
        ['balance only', balanceOnly, 'confirm', '$30.00 comes from your Bounty balance now.'],
        ['both', both, 'pay', '$10.00 from your Bounty balance and $20.00 charged to your card now.'],
      ])('%s shows the three approved lines', (_name, requirement, stage, sourceLine) => {
        const { getByText } = render(
          <AcceptFundingGate gate={makeGate({ requirement, stage })} />
        );

        expect(getByText('Reward $30.00 · You pay $30.00 · No fees for you')).toBeTruthy();
        expect(getByText(sourceLine)).toBeTruthy();
        expect(getByText(HOLD)).toBeTruthy();
      });

      test('a shortfall under the Stripe minimum still adds up to the reward', () => {
        const requirement = { ...REQ, amountRequired: 30, posterBalance: 29.9, shortfall: 0.1 };
        const { getByText } = render(<AcceptFundingGate gate={makeGate({ requirement })} />);

        expect(
          getByText('$29.50 from your Bounty balance and $0.50 charged to your card now.')
        ).toBeTruthy();
      });

      test('the sheet is only those three lines', () => {
        const { queryByText } = render(<AcceptFundingGate gate={makeGate()} />);

        expect(queryByText('Bounty reward $50.00')).toBeNull();
        expect(queryByText('charged to your card now')).toBeNull();
        expect(queryByText('Wallet balance')).toBeNull();
        expect(queryByText('Charged now')).toBeNull();
        expect(queryByText(trustSafetyStrings.posterHire)).toBeNull();
        expect(queryByText(/8%|15%/)).toBeNull();
      });

      test('the card can still be changed', () => {
        const { getByText } = render(<AcceptFundingGate gate={makeGate()} />);

        fireEvent.press(getByText('Change'));

        expect(mockSetShowPaymentMethodsModal).toHaveBeenCalledWith(true);
      });

      test('"Fund and hire" charges exactly the shortfall', () => {
        const gate = makeGate({ requirement: both });
        const { getByText } = render(<AcceptFundingGate gate={gate} />);

        fireEvent.press(getByText('Fund and hire'));

        expect(gate.onPaymentStarted).toHaveBeenCalledWith('card');
        expect(mockPayWithCard).toHaveBeenCalledWith(20);
      });

      test('charges nothing when no hire is waiting on the sheet', () => {
        const gate = makeGate({ requirement: both, onPaymentStarted: jest.fn(() => false) });
        const { getByText } = render(<AcceptFundingGate gate={gate} />);

        fireEvent.press(getByText('Fund and hire'));

        expect(mockPayWithCard).not.toHaveBeenCalled();
      });

      test('"Fund and hire" confirms without Stripe when the balance covers it', () => {
        const gate = makeGate({ stage: 'confirm', requirement: balanceOnly });
        const { getByText } = render(<AcceptFundingGate gate={gate} />);

        fireEvent.press(getByText('Fund and hire'));

        expect(gate.onConfirm).toHaveBeenCalledTimes(1);
        expect(mockPayWithCard).not.toHaveBeenCalled();
      });

      test('"Not yet" backs out', () => {
        const gate = makeGate();
        const { getByText } = render(<AcceptFundingGate gate={gate} />);

        fireEvent.press(getByText('Not yet'));

        expect(gate.onCancel).toHaveBeenCalledTimes(1);
      });

      test('a declined card is still explained', () => {
        const gate = makeGate({
          paymentFailure: { error_code: 'card_declined', error_type: 'card_error' },
        });
        const { getByText } = render(<AcceptFundingGate gate={gate} />);

        expect(getByText('Ada is still selected. Nothing has changed on this bounty.')).toBeTruthy();
      });
    });
  });

  describe('4b quick confirm', () => {
    const quick = { jobTitle: 'Clear the garage', jobIcon: 'chair', sub: '4.8 · 14 jobs' };
    const covered = { ...REQ, posterBalance: 80, shortfall: 0 };
    let readerOn: boolean;
    let onAppState: ((s: string) => void) | null;
    const tick = async (seconds: number) => {
      for (let i = 0; i < seconds; i++) await act(async () => void jest.advanceTimersByTime(1000));
    };
    const open = async (gate = makeGate(), props: Record<string, unknown> = { quickConfirm: quick }) => {
      const view = render(<AcceptFundingGate gate={gate} {...props} />);
      await act(async () => {});
      return { gate, ...view };
    };

    beforeEach(() => {
      jest.useFakeTimers();
      readerOn = false;
      onAppState = null;
      (AppState as any).currentState = 'active';
      (AppState as any).addEventListener = jest.fn((_e: string, cb: any) => {
        onAppState = cb;
        return { remove: jest.fn() };
      });
      (AccessibilityInfo as any).addEventListener = jest.fn(() => ({ remove: jest.fn() }));
      (AccessibilityInfo as any).isScreenReaderEnabled = jest.fn(async () => readerOn);
    });
    afterEach(() => jest.useRealTimers());

    test('charges exactly the shortfall once, at 0:00 and not before', async () => {
      const { gate, getByText, queryByTestId } = await open();
      expect(getByText('Looks good (0:07)')).toBeTruthy();
      await tick(6);
      expect(mockPayWithCard).not.toHaveBeenCalled();
      await tick(5);
      expect(gate.onPaymentStarted).toHaveBeenCalledWith('card');
      expect(mockPayWithCard).toHaveBeenCalledTimes(1);
      expect(mockPayWithCard).toHaveBeenCalledWith(30);
      // What follows (processing, a decline) is screen E.
      expect(queryByTestId('quick-confirm')).toBeNull();
    });

    test('tapping confirms now, and the timer does not confirm again', async () => {
      const { gate, getByTestId } = await open(makeGate({ stage: 'confirm', requirement: covered }));
      fireEvent.press(getByTestId('quick-confirm-yes'));
      await tick(10);
      expect(gate.onConfirm).toHaveBeenCalledTimes(1);
      expect(mockPayWithCard).not.toHaveBeenCalled();
    });

    test('Go back cancels and nothing is charged', async () => {
      const { gate, getByTestId } = await open();
      fireEvent.press(getByTestId('quick-confirm-back'));
      await tick(10);
      expect(gate.onCancel).toHaveBeenCalledTimes(1);
      expect(mockPayWithCard).not.toHaveBeenCalled();
    });

    test('Change stops the timer and opens the full screen', async () => {
      const { getByTestId, getByText } = await open();
      fireEvent.press(getByTestId('quick-confirm-change'));
      await tick(10);
      expect(getByText('Choose Ada for $50?')).toBeTruthy();
      expect(mockPayWithCard).not.toHaveBeenCalled();
    });

    test('pauses in the background and carries on after', async () => {
      const { getByText } = await open();
      await tick(3);
      act(() => onAppState!('background'));
      await tick(30);
      expect(mockPayWithCard).not.toHaveBeenCalled();
      act(() => onAppState!('active'));
      expect(getByText('Looks good (0:04)')).toBeTruthy();
      await tick(4);
      expect(mockPayWithCard).toHaveBeenCalledTimes(1);
    });

    test('a screen reader gets the button and no timer', async () => {
      readerOn = true;
      const { getByText, getByTestId } = await open();
      expect(getByText('Looks good')).toBeTruthy();
      await tick(30);
      expect(mockPayWithCard).not.toHaveBeenCalled();
      fireEvent.press(getByTestId('quick-confirm-yes'));
      expect(mockPayWithCard).toHaveBeenCalledTimes(1);
    });

    test('leaving the screen charges nothing', async () => {
      const { unmount } = await open();
      unmount();
      await tick(10);
      expect(mockPayWithCard).not.toHaveBeenCalled();
    });

    test('waits while saved cards load', async () => {
      resetDepositState({ stripeLoading: true, paymentMethods: [] });
      const { getByText } = await open();
      expect(getByText('Checking payment…')).toBeTruthy();
      await tick(30);
      expect(mockPayWithCard).not.toHaveBeenCalled();
    });

    test.each([
      ['no saved card', () => resetDepositState({ paymentMethods: [] }), {}],
      ['a declined payment', () => {}, { paymentFailure: { error_code: 'card_declined', error_type: 'card_error' } }],
      ['a remainder to pay', () => {}, { remainderAfterDeposit: true }],
      ['a pending payment', () => {}, { stage: 'pending' }],
    ])('%s is screen E, and never confirms itself', async (_n, setup, over) => {
      setup();
      const { queryByTestId, gate } = await open(makeGate(over));
      expect(queryByTestId('quick-confirm')).toBeNull();
      await tick(30);
      expect(mockPayWithCard).not.toHaveBeenCalled();
      expect(mockPayWithPaymentSheet).not.toHaveBeenCalled();
      expect(gate.onConfirm).not.toHaveBeenCalled();
    });

    test('is only where the screen asks for it', async () => {
      const { queryByTestId } = await open(makeGate(), {});
      expect(queryByTestId('quick-confirm')).toBeNull();
    });

    test.each([
      [true, "Stripe checked Ada's photo ID for Bounty"],
      [false, "Ada hasn't verified a photo ID yet"],
    ])('ID verified=%s: the ID line under the name, with its link', async (verified, line) => {
      const { getByTestId } = await open(makeGate({ idCheck: { name: 'Ada', verified } }));
      expect(getByTestId('quick-confirm')).toBeTruthy();
      expect(getByTestId('helper-id-line-text')).toHaveTextContent(line);
      expect(getByTestId('helper-id-line-link')).toHaveTextContent('What Bounty checks');
    });
  });

  describe('screen E: the ID line', () => {
    test.each([
      [true, "Stripe checked Ada's photo ID for Bounty"],
      [false, "Ada hasn't verified a photo ID yet"],
    ])('ID verified=%s: one line under the title, with its link', (verified, line) => {
      const { getByTestId } = render(<AcceptFundingGate gate={makeGate({ idCheck: { name: 'Ada', verified } })} />);
      const head = getByTestId('hire-confirmation');
      expect(head).toBeTruthy();
      expect(getByTestId('helper-id-line-text')).toHaveTextContent(line);
      expect(getByTestId('helper-id-line-link')).toHaveTextContent('What Bounty checks');
    });

    test('unknown (the offer came without a profile): no ID claim either way', () => {
      const { queryByTestId } = render(<AcceptFundingGate gate={makeGate({ idCheck: null })} />);
      expect(queryByTestId('helper-id-line')).toBeNull();
    });
  });

  describe('balance covers it', () => {
    const covered = { ...REQ, posterBalance: 80, shortfall: 0 };

    test('one tap confirms; nothing is sent to Stripe', () => {
      const gate = makeGate({ stage: 'confirm', requirement: covered });
      const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);

      expect(getByText('Choose Ada for $50?')).toBeTruthy();
      expect(getByText(trustSafetyStrings.payWhenYouHire)).toBeTruthy();
      expect(getByText('From your Bounty balance.')).toBeTruthy();
      // No Apple Pay button when there is nothing to charge.
      expect(queryByText('Pay')).toBeNull();

      fireEvent.press(getByText('Choose Ada'));

      expect(gate.onConfirm).toHaveBeenCalledTimes(1);
      expect(gate.onPaymentStarted).not.toHaveBeenCalled();
      expect(mockPayWithCard).not.toHaveBeenCalled();
      expect(mockPayWithApplePay).not.toHaveBeenCalled();
    });

    test('"Not now" backs out', () => {
      const gate = makeGate({ stage: 'confirm', requirement: covered });
      const { getByText } = render(<AcceptFundingGate gate={gate} />);
      fireEvent.press(getByText('Not yet'));
      expect(gate.onCancel).toHaveBeenCalledTimes(1);
      expect(gate.onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('balance is short', () => {
    test('"Pay $X & hire" charges exactly the shortfall by card', async () => {
      const gate = makeGate();
      const { getByText } = render(<AcceptFundingGate gate={gate} />);

      expect(getByText(/\$30 from your (card|payment method)\./)).toBeTruthy();
      expect(getByText(trustSafetyStrings.payWhenYouHire)).toBeTruthy();

      fireEvent.press(getByText('Pay $30 and choose Ada'));

      expect(gate.onPaymentStarted).toHaveBeenCalledWith('card');
      expect(mockPayWithCard).toHaveBeenCalledWith(30);
      // The bounty's full $50 is never what gets charged.
      expect(mockPayWithCard).not.toHaveBeenCalledWith(50);
      expect(gate.onConfirm).not.toHaveBeenCalled();
    });

    test('Apple Pay charges exactly the shortfall', () => {
      const gate = makeGate();
      const { getByLabelText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByLabelText('Pay 30.00 dollars with Apple Pay and hire'));

      expect(gate.onPaymentStarted).toHaveBeenCalledWith('applePay');
      expect(mockPayWithApplePay).toHaveBeenCalledWith(30);
      expect(mockPayWithCard).not.toHaveBeenCalled();
    });

    // Duplicate-tap protection: `busy` is React state and still reads false for
    // a second tap that lands before the re-render.
    test('a double tap on Pay starts one payment and charges once', () => {
      const gate = makeGate();
      const { getByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Pay $30 and choose Ada'));
      fireEvent.press(getByText('Pay $30 and choose Ada'));

      expect(gate.onPaymentStarted).toHaveBeenCalledTimes(1);
      expect(mockPayWithCard).toHaveBeenCalledTimes(1);
    });

    test('Apple Pay tapped while a card charge is in flight starts nothing', () => {
      const gate = makeGate();
      const { getByText, getByLabelText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Pay $30 and choose Ada'));
      fireEvent.press(getByLabelText('Pay 30.00 dollars with Apple Pay and hire'));

      expect(gate.onPaymentStarted).toHaveBeenCalledTimes(1);
      expect(mockPayWithCard).toHaveBeenCalledTimes(1);
      expect(mockPayWithApplePay).not.toHaveBeenCalled();
    });

    test('after a declined charge the poster can pay again', async () => {
      mockPayWithCard
        .mockResolvedValueOnce({ outcome: 'failed', failure: { failure_code: 'card_declined' } })
        .mockImplementation(() => new Promise(() => {}));
      const gate = makeGate();
      const { getByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Pay $30 and choose Ada'));
      await waitFor(() => expect(gate.onPaymentFailed).toHaveBeenCalledTimes(1));
      fireEvent.press(getByText('Pay $30 and choose Ada'));

      expect(mockPayWithCard).toHaveBeenCalledTimes(2);
    });

    test('no Apple Pay button off iOS', () => {
      Platform.OS = 'android';
      const gate = makeGate();
      const { queryByLabelText, getByText } = render(<AcceptFundingGate gate={gate} />);
      expect(queryByLabelText('Pay 30.00 dollars with Apple Pay and hire')).toBeNull();
      expect(getByText('Pay $30 and choose Ada')).toBeTruthy();
    });

    test('with no card on file the primary button opens the Payment Sheet for exactly the shortfall', () => {
      resetDepositState({ paymentMethods: [] });
      const gate = makeGate();
      const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Pay $30 and choose Ada'));

      expect(gate.onPaymentStarted).toHaveBeenCalledWith('paymentSheet');
      expect(mockPayWithPaymentSheet).toHaveBeenCalledWith(30);
      expect(mockPayWithCard).not.toHaveBeenCalled();
      expect(mockSetShowPaymentMethodsModal).not.toHaveBeenCalled();
      // No "Paying with … Change" row to change a card that does not exist.
      expect(queryByText('Paying with')).toBeNull();
      // The sheet is already the primary path; no second link to it.
      expect(queryByText('Use another card')).toBeNull();
    });

    test('with no card on file on web (no native sheet) the button links one instead of charging', () => {
      Platform.OS = 'web';
      resetDepositState({ paymentMethods: [] });
      const gate = makeGate();
      const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Link a card to pay $30.00'));

      expect(mockSetShowPaymentMethodsModal).toHaveBeenCalledWith(true);
      expect(mockPayWithCard).not.toHaveBeenCalled();
      expect(mockPayWithPaymentSheet).not.toHaveBeenCalled();
      // The add-a-card sheet is a payment sheet opening: accept_funding_started.
      expect(gate.onPaymentStarted).toHaveBeenCalledTimes(1);
      expect(gate.onPaymentStarted).toHaveBeenCalledWith('linkCard');
      // No "Paying with … Change" row to change a card that does not exist.
      expect(queryByText('Paying with')).toBeNull();
    });

    test('with a saved card, "Use another card" opens the Payment Sheet', () => {
      const gate = makeGate();
      const { getByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Use another card'));

      expect(gate.onPaymentStarted).toHaveBeenCalledWith('paymentSheet');
      expect(mockPayWithPaymentSheet).toHaveBeenCalledWith(30);
      expect(mockPayWithCard).not.toHaveBeenCalled();
    });

    test('a linked bank account alone opens the Payment Sheet instead of trying to charge the bank as a card', () => {
      resetDepositState({
        paymentMethods: [
          {
            id: 'ba_1',
            type: 'us_bank_account',
            us_bank_account: { bank_name: 'Test Bank', last4: '6789' },
          },
        ],
      });
      const gate = makeGate();
      const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Pay $30 and choose Ada'));

      expect(mockPayWithPaymentSheet).toHaveBeenCalledWith(30);
      expect(mockPayWithCard).not.toHaveBeenCalled();
      expect(gate.onPaymentStarted).toHaveBeenCalledWith('paymentSheet');
      expect(queryByText('Paying with')).toBeNull();
    });

    test('while Stripe is still loading methods the button waits rather than charging', () => {
      resetDepositState({ paymentMethods: [], stripeLoading: true });
      const gate = makeGate();
      const { getByText, getByLabelText } = render(<AcceptFundingGate gate={gate} />);

      expect(getByText('Checking payment methods…')).toBeTruthy();
      fireEvent.press(getByLabelText('Checking payment methods'));

      expect(mockPayWithCard).not.toHaveBeenCalled();
      expect(mockSetShowPaymentMethodsModal).not.toHaveBeenCalled();
      expect(gate.onPaymentStarted).not.toHaveBeenCalled();
    });

    test('a shortfall under the Stripe minimum is charged at the floor, not refused', () => {
      const gate = makeGate({ requirement: { ...REQ, posterBalance: 49.8, shortfall: 0.2 } });
      const { getByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText(`Pay $${MIN_SHORTFALL_CHARGE.toFixed(2)} and choose Ada`));

      expect(mockPayWithCard).toHaveBeenCalledWith(MIN_SHORTFALL_CHARGE);
      expect(chargeAmountForShortfall(0.2)).toBe(0.5);
      expect(chargeAmountForShortfall(30)).toBe(30);
      expect(chargeAmountForShortfall(0)).toBe(0);
      expect(chargeAmountForShortfall(NaN)).toBe(0);
    });

    test('a captured deposit reaches the gate with the paid amount and no modal to dismiss', async () => {
      mockPayWithCard.mockResolvedValue({ outcome: 'succeeded' });
      const gate = makeGate();
      const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Pay $30 and choose Ada'));

      await waitFor(() => expect(gate.onPaymentSucceeded).toHaveBeenCalledWith(30));
      expect(gate.onPaymentSucceeded).toHaveBeenCalledTimes(1);
      expect(gate.onPaymentFailed).not.toHaveBeenCalled();
      // The wallet keypad's "Success!" modal is not part of this sheet.
      expect(mockSetSuccessInfo).toHaveBeenCalledWith(null);
      expect(queryByText('Success!')).toBeNull();
    });

    test('an indeterminate payment stays pending and blocks another charge', async () => {
      mockPayWithPaymentSheet.mockResolvedValue({ outcome: 'pending' });
      const gate = makeGate();
      const { getByLabelText, getByText, queryByText, rerender } = render(
        <AcceptFundingGate gate={gate} />
      );

      fireEvent.press(getByText('Use another card'));

      await waitFor(() => expect(gate.onPaymentPending).toHaveBeenCalledTimes(1));
      rerender(<AcceptFundingGate gate={makeGate({ stage: 'pending' })} />);
      expect(getByText(/We're still confirming your payment/)).toBeTruthy();
      expect(queryByText('Use another card')).toBeNull();
      expect(getByLabelText('Payment status is still being confirmed').props.accessibilityState)
        .toMatchObject({ disabled: true, busy: true });
      fireEvent.press(getByLabelText('Not yet, go back without choosing anyone'));
      expect(gate.onCancel).not.toHaveBeenCalled();
    });

    test('E.3: Back to My Jobs leaves a remembered payment', () => {
      const gate = makeGate({ stage: 'pending', canLeavePending: true });
      const onLeavePending = jest.fn();
      const { getByTestId, queryByText } = render(<AcceptFundingGate gate={gate} onLeavePending={onLeavePending} />);
      expect(queryByText('Not yet')).toBeNull();
      fireEvent.press(getByTestId('hire-leave-pending'));
      expect(gate.onLeavePending).toHaveBeenCalledTimes(1);
      expect(onLeavePending).toHaveBeenCalledTimes(1);
    });

    test('a dismissed Apple Pay sheet is reported as cancelled and the sheet stays up', async () => {
      // use-wallet-deposit sets no error/successInfo on a user cancel — the
      // outcome is carried entirely by the resolved value.
      mockPayWithApplePay.mockResolvedValue({ outcome: 'cancelled' });
      const gate = makeGate();
      const { getByLabelText, getByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByLabelText('Pay 30.00 dollars with Apple Pay and hire'));

      await waitFor(() =>
        expect(gate.onPaymentFailed).toHaveBeenCalledWith('cancelled', undefined)
      );
      expect(gate.onPaymentSucceeded).not.toHaveBeenCalled();
      expect(getByText('Pay $30 and choose Ada')).toBeTruthy();
    });

    test('a declined charge is reported with its Stripe reason and the sheet stays up', async () => {
      const failure = {
        error_code: 'insufficient_funds',
        decline_code: 'insufficient_funds',
        code: 'card_declined',
        type: 'card_error',
        payment_method_type: 'card',
        error_message: 'Your card has insufficient funds.',
      };
      mockPayWithCard.mockResolvedValue({ outcome: 'failed', failure });
      const gate = makeGate();
      const { getByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Pay $30 and choose Ada'));

      await waitFor(() => expect(gate.onPaymentFailed).toHaveBeenCalledWith('failed', failure));
      expect(gate.onPaymentSucceeded).not.toHaveBeenCalled();
      // The plain-words notice replaces the hook's banner.
      expect(mockSetError).toHaveBeenCalledWith(null);
    });

    test('after a decline the sheet says what happened, what to do next, and that the hunter is still selected', () => {
      const gate = makeGate({
        paymentFailure: {
          error_code: 'fraudulent',
          decline_code: 'fraudulent',
          code: 'card_declined',
          type: 'card_error',
          payment_method_type: 'card',
          error_message: 'Your card was declined.',
        },
      });
      const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);

      // A Radar/fraud decline is shown as an ordinary bank decline.
      expect(getByText('Your bank declined this card.')).toBeTruthy();
      expect(getByText('Try another card or Apple Pay.')).toBeTruthy();
      expect(getByText('Ada is still selected. Nothing has changed on this bounty.')).toBeTruthy();
      expect(queryByText(/fraud/i)).toBeNull();
      // Still on the sheet, with every way forward available.
      expect(getByText('Pay $30 and choose Ada')).toBeTruthy();
      expect(getByText('Use another card')).toBeTruthy();
      expect(gate.onCancel).not.toHaveBeenCalled();
    });

    test('an API authentication failure asks the poster to sign in again', () => {
      const gate = makeGate({
        paymentFailure: {
          error_code: 'authentication_required',
          code: 'authentication_required',
          type: 'api_error',
          error_type: 'api_error',
          error_message: 'Authentication required',
        },
      });
      const { getByText } = render(<AcceptFundingGate gate={gate} />);

      expect(getByText('Your session needs attention.')).toBeTruthy();
      expect(getByText('Please sign in again before trying this payment.')).toBeTruthy();
    });

    test('a decline never offers to retry the card that was just declined', () => {
      resetDepositState({ error: { message: 'Your card was declined.', type: 'payment' } });
      const gate = makeGate({
        paymentFailure: {
          error_code: 'generic_decline',
          decline_code: 'generic_decline',
          type: 'card_error',
          error_message: 'Your card was declined.',
        },
      });
      const { queryByText } = render(<AcceptFundingGate gate={gate} />);
      // The old ErrorBanner's action re-ran payWithCard on the same card.
      expect(queryByText(/^banner:/)).toBeNull();
      expect(mockPayWithCard).not.toHaveBeenCalled();
    });

    test('a non-payment error (e.g. methods failed to load) still shows the banner', () => {
      resetDepositState({ stripeError: { message: 'Could not load payment methods' } });
      const gate = makeGate();
      const { getByText } = render(<AcceptFundingGate gate={gate} />);
      expect(getByText('banner:Could not load payment methods')).toBeTruthy();
    });

    test('a legacy at_post bounty keeps the original held-funds line', () => {
      const gate = makeGate({ requirement: { ...REQ, fundingMode: 'at_post' } });
      const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);
      expect(getByText('Held for in-app completion or dispute review')).toBeTruthy();
      expect(queryByText(trustSafetyStrings.payWhenYouHire)).toBeNull();
    });

    test('nothing is reported when no charge was ever in flight', () => {
      const gate = makeGate();
      const { rerender } = render(<AcceptFundingGate gate={gate} />);
      rerender(<AcceptFundingGate gate={gate} />);
      expect(gate.onPaymentFailed).not.toHaveBeenCalled();
      expect(gate.onPaymentSucceeded).not.toHaveBeenCalled();
    });

    test('buttons are locked while a charge is in flight, including "Not now"', () => {
      resetDepositState({ isProcessing: true });
      const gate = makeGate();
      const { getByText, getByLabelText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Processing…'));
      fireEvent.press(getByText('Not yet'));
      fireEvent.press(getByLabelText('Pay 30.00 dollars with Apple Pay and hire'));

      expect(mockPayWithCard).not.toHaveBeenCalled();
      expect(mockPayWithApplePay).not.toHaveBeenCalled();
      expect(gate.onCancel).not.toHaveBeenCalled();
    });

    test('while settling the sheet shows confirmation and accepts no further payment', () => {
      const gate = makeGate({ stage: 'settling' });
      const { getByText, queryByLabelText } = render(<AcceptFundingGate gate={gate} />);

      expect(getByText('Confirming payment…')).toBeTruthy();
      expect(queryByLabelText('Pay 30.00 dollars with Apple Pay and hire')).toBeNull();
      fireEvent.press(getByText('Confirming payment…'));
      expect(mockPayWithCard).not.toHaveBeenCalled();
    });

    test('on a short screen payment actions and safety guidance remain available', () => {
      const RN = require('react-native');
      const dims = RN.useWindowDimensions as jest.Mock;
      const original = dims.getMockImplementation();
      // iPhone SE: 320×568. Usable height lands in the compact tier.
      dims.mockImplementation(() => ({ width: 320, height: 568, scale: 2, fontScale: 1 }));
      try {
        const gate = makeGate();
        const { getByText, queryByText, getByLabelText } = render(<AcceptFundingGate gate={gate} />);

        expect(getByText(trustSafetyStrings.payWhenYouHire)).toBeTruthy();
        expect(getByText(trustSafetyStrings.posterHire)).toBeTruthy();
        expect(getByText(/Refunds and releases depend/)).toBeTruthy();
        expect(getByText('Pay $30 and choose Ada')).toBeTruthy();
        expect(getByLabelText('Pay 30.00 dollars with Apple Pay and hire')).toBeTruthy();
        expect(getByText('Not yet')).toBeTruthy();
        expect(getByText('Wallet balance')).toBeTruthy();
        expect(
          queryByText("If it doesn't work out, you can cancel and the money comes back to your wallet.")
        ).toBeNull();
      } finally {
        dims.mockImplementation(original);
      }
    });

    test('on a tall screen the payment scope and refund limits are shown', () => {
      const gate = makeGate();
      const { getByText } = render(<AcceptFundingGate gate={gate} />);
      expect(
        getByText(/Bounty’s payment protections apply only to payments handled through Bounty/)
      ).toBeTruthy();
    });

    test('after a partial deposit the sheet asks for the remainder', () => {
      const gate = makeGate({
        remainderAfterDeposit: true,
        requirement: { ...REQ, posterBalance: 30, shortfall: 20 },
      });
      const { getByText } = render(<AcceptFundingGate gate={gate} />);

      expect(getByText('Payment received. $20.00 more is needed to hire Ada.')).toBeTruthy();
      fireEvent.press(getByText('Pay $20 and choose Ada'));
      expect(mockPayWithCard).toHaveBeenCalledWith(20);
    });
  });
});
