/**
 * Reopening a saved draft on its step (app/screens/CreateBounty/index.tsx +
 * ResumeDraftNote). Replaces the old dismissible "Continue your post" banner.
 *
 * Leaving the Post tab remounts the composer. It used to land on step 1 every
 * time. It now opens on the step saved with the draft (capped at the first
 * step the draft still has to finish) and says "Picking up where you left off"
 * with a "Start over" link. These tests drive the flow with a mocked draft
 * hook; the hook and the tab-shell remount are covered by
 * use-bounty-draft-sync.test.tsx and composer-tab-return.test.tsx.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

const COMPLETE_TASK = {
  title: 'Mount my TV',
  description: '55-inch TV on drywall, any weekday after 5pm',
};
const PIN = { location: '123 Main St', latitude: 40.7128, longitude: -74.006, zipCode: '10001' };

let mockDraft: any;
let mockLastStep: number;
let mockSource: 'local' | 'server' | null;
const mockSaveStep = jest.fn();
const mockClearDraft = jest.fn(async () => {});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

jest.mock('hooks/useBackHandler', () => ({
  useBackHandler: jest.fn(),
}));

jest.mock('app/hooks/useBountyDraft', () => ({
  useBountyDraft: jest.fn(() => ({
    draft: mockDraft,
    lastStep: mockLastStep,
    source: mockSource,
    saveDraft: jest.fn(),
    saveStep: mockSaveStep,
    clearDraft: mockClearDraft,
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
  StepWhere: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepWhere</Text>
        <TouchableOpacity accessibilityLabel="stub-where-next" onPress={props.onNext}>
          <Text>Next</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepPay', () => ({
  StepPay: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <Text>StepPay</Text>
        <TouchableOpacity accessibilityLabel="stub-pay-back" onPress={props.onBack}>
          <Text>Back</Text>
        </TouchableOpacity>
      </View>
    );
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

/** Press the destructive button of the most recent Alert. */
function confirmAlert(buttonText: string) {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1][2] as { text: string; onPress?: () => void }[];
  act(() => {
    buttons.find(b => b.text === buttonText)?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (Alert.alert as jest.Mock).mockImplementation(() => {});
  mockDraft = draftWith({ ...PIN });
  mockLastStep = 3;
  mockSource = 'local';
});

describe('CreateBountyFlow — reopens a saved draft on its step', () => {
  it('opens on the price step it was left on, with the note', () => {
    render(<CreateBountyFlow />);

    expect(screen.getByText('StepPay')).toBeTruthy();
    expect(screen.queryByText('StepTask')).toBeNull();
    expect(screen.getByTestId('resume-draft-note')).toBeTruthy();
    expect(screen.getByText('Picking up where you left off')).toBeTruthy();
    expect(screen.getByText('Start over')).toBeTruthy();
    expect(promptEvents()).toEqual([
      expect.objectContaining({
        surface: 'create_flow',
        action: 'restored',
        to_step: 3,
        to_step_name: 'Compensation',
        draft_source: 'local',
      }),
    ]);
    // Reopening is not intent, and skipping ahead is not completing steps.
    expect(eventsNamed('bounty_started')).toEqual([]);
    expect(eventsNamed('post_step_completed')).toEqual([]);
    expect(eventsNamed('post_step_viewed')).toEqual([
      expect.objectContaining({ step_index: 3, step_name: 'Compensation' }),
    ]);
    // Opening doesn't rewrite the saved step.
    expect(mockSaveStep).not.toHaveBeenCalled();
  });

  it('reports a copy that came from another device', () => {
    mockSource = 'server';
    render(<CreateBountyFlow />);
    expect(promptEvents()[0]).toMatchObject({ action: 'restored', draft_source: 'server' });
  });

  it('never opens past the first unfinished step (no pin yet: Location)', () => {
    mockDraft = draftWith({ location: '123 Main St' }); // typed, never geocoded
    mockLastStep = 3;
    render(<CreateBountyFlow />);

    expect(screen.getByText('StepWhere')).toBeTruthy();
    expect(promptEvents()[0]).toMatchObject({ to_step: 2, to_step_name: 'Location' });
  });

  it('opens on step 1 without a note when that is where the poster was', () => {
    mockLastStep = 1;
    render(<CreateBountyFlow />);

    expect(screen.getByText('StepTask')).toBeTruthy();
    expect(screen.queryByTestId('resume-draft-note')).toBeNull();
    expect(promptEvents()).toEqual([]);
  });

  it('opens on step 1 with no draft', () => {
    mockDraft = draftWith({ title: '', description: '' });
    render(<CreateBountyFlow />);

    expect(screen.getByText('StepTask')).toBeTruthy();
    expect(screen.queryByTestId('resume-draft-note')).toBeNull();
  });

  it('a preloaded flow is already on the step, but reports only once active', () => {
    const { rerender } = render(<CreateBountyFlow isActive={false} />);
    expect(screen.getByText('StepPay')).toBeTruthy();
    expect(promptEvents()).toEqual([]);

    rerender(<CreateBountyFlow isActive />);
    expect(promptEvents()).toHaveLength(1);
  });

  it('saves every step change, and the note goes once the poster moves', () => {
    render(<CreateBountyFlow />);

    fireEvent.press(screen.getByLabelText('stub-pay-back'));
    expect(screen.getByText('StepWhere')).toBeTruthy();
    expect(mockSaveStep).toHaveBeenLastCalledWith(2);
    expect(screen.queryByTestId('resume-draft-note')).toBeNull();

    fireEvent.press(screen.getByLabelText('stub-where-next'));
    expect(screen.getByText('StepPay')).toBeTruthy();
    expect(mockSaveStep).toHaveBeenLastCalledWith(3);
    expect(screen.queryByTestId('resume-draft-note')).toBeNull();
  });

  it('saves the step on a normal advance from step 1', () => {
    mockLastStep = 1;
    render(<CreateBountyFlow />);

    fireEvent.press(screen.getByLabelText('stub-next'));
    expect(screen.getByText('StepWhere')).toBeTruthy();
    expect(mockSaveStep).toHaveBeenCalledWith(2);
    expect(eventsNamed('post_step_completed')).toEqual([expect.objectContaining({ step_index: 1 })]);
  });
});

