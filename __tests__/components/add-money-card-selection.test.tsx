import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockDeposit = jest.fn().mockResolvedValue(undefined);
const mockRefreshFromApi = jest.fn().mockResolvedValue(undefined);
const mockProcessPaymentSecure = jest.fn();
const mockLoadPaymentMethods = jest.fn().mockResolvedValue(undefined);

let mockPaymentMethods: any[] = [];

jest.mock('../../lib/wallet-context', () => ({
  useWallet: jest.fn(() => ({
    deposit: mockDeposit,
    refreshFromApi: mockRefreshFromApi,
  })),
}));

jest.mock('../../lib/stripe-context', () => ({
  useStripe: jest.fn(() => ({
    processPaymentSecure: mockProcessPaymentSecure,
    paymentMethods: mockPaymentMethods,
    isLoading: false,
    error: null,
    loadPaymentMethods: mockLoadPaymentMethods,
  })),
}));

jest.mock('../../hooks/use-auth-context', () => ({
  useAuthContext: jest.fn(() => ({ session: { access_token: 'test-token', user: { id: 'u1' } } })),
}));

jest.mock('../../lib/config/api', () => ({ API_BASE_URL: 'https://api.example.com' }));
jest.mock('../../lib/config', () => ({ config: { supabase: { anonKey: 'test-anon-key' } } }));
jest.mock('../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));
jest.mock('../../components/payment-methods-modal', () => {
  const { Text } = require('react-native');
  return {
    PaymentMethodsModal: ({ isOpen }: { isOpen: boolean }) =>
      isOpen ? <Text>payment-methods-modal-open</Text> : null,
  };
});

import { AddMoneyScreen } from '../../components/add-money-screen';

describe('AddMoneyScreen card-backed deposits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeposit.mockResolvedValue(undefined);
    mockRefreshFromApi.mockResolvedValue(undefined);
    mockProcessPaymentSecure.mockResolvedValue({ success: true, paymentIntentId: 'pi_test_123' });
    mockPaymentMethods = [];
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({}) } as any);
  });

  afterEach(() => {
    (global.fetch as any).mockRestore?.();
  });

  it('charges the first saved card even when a bank account appears earlier in the list', async () => {
    mockPaymentMethods = [
      {
        id: 'ba_1',
        type: 'us_bank_account',
        us_bank_account: { bank_name: 'Bank', last4: '6789', verification_status: 'verified' },
      },
      {
        id: 'pm_card_1',
        type: 'card',
        card: { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2030 },
      },
    ];

    const { getByLabelText } = render(<AddMoneyScreen initialAmount="5.00" />);

    await act(async () => {
      fireEvent.press(getByLabelText('Add money to wallet'));
    });

    await waitFor(() =>
      expect(mockProcessPaymentSecure).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ paymentMethodId: 'pm_card_1', purpose: 'wallet_deposit' })
      )
    );
  });

  it('treats a bank-only wallet as needing a card and reopens payment methods instead of charging', async () => {
    mockPaymentMethods = [
      {
        id: 'ba_1',
        type: 'us_bank_account',
        us_bank_account: { bank_name: 'Bank', last4: '6789', verification_status: 'verified' },
      },
    ];

    const { getByText, getByLabelText, queryByLabelText } = render(
      <AddMoneyScreen initialAmount="5.00" />
    );

    expect(getByText('Link Payment Method')).toBeTruthy();
    expect(queryByLabelText('Add money to wallet')).toBeNull();

    fireEvent.press(getByLabelText('Link a payment method'));

    expect(mockProcessPaymentSecure).not.toHaveBeenCalled();
    expect(getByText('payment-methods-modal-open')).toBeTruthy();
  });
});
