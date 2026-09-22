/**
 * CreateBountyFlow under the $1 posting-fee experiment
 * (app/screens/CreateBounty/index.tsx + useBountyPublish.ts).
 *
 * This suite runs the REAL publish path (useFormSubmission and
 * useBountyPublish are not stubbed) so it can assert on what actually reaches
 * `bountyService.createBounty` and `createEscrow`. That is the whole point:
 * the requirements this feature has to satisfy are statements about money
 * movement, and they are only checkable at that boundary.
 *
 * What is asserted, per requirement:
 *
 *   CONTROL IS UNTOUCHED        — no checkout, publishes straight through, and
 *                                 the reward is NOT charged or escrowed at
 *                                 posting (funding_mode stays at_accept).
 *   TREATMENT GATES ON PAYMENT  — the checkout shows, and NO bounty is created
 *                                 until the server has verified the charge.
 *   FEE CHARGED EXACTLY ONCE    — a failed publish retried does not re-charge.
 *   NO EARLY REWARD LOCK        — a control bounty never escrows at post; a
 *                                 treatment bounty escrows only after payment.
 *   $0 / HONOR POSTS EXCLUDED   — they skip the checkout in both arms.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

// ---- controllable test state ----

let mockVariant: 'control' | 'fee' = 'control';
let mockVariantReady = true;
let mockDraft: any;
let mockPayResult = true;

const mockCreateBounty = jest.fn();
const mockDeleteBounty = jest.fn();
const mockCreateEscrow = jest.fn();
const mockTrackEvent = jest.fn();
const mockPay = jest.fn();

function resetDraft(overrides: Record<string, unknown> = {}) {
  mockDraft = {
    title: 'Assemble a desk',
    description: 'IKEA desk, hex key provided',
    amount: 50,
    isForHonor: false,
    category: 'errands',
    workType: 'in_person',
    attachments: [],
    ...overrides,
  };
}
resetDraft();

// ---- module mocks ----

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

jest.mock('hooks/useBackHandler', () => ({ useBackHandler: jest.fn() }));

jest.mock('app/hooks/useBountyDraft', () => ({
  useBountyDraft: jest.fn(() => ({
    draft: mockDraft,
    saveDraft: jest.fn(),
    clearDraft: jest.fn().mockResolvedValue(undefined),
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
  useWallet: jest.fn(() => ({ balance: 0, createEscrow: mockCreateEscrow })),
}));

jest.mock('lib/stripe-context', () => ({
  useStripe: jest.fn(() => ({ paymentMethods: [{ id: 'pm_test' }] })),
}));

jest.mock('lib/utils/payment-architecture', () => ({
  shouldFundNewBountiesWithPhase2: jest.fn(() => false),
  shouldUseStripeNativeFunding: jest.fn(() => false),
}));

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: unknown[]) => mockTrackEvent(...a) },
}));

jest.mock('app/services/bountyService', () => ({
  bountyService: {
    createBounty: (...a: unknown[]) => mockCreateBounty(...a),
    deleteBounty: (...a: unknown[]) => mockDeleteBounty(...a),
    updateBountyDetails: jest.fn(),
  },
}));

jest.mock('lib/services/bounty-payments-service', () => ({
  bountyPaymentsService: { createBountyPayment: jest.fn(), cancelBountyPayment: jest.fn() },
}));

jest.mock('lib/services/offline-queue-service', () => ({
  offlineQueueService: { getOnlineStatus: jest.fn(() => true) },
}));

jest.mock('lib/services/stripe-service', () => ({
  stripeService: { confirmPaymentSecure: jest.fn(), presentPaymentSheet: jest.fn() },
}));

// Deferred-funding eligibility: the server grants pay-at-accept for every
// paid v1 bounty today, so control's expected outcome is at_accept.
jest.mock('lib/services/bounty-funding-service', () => ({
  canDeferBountyFunding: jest.fn().mockResolvedValue(true),
  amountBucket: jest.fn(() => '25_100'),
}));

jest.mock('lib/analytics/lifecycle', () => ({
  markPosterActivated: jest.fn().mockResolvedValue(undefined),
}));

// The experiment arm, driven per test.
jest.mock('lib/experiments/posting-fee-variant', () => ({
  usePostingFeeVariant: () => ({ variant: mockVariant, ready: mockVariantReady }),
}));

// The checkout hook is stubbed here so this suite tests the COMPOSER's
// gating decisions. The hook's own charge-exactly-once state machine is
// covered directly in __tests__/unit/hooks/usePostingCheckout.test.tsx.
const ATTEMPT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
jest.mock('hooks/usePostingCheckout', () => ({
  usePostingCheckout: () => {
    const React = require('react');
    const [paid, setPaid] = React.useState(false);
    return {
      state: paid ? 'paid' : 'idle',
      isBusy: false,
      error: null,
      failureCode: null,
      prepaid: false,
      totals: { feeCents: 100, rewardCents: 5000, totalCents: 5100 },
      attemptId: ATTEMPT_ID,
      pay: async () => {
        mockPay();
        if (mockPayResult) setPaid(true);
        return mockPayResult;
      },
      reset: jest.fn(),
    };
  },
}));

// ---- step screen stubs ----

function stubStep(label: string, extra?: (props: any) => React.ReactNode) {
  return (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>{label}</Text>
        <TouchableOpacity accessibilityLabel={`${label}-next`} onPress={() => props.onNext?.()}>
          <Text>Next</Text>
        </TouchableOpacity>
        {extra?.(props)}
      </View>
    );
  };
}

jest.mock('app/screens/CreateBounty/quick/StepTask', () => ({
  StepTask: stubStep('StepTask'),
}));
jest.mock('app/screens/CreateBounty/quick/StepWhere', () => ({
  StepWhere: stubStep('StepWhere'),
}));
jest.mock('app/screens/CreateBounty/quick/StepWhen', () => ({
  StepWhen: stubStep('StepWhen'),
}));
jest.mock('app/screens/CreateBounty/quick/StepPhotos', () => ({
  StepPhotos: stubStep('StepPhotos'),
}));

jest.mock('app/screens/CreateBounty/quick/StepPay', () => ({
  StepPay: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepPay</Text>
        <TouchableOpacity
          accessibilityLabel="publish"
          onPress={() =>
            props.onNext({ amount: mockDraft.amount, isForHonor: mockDraft.isForHonor })
          }
        >
          <Text>Post Bounty</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

jest.mock('app/screens/CreateBounty/quick/StepCheckout', () => ({
  StepCheckout: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    React.useEffect(() => props.onShown?.(), []);
    return (
      <View>
        <Text>StepCheckout</Text>
        <Text>{`total:${props.totals.totalCents}`}</Text>
        <Text>{`fee:${props.totals.feeCents}`}</Text>
        <TouchableOpacity accessibilityLabel="pay" onPress={props.onPay}>
          <Text>Pay</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel="checkout-back" onPress={props.onBack}>
          <Text>Back</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

jest.mock('app/screens/CreateBounty/quick/StepPostPublish', () => ({
  StepPostPublish: (props: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="finish" onPress={props.onContinue}>
        <Text>StepPostPublish</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('app/screens/CreateBounty/PublishFundingGate', () => ({
  PublishFundingGate: () => {
    const { Text } = require('react-native');
    return <Text>PublishFundingGate</Text>;
  },
}));

import { CreateBountyFlow } from 'app/screens/CreateBounty/index';

// ---- helpers ----

/** Walk the composer from step 1 to the amount step. */
async function advanceToAmountStep() {
  fireEvent.press(screen.getByLabelText('StepTask-next'));
  fireEvent.press(await screen.findByLabelText('StepWhere-next'));
  await screen.findByText('StepPay');
}

