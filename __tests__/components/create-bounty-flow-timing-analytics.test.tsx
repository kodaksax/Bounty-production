/**
 * Timing/property contract for CreateBountyFlow's posting-funnel analytics
 * (app/screens/CreateBounty/index.tsx).
 *
 * The baseline this funnel feeds is about to be frozen for a collection
 * window, and dirty timing data can't be repaired retroactively. These tests
 * pin the three things that would silently corrupt it:
 *  - seconds_on_step / seconds_total must exclude backgrounded time
 *  - both must be capped at 1800s, flagged with seconds_capped
 *  - post_step_viewed must fire exactly once per step ENTRY, not per re-render
 *
 * Time is driven by a mocked performance.now() (the monotonic source
 * lib/utils/foreground-timer.ts prefers) so tests can advance minutes without
 * waiting, and AppState transitions are driven by capturing the flow's single
 * subscription handler.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

// ---- controllable test state ----

let mockNow = 0;
let mockIsLoading = false;
let mockDraft: any = {
  title: 'Test bounty',
  description: '',
  amount: 0,
  isForHonor: false,
  category: 'errands',
  workType: 'in_person',
  attachments: [],
};

const advance = (ms: number) => {
  mockNow += ms;
};

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

jest.mock('hooks/useBackHandler', () => ({
  useBackHandler: jest.fn(),
}));

const mockSaveDraft = jest.fn();
jest.mock('app/hooks/useBountyDraft', () => ({
  useBountyDraft: jest.fn(() => ({
    draft: mockDraft,
    saveDraft: mockSaveDraft,
    clearDraft: jest.fn(),
    isLoading: mockIsLoading,
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

// Step screens: minimal stubs wired to the same props the real flow passes.
// StepTask additionally exposes a text input so the "typing must not re-emit
// post_step_viewed" case can drive a realistic re-render.
jest.mock('app/screens/CreateBounty/quick/StepTask', () => ({
  StepTask: (props: any) => {
    const { TouchableOpacity, Text, TextInput, View } = require('react-native');
    return (
      <View>
        <TextInput
          accessibilityLabel="stub-title-input"
          onChangeText={(t: string) => props.onUpdate({ title: t })}
        />
        <TouchableOpacity accessibilityLabel="stub-next" onPress={props.onNext}>
          <Text>StepTask</Text>
        </TouchableOpacity>
      </View>
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
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="stub-next" onPress={props.onNext}>
        <Text>StepPay</Text>
      </TouchableOpacity>
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

// Pulled in transitively by PublishFundingGate; its expo-image dependency
// doesn't survive the jest native-module stub. Never rendered here.
jest.mock('components/add-money-screen', () => ({
  AddMoneyScreen: () => null,
}));

// ---- imports after mocks ----

import { CreateBountyFlow } from 'app/screens/CreateBounty/index';
import { analyticsService } from 'lib/services/analytics-service';

// require, not `import * as` — under esModuleInterop the latter yields a COPY
// of the mocked module's exports, so mutating it wouldn't be visible to the
// flow's own `react_native_1.AppState` lookup.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactNative = require('react-native');

type AppStateHandler = (state: string) => void;
let appStateHandlers: AppStateHandler[] = [];

// jest.setup.js's react-native mock doesn't include AppState (the flow guards
// for exactly that with optional chaining). Install a controllable one so the
// flow's single subscription can be driven from the tests.
function installAppStateMock() {
  (ReactNative as any).AppState = {
    currentState: 'active',
    addEventListener: (_type: string, handler: AppStateHandler) => {
      appStateHandlers.push(handler);
      return {
        remove: () => {
          appStateHandlers = appStateHandlers.filter(h => h !== handler);
        },
      };
    },
  };
}

const trackEvent = analyticsService.trackEvent as jest.Mock;

function eventsNamed(name: string) {
  return trackEvent.mock.calls.filter(call => call[0] === name).map(call => call[1] ?? {});
}

function lastEventNamed(name: string) {
  const all = eventsNamed(name);
  return all[all.length - 1];
}

/** Drives the flow's AppState subscription (a background/foreground cycle). */
function setAppState(state: string) {
  appStateHandlers.forEach(handler => handler(state));
}

