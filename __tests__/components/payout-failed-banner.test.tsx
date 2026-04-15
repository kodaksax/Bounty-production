/**
 * Tests for PayoutFailedBanner component
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { PayoutFailedBanner } from '../../components/ui/PayoutFailedBanner';

// ---- module mocks ----

jest.mock('../../lib/wallet-context', () => ({
  useWallet: jest.fn(),
}));

jest.mock('../../hooks/use-auth-context', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('../../lib/utils/browser', () => ({
  openUrlInBrowser: jest.fn(),
}));

jest.mock('../../lib/config/api', () => ({
  API_BASE_URL: 'https://api.example.com',
}));

jest.mock('../../lib/config', () => ({
  config: { supabase: { anonKey: 'test-anon-key' } },
}));

// ---- imports after mocks ----

import { useAuthContext } from '../../hooks/use-auth-context';
import { openUrlInBrowser } from '../../lib/utils/browser';
import { useWallet } from '../../lib/wallet-context';

// ---- helpers ----

const mockRefreshFromApi = jest.fn();
const mockSession = { access_token: 'test-token' };

function setupWallet(
  overrides: Partial<{ payoutFailed: boolean; payoutFailureCode: string | null }> = {}
) {
  (useWallet as jest.Mock).mockReturnValue({
    payoutFailed: true,
    payoutFailureCode: null,
    refreshFromApi: mockRefreshFromApi,
    clearPayoutFailure: jest.fn(),
    ...overrides,
  });
  (useAuthContext as jest.Mock).mockReturnValue({ session: mockSession });
}

function setupFetch(responses: Array<{ ok: boolean; json?: () => Promise<unknown> }>) {
  let callIndex = 0;
  global.fetch = jest.fn(() => {
    const res = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return Promise.resolve({
      ok: res.ok,
      json: res.json ?? (() => Promise.resolve({})),
    });
  }) as jest.Mock;
}

// ---- tests ----

describe('PayoutFailedBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshFromApi.mockResolvedValue(undefined);
  });

  describe('visibility', () => {
    it('renders nothing when payoutFailed is false', () => {
      setupWallet({ payoutFailed: false });
      const { queryByText } = render(<PayoutFailedBanner />);
      expect(queryByText('Payout Failed')).toBeNull();
    });

    it('renders the banner when payoutFailed is true', () => {
      setupWallet({ payoutFailed: true });
      const { getByText } = render(<PayoutFailedBanner />);
      expect(getByText('Payout Failed')).toBeTruthy();
    });
  });

  describe('failure_code → message mapping', () => {
    it('shows a mapped message for account_closed', () => {
      setupWallet({ payoutFailed: true, payoutFailureCode: 'account_closed' });
      const { getByText } = render(<PayoutFailedBanner />);
      expect(getByText('Your bank account has been closed. Please add a new one.')).toBeTruthy();
    });

    it('shows a mapped message for no_account', () => {
      setupWallet({ payoutFailed: true, payoutFailureCode: 'no_account' });
      const { getByText } = render(<PayoutFailedBanner />);
      expect(
        getByText('The bank account could not be found. Please re-enter your details.')
      ).toBeTruthy();
    });

    it('shows a generic code message for an unknown failure code', () => {
      setupWallet({ payoutFailed: true, payoutFailureCode: 'some_exotic_code' });
      const { getByText } = render(<PayoutFailedBanner />);
      expect(
        getByText('Payout failed (some_exotic_code). Please update your payment details.')
      ).toBeTruthy();
    });

    it('shows the default message when failureCode is null', () => {
      setupWallet({ payoutFailed: true, payoutFailureCode: null });
      const { getByText } = render(<PayoutFailedBanner />);
      expect(
        getByText(
          'Your most recent payout could not be processed. Please update your payment details.'
        )
      ).toBeTruthy();
    });
  });

  describe('"Fix Payment Details" action flow', () => {
    it('opens the browser URL returned by the server on success', async () => {
      setupWallet();
      (openUrlInBrowser as jest.Mock).mockResolvedValue({ success: true });
      setupFetch([
        { ok: true, json: () => Promise.resolve({ url: 'https://stripe.com/update' }) },
        { ok: true, json: () => Promise.resolve({ payoutsEnabled: true }) },
      ]);

      const { getByText } = render(<PayoutFailedBanner />);
      await act(async () => {
        fireEvent.press(getByText('Fix Payment Details →'));
      });

      await waitFor(() => {
        expect(openUrlInBrowser).toHaveBeenCalledWith('https://stripe.com/update');
      });
      expect(mockRefreshFromApi).toHaveBeenCalledWith('test-token');
    });

    it('shows an error and does NOT call verify-onboarding when browser open fails', async () => {
      setupWallet();
      (openUrlInBrowser as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Browser unavailable',
      });
      setupFetch([{ ok: true, json: () => Promise.resolve({ url: 'https://stripe.com/update' }) }]);

      const { getByText, queryByText } = render(<PayoutFailedBanner />);
      await act(async () => {
        fireEvent.press(getByText('Fix Payment Details →'));
      });

      await waitFor(() => {
        expect(queryByText('Browser unavailable')).toBeTruthy();
      });
      // fetch should only have been called once (create-account-link), not twice
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
      expect(mockRefreshFromApi).not.toHaveBeenCalled();
    });

    it('shows a server error message when create-account-link fails', async () => {
      setupWallet();
      setupFetch([
        { ok: false, json: () => Promise.resolve({ error: 'No connected account found' }) },
      ]);

      const { getByText, queryByText } = render(<PayoutFailedBanner />);
      await act(async () => {
        fireEvent.press(getByText('Fix Payment Details →'));
      });

      await waitFor(() => {
        expect(queryByText('No connected account found')).toBeTruthy();
      });
      expect(openUrlInBrowser).not.toHaveBeenCalled();
    });

    it('shows a server error when verify-onboarding returns non-2xx', async () => {
      setupWallet();
      (openUrlInBrowser as jest.Mock).mockResolvedValue({ success: true });
      setupFetch([
        { ok: true, json: () => Promise.resolve({ url: 'https://stripe.com/update' }) },
        {
          ok: false,
          json: () =>
            Promise.resolve({ error: 'Failed to update account status. Please try again.' }),
        },
      ]);

      const { getByText, queryByText } = render(<PayoutFailedBanner />);
      await act(async () => {
        fireEvent.press(getByText('Fix Payment Details →'));
      });

      await waitFor(() => {
        expect(queryByText('Failed to update account status. Please try again.')).toBeTruthy();
      });
      expect(mockRefreshFromApi).not.toHaveBeenCalled();
    });

    it('shows a guidance message when verify-onboarding returns payoutsEnabled: false', async () => {
      setupWallet();
      (openUrlInBrowser as jest.Mock).mockResolvedValue({ success: true });
      setupFetch([
        { ok: true, json: () => Promise.resolve({ url: 'https://stripe.com/update' }) },
        { ok: true, json: () => Promise.resolve({ payoutsEnabled: false }) },
      ]);

      const { getByText, queryByText } = render(<PayoutFailedBanner />);
      await act(async () => {
        fireEvent.press(getByText('Fix Payment Details →'));
      });

      await waitFor(() => {
        expect(queryByText(/payouts are not yet enabled/i)).toBeTruthy();
      });
      // refreshFromApi still called even when payouts not yet enabled
      expect(mockRefreshFromApi).toHaveBeenCalledWith('test-token');
    });
  });
});
