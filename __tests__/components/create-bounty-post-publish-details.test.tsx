/**
 * Integration tests for the two-step posting flow's post-publish phase
 * (app/screens/CreateBounty/index.tsx).
 *
 * The bounty is already live by the time StepPostPublish renders, so photos,
 * details, location and date are written onto the real row by
 * bountyService.updateBountyDetails. This suite covers the handoff between the
 * detail screens and that write:
 *
 *  - a screen that patches and advances in the SAME tick (StepWhere does
 *    exactly this: geocode the typed address, then continue) must still have
 *    its last patch persisted — reading `detailDraft` from React state at that
 *    point yields the pre-patch value, which silently dropped the coordinates
 *  - several patches dispatched in one tick (the upload hook calls onUploaded
 *    once per photo, synchronously) must all survive
 *  - a failed write must leave the poster on the detail screen with their
 *    edits intact, never report a save that did not happen
 *
 * The step screens themselves are stubbed so the assertions are about the
 * orchestrator's state machine, not each screen's internal UI.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

// ---- controllable test state ----

const mockDraft: any = {
  title: 'Move a couch',
  description: '',
  amount: 0,
  isForHonor: true,
  category: 'errands',
  workType: 'in_person',
  location: '',
  attachments: [],
};

// ---- module mocks ----

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
  useWallet: jest.fn(() => ({ balance: 0, createEscrow: jest.fn() })),
}));

jest.mock('lib/stripe-context', () => ({
  useStripe: jest.fn(() => ({ paymentMethods: [{ id: 'pm_test' }] })),
}));

jest.mock('lib/utils/payment-architecture', () => ({
  shouldFundNewBountiesWithPhase2: jest.fn(() => false),
  shouldUseStripeNativeFunding: jest.fn(() => false),
}));

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('app/services/bountyService', () => ({
  bountyService: {
    createBounty: jest.fn(),
    deleteBounty: jest.fn(),
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
  stripeService: { confirmPaymentSecure: jest.fn() },
}));

// The funding gate pulls in AddMoneyScreen -> expo-image, which needs native
// modules this environment doesn't have. A for-honor bounty never reaches the
// gate, so stub the whole module out. Its behavior is covered by
// create-bounty-flow-insufficient-balance.test.tsx.
jest.mock('app/screens/CreateBounty/PublishFundingGate', () => ({
  PublishFundingGate: () => {
    const { Text } = require('react-native');
    return <Text>PublishFundingGate</Text>;
  },
}));

// Step stubs. Each exposes the same props CreateBountyFlow passes in real
// usage; the "where" and "photos" stubs deliberately reproduce their real
// screens' patch-then-advance timing.
jest.mock('app/screens/CreateBounty/quick/StepTask', () => ({
  StepTask: (props: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="stub-task-next" onPress={props.onNext}>
        <Text>StepTask</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('app/screens/CreateBounty/quick/StepPay', () => ({
  StepPay: (props: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="stub-publish" onPress={props.onNext}>
        <Text>StepPay</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('app/screens/CreateBounty/quick/StepPostPublish', () => ({
  StepPostPublish: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepPostPublish</Text>
        {/* Renders the summary the poster actually sees, so a save that
            didn't land can't masquerade as one that did. */}
        <Text accessibilityLabel="summary-photos">
          {`photos:${props.draft.attachments?.length ?? 0}`}
        </Text>
        <Text accessibilityLabel="summary-coords">
          {`coords:${props.draft.latitude ?? 'none'}`}
        </Text>
        <TouchableOpacity
          accessibilityLabel="stub-add-where"
          onPress={() => props.onAddDetail('where')}
        >
          <Text>Add location</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="stub-add-photos"
          onPress={() => props.onAddDetail('photos')}
        >
          <Text>Add photos</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

