/**
 * The "Continue your post" prompt (app/screens/CreateBounty/ResumeDraftBanner,
 * wired in app/screens/CreateBounty/index.tsx).
 *
 * Leaving the Post tab resets the composer to step 1, so a poster returning to
 * a draft that had got further lands on a pre-filled title with no sign of how
 * far they were. These tests pin when the prompt appears, where Continue lands,
 * and that the jump doesn't masquerade as completed steps in the funnel.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

const COMPLETE_TASK = {
  title: 'Mount my TV',
  description: '55-inch TV on drywall, any weekday after 5pm',
};

let mockDraft: any;

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
  useWallet: jest.fn(() => ({ balance: 100, createEscrow: jest.fn() })),
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

jest.mock('hooks/useFormSubmission', () => ({
  useFormSubmission: jest.fn(() => ({
    submit: jest.fn(),
    isSubmitting: false,
    error: null,
    reset: jest.fn(),
  })),
}));

jest.mock('app/screens/CreateBounty/quick/StepTask', () => ({
  StepTask: (props: any) => {
    const { TouchableOpacity, Text, TextInput, View } = require('react-native');
    return (
      <View>
        <TextInput
          accessibilityLabel="stub-title-input"
          onChangeText={(t: string) => props.onUpdate({ title: t })}
          onFocus={() => props.onFieldFocus?.('title')}
        />
        <TouchableOpacity accessibilityLabel="stub-next" onPress={props.onNext}>
          <Text>StepTask</Text>
        </TouchableOpacity>
        {props.onClose && (
          <TouchableOpacity accessibilityLabel="stub-close" onPress={props.onClose}>
            <Text>Close</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepWhere', () => ({
  StepWhere: () => {
    const { Text } = require('react-native');
    return <Text>StepWhere</Text>;
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepPay', () => ({
  StepPay: () => {
    const { Text } = require('react-native');
    return <Text>StepPay</Text>;
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepPhotos', () => ({ StepPhotos: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepWhen', () => ({ StepWhen: () => null }));
jest.mock('app/screens/CreateBounty/quick/PostCelebration', () => ({ PostCelebration: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepPostPublish', () => ({ StepPostPublish: () => null }));
jest.mock('components/add-money-screen', () => ({ AddMoneyScreen: () => null }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CreateBountyFlow } from 'app/screens/CreateBounty/index';
import { analyticsService } from 'lib/services/analytics-service';

const trackEvent = analyticsService.trackEvent as jest.Mock;

function promptEvents() {
  return trackEvent.mock.calls.filter(c => c[0] === 'post_resume_prompt').map(c => c[1]);
}

function eventsNamed(name: string) {
  return trackEvent.mock.calls.filter(c => c[0] === name).map(c => c[1]);
}

const draftWith = (overrides: Record<string, unknown> = {}) => ({
  ...COMPLETE_TASK,
  amount: 0,
  isForHonor: false,
  category: 'labor',
  location: '',
  workType: 'in_person',
  attachments: [],
  ...overrides,
});

describe('CreateBountyFlow — "Continue your post" prompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDraft = draftWith();
  });

  it('offers Location for a finished task with no pinned address', () => {
    mockDraft = draftWith({ location: '123 Main St' });
    render(<CreateBountyFlow />);

    expect(screen.getByTestId('resume-draft-banner')).toBeTruthy();
    expect(screen.getByText(/Add the location next/)).toBeTruthy();
    expect(promptEvents()).toEqual([
      expect.objectContaining({ action: 'shown', to_step: 2, to_step_name: 'Location' }),
    ]);

    fireEvent.press(screen.getByTestId('resume-draft-continue'));
    expect(screen.getByText('StepWhere')).toBeTruthy();
    expect(screen.queryByTestId('resume-draft-banner')).toBeNull();
  });

  it('jumps a pinned draft straight to Compensation', () => {
    mockDraft = draftWith({ location: '123 Main St', latitude: 40.7, longitude: -74 });
    render(<CreateBountyFlow />);

    expect(screen.getByText(/Set the reward next/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('resume-draft-continue'));

    expect(screen.getByText('StepPay')).toBeTruthy();
    expect(promptEvents()[1]).toMatchObject({ action: 'continued', to_step: 3 });
    expect(eventsNamed('bounty_started')).toEqual([
      expect.objectContaining({ trigger: 'resume', resumed_draft: true }),
    ]);
    // Skipped, not completed, in this visit.
    expect(eventsNamed('post_step_completed')).toEqual([]);
  });

  it('stays quiet for a draft still unfinished on step 1', () => {
    mockDraft = draftWith({ description: 'too short' });
    render(<CreateBountyFlow />);

    expect(screen.queryByTestId('resume-draft-banner')).toBeNull();
    expect(promptEvents()).toEqual([]);
  });

  it('stays quiet with no draft', () => {
    mockDraft = draftWith({ title: '', description: '' });
    render(<CreateBountyFlow />);

    expect(screen.queryByTestId('resume-draft-banner')).toBeNull();
  });

  it('waits until a preloaded flow becomes active', () => {
    const { rerender } = render(<CreateBountyFlow isActive={false} />);
    expect(screen.queryByTestId('resume-draft-banner')).toBeNull();
    expect(promptEvents()).toEqual([]);

    rerender(<CreateBountyFlow isActive />);
    expect(screen.getByTestId('resume-draft-banner')).toBeTruthy();
    expect(promptEvents()).toHaveLength(1);
  });

  it('dismisses to step 1 with the draft left alone', () => {
    render(<CreateBountyFlow />);

    fireEvent.press(screen.getByTestId('resume-draft-dismiss'));

    expect(screen.queryByTestId('resume-draft-banner')).toBeNull();
    expect(screen.getByText('StepTask')).toBeTruthy();
    expect(promptEvents()[1]).toMatchObject({ action: 'dismissed', to_step: 2 });
  });

  it('gets out of the way once the poster works on step 1', () => {
    render(<CreateBountyFlow />);

    fireEvent(screen.getByLabelText('stub-title-input'), 'focus');

    expect(screen.queryByTestId('resume-draft-banner')).toBeNull();
    // Neither continued nor dismissed — the "ignored" bucket.
    expect(promptEvents()).toHaveLength(1);
  });

  it('goes away when the poster advances with Next themselves', () => {
    render(<CreateBountyFlow />);

    fireEvent.press(screen.getByLabelText('stub-next'));
    expect(screen.getByText('StepWhere')).toBeTruthy();
    // A normal advance is still a completed step.
    expect(eventsNamed('post_step_completed')).toEqual([
      expect.objectContaining({ step_index: 1 }),
    ]);
  });
});

// The app-open prompt's trigger (lib/storage/abandoned-draft.ts): a tab
// switch away from an unfinished draft flags it; other exits don't.
describe('CreateBountyFlow — abandoned-draft flag', () => {
  const ABANDONED_KEY = '@bounty_abandoned_draft:poster-1';
  const flagWrites = () =>
    (AsyncStorage.setItem as jest.Mock).mock.calls.filter(c => c[0] === ABANDONED_KEY);

  beforeEach(() => {
    jest.clearAllMocks();
    mockDraft = draftWith();
  });

  it('flags a draft left by switching tabs', () => {
    const { unmount } = render(<CreateBountyFlow />);
    unmount();

    expect(eventsNamed('post_step_abandoned')).toEqual([
      expect.objectContaining({ exit_method: 'tab' }),
    ]);
    expect(flagWrites()).toHaveLength(1);
  });

  it('does not flag a tab switch with no draft', () => {
    mockDraft = draftWith({ title: '', description: '' });
    const { unmount } = render(<CreateBountyFlow />);
    unmount();

    expect(flagWrites()).toHaveLength(0);
  });

  it('does not flag closing the composer', () => {
    const { unmount } = render(<CreateBountyFlow onCancel={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('stub-close'));
    unmount();

    expect(eventsNamed('post_step_abandoned')).toEqual([
      expect.objectContaining({ exit_method: 'close' }),
    ]);
    expect(flagWrites()).toHaveLength(0);
  });
});
