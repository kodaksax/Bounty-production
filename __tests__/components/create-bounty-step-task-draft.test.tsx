/**
 * SBA-03: step 1's "What exactly, and when?" answer is the bounty description.
 * This drives the REAL StepTask and the REAL useBountyDraft (over an in-memory
 * storage) through the composer, to prove the answer survives what drafts
 * have always survived: going on to step 2 and back, and leaving and
 * returning to the composer. It also checks a template tap no longer
 * advances on its own. Later steps are stubbed.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo } from 'react-native';

(AccessibilityInfo as unknown as { announceForAccessibility: jest.Mock }).announceForAccessibility =
  jest.fn();

const mockStore = new Map<string, string>();
jest.mock('lib/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockStore.delete(k);
    }),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));
jest.mock('hooks/useBackHandler', () => ({ useBackHandler: jest.fn() }));
jest.mock('hooks/use-auth-context', () => ({
  useAuthContext: jest.fn(() => ({ session: { access_token: 'token', user: { id: 'poster-1' } } })),
}));
jest.mock('hooks/use-email-verification', () => ({
  useEmailVerification: jest.fn(() => ({
    isEmailVerified: true,
    canPostBounties: true,
    userEmail: 'poster@example.com',
  })),
}));
jest.mock('lib/wallet-context', () => ({
  useWallet: jest.fn(() => ({ balance: 0, createEscrow: jest.fn() })),
}));
jest.mock('lib/stripe-context', () => ({
  useStripe: jest.fn(() => ({ paymentMethods: [] })),
}));
jest.mock('lib/utils/payment-architecture', () => ({
  shouldFundNewBountiesWithPhase2: jest.fn(() => false),
  shouldUseStripeNativeFunding: jest.fn(() => false),
}));
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
jest.mock('app/services/bountyService', () => ({
  bountyService: { createBounty: jest.fn(), deleteBounty: jest.fn(), updateBountyDetails: jest.fn() },
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
jest.mock('app/screens/CreateBounty/PublishFundingGate', () => ({
  PublishFundingGate: () => null,
}));
jest.mock('app/screens/CreateBounty/quick/StepWhere', () => ({
  StepWhere: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepWhere</Text>
        <TouchableOpacity accessibilityLabel="stub-where-back" onPress={props.onBack}>
          <Text>Back</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepPay', () => ({ StepPay: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepPhotos', () => ({ StepPhotos: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepWhen', () => ({ StepWhen: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepPostPublish', () => ({ StepPostPublish: () => null }));
jest.mock('app/screens/CreateBounty/quick/PostCelebration', () => ({ PostCelebration: () => null }));

import { CreateBountyFlow } from 'app/screens/CreateBounty';

const DETAIL_LABEL = 'What exactly, and when?';
const DETAIL = 'One 30-minute walk for a friendly lab, Saturday morning';

const savedDraft = () => JSON.parse(mockStore.get('bounty-draft-v1:poster-1') ?? '{}');

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('step 1 details in the composer draft', () => {
  it('a template tap stays on step 1; the details persist through Next, Back and a remount', async () => {
    const first = render(<CreateBountyFlow entryPoint="test" />);
    await waitFor(() => expect(screen.getByLabelText('Walk my dog, suggested $20')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Walk my dog, suggested $20'));
    await waitFor(() => expect(savedDraft().title).toBe('Walk my dog'));

    // Still on step 1, with Next held until the details are written.
    expect(screen.queryByText('StepWhere')).toBeNull();
    expect(screen.getByLabelText('Next').props.accessibilityState).toEqual({ disabled: true });

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(DETAIL_LABEL), DETAIL);
    });
    await waitFor(() => expect(savedDraft().description).toBe(DETAIL));
    expect(screen.getByLabelText('Next').props.accessibilityState).toEqual({ disabled: false });

    fireEvent.press(screen.getByLabelText('Next'));
    await waitFor(() => expect(screen.getByText('StepWhere')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('stub-where-back'));
    await waitFor(() => expect(screen.getByLabelText(DETAIL_LABEL).props.value).toBe(DETAIL));

    // Leave the composer and come back: the draft resumes with the details.
    first.unmount();
    render(<CreateBountyFlow entryPoint="test" />);
    await waitFor(() => expect(screen.getByLabelText(DETAIL_LABEL).props.value).toBe(DETAIL));
    expect(screen.getByLabelText('What do you need done?').props.value).toBe('Walk my dog');
  });
});
