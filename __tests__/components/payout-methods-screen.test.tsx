/**
 * Tests for PayoutMethodsScreen, refactored to consume the shared
 * usePayoutMethods/useConnectEligibility hooks instead of its own
 * independent bank-account/debit-card fetch logic.
 */
import { fireEvent, render } from '@testing-library/react-native';
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

jest.mock('../../components/add-bank-account-modal', () => ({
  AddBankAccountModal: () => null,
}));
jest.mock('../../components/add-debit-card-modal', () => ({
  AddDebitCardModal: () => null,
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
    removeBankAccount: jest.fn().mockResolvedValue({ ok: true }),
    removeDebitCard: jest.fn().mockResolvedValue({ ok: true }),
    setDefaultBankAccount: jest.fn().mockResolvedValue({ ok: true }),
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
    const { getByText, queryByText } = render(
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
    expect(queryByText('Make Default')).toBeNull();
  });

  it('shows "Make Default" for a non-default bank account and calls setDefaultBankAccount on press', async () => {
    const setDefaultBankAccount = jest.fn().mockResolvedValue({ ok: true });
    const { getByText } = render(
      <PayoutMethodsScreen
        onBack={jest.fn()}
        payoutMethods={makePayoutMethods({
          bankAccounts: [
            { id: 'ba_1', bankName: 'Chase', last4: '1234', default: false, status: 'verified' },
          ],
          setDefaultBankAccount,
        })}
        eligibility={makeEligibility()}
      />
    );
    fireEvent.press(getByText('Make Default'));
    expect(setDefaultBankAccount).toHaveBeenCalledWith('ba_1');
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
