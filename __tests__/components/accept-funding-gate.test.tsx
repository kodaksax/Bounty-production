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
 *   * no card on file    -> the same button links one instead of charging;
 *                           nothing is sent to Stripe
 *   * Stripe still loading -> the button waits rather than charging with an
 *                           empty method list
 *   * success            -> gate.onPaymentSucceeded with the captured amount,
 *                           with NO success modal in the way
 *   * cancel / decline   -> gate.onPaymentFailed('cancelled' | 'failed'); the
 *                           sheet stays up
 *   * sub-minimum shortfall -> charged at Stripe's $0.50 floor, not refused
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';

const mockPayWithCard = jest.fn();
const mockPayWithApplePay = jest.fn();
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
    paymentMethods: [{ id: 'pm_1', card: { brand: 'visa', last4: '4242' } }],
    stripeLoading: false,
    stripeError: null,
    showPaymentMethodsModal: false,
    ...overrides,
  };
};

jest.mock('hooks/use-wallet-deposit', () => ({
  useWalletDeposit: () => ({
    ...depositState,
    isApplePayAvailable: true,
    setError: mockSetError,
    setSuccessInfo: mockSetSuccessInfo,
    setShowPaymentMethodsModal: mockSetShowPaymentMethodsModal,
    loadPaymentMethods: mockLoadPaymentMethods,
    payWithCard: (...a: unknown[]) => mockPayWithCard(...a),
    payWithApplePay: (...a: unknown[]) => mockPayWithApplePay(...a),
  }),
}));

jest.mock('lib/services/stripe-service', () => ({
  stripeService: { formatCardDisplay: () => 'Visa •••• 4242' },
}));
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
    onConfirm: jest.fn(),
    onPaymentStarted: jest.fn(),
    onPaymentSucceeded: jest.fn(),
    onPaymentFailed: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
}

