/**
 * Tests for the Apple Pay button discoverability in AddMoneyScreen.
 *
 * Regression coverage for App Store rejection (Guideline 2.1 — PassKit/Apple
 * Pay): the reviewer could not locate the Apple Pay integration because the
 * button was previously hidden whenever `isApplePaySupported()` returned false
 * (i.e. no card provisioned in the Wallet app on the review device).
 *
 * The fix renders the Apple Pay button on all iOS devices so the integration is
 * always locatable, and re-checks availability on tap — guiding the user to set
 * up Apple Pay instead of silently failing.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';

// ---- module mocks ----

const mockIsAvailable = jest.fn();
const mockProcessPayment = jest.fn();

jest.mock('../../lib/services/apple-pay-service', () => ({
  applePayService: {
    isAvailable: (...args: unknown[]) => mockIsAvailable(...args),
    processPayment: (...args: unknown[]) => mockProcessPayment(...args),
  },
}));

jest.mock('../../lib/wallet-context', () => ({
  useWallet: jest.fn(() => ({
    deposit: jest.fn(),
    refreshFromApi: jest.fn(),
  })),
}));

jest.mock('../../lib/stripe-context', () => ({
  useStripe: jest.fn(() => ({
    processPaymentSecure: jest.fn(),
    paymentMethods: [],
    isLoading: false,
    error: null,
    loadPaymentMethods: jest.fn(),
  })),
}));

jest.mock('../../hooks/use-auth-context', () => ({
  useAuthContext: jest.fn(() => ({ session: { access_token: 'test-token', user: { id: 'u1' } } })),
}));

jest.mock('../../lib/config/api', () => ({ API_BASE_URL: 'https://api.example.com' }));
jest.mock('../../lib/config', () => ({ config: { supabase: { anonKey: 'test-anon-key' } } }));

jest.mock('../../components/ui/branding-logo', () => ({
  BrandingLogo: () => null,
}));

jest.mock('../../components/payment-methods-modal', () => ({
  PaymentMethodsModal: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

// ---- imports after mocks ----

import { AddMoneyScreen } from '../../components/add-money-screen';

describe('AddMoneyScreen — Apple Pay discoverability (Guideline 2.1)', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('renders the Apple Pay button on iOS even when Apple Pay is not yet set up', async () => {
    mockIsAvailable.mockResolvedValue(false);

    const { getByText } = render(<AddMoneyScreen />);

    // The Apple Pay button (labelled "Pay") must be present so the integration
    // is locatable for App Store review even without a provisioned Wallet card.
    await waitFor(() => expect(getByText('Pay')).toBeTruthy());
  });

  it('guides the user to set up Apple Pay when unavailable instead of charging', async () => {
    mockIsAvailable.mockResolvedValue(false);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByText } = render(<AddMoneyScreen />);
    await waitFor(() => expect(getByText('Pay')).toBeTruthy());

    // Enter an amount >= $0.50 so amount validation passes.
    fireEvent.press(getByText('5'));

    await act(async () => {
      fireEvent.press(getByText('Pay'));
    });

    expect(mockProcessPayment).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Apple Pay Not Set Up',
      expect.stringContaining('Wallet app'),
      expect.anything()
    );

    alertSpy.mockRestore();
  });

  it('processes the payment when Apple Pay is available', async () => {
    mockIsAvailable.mockResolvedValue(true);
    mockProcessPayment.mockResolvedValue({ success: true, paymentIntentId: 'pi_123' });
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true } as any);

    const { getByText } = render(<AddMoneyScreen />);
    await waitFor(() => expect(getByText('Pay')).toBeTruthy());

    fireEvent.press(getByText('5'));

    await act(async () => {
      fireEvent.press(getByText('Pay'));
    });

    await waitFor(() => expect(mockProcessPayment).toHaveBeenCalledTimes(1));
    fetchSpy.mockRestore();
  });
});
