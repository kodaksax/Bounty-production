/**
 * Regression test for a real bug found in the Post-a-Bounty top-up flow:
 * AddMoneyScreen's success-modal dismiss handler used to call BOTH
 * `onAddMoney` and `onBack` unconditionally. In CreateBountyFlow, `onAddMoney`
 * correctly determines the bounty is now fully funded and dismisses the
 * insufficient-balance gate — but the immediately-following `onBack` call
 * (written only for the cancel/close path) unconditionally re-opened it,
 * since both are plain setState(value) calls batched in the same handler and
 * the last write wins. This meant a top-up that fully funded the bounty in
 * one shot (a single sufficient deposit, or the second of two partial ones)
 * always bounced the poster back to a stale "insufficient balance" screen —
 * recomputed against the now-sufficient balance, showing a nonsensical
 * "$0.00 needed" dead end.
 *
 * The fix: AddMoneyScreen's dismiss handler calls onAddMoney only. Every
 * current caller (wallet-screen.tsx, postings-screen.tsx,
 * CreateBounty/index.tsx) already handles its own dismissal/transition
 * entirely inside its own onAddMoney handler, so onBack firing automatically
 * afterward was always redundant for the success path — and actively wrong
 * for CreateBountyFlow's multi-step decision (still short vs. fully funded
 * vs. auto-submit).
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

// ---- module mocks ----

const mockDeposit = jest.fn().mockResolvedValue(undefined);
const mockRefreshFromApi = jest.fn().mockResolvedValue(undefined);
const mockProcessPaymentSecure = jest.fn();

jest.mock('../../lib/wallet-context', () => ({
  useWallet: jest.fn(() => ({
    deposit: mockDeposit,
    refreshFromApi: mockRefreshFromApi,
  })),
}));

jest.mock('../../lib/stripe-context', () => ({
  useStripe: jest.fn(() => ({
    processPaymentSecure: mockProcessPaymentSecure,
    paymentMethods: [{ id: 'pm_test_123' }],
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

jest.mock('../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }));
jest.mock('../../components/payment-methods-modal', () => ({ PaymentMethodsModal: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

// ---- imports after mocks ----

import { AddMoneyScreen } from '../../components/add-money-screen';

describe('AddMoneyScreen — success dismiss contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeposit.mockResolvedValue(undefined);
    mockRefreshFromApi.mockResolvedValue(undefined);
    mockProcessPaymentSecure.mockResolvedValue({ success: true, paymentIntentId: 'pi_test_123' });
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({}) } as any);
  });

  afterEach(() => {
    (global.fetch as any).mockRestore?.();
  });

  it('calls onAddMoney but NOT onBack when the success modal is dismissed', async () => {
    const onAddMoney = jest.fn();
    const onBack = jest.fn();

    const { getByText, getByLabelText } = render(
      <AddMoneyScreen initialAmount="5.00" onAddMoney={onAddMoney} onBack={onBack} />
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Add money to wallet'));
    });

    await waitFor(() => expect(getByText('Success!')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('OK'));
    });

    expect(onAddMoney).toHaveBeenCalledTimes(1);
    expect(onAddMoney).toHaveBeenCalledWith(5);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('still calls onBack for a genuine cancel (header close button, before any payment)', () => {
    const onAddMoney = jest.fn();
    const onBack = jest.fn();

    const { getByLabelText } = render(
      <AddMoneyScreen initialAmount="5.00" onAddMoney={onAddMoney} onBack={onBack} />
    );

    fireEvent.press(getByLabelText('Close'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onAddMoney).not.toHaveBeenCalled();
  });
});
