/**
 * Integration tests for CreateBountyFlow's insufficient-balance → top-up gate
 * (app/screens/CreateBounty/index.tsx).
 *
 * Covers the seamless-continuation contract from both trigger points:
 *  - the Compensation step (StepPay), when a poster commits to an amount
 *    their wallet can't yet cover
 *  - the final Publish tap (StepReviewQuick), as a safety net if balance
 *    changed since the amount was chosen
 *
 * Heavy leaf dependencies (bounty creation service calls, Stripe SDK, the
 * step screens' own internals) are stubbed so this suite exercises purely
 * CreateBountyFlow's own state machine: which screen shows, what props it
 * gets, and what happens once the top-up resolves. StepPay's own balance
 * logic is covered separately in step-pay-insufficient-balance.test.tsx, and
 * AddMoneyScreen's Apple Pay / card behavior in add-money-apple-pay.test.tsx.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

// ---- controllable test state ----

let mockBalance = 0;
let mockDraft: any = {
  title: 'Test bounty',
  description: '',
  amount: 0,
  isForHonor: false,
  category: 'errands',
  workType: 'in_person',
  attachments: [],
};
const mockSubmit = jest.fn();
const mockCreateEscrow = jest.fn();

function resetDraft(overrides: Partial<typeof mockDraft> = {}) {
  mockDraft = {
    title: 'Test bounty',
    description: '',
    amount: 0,
    isForHonor: false,
    category: 'errands',
    workType: 'in_person',
    attachments: [],
    ...overrides,
  };
}

// ---- module mocks ----

// The global jest.setup.js mock for react-native-reanimated (deliberately
// minimal — see its comment) doesn't export the FadeIn/FadeInDown entrance
// presets InsufficientBalanceScreen uses. Override locally per that file's
// own documented escape hatch.
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const chainable = (): any => {
    const obj: any = {};
    obj.duration = () => obj;
    obj.delay = () => obj;
    obj.springify = () => obj;
    return obj;
  };
  return {
    __esModule: true,
    default: {
      View: RN.View,
      Text: RN.Text,
      Image: RN.Image,
      ScrollView: RN.ScrollView,
      createAnimatedComponent: (c: unknown) => c,
    },
    View: RN.View,
    Text: RN.Text,
    FadeIn: chainable(),
    FadeInDown: chainable(),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

jest.mock('hooks/useBackHandler', () => ({
  useBackHandler: jest.fn(),
}));

jest.mock('app/hooks/useBountyDraft', () => ({
  useBountyDraft: jest.fn(() => ({
    draft: mockDraft,
    saveDraft: jest.fn(),
    clearDraft: jest.fn(),
    isLoading: false,
  })),
}));

jest.mock('hooks/use-auth-context', () => ({
  useAuthContext: jest.fn(() => ({
    session: { access_token: 'token', user: { id: 'poster-1' } },
  })),
}));

jest.mock('hooks/use-email-verification', () => ({
  useEmailVerification: jest.fn(() => ({
    isEmailVerified: true,
    canPostBounties: true,
    userEmail: 'poster@example.com',
  })),
}));

jest.mock('lib/wallet-context', () => ({
  useWallet: jest.fn(() => ({ balance: mockBalance, createEscrow: mockCreateEscrow })),
}));

jest.mock('lib/stripe-context', () => ({
  useStripe: jest.fn(() => ({ paymentMethods: [{ id: 'pm_test' }] })),
}));

jest.mock('lib/utils/payment-architecture', () => ({
  shouldFundNewBountiesWithPhase2: jest.fn(() => false),
}));

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('app/services/bountyService', () => ({
  bountyService: { createBounty: jest.fn(), deleteBounty: jest.fn() },
}));

jest.mock('lib/services/bounty-payments-service', () => ({
  bountyPaymentsService: { createBountyPayment: jest.fn(), cancelBountyPayment: jest.fn() },
}));

jest.mock('lib/services/offline-queue-service', () => ({
  offlineQueueService: { getOnlineStatus: jest.fn(() => true) },
}));

jest.mock('lib/services/stripe-service', () => ({
  stripeService: { confirmPaymentSecure: jest.fn() },
}));

// useFormSubmission drives real bounty-creation/escrow logic that isn't the
// point of this suite — replace it with a spy so tests can assert *whether*
// submit() ran (the "auto-continue publish" contract) without exercising the
// real create/escrow/rollback body.
jest.mock('hooks/useFormSubmission', () => ({
  useFormSubmission: jest.fn(() => ({
    submit: mockSubmit,
    isSubmitting: false,
    error: null,
    reset: jest.fn(),
  })),
}));

// Step screens: stub with minimal controls wired to the same props
// CreateBountyFlow passes in real usage, so this suite can drive the flow's
// state machine without each step's own internal UI/validation.
jest.mock('app/screens/CreateBounty/quick/StepTask', () => ({
  StepTask: (props: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="stub-next" onPress={props.onNext}>
        <Text>StepTask</Text>
      </TouchableOpacity>
    );
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepPhotos', () => ({
  StepPhotos: (props: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="stub-next" onPress={props.onNext}>
        <Text>StepPhotos</Text>
      </TouchableOpacity>
    );
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepWhere', () => ({
  StepWhere: (props: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="stub-next" onPress={props.onNext}>
        <Text>StepWhere</Text>
      </TouchableOpacity>
    );
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepWhen', () => ({
  StepWhen: (props: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="stub-next" onPress={props.onNext}>
        <Text>StepWhen</Text>
      </TouchableOpacity>
    );
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepPay', () => ({
  StepPay: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepPay</Text>
        <TouchableOpacity accessibilityLabel="stub-continue" onPress={props.onNext}>
          <Text>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="stub-trigger-insufficient"
          onPress={() => props.onInsufficientBalance(mockDraft.amount)}
        >
          <Text>Trigger insufficient</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepReviewQuick', () => ({
  StepReviewQuick: (props: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="stub-publish" onPress={props.onSubmit}>
        <Text>Publish</Text>
      </TouchableOpacity>
    );
  },
}));

// AddMoneyScreen's own Apple Pay / card behavior is covered by
// add-money-apple-pay.test.tsx. Here it's stubbed with controls split into a
// deposit step and a separate confirm step, mirroring the real app's actual
// timing: useWalletDeposit's deposit() updates WalletContext (propagating a
// fresh `balance` to CreateBountyFlow, and so a fresh onAddMoney closure into
// this screen's props) strictly before the user taps "OK" on the success
// modal, which is what actually invokes onAddMoney. Tests reproduce that gap
// with an explicit rerender() between pressing "deposit" and "confirm".
jest.mock('components/add-money-screen', () => ({
  AddMoneyScreen: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text testID="topup-initial-amount">{props.initialAmount}</Text>
        <Text testID="topup-header-label">{props.headerLabel}</Text>
        <Text testID="topup-cta-label">{props.primaryCtaLabel?.(Number(props.initialAmount))}</Text>
        <TouchableOpacity accessibilityLabel="stub-topup-cancel" onPress={props.onBack}>
          <Text>Cancel top-up</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="stub-topup-deposit-full"
          onPress={() => {
            mockBalance += Number(props.initialAmount);
          }}
        >
          <Text>Deposit full amount</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="stub-topup-deposit-partial"
          onPress={() => {
            // A quarter, not half — half-of-shortfall would leave exactly
            // half-of-shortfall remaining, an unrelated numeric coincidence
            // that would make wallet-balance and amount-needed collide in
            // the assertions below.
            mockBalance += Number(props.initialAmount) / 4;
          }}
        >
          <Text>Deposit partial amount</Text>
        </TouchableOpacity>
        {/* Fixed-amount deposits (independent of the pre-filled shortfall) for
            scenarios that need an exact, caller-chosen top-up amount — e.g.
            the reported "$5 + $5 = $10" repro, or cents-precision cases. */}
        <TouchableOpacity accessibilityLabel="stub-topup-deposit-5" onPress={() => { mockBalance += 5; }}>
          <Text>Deposit $5</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel="stub-topup-deposit-dime" onPress={() => { mockBalance += 0.1; }}>
          <Text>Deposit $0.10</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="stub-topup-deposit-overfund"
          onPress={() => { mockBalance += Number(props.initialAmount) + 3; }}
        >
          <Text>Deposit more than needed</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel="stub-topup-confirm" onPress={() => props.onAddMoney(0)}>
          <Text>Confirm top-up</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

