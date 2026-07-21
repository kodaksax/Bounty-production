/**
 * Tests for WithdrawalResultScreen — the processing/success/failure states
 * that replaced Alert.alert success/failure copy in the withdraw and
 * Instant Cash Out flows.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { WithdrawalResultScreen } from '../../components/ui/withdrawal-result-screen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

describe('WithdrawalResultScreen', () => {
  describe('processing', () => {
    it('shows a standard-flow processing message', () => {
      const { getByText } = render(
        <WithdrawalResultScreen
          status="processing"
          method="standard"
          amount={50}
          onDismiss={jest.fn()}
        />
      );
      expect(getByText('Sending your withdrawal…')).toBeTruthy();
    });

    it('shows an instant-flow processing message', () => {
      const { getByText } = render(
        <WithdrawalResultScreen
          status="processing"
          method="instant"
          amount={50}
          onDismiss={jest.fn()}
        />
      );
      expect(getByText('Sending your Instant Cash Out…')).toBeTruthy();
    });
  });

  describe('success', () => {
    it('shows the gross amount and 1-3 business day ETA for standard', () => {
      const { getByText } = render(
        <WithdrawalResultScreen
          status="success"
          method="standard"
          amount={50}
          destinationLabel="Chase account ending in 1234"
          transferId="tr_123"
          onDismiss={jest.fn()}
        />
      );
      expect(getByText('Withdrawal Initiated')).toBeTruthy();
      expect(getByText('$50.00')).toBeTruthy();
      expect(getByText('1-2 business days')).toBeTruthy();
      expect(getByText('tr_123')).toBeTruthy();
    });

    it('shows the net amount and fee note for a successful instant cash out', () => {
      const { getByText } = render(
        <WithdrawalResultScreen
          status="success"
          method="instant"
          amount={100}
          netAmount={98.5}
          fee={1.5}
          destinationLabel="Visa •••• 4242"
          onDismiss={jest.fn()}
        />
      );
      expect(getByText('Cash Out Sent')).toBeTruthy();
      expect(getByText('$98.50')).toBeTruthy();
      expect(getByText('$100.00 minus a $1.50 instant fee')).toBeTruthy();
      expect(getByText('Usually within minutes')).toBeTruthy();
    });

    it('shows fallback-to-standard messaging and does not show instant fee copy', () => {
      const { getByText, queryByText } = render(
        <WithdrawalResultScreen
          status="success"
          method="instant"
          amount={100}
          netAmount={98.5}
          fee={1.5}
          fellBackToStandard
          onDismiss={jest.fn()}
        />
      );
      expect(getByText('Sent via Standard Transfer')).toBeTruthy();
      // Gross amount shown, not the net-of-fee amount, since no fee was charged.
      expect(getByText('$100.00')).toBeTruthy();
      expect(queryByText(/minus a/)).toBeNull();
      expect(getByText(/couldn't complete/)).toBeTruthy();
    });

    it('calls onDismiss when Done is pressed', () => {
      const onDismiss = jest.fn();
      const { getByText } = render(
        <WithdrawalResultScreen status="success" method="standard" amount={50} onDismiss={onDismiss} />
      );
      fireEvent.press(getByText('Done'));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure', () => {
    it('resolves a known request error code to friendly copy', () => {
      const { getByText } = render(
        <WithdrawalResultScreen
          status="failure"
          method="standard"
          amount={50}
          errorCode="insufficient_balance"
          onDismiss={jest.fn()}
        />
      );
      expect(getByText('Withdrawal Failed')).toBeTruthy();
      expect(
        getByText('Insufficient available balance. Part of your balance may be on hold or already reserved.')
      ).toBeTruthy();
    });

    it('resolves a known Stripe payout failure code via the shared FAILURE_CODE_MESSAGES map', () => {
      const { getByText } = render(
        <WithdrawalResultScreen
          status="failure"
          method="standard"
          amount={50}
          errorCode="account_closed"
          onDismiss={jest.fn()}
        />
      );
      expect(getByText('Your bank account has been closed. Please add a new one.')).toBeTruthy();
    });

    it('falls back to the server error message for an unmapped code', () => {
      const { getByText } = render(
        <WithdrawalResultScreen
          status="failure"
          method="standard"
          amount={50}
          errorCode="some_unmapped_code"
          errorMessage="Something specific from the server."
          onDismiss={jest.fn()}
        />
      );
      expect(getByText('Something specific from the server.')).toBeTruthy();
    });

    it('shows Try Again and calls onRetry when provided', () => {
      const onRetry = jest.fn();
      const { getByText } = render(
        <WithdrawalResultScreen
          status="failure"
          method="instant"
          amount={50}
          errorMessage="Something went wrong."
          onDismiss={jest.fn()}
          onRetry={onRetry}
        />
      );
      fireEvent.press(getByText('Try Again'));
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(getByText('Cancel')).toBeTruthy();
    });

    it('shows Done instead of Cancel when no onRetry is provided', () => {
      const { getByText, queryByText } = render(
        <WithdrawalResultScreen
          status="failure"
          method="standard"
          amount={50}
          errorMessage="Something went wrong."
          onDismiss={jest.fn()}
        />
      );
      expect(queryByText('Try Again')).toBeNull();
      expect(getByText('Done')).toBeTruthy();
    });

    it('shows "Manage Payout Methods" instead of "Try Again" for a payout-method error code, and calls onManagePayoutMethods', () => {
      const onManagePayoutMethods = jest.fn();
      const onRetry = jest.fn();
      const { getByText, queryByText } = render(
        <WithdrawalResultScreen
          status="failure"
          method="standard"
          amount={50}
          errorCode="bank_account_not_default"
          onDismiss={jest.fn()}
          onRetry={onRetry}
          onManagePayoutMethods={onManagePayoutMethods}
        />
      );
      expect(queryByText('Try Again')).toBeNull();
      fireEvent.press(getByText('Manage Payout Methods'));
      expect(onManagePayoutMethods).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('falls back to Try Again for a non-payout-method error code even when onManagePayoutMethods is provided', () => {
      const onManagePayoutMethods = jest.fn();
      const { getByText, queryByText } = render(
        <WithdrawalResultScreen
          status="failure"
          method="standard"
          amount={50}
          errorCode="insufficient_balance"
          onDismiss={jest.fn()}
          onRetry={jest.fn()}
          onManagePayoutMethods={onManagePayoutMethods}
        />
      );
      expect(queryByText('Manage Payout Methods')).toBeNull();
      expect(getByText('Try Again')).toBeTruthy();
    });
  });
});
