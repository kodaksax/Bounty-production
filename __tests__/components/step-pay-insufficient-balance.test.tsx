/**
 * Tests for StepPay's balance guard — the amount/payment step of the "quick"
 * Post-a-Bounty flow (app/screens/CreateBounty/quick/StepPay.tsx).
 *
 * Regression coverage for replacing the blocking `Alert.alert('Insufficient
 * Balance', ...)` on preset tap with a routed callback (onInsufficientBalance)
 * into the shared top-up flow owned by CreateBountyFlow. Also covers the
 * previously-silent gap where a custom-typed amount over balance let the
 * poster tap Continue straight through to Review with an unfundable draft.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockTrackEvent = jest.fn();
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  },
}));

let mockBalance = 0;
jest.mock('../../lib/wallet-context', () => ({
  useWallet: jest.fn(() => ({ balance: mockBalance })),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Pin the posting policy so this suite exercises StepPay's balance-routing
// guard in isolation. honorPostsEnabled:true keeps the for-honor path open (the
// shipped default is the closed state), and the $1 floor keeps the amount
// checks independent of the policy value.
jest.mock('../../hooks/usePostingPolicy', () => {
  const policy = { honorPostsEnabled: true, minimumAmount: 1 };
  return { __esModule: true, default: () => policy, usePostingPolicy: () => policy };
});

import { StepPay } from '../../app/screens/CreateBounty/quick/StepPay';

function makeDraft(overrides: Partial<{ amount: number; isForHonor: boolean }> = {}) {
  return {
    title: 'Test bounty',
    description: '',
    amount: 0,
    isForHonor: false,
    category: 'errands',
    workType: 'in_person',
    ...overrides,
  } as any;
}

describe('StepPay — insufficient balance routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBalance = 0;
  });

  it('never calls the native Alert for a balance shortfall (replaced by the routed flow)', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockBalance = 5;
    const onUpdate = jest.fn();
    const onInsufficientBalance = jest.fn();

    const { getByLabelText } = render(
      <StepPay
        draft={makeDraft()}
        onUpdate={onUpdate}
        onNext={jest.fn()}
        onBack={jest.fn()}
        step={5}
        totalSteps={6}
        onInsufficientBalance={onInsufficientBalance}
      />
    );

    fireEvent.press(getByLabelText('Pay $20'));

    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('selects a preset the balance cannot cover WITHOUT routing to the top-up gate', () => {
    // Pay-at-accept: posting is publishing an offer and debits nothing, so an
    // amount the poster cannot currently afford is a perfectly valid choice.
    // Diverting to top-up here would rebuild, on the amount step, the exact
    // activation barrier deferring the charge exists to remove.
    mockBalance = 5;
    const onUpdate = jest.fn();
    const onInsufficientBalance = jest.fn();

    const { getByLabelText } = render(
      <StepPay
        draft={makeDraft()}
        onUpdate={onUpdate}
        onNext={jest.fn()}
        onBack={jest.fn()}
        step={5}
        totalSteps={6}
        onInsufficientBalance={onInsufficientBalance}
      />
    );

    fireEvent.press(getByLabelText('Pay $20'));

    expect(onUpdate).toHaveBeenCalledWith({ amount: 20, isForHonor: false });
    expect(onInsufficientBalance).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      'post_amount_blocked_by_balance',
      expect.anything()
    );
  });

  it('selects a covered preset without routing to the top-up gate', () => {
    mockBalance = 100;
    const onUpdate = jest.fn();
    const onInsufficientBalance = jest.fn();

    const { getByLabelText } = render(
      <StepPay
        draft={makeDraft()}
        onUpdate={onUpdate}
        onNext={jest.fn()}
        onBack={jest.fn()}
        step={5}
        totalSteps={6}
        onInsufficientBalance={onInsufficientBalance}
      />
    );

    fireEvent.press(getByLabelText('Pay $40'));

    expect(onUpdate).toHaveBeenCalledWith({ amount: 40, isForHonor: false });
    expect(onInsufficientBalance).not.toHaveBeenCalled();
  });

  it('advances on Continue with an amount over balance instead of gating the post', () => {
    // The reckoning moves to acceptance, not away: the poster is charged when
    // they select a hunter. The publish path still holds the real gate for the
    // cases that DO charge at insert (kill switch off, or v2 Stripe-native).
    mockBalance = 10;
    const onNext = jest.fn();
    const onInsufficientBalance = jest.fn();

    const { getByLabelText } = render(
      <StepPay
        draft={makeDraft({ amount: 35 })}
        onUpdate={jest.fn()}
        onNext={onNext}
        onBack={jest.fn()}
        step={5}
        totalSteps={6}
        onInsufficientBalance={onInsufficientBalance}
      />
    );

    fireEvent.press(getByLabelText('Continue'));

    expect(onNext).toHaveBeenCalled();
    expect(onInsufficientBalance).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      'post_amount_blocked_by_balance',
      expect.anything()
    );
  });

  it('advances normally on Continue when the amount is covered by balance', () => {
    mockBalance = 100;
    const onNext = jest.fn();
    const onInsufficientBalance = jest.fn();

    const { getByLabelText } = render(
      <StepPay
        draft={makeDraft({ amount: 35 })}
        onUpdate={jest.fn()}
        onNext={onNext}
        onBack={jest.fn()}
        step={5}
        totalSteps={6}
        onInsufficientBalance={onInsufficientBalance}
      />
    );

    fireEvent.press(getByLabelText('Continue'));

    expect(onInsufficientBalance).not.toHaveBeenCalled();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('lets a for-honor bounty (no balance required) advance on Continue regardless of balance', () => {
    mockBalance = 0;
    const onNext = jest.fn();
    const onInsufficientBalance = jest.fn();

    const { getByLabelText } = render(
      <StepPay
        draft={makeDraft({ amount: 0, isForHonor: true })}
        onUpdate={jest.fn()}
        onNext={onNext}
        onBack={jest.fn()}
        step={5}
        totalSteps={6}
        onInsufficientBalance={onInsufficientBalance}
      />
    );

    fireEvent.press(getByLabelText('Continue'));

    expect(onInsufficientBalance).not.toHaveBeenCalled();
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