/** The options object `createBounty` was called with. */
function createBountyOptions() {
  return mockCreateBounty.mock.calls[0]?.[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  resetDraft();
  mockVariant = 'control';
  mockVariantReady = true;
  mockPayResult = true;
  mockCreateEscrow.mockResolvedValue(undefined);
  // Mirrors production: the server grants pay-at-accept unless the bounty was
  // prepaid, in which case it honours at_post.
  mockCreateBounty.mockImplementation(async (_draft: any, options: any) => ({
    bounty: {
      id: 'bounty-1',
      funding_mode: options?.postingCheckoutAttemptId ? 'at_post' : 'at_accept',
    },
    created: true,
  }));
});

describe('control arm is untouched', () => {
  it('publishes straight from the amount step with no checkout', async () => {
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();

    fireEvent.press(screen.getByLabelText('publish'));

    await waitFor(() => expect(mockCreateBounty).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('StepCheckout')).toBeNull();
    expect(mockPay).not.toHaveBeenCalled();
  });

  it('does NOT charge or escrow the bounty reward at posting', async () => {
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));

    await waitFor(() => expect(mockCreateBounty).toHaveBeenCalledTimes(1));

    // The deferred-acceptance model, unchanged: asks for at_accept, sends no
    // prepaid claim, and never reserves escrow at post time.
    // The prepaid key is absent entirely, not null — a control publish calls
    // createBounty with exactly the options it did before this feature existed.
    expect(createBountyOptions()).toEqual({ fundingMode: 'at_accept' });
    expect(mockCreateEscrow).not.toHaveBeenCalled();
  });

  it('reports the bounty as live and unfunded', async () => {
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));

    await waitFor(() => expect(mockCreateBounty).toHaveBeenCalled());

    const unfunded = mockTrackEvent.mock.calls.find(c => c[0] === 'bounty_posted_unfunded');
    expect(unfunded).toBeDefined();
    expect(unfunded![1]).toMatchObject({ fundingMode: 'at_accept' });

    const published = mockTrackEvent.mock.calls.find(c => c[0] === 'bounty_published');
    expect(published![1]).toMatchObject({
      posting_fee_variant: 'control',
      prepaid: false,
      posting_fee_cents: 0,
      funded: false,
    });
  });
});

