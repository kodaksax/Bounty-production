/**
 * Unit tests for useWalletBalanceDisplay — the single authoritative path for
 * the balance figure rendered anywhere in the app.
 *
 * The invariant these tests defend: on the Stripe-backed path, the displayed
 * balance comes from the Connect account and nothing else. The legacy ledger
 * figure must never leak into it, and the two must never be summed.
 */
import { renderHook } from '@testing-library/react-native';

const mockConfig = {
  features: { walletBalanceSource: 'ledger' as 'ledger' | 'connect' },
  supabase: { anonKey: 'test-anon-key' },
};

jest.mock('../../../lib/config', () => ({ config: mockConfig }));
jest.mock('../../../lib/config/api', () => ({ API_BASE_URL: 'https://api.example.com' }));
jest.mock('../../../hooks/use-auth-context', () => ({ useAuthContext: jest.fn() }));
jest.mock('../../../lib/wallet-context', () => ({ useWallet: jest.fn() }));
jest.mock('../../../hooks/use-connect-balance', () => ({ useConnectBalance: jest.fn() }));

import { useAuthContext } from '../../../hooks/use-auth-context';
import { useConnectBalance } from '../../../hooks/use-connect-balance';
import { useWallet } from '../../../lib/wallet-context';
import { useWalletBalanceDisplay } from '../../../hooks/use-wallet-balance-display';

const CONNECT_BALANCE = {
  available: 1250,
  pending: 500,
  instantAvailable: 750,
  currency: 'usd',
  lastUpdated: '2026-07-26T18:04:11.000Z',
  hasConnectAccount: true,
  payoutsEnabled: true,
  isLoading: false,
  isRefreshing: false,
  error: null,
  refresh: jest.fn(),
};

describe('useWalletBalanceDisplay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.features.walletBalanceSource = 'ledger';
    (useAuthContext as jest.Mock).mockReturnValue({ session: { access_token: 'test-token' } });
    // A deliberately different figure from the Connect balance, so any leak
    // between the two sources shows up as a failed assertion.
    (useWallet as jest.Mock).mockReturnValue({
      balance: 99.99,
      isLoading: false,
      refreshFromApi: jest.fn(),
    });
    (useConnectBalance as jest.Mock).mockReturnValue(CONNECT_BALANCE);
  });

  describe("when the source is 'connect'", () => {
    beforeEach(() => {
      mockConfig.features.walletBalanceSource = 'connect';
    });

    it('reports the Stripe available balance, not the ledger figure', () => {
      const { result } = renderHook(() => useWalletBalanceDisplay());

      expect(result.current.amountCents).toBe(1250);
      expect(result.current.source).toBe('connect');
      // 99.99 dollars = 9999 cents would be the ledger value.
      expect(result.current.amountCents).not.toBe(9999);
    });

    it('never sums the Stripe balance with the ledger balance', () => {
      const { result } = renderHook(() => useWalletBalanceDisplay());
      expect(result.current.amountCents).not.toBe(1250 + 9999);
    });

    it('exposes pending and instant-available separately from the primary figure', () => {
      const { result } = renderHook(() => useWalletBalanceDisplay());

      expect(result.current.pendingCents).toBe(500);
      expect(result.current.instantAvailableCents).toBe(750);
      // Pending is explicitly NOT rolled into the withdrawable figure.
      expect(result.current.amountCents).toBe(1250);
    });

    it('enables the Connect hook', () => {
      renderHook(() => useWalletBalanceDisplay());
      expect(useConnectBalance).toHaveBeenCalledWith({ enabled: true });
    });

    it('propagates the loading state', () => {
      (useConnectBalance as jest.Mock).mockReturnValue({ ...CONNECT_BALANCE, isLoading: true });
      const { result } = renderHook(() => useWalletBalanceDisplay());
      expect(result.current.isLoading).toBe(true);
    });

    it('propagates errors instead of falling back to the ledger', () => {
      (useConnectBalance as jest.Mock).mockReturnValue({
        ...CONNECT_BALANCE,
        available: 0,
        lastUpdated: null,
        error: 'Could not load your balance from Stripe.',
      });
      const { result } = renderHook(() => useWalletBalanceDisplay());

      expect(result.current.error).toBeTruthy();
      expect(result.current.amountCents).toBe(0);
      // The ledger value must not be substituted in on failure.
      expect(result.current.amountCents).not.toBe(9999);
    });

    it('marks a retained value as stale when the latest fetch failed', () => {
      (useConnectBalance as jest.Mock).mockReturnValue({
        ...CONNECT_BALANCE,
        error: 'Could not reach Stripe.',
      });
      const { result } = renderHook(() => useWalletBalanceDisplay());

      expect(result.current.isStale).toBe(true);
      expect(result.current.amountCents).toBe(1250);
    });

    it('is not stale when a fetch has never succeeded', () => {
      (useConnectBalance as jest.Mock).mockReturnValue({
        ...CONNECT_BALANCE,
        lastUpdated: null,
        error: 'Could not reach Stripe.',
      });
      const { result } = renderHook(() => useWalletBalanceDisplay());
      expect(result.current.isStale).toBe(false);
    });

    it('surfaces the missing-Connect-account state', () => {
      (useConnectBalance as jest.Mock).mockReturnValue({
        ...CONNECT_BALANCE,
        available: 0,
        hasConnectAccount: false,
        payoutsEnabled: false,
      });
      const { result } = renderHook(() => useWalletBalanceDisplay());

      expect(result.current.hasConnectAccount).toBe(false);
      expect(result.current.payoutsEnabled).toBe(false);
    });
  });

  describe("when the source is 'ledger'", () => {
    it('reports the legacy ledger balance converted to cents', () => {
      const { result } = renderHook(() => useWalletBalanceDisplay());

      expect(result.current.amountCents).toBe(9999);
      expect(result.current.source).toBe('ledger');
    });

    it('converts fractional dollars without floating point drift', () => {
      (useWallet as jest.Mock).mockReturnValue({
        balance: 5.7,
        isLoading: false,
        refreshFromApi: jest.fn(),
      });
      const { result } = renderHook(() => useWalletBalanceDisplay());
      // 5.7 * 100 is 570.0000000000001 in IEEE754 — must round to 570.
      expect(result.current.amountCents).toBe(570);
    });

    it('does not enable or consume the Connect hook', () => {
      const { result } = renderHook(() => useWalletBalanceDisplay());

      expect(useConnectBalance).toHaveBeenCalledWith({ enabled: false });
      expect(result.current.amountCents).not.toBe(1250);
      expect(result.current.pendingCents).toBe(0);
      expect(result.current.instantAvailableCents).toBe(0);
    });

    it('does not render an onboarding CTA over a working ledger balance', () => {
      const { result } = renderHook(() => useWalletBalanceDisplay());
      expect(result.current.hasConnectAccount).toBe(true);
    });
  });
});