describe('CreateBountyFlow — "Start over"', () => {
  it('asks first, then clears the draft (device and server) and goes to step 1', () => {
    render(<CreateBountyFlow />);

    fireEvent.press(screen.getByTestId('resume-draft-start-over'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Start over?',
      'This clears your draft on all your devices.',
      expect.any(Array)
    );
    expect(mockClearDraft).not.toHaveBeenCalled();

    confirmAlert('Start over');
    expect(mockClearDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByText('StepTask')).toBeTruthy();
    expect(screen.queryByTestId('resume-draft-note')).toBeNull();
    expect(promptEvents()[1]).toMatchObject({
      action: 'started_over',
      from_step: 3,
      from_step_name: 'Compensation',
    });
  });

  it('"Keep draft" leaves everything as it was', () => {
    render(<CreateBountyFlow />);

    fireEvent.press(screen.getByTestId('resume-draft-start-over'));
    confirmAlert('Keep draft');

    expect(mockClearDraft).not.toHaveBeenCalled();
    expect(screen.getByText('StepPay')).toBeTruthy();
    expect(screen.getByTestId('resume-draft-note')).toBeTruthy();
  });
});

describe('CreateBountyFlow — draft contents never reach analytics', () => {
  it('no event payload carries the title, description, address or pin', () => {
    const { unmount } = render(<CreateBountyFlow />);
    fireEvent.press(screen.getByTestId('resume-draft-start-over'));
    confirmAlert('Start over');
    unmount();

    expect(trackEvent).toHaveBeenCalled();
    const payloads = JSON.stringify(trackEvent.mock.calls);
    for (const secret of [
      COMPLETE_TASK.title,
      COMPLETE_TASK.description,
      PIN.location,
      String(PIN.latitude),
      String(PIN.longitude),
      PIN.zipCode,
    ]) {
      expect(payloads).not.toContain(secret);
    }
  });
});

// The app-open prompt's trigger (lib/storage/abandoned-draft.ts): a tab
// switch away from an unfinished draft flags it; other exits don't.
describe('CreateBountyFlow — abandoned-draft flag', () => {
  const ABANDONED_KEY = '@bounty_abandoned_draft:poster-1';
  const flagWrites = () =>
    (AsyncStorage.setItem as jest.Mock).mock.calls.filter(c => c[0] === ABANDONED_KEY);

  beforeEach(() => {
    mockLastStep = 1;
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
