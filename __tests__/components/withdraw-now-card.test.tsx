/**
 * Tests for WithdrawNowCard's failed-state vocabulary. A genuine failure reads
 * "Withdrawal failed", but a decline or an unverified state must not — that
 * mismatch (a red "failed" header over copy that says the status is still being
 * checked) is the contradiction this guards against.
 */
import { render } from '@testing-library/react-native';
import { WithdrawNowCard } from '../../components/withdraw-now-card';
import { useConnectPayout } from '../../hooks/use-connect-payout';
import { useWalletBalanceDisplay } from '../../hooks/use-wallet-balance-display';

jest.mock('../../hooks/use-connect-payout', () => ({ useConnectPayout: jest.fn() }));
jest.mock('../../hooks/use-wallet-balance-display', () => ({ useWalletBalanceDisplay: jest.fn() }));
jest.mock('../../hooks/use-auth-context', () => ({ useAuthContext: () => ({ session: null }) }));
jest.mock('../../lib/wallet-context', () => ({ useWallet: () => ({ refreshFromApi: jest.fn() }) }));
jest.mock('../../lib/haptic-feedback', () => ({ useHapticFeedback: () => ({ triggerHaptic: jest.fn() }) }));
jest.mock('../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({
    theme: {
      surface: '#fff',
      border: '#eee',
      primary: '#059669',
      primaryLight: '#6ee7b7',
      text: '#000',
      textSecondary: '#666',
      success: '#22c55e',
      error: '#ef4444',
    },
  }),
}));

function mockFailed(error: { code: string; message: string; retryable: boolean }) {
  (useWalletBalanceDisplay as jest.Mock).mockReturnValue({ isLoading: false, amountCents: 0 });
  (useConnectPayout as jest.Mock).mockReturnValue({
    phase: 'failed',
    result: null,
    error,
    isProcessing: false,
    withdraw: jest.fn(),
    reset: jest.fn(),
  });
}

describe('WithdrawNowCard failed state', () => {
  it('shows "Withdrawal failed" for a genuine provider failure', () => {
    mockFailed({ code: 'payout_failed', message: 'We could not confirm whether this completed.', retryable: true });
    const { getByText, queryByText } = render(<WithdrawNowCard />);
    expect(getByText('Withdrawal failed')).toBeTruthy();
    expect(queryByText('Verifying your withdrawal')).toBeNull();
  });

  it('uses a neutral title when the payout state is still being verified', () => {
    mockFailed({ code: 'unknown_payout_state', message: 'Your withdrawal status is being verified.', retryable: true });
    const { getByText, queryByText } = render(<WithdrawNowCard />);
    expect(getByText('Verifying your withdrawal')).toBeTruthy();
    expect(queryByText('Withdrawal failed')).toBeNull();
  });

  it('uses a neutral title when a withdrawal is already in progress', () => {
    mockFailed({ code: 'withdrawal_already_in_progress', message: 'You already have a withdrawal on its way.', retryable: false });
    const { getByText, queryByText } = render(<WithdrawNowCard />);
    expect(getByText('Withdrawal already in progress')).toBeTruthy();
    expect(queryByText('Withdrawal failed')).toBeNull();
  });
});
