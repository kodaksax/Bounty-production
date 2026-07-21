/**
 * Tests for WithdrawalConfirmSheet — the themed bottom-sheet confirm step
 * that replaced Alert.alert confirmation dialogs in the withdraw and
 * Instant Cash Out flows.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { WithdrawalConfirmSheet } from '../../components/ui/withdrawal-confirm-sheet';

describe('WithdrawalConfirmSheet', () => {
  it('passes the visible prop through to the underlying Modal', () => {
    const { UNSAFE_getByProps } = render(
      <WithdrawalConfirmSheet
        visible={false}
        method="standard"
        amount={50}
        destinationLabel="Chase account ending in 1234"
        estimatedArrival="1-3 business days"
        isSubmitting={false}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(UNSAFE_getByProps({ visible: false })).toBeTruthy();
  });

  it('shows standard withdrawal copy: amount, destination, and no fee row', () => {
    const { getAllByText, getByText, queryByText } = render(
      <WithdrawalConfirmSheet
        visible
        method="standard"
        amount={50}
        destinationLabel="Chase account ending in 1234"
        estimatedArrival="1-3 business days"
        isSubmitting={false}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    // Title and confirm-button text are both literally "Confirm Withdrawal".
    expect(getAllByText('Confirm Withdrawal').length).toBe(2);
    expect(getByText('$50.00')).toBeTruthy();
    expect(getByText('Chase account ending in 1234')).toBeTruthy();
    expect(getByText('1-3 business days')).toBeTruthy();
    expect(queryByText('Instant fee')).toBeNull();
  });

  it('shows instant fee/net breakdown for instant method', () => {
    const { getByText } = render(
      <WithdrawalConfirmSheet
        visible
        method="instant"
        amount={100}
        fee={1.5}
        netAmount={98.5}
        destinationLabel="Visa •••• 4242"
        estimatedArrival="Usually within minutes"
        isSubmitting={false}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(getByText('Confirm Instant Cash Out')).toBeTruthy();
    expect(getByText('Instant fee')).toBeTruthy();
    expect(getByText('$1.50')).toBeTruthy();
    expect(getByText('$98.50')).toBeTruthy();
  });

  it('calls onConfirm when the confirm button is pressed', () => {
    const onConfirm = jest.fn();
    const { getByLabelText } = render(
      <WithdrawalConfirmSheet
        visible
        method="standard"
        amount={50}
        destinationLabel="Chase account ending in 1234"
        estimatedArrival="1-3 business days"
        isSubmitting={false}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );
    fireEvent.press(getByLabelText('Confirm withdrawal'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is pressed', () => {
    const onCancel = jest.fn();
    const { getByText } = render(
      <WithdrawalConfirmSheet
        visible
        method="standard"
        amount={50}
        destinationLabel="Chase account ending in 1234"
        estimatedArrival="1-3 business days"
        isSubmitting={false}
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.press(getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm button while submitting', () => {
    const { getByLabelText } = render(
      <WithdrawalConfirmSheet
        visible
        method="standard"
        amount={50}
        destinationLabel="Chase account ending in 1234"
        estimatedArrival="1-3 business days"
        isSubmitting
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(getByLabelText('Confirm withdrawal').props.accessibilityState.disabled).toBe(true);
  });
});