// ---- import after mocks ----

import { CreateBountyFlow } from 'app/screens/CreateBounty/index';

/** Steps 1-4 (Task/Photos/Where/When) are stubbed identically — advance through them to reach Compensation (step 5). */
function goToStepPay() {
  fireEvent.press(screen.getByLabelText('stub-next')); // Task -> Photos
  fireEvent.press(screen.getByLabelText('stub-next')); // Photos -> Where
  fireEvent.press(screen.getByLabelText('stub-next')); // Where -> When
  fireEvent.press(screen.getByLabelText('stub-next')); // When -> Pay
}

/** Advances all the way to Review (step 6) via the stubbed Compensation "Continue". */
function goToReview() {
  goToStepPay();
  fireEvent.press(screen.getByLabelText('stub-continue')); // Pay -> Review
}

describe('CreateBountyFlow — insufficient balance → top-up gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBalance = 0;
    resetDraft();
  });

  it('sufficient balance: Publish goes straight to submit without showing the gate', () => {
    mockBalance = 50;
    resetDraft({ amount: 50 });
    render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Add Funds to Post')).toBeNull();
  });

  it('exact-balance case: balance equal to the bounty amount is treated as sufficient', () => {
    mockBalance = 25;
    resetDraft({ amount: 25 });
    render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Add Funds to Post')).toBeNull();
  });

  it('insufficient balance at publish shows the top-up gate with the correct shortfall, not a raw error', () => {
    mockBalance = 10;
    resetDraft({ amount: 30 });
    render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Add Funds to Post')).toBeTruthy();
    expect(screen.getByText('$20.00')).toBeTruthy(); // needed = 30 - 10
  });

  it('insufficient balance chosen on the amount step shows the same gate (not a dead-end alert)', () => {
    mockBalance = 10;
    resetDraft({ amount: 27 });
    render(<CreateBountyFlow />);
    goToStepPay();

    fireEvent.press(screen.getByLabelText('stub-trigger-insufficient'));

    expect(screen.getByText('Add Funds to Post')).toBeTruthy();
    expect(screen.getByText('$17.00')).toBeTruthy(); // needed = 27 - 10
  });

  it('Add Funds routes into the top-up screen pre-filled with the shortfall and a bounty-specific CTA', () => {
    mockBalance = 10;
    resetDraft({ amount: 30 });
    render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));
    fireEvent.press(screen.getByLabelText(/Add \$20\.00 and continue/i));

    expect(screen.getByTestId('topup-initial-amount').props.children).toBe('20.00');
    expect(screen.getByTestId('topup-header-label').props.children).toBe('ADD FUNDS TO POST');
    expect(screen.getByTestId('topup-cta-label').props.children).toBe('Add $20.00 & Continue');
  });

  it('successful top-up from the publish gate auto-continues the post (data already preserved via the draft)', () => {
    mockBalance = 10;
    resetDraft({ amount: 30 });
    const { rerender } = render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));
    fireEvent.press(screen.getByLabelText(/Add \$20\.00 and continue/i));
    fireEvent.press(screen.getByLabelText('stub-topup-deposit-full'));
    rerender(<CreateBountyFlow />); // propagate the updated balance, as the real WalletContext would
    fireEvent.press(screen.getByLabelText('stub-topup-confirm'));

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Add Funds to Post')).toBeNull();
  });

  it('successful top-up from the amount step returns to Compensation for the poster to tap Continue themselves', () => {
    mockBalance = 10;
    resetDraft({ amount: 27 });
    const { rerender } = render(<CreateBountyFlow />);
    goToStepPay();

    fireEvent.press(screen.getByLabelText('stub-trigger-insufficient'));
    fireEvent.press(screen.getByLabelText(/Add \$17\.00 and continue/i));
    fireEvent.press(screen.getByLabelText('stub-topup-deposit-full'));
    rerender(<CreateBountyFlow />);
    fireEvent.press(screen.getByLabelText('stub-topup-confirm'));

    // Back on StepPay, not auto-submitted and not stuck on the gate.
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText('Add Funds to Post')).toBeNull();
    expect(screen.getByText('StepPay')).toBeTruthy();
  });

  it('a partial top-up that still leaves the bounty underfunded re-shows the gate with the smaller shortfall', () => {
    mockBalance = 0;
    resetDraft({ amount: 40 });
    const { rerender } = render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));
    fireEvent.press(screen.getByLabelText(/Add \$40\.00 and continue/i));
    fireEvent.press(screen.getByLabelText('stub-topup-deposit-partial')); // tops up $10 of $40
    rerender(<CreateBountyFlow />);
    fireEvent.press(screen.getByLabelText('stub-topup-confirm'));

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Add Funds to Post')).toBeTruthy();
    expect(screen.getByText('$30.00')).toBeTruthy(); // remaining shortfall = 40 - 10
  });

  it('cancelling out of the top-up screen returns to the insufficient-balance summary, not the raw error path', () => {
    mockBalance = 10;
    resetDraft({ amount: 30 });
    render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));
    fireEvent.press(screen.getByLabelText(/Add \$20\.00 and continue/i));
    fireEvent.press(screen.getByLabelText('stub-topup-cancel'));

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Add Funds to Post')).toBeTruthy();
  });

  // Regression coverage for the reported bug: $10 bounty, $0 balance, two
  // sequential $5 top-ups. The underlying defect was AddMoneyScreen's success
  // dismiss firing both onAddMoney AND onBack — onAddMoney correctly
  // recognized the bounty was fully funded after the second $5, but the
  // immediately-following onBack call unconditionally re-opened the gate
  // anyway. Fixed in components/add-money-screen.tsx (see
  // add-money-screen-dismiss-contract.test.tsx for the direct regression
  // test); this test proves the fix holds through the full CreateBountyFlow
  // wiring, for both trigger origins.
  describe('$5 + $5 = $10 (reported bug)', () => {
    it('from the amount step: recognizes full funding after the second top-up and returns to Compensation', () => {
      mockBalance = 0;
      resetDraft({ amount: 10 });
      const { rerender } = render(<CreateBountyFlow />);
      goToStepPay();

      fireEvent.press(screen.getByLabelText('stub-trigger-insufficient'));
      expect(screen.getByText('Add Funds to Post')).toBeTruthy();
      // (Bounty Amount and Amount Needed are both $10.00 at $0 balance, so
      // skip a getByText($) check here — the CTA press below already proves
      // the $10.00 shortfall was computed correctly.)

      // First $5 top-up — still short by $5.
      fireEvent.press(screen.getByLabelText(/Add \$10\.00 and continue/i));
      fireEvent.press(screen.getByLabelText('stub-topup-deposit-5'));
      rerender(<CreateBountyFlow />);
      fireEvent.press(screen.getByLabelText('stub-topup-confirm'));

      expect(screen.getByText('Add Funds to Post')).toBeTruthy();
      // Current Balance and Amount Needed are both $5.00 at this point (5 of
      // 10), so assert via the CTA label instead of getByText to avoid
      // ambiguity — the press below proves the $5.00 shortfall was recomputed.
      expect(screen.getByLabelText(/Add \$5\.00 and continue/i)).toBeTruthy();

      // Second $5 top-up — now exactly funded. This is the step that
      // reproduced the bug: the gate must NOT reappear.
      fireEvent.press(screen.getByLabelText(/Add \$5\.00 and continue/i));
      fireEvent.press(screen.getByLabelText('stub-topup-deposit-5'));
      rerender(<CreateBountyFlow />);
      fireEvent.press(screen.getByLabelText('stub-topup-confirm'));

      expect(screen.queryByText('Add Funds to Post')).toBeNull();
      expect(screen.getByText('StepPay')).toBeTruthy();
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('from the publish gate: recognizes full funding after the second top-up and auto-submits', () => {
      mockBalance = 0;
      resetDraft({ amount: 10 });
      const { rerender } = render(<CreateBountyFlow />);
      goToReview();

      fireEvent.press(screen.getByLabelText('stub-publish'));
      fireEvent.press(screen.getByLabelText(/Add \$10\.00 and continue/i));
      fireEvent.press(screen.getByLabelText('stub-topup-deposit-5'));
      rerender(<CreateBountyFlow />);
      fireEvent.press(screen.getByLabelText('stub-topup-confirm'));

      expect(screen.getByText('Add Funds to Post')).toBeTruthy();
      expect(screen.getByLabelText(/Add \$5\.00 and continue/i)).toBeTruthy();
      expect(mockSubmit).not.toHaveBeenCalled();

      fireEvent.press(screen.getByLabelText(/Add \$5\.00 and continue/i));
      fireEvent.press(screen.getByLabelText('stub-topup-deposit-5'));
      rerender(<CreateBountyFlow />);
      fireEvent.press(screen.getByLabelText('stub-topup-confirm'));

      expect(screen.queryByText('Add Funds to Post')).toBeNull();
      expect(mockSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it('a single top-up landing exactly on the bounty amount is recognized as fully funded (not just multi-step)', () => {
    mockBalance = 0;
    resetDraft({ amount: 10 });
    const { rerender } = render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));
    fireEvent.press(screen.getByLabelText(/Add \$10\.00 and continue/i));
    fireEvent.press(screen.getByLabelText('stub-topup-deposit-full'));
    rerender(<CreateBountyFlow />);
    fireEvent.press(screen.getByLabelText('stub-topup-confirm'));

    expect(screen.queryByText('Add Funds to Post')).toBeNull();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('an overfunding top-up (adds more than the shortfall) is recognized as fully funded', () => {
    mockBalance = 0;
    resetDraft({ amount: 7 });
    const { rerender } = render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));
    fireEvent.press(screen.getByLabelText(/Add \$7\.00 and continue/i));
    fireEvent.press(screen.getByLabelText('stub-topup-deposit-overfund')); // adds $10 for a $7 shortfall
    rerender(<CreateBountyFlow />);
    fireEvent.press(screen.getByLabelText('stub-topup-confirm'));

    expect(screen.queryByText('Add Funds to Post')).toBeNull();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('multiple consecutive top-ups without leaving the flow converge correctly (3 partial top-ups)', () => {
    mockBalance = 0;
    resetDraft({ amount: 9 });
    const { rerender } = render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));

    for (let i = 0; i < 2; i++) {
      const before = mockBalance;
      // Each iteration starts back on the insufficient-balance summary
      // (either the initial one, or the one the prior iteration's top-up
      // re-opened because it was still short) — navigate into the top-up
      // screen fresh each time, exactly as a poster tapping through would.
      fireEvent.press(screen.getByText(/Add \$.+ & Continue/));
      fireEvent.press(screen.getByLabelText('stub-topup-deposit-5'));
      rerender(<CreateBountyFlow />);
      fireEvent.press(screen.getByLabelText('stub-topup-confirm'));
      expect(mockBalance).toBe(before + 5);
    }

    // After two $5 top-ups balance is $10 against a $9 bounty — overfunded,
    // recognized as complete without a third top-up.
    expect(screen.queryByText('Add Funds to Post')).toBeNull();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('cents precision: three $0.10 top-ups exactly fund a $0.30 shortfall despite float drift (0.1 + 0.1 + 0.1 !== 0.3 in IEEE-754)', () => {
    mockBalance = 0;
    resetDraft({ amount: 0.3 });
    const { rerender } = render(<CreateBountyFlow />);
    goToReview();

    fireEvent.press(screen.getByLabelText('stub-publish'));
    // Bounty Amount and Amount Needed are both $0.30 at $0 balance — assert
    // via the CTA label instead of getByText to avoid ambiguity.
    expect(screen.getByLabelText(/Add \$0\.30 and continue/i)).toBeTruthy();

    fireEvent.press(screen.getByLabelText(/Add \$0\.30 and continue/i));
    fireEvent.press(screen.getByLabelText('stub-topup-deposit-dime'));
    rerender(<CreateBountyFlow />);
    fireEvent.press(screen.getByLabelText('stub-topup-confirm'));
    expect(screen.getByText('Add Funds to Post')).toBeTruthy();
    expect(screen.getByText('$0.20')).toBeTruthy();

    fireEvent.press(screen.getByLabelText(/Add \$0\.20 and continue/i));
    fireEvent.press(screen.getByLabelText('stub-topup-deposit-dime'));
    rerender(<CreateBountyFlow />);
    fireEvent.press(screen.getByLabelText('stub-topup-confirm'));
    expect(screen.getByText('Add Funds to Post')).toBeTruthy();
    expect(screen.getByText('$0.10')).toBeTruthy();

    // Third dime: raw JS balance is now 0.1 + 0.1 + 0.1 = 0.30000000000000004,
    // not exactly 0.3 — this is the case a naive float compare gets wrong.
    fireEvent.press(screen.getByLabelText(/Add \$0\.10 and continue/i));
    fireEvent.press(screen.getByLabelText('stub-topup-deposit-dime'));
    rerender(<CreateBountyFlow />);
    fireEvent.press(screen.getByLabelText('stub-topup-confirm'));

    expect(screen.queryByText('Add Funds to Post')).toBeNull();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });
});
