/**
 * The Oct 14 report, end to end: a poster reaches the price step, leaves
 * through the tab bar, and comes back. NeedHelpScreen remounts the composer
 * when the Post tab stops being the settled tab (its flowKey), which used to
 * restart it at step 1 on every return.
 *
 * Runs the REAL NeedHelpScreen, CreateBountyFlow and useBountyDraft over an
 * in-memory storage per device and one fake bounty_drafts server. Step screens
 * are stubs that patch the draft the way the real ones do before Continue.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

type Copy = { draft: any; lastStep: number; updatedAt: string | null };

const mockDevices: Record<string, Map<string, string>> = { phone: new Map(), tablet: new Map() };
let mockDevice: 'phone' | 'tablet' = 'phone';
const mockServer = new Map<string, Copy>();

jest.mock('lib/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => mockDevices[mockDevice].get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockDevices[mockDevice].set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockDevices[mockDevice].delete(k);
    }),
  },
}));

jest.mock('lib/services/bounty-draft-sync', () => {
  const actual = jest.requireActual('lib/services/bounty-draft-sync');
  return {
    ...actual,
    fetchServerDraft: jest.fn(async (userId: string) => ({
      status: 'ok',
      copy: mockServer.has(userId) ? JSON.parse(JSON.stringify(mockServer.get(userId))) : null,
    })),
    scheduleServerDraftUpsert: jest.fn((userId: string, copy: Copy, onSynced?: (at: string) => void) => {
      mockServer.set(userId, JSON.parse(JSON.stringify(copy)));
      if (copy.updatedAt) onSynced?.(copy.updatedAt);
    }),
    flushServerDraftUpsert: jest.fn(async () => {}),
    cancelServerDraftUpsert: jest.fn(),
    deleteServerDraft: jest.fn(async (userId: string) => {
      mockServer.delete(userId);
      return true;
    }),
  };
});

jest.mock('lib/services/draft-reminder', () => ({
  cancelDraftReminder: jest.fn(async () => {}),
  scheduleDraftReminderSoon: jest.fn(),
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
jest.mock('app/screens/CreateBounty/quick/StepTask', () => ({
  StepTask: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepTask</Text>
        <TouchableOpacity
          accessibilityLabel="stub-task-continue"
          onPress={() => {
            props.onUpdate({
              title: 'Mount my TV',
              description: '55-inch TV on drywall, any weekday after 5pm',
            });
            props.onNext();
          }}
        >
          <Text>Next</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));
// Like the real StepWhere: geocode on Continue, patch the pin, then advance in
// the same tick.
jest.mock('app/screens/CreateBounty/quick/StepWhere', () => ({
  StepWhere: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepWhere</Text>
        <TouchableOpacity
          accessibilityLabel="stub-where-continue"
          onPress={() => {
            props.onUpdate({ location: '123 Main St', latitude: 40.7128, longitude: -74.006 });
            props.onNext();
          }}
        >
          <Text>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepPay', () => ({
  StepPay: () => {
    const { Text } = require('react-native');
    return <Text>How much will you pay?</Text>;
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepPhotos', () => ({ StepPhotos: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepWhen', () => ({ StepWhen: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepPostPublish', () => ({ StepPostPublish: () => null }));
jest.mock('app/screens/CreateBounty/quick/PostCelebration', () => ({ PostCelebration: () => null }));

import { NeedHelpScreen } from 'app/tabs/need-help-screen';
import { analyticsService } from 'lib/services/analytics-service';

const trackEvent = analyticsService.trackEvent as jest.Mock;
const restoredEvents = () =>
  trackEvent.mock.calls
    .filter(c => c[0] === 'post_resume_prompt' && c[1].action === 'restored')
    .map(c => c[1]);

function PostTab({ isActive }: { isActive: boolean }) {
  return <NeedHelpScreen activeScreen="postings" setActiveScreen={jest.fn()} isActive={isActive} />;
}

async function reachPriceStep() {
  await waitFor(() => expect(screen.getByText('StepTask')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('stub-task-continue'));
  await waitFor(() => expect(screen.getByText('StepWhere')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('stub-where-continue'));
  await waitFor(() => expect(screen.getByText('How much will you pay?')).toBeTruthy());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDevices.phone.clear();
  mockDevices.tablet.clear();
  mockServer.clear();
  mockDevice = 'phone';
});

describe('Post tab: leave and come back', () => {
  it('price step → switch tab → return: still on the price step', async () => {
    const view = render(<PostTab isActive />);
    await reachPriceStep();

    // Leave through the tab bar: the shell marks Post inactive, which bumps
    // NeedHelpScreen's flowKey and remounts the composer.
    view.rerender(<PostTab isActive={false} />);
    await act(async () => {});
    // Back to Post.
    view.rerender(<PostTab isActive />);

    await waitFor(() => expect(screen.getByText('How much will you pay?')).toBeTruthy());
    expect(screen.queryByText('StepTask')).toBeNull();
    expect(screen.getByText('Picking up where you left off')).toBeTruthy();
    expect(restoredEvents()).toEqual([
      expect.objectContaining({ to_step: 3, to_step_name: 'Compensation', draft_source: 'local' }),
    ]);
  });

  it('stays on the price step across three returns in a row', async () => {
    const view = render(<PostTab isActive />);
    await reachPriceStep();

    for (let i = 0; i < 3; i++) {
      view.rerender(<PostTab isActive={false} />);
      await act(async () => {});
      view.rerender(<PostTab isActive />);
      await waitFor(() => expect(screen.getByText('How much will you pay?')).toBeTruthy());
    }
    expect(restoredEvents()).toHaveLength(3);
  });
});

describe('another device', () => {
  it('a draft started on the phone opens on the tablet after sign-in, on the price step', async () => {
    mockDevice = 'phone';
    const phone = render(<PostTab isActive />);
    await reachPriceStep();
    phone.unmount();

    mockDevice = 'tablet'; // fresh device: nothing in its storage
    render(<PostTab isActive />);

    await waitFor(() => expect(screen.getByText('How much will you pay?')).toBeTruthy());
    expect(screen.getByText('Picking up where you left off')).toBeTruthy();
    expect(restoredEvents()).toEqual([
      expect.objectContaining({ to_step: 3, draft_source: 'server' }),
    ]);
  });
});