jest.mock('app/screens/CreateBounty/quick/StepWhere', () => ({
  StepWhere: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepWhere</Text>
        <TouchableOpacity
          accessibilityLabel="stub-where-continue"
          onPress={() => {
            // The real screen forward-geocodes the typed address and then
            // advances, both inside one handler.
            props.onUpdate({
              workType: 'in_person',
              location: '123 Main St, Baltimore, MD',
              latitude: 39.29,
              longitude: -76.61,
              neighborhood: 'Federal Hill',
            });
            props.onNext();
          }}
        >
          <Text>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

jest.mock('app/screens/CreateBounty/quick/StepPhotos', () => ({
  StepPhotos: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepPhotos</Text>
        <TouchableOpacity
          accessibilityLabel="stub-photos-continue"
          onPress={() => {
            // Two uploads land back-to-back in the same tick, then the
            // description edit, then Continue — no render in between.
            props.onUpdate({ attachments: [{ id: 'a1', name: 'one.jpg', uri: 'file:///1' }] });
            props.onUpdate({
              attachments: [
                { id: 'a1', name: 'one.jpg', uri: 'file:///1' },
                { id: 'a2', name: 'two.jpg', uri: 'file:///2' },
              ],
            });
            props.onUpdate({ description: 'Third floor walk-up' });
            props.onNext();
          }}
        >
          <Text>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

jest.mock('app/screens/CreateBounty/quick/StepWhen', () => ({
  StepWhen: (props: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="stub-when-continue" onPress={props.onNext}>
        <Text>StepWhen</Text>
      </TouchableOpacity>
    );
  },
}));

import { CreateBountyFlow } from 'app/screens/CreateBounty';
import { bountyService } from 'app/services/bountyService';

const mockedService = bountyService as jest.Mocked<typeof bountyService>;

/** Runs the pre-publish steps and leaves the flow on StepPostPublish. */
async function publishThenReachConfirmation() {
  render(<CreateBountyFlow entryPoint="test" />);
  fireEvent.press(screen.getByLabelText('stub-task-next'));
  await act(async () => {
    fireEvent.press(screen.getByLabelText('stub-publish'));
  });
  await waitFor(() => expect(screen.getByText('StepPostPublish')).toBeTruthy());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedService.createBounty.mockResolvedValue({
    bounty: { id: 'bounty-1' } as any,
    created: true,
  });
  mockedService.updateBountyDetails.mockResolvedValue({ id: 'bounty-1' } as any);
});

describe('post-publish detail saves', () => {
  it('persists a patch applied in the same tick as Continue (geocoded location)', async () => {
    await publishThenReachConfirmation();

    fireEvent.press(screen.getByLabelText('stub-add-where'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('stub-where-continue'));
    });

    expect(mockedService.updateBountyDetails).toHaveBeenCalledWith(
      'bounty-1',
      expect.objectContaining({
        location: '123 Main St, Baltimore, MD',
        latitude: 39.29,
        longitude: -76.61,
        neighborhood: 'Federal Hill',
      })
    );

    // ...and the confirmation screen reflects what was saved.
    await waitFor(() => expect(screen.getByLabelText('summary-coords').props.children).toBe('coords:39.29'));
  });

  it('keeps every patch dispatched in one tick (multi-photo upload + details)', async () => {
    await publishThenReachConfirmation();

    fireEvent.press(screen.getByLabelText('stub-add-photos'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('stub-photos-continue'));
    });

    const savedDraft = mockedService.updateBountyDetails.mock.calls[0][1];
    expect(savedDraft.attachments).toHaveLength(2);
    expect(savedDraft.description).toBe('Third floor walk-up');

    await waitFor(() => expect(screen.getByLabelText('summary-photos').props.children).toBe('photos:2'));
  });

  it('carries the published draft into the update, not just the edited field', async () => {
    await publishThenReachConfirmation();

    fireEvent.press(screen.getByLabelText('stub-add-where'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('stub-where-continue'));
    });

    expect(mockedService.updateBountyDetails.mock.calls[0][1]).toEqual(
      expect.objectContaining({ title: 'Move a couch', isForHonor: true })
    );
  });

  it('keeps the poster on the detail screen when the write fails', async () => {
    mockedService.updateBountyDetails.mockRejectedValue(new Error('network down'));
    await publishThenReachConfirmation();

    fireEvent.press(screen.getByLabelText('stub-add-photos'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('stub-photos-continue'));
    });

    // Still on StepPhotos, and the confirmation summary was never advanced to
    // a state the bounty row is not actually in.
    expect(screen.getByText('StepPhotos')).toBeTruthy();
    expect(screen.queryByText('StepPostPublish')).toBeNull();
  });

  it('retries a failed save from the same screen without losing the edits', async () => {
    mockedService.updateBountyDetails.mockRejectedValueOnce(new Error('network down'));
    await publishThenReachConfirmation();

    fireEvent.press(screen.getByLabelText('stub-add-photos'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('stub-photos-continue'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('stub-photos-continue'));
    });

    const retryDraft = mockedService.updateBountyDetails.mock.calls[1][1];
    expect(retryDraft.attachments).toHaveLength(2);
    expect(retryDraft.description).toBe('Third floor walk-up');
    await waitFor(() => expect(screen.getByText('StepPostPublish')).toBeTruthy());
  });
});
