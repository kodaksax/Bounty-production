import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { PaymentMethodsModal } from '../../components/payment-methods-modal';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../lib/stripe-context', () => ({
  useStripe: () => ({
    paymentMethods: [
      {
        id: 'pm_card',
        type: 'card',
        card: { brand: 'visa', last4: '4242', exp_month: 2, exp_year: 2029 },
      },
    ],
    isLoading: false,
    removePaymentMethod: jest.fn(),
    loadPaymentMethods: jest.fn().mockResolvedValue(undefined),
    error: null,
    clearError: jest.fn(),
  }),
}));

jest.mock('@expo/vector-icons/MaterialIcons', () => 'MaterialIcons');
jest.mock('../../components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('../../components/add-card-modal', () => ({ AddCardModal: () => null }));
jest.mock('../../components/add-bank-account-modal', () => ({ AddBankAccountModal: () => null }));
jest.mock('../../components/ui/feedback-modal', () => ({ FeedbackModal: () => null }));

describe('PaymentMethodsModal', () => {
  it('keeps payment methods separated from the add-method control', () => {
    const { UNSAFE_getAllByType } = render(<PaymentMethodsModal isOpen onClose={jest.fn()} />);

    expect(
      UNSAFE_getAllByType(View).some(
        ({ props }) => props.style?.paddingHorizontal === 24 && props.style?.paddingTop === 16
      )
    ).toBe(true);
  });
});