describe('AcceptFundingGate', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDepositState();
    Platform.OS = 'ios';
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  describe('balance covers it', () => {
    const covered = { ...REQ, posterBalance: 80, shortfall: 0 };

    test('one tap confirms; nothing is sent to Stripe', () => {
      const gate = makeGate({ stage: 'confirm', requirement: covered });
      const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);

      expect(getByText('Ada')).toBeTruthy();
      expect(getByText('Held until you approve the work')).toBeTruthy();
      expect(getByText('from your wallet balance')).toBeTruthy();
      // No Apple Pay button when there is nothing to charge.
      expect(queryByText('Pay')).toBeNull();

      fireEvent.press(getByText('Confirm & hire'));

      expect(gate.onConfirm).toHaveBeenCalledTimes(1);
      expect(gate.onPaymentStarted).not.toHaveBeenCalled();
      expect(mockPayWithCard).not.toHaveBeenCalled();
      expect(mockPayWithApplePay).not.toHaveBeenCalled();
    });

    test('"Not now" backs out', () => {
      const gate = makeGate({ stage: 'confirm', requirement: covered });
      const { getByText } = render(<AcceptFundingGate gate={gate} />);
      fireEvent.press(getByText('Not now'));
      expect(gate.onCancel).toHaveBeenCalledTimes(1);
      expect(gate.onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('balance is short', () => {
    test('"Pay $X & hire" charges exactly the shortfall by card', async () => {
      const gate = makeGate();
      const { getByText } = render(<AcceptFundingGate gate={gate} />);

      expect(getByText('charged to your card now')).toBeTruthy();
      expect(getByText('Held until you approve the work')).toBeTruthy();

      fireEvent.press(getByText('Pay $30.00 & hire'));

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

    test('no Apple Pay button off iOS', () => {
      Platform.OS = 'android';
      const gate = makeGate();
      const { queryByLabelText, getByText } = render(<AcceptFundingGate gate={gate} />);
      expect(queryByLabelText('Pay 30.00 dollars with Apple Pay and hire')).toBeNull();
      expect(getByText('Pay $30.00 & hire')).toBeTruthy();
    });

    test('with no card on file the primary button links one instead of charging', () => {
      resetDepositState({ paymentMethods: [] });
      const gate = makeGate();
      const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Link a card to pay $30.00'));

      expect(mockSetShowPaymentMethodsModal).toHaveBeenCalledWith(true);
      expect(mockPayWithCard).not.toHaveBeenCalled();
      expect(gate.onPaymentStarted).not.toHaveBeenCalled();
      // No "Paying with … Change" row to change a card that does not exist.
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

      fireEvent.press(getByText(`Pay $${MIN_SHORTFALL_CHARGE.toFixed(2)} & hire`));

      expect(mockPayWithCard).toHaveBeenCalledWith(MIN_SHORTFALL_CHARGE);
      expect(chargeAmountForShortfall(0.2)).toBe(0.5);
      expect(chargeAmountForShortfall(30)).toBe(30);
      expect(chargeAmountForShortfall(0)).toBe(0);
      expect(chargeAmountForShortfall(NaN)).toBe(0);
    });

    test('a captured deposit reaches the gate with the paid amount and no modal to dismiss', async () => {
      mockPayWithCard.mockResolvedValue('succeeded');
      const gate = makeGate();
      const { getByText, queryByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Pay $30.00 & hire'));

      await waitFor(() => expect(gate.onPaymentSucceeded).toHaveBeenCalledWith(30));
      expect(gate.onPaymentSucceeded).toHaveBeenCalledTimes(1);
      expect(gate.onPaymentFailed).not.toHaveBeenCalled();
      // The wallet keypad's "Success!" modal is not part of this sheet.
      expect(mockSetSuccessInfo).toHaveBeenCalledWith(null);
      expect(queryByText('Success!')).toBeNull();
    });

    test('a dismissed Apple Pay sheet is reported as cancelled and the sheet stays up', async () => {
      // use-wallet-deposit sets no error/successInfo on a user cancel — the
      // outcome is carried entirely by the resolved value.
      mockPayWithApplePay.mockResolvedValue('cancelled');
      const gate = makeGate();
      const { getByLabelText, getByText } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByLabelText('Pay 30.00 dollars with Apple Pay and hire'));

      await waitFor(() => expect(gate.onPaymentFailed).toHaveBeenCalledWith('cancelled'));
      expect(gate.onPaymentSucceeded).not.toHaveBeenCalled();
      expect(getByText('Pay $30.00 & hire')).toBeTruthy();
    });

    test('a declined charge is reported as failed and shown in place', async () => {
      mockPayWithCard.mockImplementation(async () => {
        depositState = {
          ...depositState,
          error: { message: 'Your card was declined.', type: 'payment' },
        };
        return 'failed';
      });
      const gate = makeGate();
      const { getByText, rerender } = render(<AcceptFundingGate gate={gate} />);

      fireEvent.press(getByText('Pay $30.00 & hire'));

      await waitFor(() => expect(gate.onPaymentFailed).toHaveBeenCalledWith('failed'));
      expect(gate.onPaymentSucceeded).not.toHaveBeenCalled();

      // In the real hook, `setError` is React state on the same component and
      // its own state change triggers this re-render; here the mock hook
      // returns a plain snapshot of `depositState`, so the render that picks
      // up the mutation above has to be asked for explicitly.
      rerender(<AcceptFundingGate gate={gate} />);
      expect(getByText('banner:Your card was declined.')).toBeTruthy();
      expect(getByText('Pay $30.00 & hire')).toBeTruthy();
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
      fireEvent.press(getByText('Not now'));
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

    test('on a short screen the buttons and the escrow line share the screen; only the reassurance copy is trimmed', () => {
      const RN = require('react-native');
      const dims = RN.useWindowDimensions as jest.Mock;
      const original = dims.getMockImplementation();
      // iPhone SE: 320×568. Usable height lands in the compact tier.
      dims.mockImplementation(() => ({ width: 320, height: 568, scale: 2, fontScale: 1 }));
      try {
        const gate = makeGate();
        const { getByText, queryByText, getByLabelText } = render(<AcceptFundingGate gate={gate} />);

        expect(getByText('Held until you approve the work')).toBeTruthy();
        expect(getByText('Pay $30.00 & hire')).toBeTruthy();
        expect(getByLabelText('Pay 30.00 dollars with Apple Pay and hire')).toBeTruthy();
        expect(getByText('Not now')).toBeTruthy();
        expect(getByText('Wallet balance')).toBeTruthy();
        expect(
          queryByText("If it doesn't work out, you can cancel and the money comes back to your wallet.")
        ).toBeNull();
      } finally {
        dims.mockImplementation(original);
      }
    });

    test('on a tall screen the reassurance copy is shown', () => {
      const gate = makeGate();
      const { getByText } = render(<AcceptFundingGate gate={gate} />);
      expect(
        getByText("If it doesn't work out, you can cancel and the money comes back to your wallet.")
      ).toBeTruthy();
    });

    test('after a partial deposit the sheet asks for the remainder', () => {
      const gate = makeGate({
        remainderAfterDeposit: true,
        requirement: { ...REQ, posterBalance: 30, shortfall: 20 },
      });
      const { getByText } = render(<AcceptFundingGate gate={gate} />);

      expect(getByText('Payment received. $20.00 more is needed to hire Ada.')).toBeTruthy();
      fireEvent.press(getByText('Pay $20.00 & hire'));
      expect(mockPayWithCard).toHaveBeenCalledWith(20);
    });
  });
});
