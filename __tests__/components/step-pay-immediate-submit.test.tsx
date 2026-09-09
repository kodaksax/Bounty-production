/**
 * Regression coverage for the reported "Post Bounty does nothing" bug on the
 * amount step of the quick Post-a-Bounty flow
 * (app/screens/CreateBounty/quick/StepPay.tsx).
 *
 * Two silent-swallow paths were reported. This suite covers the StepPay side:
 *
 *  1. Type-then-immediate-submit. The poster types an amount and taps the CTA
 *     in the same frame, before the parent has propagated the new amount back
 *     into `draft`. The CTA used to disable itself while `draft.amount < 1`, so
 *     that first tap landed on a dead touchable and was lost. The step now reads
 *     the committed amount from a ref and keeps the CTA pressable, so the tap
 *     reaches handleContinue.
 *
 *  2. Below-$1 tap. With the CTA now always pressable, tapping with no valid
 *     amount must surface the amount validation error — previously unreachable,
 *     because the button that would trigger it was disabled.
 *
 * The post-completion cooldown (the other reported path, in
 * hooks/useFormSubmission via useBountyPublish) is covered in
 * __tests__/unit/hooks/useFormSubmission.test.tsx.
 */

import { fireEvent, render } from '@testing-library/react-native';

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

// Pin the posting policy so this suite exercises StepPay's submit/validation
// wiring, not the policy hook's network read. The $1 floor keeps the
// below-minimum assertions below exact and independent of the shipped default.
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

describe('StepPay — type-then-immediate-submit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBalance = 0;
  });

  it('publishes when the poster types an amount and taps in the same frame, before draft propagates', () => {
    const onUpdate = jest.fn();
    const onNext = jest.fn();

    // draft.amount stays 0 for the whole render: onUpdate is a spy, so the
    // parent never feeds the typed amount back as a new prop — exactly the
    // not-yet-propagated state the first tap used to land in.
    const { getByLabelText } = render(
      <StepPay
        draft={makeDraft()}
        onUpdate={onUpdate}
        onNext={onNext}
        onBack={jest.fn()}
        step={2}
        totalSteps={2}
        ctaLabel="Post Bounty"
      />
    );

    fireEvent.changeText(getByLabelText('Bounty amount in dollars'), '50');
    fireEvent.press(getByLabelText('Post Bounty'));

    expect(onUpdate).toHaveBeenCalledWith({ amount: 50, isForHonor: false });
    expect(onNext).toHaveBeenCalledWith({ amount: 50, isForHonor: false });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'amount_set',
      expect.objectContaining({ amount: 50, method: 'custom' })
    );
  });

  it('shows the amount validation error instead of doing nothing when tapped below $1', () => {
    const onNext = jest.fn();

    const { getByLabelText, getByText, queryByText } = render(
      <StepPay
        draft={makeDraft()}
        onUpdate={jest.fn()}
        onNext={onNext}
        onBack={jest.fn()}
        step={2}
        totalSteps={2}
        ctaLabel="Post Bounty"
      />
    );

    expect(queryByText('The minimum bounty amount is $1.00')).toBeNull();

    fireEvent.press(getByLabelText('Post Bounty'));

    expect(onNext).not.toHaveBeenCalled();
    expect(getByText('The minimum bounty amount is $1.00')).toBeTruthy();
  });
});