describe('treatment arm gates publishing on payment', () => {
  beforeEach(() => {
    mockVariant = 'fee';
  });

  it('shows the itemised checkout instead of publishing', async () => {
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();

    fireEvent.press(screen.getByLabelText('publish'));

    expect(await screen.findByText('StepCheckout')).toBeTruthy();
    expect(screen.getByText('total:5100')).toBeTruthy();
    expect(screen.getByText('fee:100')).toBeTruthy();
    // The critical assertion: nothing was created by merely reaching checkout.
    expect(mockCreateBounty).not.toHaveBeenCalled();
  });

  it('creates the bounty only after the charge is verified', async () => {
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));
    await screen.findByText('StepCheckout');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('pay'));
    });

    await waitFor(() => expect(mockCreateBounty).toHaveBeenCalledTimes(1));
    expect(mockPay).toHaveBeenCalledTimes(1);
    // Funds at post, under a verified prepaid claim.
    expect(createBountyOptions()).toMatchObject({
      fundingMode: 'at_post',
      postingCheckoutAttemptId: ATTEMPT_ID,
    });
  });

  it('creates NO bounty when the payment fails', async () => {
    mockPayResult = false;
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));
    await screen.findByText('StepCheckout');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('pay'));
    });

    expect(mockPay).toHaveBeenCalledTimes(1);
    // Blocking, as specified: no fee, no post.
    expect(mockCreateBounty).not.toHaveBeenCalled();
    // And the poster is still on the checkout, able to retry.
    expect(screen.getByText('StepCheckout')).toBeTruthy();
  });

  it('retries after a failed payment without creating a bounty', async () => {
    mockPayResult = false;
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));
    await screen.findByText('StepCheckout');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('pay'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('pay'));
    });

    expect(mockPay).toHaveBeenCalledTimes(2);
    expect(mockCreateBounty).not.toHaveBeenCalled();
  });

  it('escrows the reward at post, and reports it as funded and prepaid', async () => {
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));
    await screen.findByText('StepCheckout');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('pay'));
    });
    await waitFor(() => expect(mockCreateBounty).toHaveBeenCalled());

    // A prepaid bounty is funded at insert, so it must NOT be reported as
    // "posted unfunded" — that event drives the pay-at-accept funnel.
    expect(mockTrackEvent.mock.calls.find(c => c[0] === 'bounty_posted_unfunded')).toBeUndefined();

    const escrow = mockTrackEvent.mock.calls.find(c => c[0] === 'escrow_funded');
    expect(escrow![1]).toMatchObject({ timing: 'at_post', prepaid: true });

    const published = mockTrackEvent.mock.calls.find(c => c[0] === 'bounty_published');
    expect(published![1]).toMatchObject({
      posting_fee_variant: 'fee',
      prepaid: true,
      posting_fee_cents: 100,
      funded: true,
    });
  });

  it('never routes a paid poster to the insufficient-balance gate', async () => {
    // Wallet balance is 0 in this suite. The reward was credited server-side at
    // settle, so the local balance is necessarily stale — a gate here would
    // ask a poster who just paid $51 to add funds.
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));
    await screen.findByText('StepCheckout');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('pay'));
    });

    await waitFor(() => expect(mockCreateBounty).toHaveBeenCalled());
    expect(screen.queryByText('PublishFundingGate')).toBeNull();
    expect(
      mockTrackEvent.mock.calls.find(c => c[0] === 'post_amount_blocked_by_balance')
    ).toBeUndefined();
  });

  it('emits the checkout-shown funnel event with the arm and the split', async () => {
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));
    await screen.findByText('StepCheckout');

    const shown = mockTrackEvent.mock.calls.find(c => c[0] === 'posting_checkout_shown');
    expect(shown![1]).toMatchObject({
      surface: 'create_flow',
      variant: 'fee',
      feeCents: 100,
      rewardCents: 5000,
      totalCents: 5100,
    });
  });

  it('records an abandon when the poster backs out unpaid', async () => {
    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));
    await screen.findByText('StepCheckout');

    fireEvent.press(screen.getByLabelText('checkout-back'));

    const abandoned = mockTrackEvent.mock.calls.find(c => c[0] === 'posting_checkout_abandoned');
    expect(abandoned![1]).toMatchObject({ trigger: 'back', variant: 'fee' });
    // Back returns to the amount step rather than exiting the flow.
    expect(await screen.findByText('StepPay')).toBeTruthy();
    expect(mockCreateBounty).not.toHaveBeenCalled();
  });
});

describe('eligibility', () => {
  it('skips the checkout for an honor ($0) post even in the treatment arm', async () => {
    mockVariant = 'fee';
    resetDraft({ amount: 0, isForHonor: true });

    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));

    await waitFor(() => expect(mockCreateBounty).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('StepCheckout')).toBeNull();
    expect(mockPay).not.toHaveBeenCalled();
  });

  it('runs control while the arm is still unresolved, rather than charging on a guess', async () => {
    mockVariant = 'fee';
    mockVariantReady = false;

    render(<CreateBountyFlow deliberateTap />);
    await advanceToAmountStep();
    fireEvent.press(screen.getByLabelText('publish'));

    await waitFor(() => expect(mockCreateBounty).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('StepCheckout')).toBeNull();
    expect(createBountyOptions()).toMatchObject({ fundingMode: 'at_accept' });
  });
});