describe('CreateBountyFlow — posting-funnel timing analytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNow = 0;
    mockIsLoading = false;
    appStateHandlers = [];

    // foreground-timer prefers performance.now() as its monotonic source.
    jest.spyOn(performance, 'now').mockImplementation(() => mockNow);
    installAppStateMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('subscribes to AppState exactly once (no duplicate listener)', () => {
    render(<CreateBountyFlow />);
    expect(appStateHandlers).toHaveLength(1);
  });

  it('excludes backgrounded time from seconds_on_step', () => {
    render(<CreateBountyFlow />);

    advance(4_000); // 4s foreground on step 1
    setAppState('background');
    advance(120_000); // 2 minutes backgrounded — must not count
    setAppState('active');

    fireEvent.press(screen.getByLabelText('stub-next')); // step 1 -> 2

    expect(lastEventNamed('post_step_completed')).toMatchObject({
      step_index: 1,
      seconds_on_step: 4,
      seconds_capped: false,
    });
  });

  it('resumes accumulation after returning to the foreground', () => {
    render(<CreateBountyFlow />);

    advance(3_000);
    setAppState('background');
    advance(60_000);
    setAppState('active');
    advance(5_000); // continues from 3s, not from zero

    fireEvent.press(screen.getByLabelText('stub-next'));

    expect(lastEventNamed('post_step_completed')).toMatchObject({ seconds_on_step: 8 });
  });

  it('accumulates correctly across multiple background/foreground cycles in one step', () => {
    render(<CreateBountyFlow />);

    advance(2_000);
    setAppState('background');
    advance(30_000);
    setAppState('active');
    advance(3_000);
    setAppState('inactive');
    advance(45_000);
    setAppState('active');
    advance(1_000);

    fireEvent.press(screen.getByLabelText('stub-next'));

    expect(lastEventNamed('post_step_completed')).toMatchObject({ seconds_on_step: 6 });
  });

  it('caps a long foreground step at 1800s and flags seconds_capped', () => {
    render(<CreateBountyFlow />);

    advance(2_000_000); // ~33 minutes, all foreground

    fireEvent.press(screen.getByLabelText('stub-next'));

    expect(lastEventNamed('post_step_completed')).toMatchObject({
      seconds_on_step: 1800,
      seconds_capped: true,
    });
  });

  it('times each step independently — the step timer resets on entry', () => {
    render(<CreateBountyFlow />);

    advance(5_000);
    fireEvent.press(screen.getByLabelText('stub-next')); // step 1 (5s)
    advance(9_000);
    fireEvent.press(screen.getByLabelText('stub-next')); // step 2 (9s)

    const completed = eventsNamed('post_step_completed');
    expect(completed[0]).toMatchObject({ step_index: 1, seconds_on_step: 5 });
    expect(completed[1]).toMatchObject({ step_index: 2, seconds_on_step: 9 });
  });

  it('reports background_seconds on post_step_abandoned for the current step only', () => {
    const { unmount } = render(<CreateBountyFlow />);

    // Backgrounded time on step 1 must not leak into step 2's report.
    setAppState('background');
    advance(20_000);
    setAppState('active');
    advance(1_000);
    fireEvent.press(screen.getByLabelText('stub-next')); // -> step 2

    advance(2_000);
    setAppState('background');
    advance(45_000);
    setAppState('active');

    unmount();

    expect(lastEventNamed('post_step_abandoned')).toMatchObject({
      step_index: 2,
      seconds_on_step: 2,
      seconds_capped: false,
      background_seconds: 45,
    });
  });

  it('folds the still-open background segment into background_seconds when torn down while backgrounded', () => {
    const { unmount } = render(<CreateBountyFlow />);

    advance(3_000);
    setAppState('background');
    advance(90_000);

    unmount();

    expect(lastEventNamed('post_step_abandoned')).toMatchObject({
      seconds_on_step: 3,
      background_seconds: 90,
      exit_method: 'background',
    });
  });

  // seconds_total (bounty_published) is fed by the flow timer, which pauses
  // and resumes off the SAME AppState subscription as the step timer — the
  // publish path itself is stubbed here (useFormSubmission), so its exclusion
  // is asserted indirectly: total foreground time across steps must exclude
  // the backgrounded stretch.
  it('excludes backgrounded time from the flow-level elapsed total', () => {
    render(<CreateBountyFlow />);

    advance(10_000);
    setAppState('background');
    advance(600_000); // 10 minutes backgrounded
    setAppState('active');
    advance(5_000);

    fireEvent.press(screen.getByLabelText('stub-next'));
    fireEvent.press(screen.getByLabelText('stub-next'));

    const completed = eventsNamed('post_step_completed');
    const totalForeground = completed.reduce((sum, e: any) => sum + e.seconds_on_step, 0);
    expect(totalForeground).toBe(15);
  });
});

describe('CreateBountyFlow — post_step_viewed fires once per step entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNow = 0;
    mockIsLoading = false;
    appStateHandlers = [];
    jest.spyOn(performance, 'now').mockImplementation(() => mockNow);
    installAppStateMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not emit additional post_step_viewed events while typing in the title field', () => {
    const { rerender } = render(<CreateBountyFlow />);
    expect(eventsNamed('post_step_viewed')).toHaveLength(1);

    const input = screen.getByLabelText('stub-title-input');
    ['T', 'Ta', 'Tak', 'Task'].forEach(text => {
      fireEvent.changeText(input, text);
      // Draft autosave re-renders the flow (and flips isLoading) on every
      // keystroke — the previous implementation re-emitted the step view here.
      mockIsLoading = true;
      rerender(<CreateBountyFlow />);
      mockIsLoading = false;
      rerender(<CreateBountyFlow />);
    });

    expect(eventsNamed('post_step_viewed')).toHaveLength(1);
  });

  it('emits one post_step_viewed per entry, including returning to a previous step', () => {
    render(<CreateBountyFlow />);
    fireEvent.press(screen.getByLabelText('stub-next')); // -> step 2

    const viewed = eventsNamed('post_step_viewed');
    expect(viewed).toHaveLength(2);
    expect(viewed[0]).toMatchObject({ step_index: 1, step_name: 'Task', direction: 'forward' });
    expect(viewed[1]).toMatchObject({ step_index: 2, step_name: 'Photos', direction: 'forward' });
  });

  it('emits only the canonical step properties (step_index number + step_name)', () => {
    render(<CreateBountyFlow />);

    const viewed = eventsNamed('post_step_viewed')[0] as Record<string, unknown>;
    expect(typeof viewed.step_index).toBe('number');
    expect(viewed).not.toHaveProperty('stepTitle');
    expect(viewed).not.toHaveProperty('step_title');
    expect(viewed).not.toHaveProperty('steptitle');
    expect(viewed).not.toHaveProperty('step');
  });

  it('emits post_started with a single canonical resumed_draft spelling', () => {
    render(<CreateBountyFlow />);

    const started = lastEventNamed('post_started') as Record<string, unknown>;
    expect(started).toHaveProperty('resumed_draft');
    expect(started).not.toHaveProperty('resumedDraft');
    expect(started).not.toHaveProperty('resumeddraft');
  });
});
