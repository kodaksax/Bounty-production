/**
 * The purchase summary between the amount step and publishing
 * (app/screens/CreateBounty/quick/StepReceipt.tsx): itemised subtotal, posting
 * fee and total, the payment method on file, and card setup instead of a
 * publish when there is none.
 */

import { fireEvent, render } from '@testing-library/react-native';

let mockPaymentMethods: any[] = [];
const mockLoadPaymentMethods = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/stripe-context', () => ({
  useStripe: () => ({
    paymentMethods: mockPaymentMethods,
    isLoading: false,
    loadPaymentMethods: mockLoadPaymentMethods,
  }),
}));

jest.mock('../../hooks/useWalletPostingFee', () => ({ useWalletPostingFee: () => 1 }));

jest.mock('components/payment-methods-modal', () => ({
  PaymentMethodsModal: ({ isOpen }: { isOpen: boolean }) => {
    const { Text } = require('react-native');
    return isOpen ? <Text>payment-methods-modal-open</Text> : null;
  },
}));

import { StepReceipt } from '../../app/screens/CreateBounty/quick/StepReceipt';

const draft = { title: 'Move a couch', description: '', amount: 40, isForHonor: false } as any;

function renderReceipt(onPost = jest.fn()) {
  return render(
    <StepReceipt draft={draft} onPost={onPost} onBack={jest.fn()} step={3} totalSteps={3} />
  );
}

describe('StepReceipt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPaymentMethods = [];
  });

  it('itemises subtotal, posting fee and their sum', () => {
    const { getByText } = renderReceipt();
    expect(getByText('Purchase summary')).toBeTruthy();
    expect(getByText('$40.00')).toBeTruthy();
    expect(getByText('$1.00')).toBeTruthy();
    expect(getByText('$41.00')).toBeTruthy();
  });

  it('shows the card on file and posts from the CTA', () => {
    mockPaymentMethods = [{ id: 'pm_1', type: 'card', card: { brand: 'visa', last4: '4242' } }];
    const onPost = jest.fn();
    const { getByText, getByLabelText } = renderReceipt(onPost);

    expect(getByText('Visa •••• 4242')).toBeTruthy();
    fireEvent.press(getByLabelText('Post Bounty'));
    expect(onPost).toHaveBeenCalledTimes(1);
  });

  it('opens card setup instead of posting when no payment method is on file', () => {
    const onPost = jest.fn();
    const { getByLabelText, getByText, queryByTestId } = renderReceipt(onPost);

    expect(queryByTestId('receipt-payment-method')).toBeNull();
    fireEvent.press(getByLabelText('Post Bounty'));
    expect(onPost).not.toHaveBeenCalled();
    expect(getByText('payment-methods-modal-open')).toBeTruthy();
  });
});
