/**
 * Tests for PayoutMethodsScreen, refactored to consume the shared
 * usePayoutMethods/useConnectEligibility hooks instead of its own
 * independent bank-account/debit-card fetch logic.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import type { UseConnectEligibilityResult } from '../../hooks/use-connect-eligibility';
import type { UsePayoutMethodsResult } from '../../hooks/use-payout-methods';
import { PayoutMethodsScreen } from '../../components/payout-methods-screen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

function makePayoutMethods(overrides: Partial<UsePayoutMethodsResult> = {}): UsePayoutMethodsResult {
  return {
    bankAccounts: [],
    debitCards: [],
    hasInstantEligibleCard: false,
    minWithdrawal: 10,
    maxWithdrawal: null,
    availableBalance: null,
    isLoading: false,
    error: null,
    refresh: jest.fn(),
    openPayoutDashboard: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeEligibility(overrides: Partial<UseConnectEligibilityResult> = {}): UseConnectEligibilityResult {
  return {
    loading: false,
    connectedAccountExists: false,
    detailsSubmitted: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    isFullyOnboarded: false,
    error: null,
    refresh: jest.fn(),
    ...overrides,
  };
}

describe('PayoutMethodsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty states when no bank accounts or cards are linked', () => {
    const { getByText } = render(
      <PayoutMethodsScreen onBack={jest.fn()} payoutMethods={makePayoutMethods()} eligibility={makeEligibility()} />
    );
    expect(getByText('No bank accounts linked')).toBeTruthy();
    expect(getByText('No debit cards linked')).toBeTruthy();
  });

  it('shows a linked bank account with its Default badge', () => {
    const { getByText } = render(
      <PayoutMethodsScreen
        onBack={jest.fn()}
        payoutMethods={makePayoutMethods({
          bankAccounts: [
            { id: 'ba_1', bankName: 'Chase', last4: '1234', default: true, status: 'verified' },
          ],
        })}
        eligibility={makeEligibility()}
      />
    );
    expect(getByText(/Chase/)).toBeTruthy();
    expect(getByText('Default')).toBeTruthy();
  });

  it('opens the Stripe payout dashboard when "Manage Payout Methods" is pressed', async () => {
    const openPayoutDashboard = jest.fn().mockResolvedValue({ ok: true });
    const { getByText } = render(
      <PayoutMethodsScreen
        onBack={jest.fn()}
        payoutMethods={makePayoutMethods({ openPayoutDashboard })}
        eligibility={makeEligibility({ connectedAccountExists: true })}
      />
    );
    await act(async () => {
      fireEvent.press(getByText('Manage Payout Methods'));
    });
    expect(openPayoutDashboard).toHaveBeenCalled();
  });

  it('shows instant-eligible vs not-instant-eligible badges for debit cards', () => {
    const { getByText } = render(
      <PayoutMethodsScreen
        onBack={jest.fn()}
        payoutMethods={makePayoutMethods({
          debitCards: [
            { id: 'card_1', brand: 'Visa', last4: '4242', expMonth: 1, expYear: 2030, instantEligible: true },
            { id: 'card_2', brand: 'Amex', last4: '0005', expMonth: 2, expYear: 2031, instantEligible: false },
          ],
        })}
        eligibility={makeEligibility()}
      />
    );
    expect(getByText('Instant-eligible')).toBeTruthy();
    expect(getByText('Not instant-eligible')).toBeTruthy();
  });

  it('shows a loading indicator and hides the lists while isLoading', () => {
    const { queryByText } = render(
      <PayoutMethodsScreen
        onBack={jest.fn()}
        payoutMethods={makePayoutMethods({ isLoading: true })}
        eligibility={makeEligibility()}
      />
    );
    expect(queryByText('No bank accounts linked')).toBeNull();
  });

  it('only shows "View Payment Activity" once a Connect account exists', () => {
    const { queryByText, rerender } = render(
      <PayoutMethodsScreen onBack={jest.fn()} payoutMethods={makePayoutMethods()} eligibility={makeEligibility()} />
    );
    expect(queryByText('View Payment Activity')).toBeNull();

    rerender(
      <PayoutMethodsScreen
        onBack={jest.fn()}
        payoutMethods={makePayoutMethods()}
        eligibility={makeEligibility({ connectedAccountExists: true })}
      />
    );
    expect(queryByText('View Payment Activity')).toBeTruthy();
  });

  it('navigates to /wallet/payments when "View Payment Activity" is pressed', () => {
    const { getByText } = render(
      <PayoutMethodsScreen
        onBack={jest.fn()}
        payoutMethods={makePayoutMethods()}
        eligibility={makeEligibility({ connectedAccountExists: true })}
      />
    );
    fireEvent.press(getByText('View Payment Activity'));
    expect(mockPush).toHaveBeenCalledWith('/wallet/payments');
  });
});
