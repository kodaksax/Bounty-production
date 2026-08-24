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

import { act, fireEvent, render, screen } from '@testing-library/react-native';

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
          onFocus={props.onFieldFocus}
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
// StepPay is the flow's terminal step: its onNext publishes rather than
// advancing, so this stub also exposes a back control for the cases that need
// to leave and re-enter a step.
jest.mock('app/screens/CreateBounty/quick/StepPay', () => ({
  StepPay: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <TouchableOpacity accessibilityLabel="stub-next" onPress={props.onNext}>
          <Text>StepPay</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel="stub-back" onPress={props.onBack}>
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
      <TouchableOpacity accessibilityLabel="stub-finish" onPress={props.onContinue}>
        <Text>StepPostPublish</Text>
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
import { bountyService } from 'app/services/bountyService';
import { useBackHandler } from 'hooks/useBackHandler';
import { useFormSubmission } from 'hooks/useFormSubmission';

// require, not `import * as` — under esModuleInterop the latter yields a COPY
// of the mocked module's exports, so mutating it wouldn't be visible to the
// flow's own `react_native_1.AppState` lookup.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactNative = require('react-native');

type AppStateHandler = (state: string) => void;
let appStateHandlers: AppStateHandler[] = [];
const originalPerformanceNow = global.performance.now.bind(global.performance);

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

function installPerformanceNowMock() {
  Object.defineProperty(global.performance, 'now', {
    writable: true,
    configurable: true,
    value: () => mockNow,
  });
}

function restorePerformanceNow() {
  Object.defineProperty(global.performance, 'now', {
    writable: true,
    configurable: true,
    value: originalPerformanceNow,
  });
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
    installPerformanceNowMock();
    installAppStateMock();
  });

  afterEach(() => {
    restorePerformanceNow();
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

    // Step 2 is terminal (its CTA publishes), so a second forward advance
    // isn't available. Leaving step 1 and returning exercises the same
    // invariant: the second visit must be timed from its own entry, not
    // carry the first visit's 5s forward.
    advance(5_000);
    fireEvent.press(screen.getByLabelText('stub-next')); // leaves step 1 (5s)
    fireEvent.press(screen.getByLabelText('stub-back')); // back to step 1
    advance(9_000);
    fireEvent.press(screen.getByLabelText('stub-next')); // leaves step 1 again (9s)

    const completed = eventsNamed('post_step_completed');
    expect(completed[0]).toMatchObject({ step_index: 1, seconds_on_step: 5 });
    expect(completed[1]).toMatchObject({ step_index: 1, seconds_on_step: 9 });
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
    installPerformanceNowMock();
    installAppStateMock();
  });

  afterEach(() => {
    restorePerformanceNow();
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
    expect(viewed[1]).toMatchObject({
      step_index: 2,
      step_name: 'Compensation',
      direction: 'forward',
    });
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
    fireEvent(screen.getByLabelText('stub-title-input'), 'focus');

    const started = lastEventNamed('post_started') as Record<string, unknown>;
    expect(started).toHaveProperty('resumed_draft');
    expect(started).not.toHaveProperty('resumedDraft');
    expect(started).not.toHaveProperty('resumeddraft');
  });
});

// `deliberateTap` gates post_flow_started (a screen defaulting to showing the
// composer, or a bare bottom-nav tab focus, must NOT count as a funnel start —
// see the property's doc comment on CreateBountyFlowProps). post_field_focused
// is the companion composer-engagement signal and must fire regardless of it.
describe('CreateBountyFlow — deliberateTap gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNow = 0;
    mockIsLoading = false;
    appStateHandlers = [];
    installPerformanceNowMock();
    installAppStateMock();
  });

  afterEach(() => {
    restorePerformanceNow();
    jest.restoreAllMocks();
  });

  it('fires post_flow_started when deliberateTap is true', () => {
    render(<CreateBountyFlow deliberateTap />);

    expect(eventsNamed('post_flow_started')).toHaveLength(1);
    expect(lastEventNamed('post_flow_started')).toMatchObject({ deliberate_entry: true });
    // A deliberate tab press is still not composer intent — post_started is
    // gated on interaction, not on how the poster arrived.
    expect(eventsNamed('post_started')).toHaveLength(0);
  });

  it('does not fire post_flow_started when deliberateTap is false (the default)', () => {
    render(<CreateBountyFlow />);

    expect(eventsNamed('post_flow_started')).toHaveLength(0);
    expect(eventsNamed('post_started')).toHaveLength(0);
  });

  it('does not retroactively fire post_flow_started if deliberateTap flips true on a later re-render', () => {
    const { rerender } = render(<CreateBountyFlow deliberateTap={false} />);
    expect(eventsNamed('post_flow_started')).toHaveLength(0);

    rerender(<CreateBountyFlow deliberateTap={true} />);
    expect(eventsNamed('post_flow_started')).toHaveLength(0);
  });

  it('fires post_field_focused exactly once on the title field\'s first focus when deliberateTap is true', () => {
    render(<CreateBountyFlow deliberateTap />);

    const input = screen.getByLabelText('stub-title-input');
    fireEvent(input, 'focus');
    fireEvent(input, 'focus');

    expect(eventsNamed('post_field_focused')).toHaveLength(1);
    expect(lastEventNamed('post_field_focused')).toMatchObject({
      step_index: 1,
      deliberate_entry: true,
    });
  });

  it('fires post_field_focused exactly once even when deliberateTap is false', () => {
    render(<CreateBountyFlow />);

    const input = screen.getByLabelText('stub-title-input');
    fireEvent(input, 'focus');
    fireEvent(input, 'focus');

    expect(eventsNamed('post_field_focused')).toHaveLength(1);
    expect(lastEventNamed('post_field_focused')).toMatchObject({
      step_index: 1,
      deliberate_entry: false,
    });
  });

  it('includes entry_point on post_field_focused, matching post_flow_started', () => {
    render(<CreateBountyFlow deliberateTap entryPoint="need_help_tab" />);

    fireEvent(screen.getByLabelText('stub-title-input'), 'focus');

    expect(lastEventNamed('post_field_focused')).toMatchObject({ entry_point: 'need_help_tab' });
    expect(lastEventNamed('post_flow_started')).toMatchObject({ entry_point: 'need_help_tab' });
  });
});

// ---------------------------------------------------------------------------
// post_started must mean COMPOSER INTENT, not composer render.
//
// The regression these pin: post_started used to fire from the flow's mount
// effect. The host screen (app/tabs/bounty-app.tsx) mounts this component
// whenever the Post tab is selected and unmounts it on leaving, so every pass
// through the tab bar minted a start/abandon pair. Production over the 30 days
// to 2026-08-24 showed a MEDIAN 0.91s between the two, 879/1072 pairs under 3
// seconds, and single sessions reaching 29 and 35 "composer opens" with zero
// keystrokes.
//
// Mount/unmount here is the faithful simulation of a tab switch: it is
// literally what the host screen does.
// ---------------------------------------------------------------------------
describe('CreateBountyFlow — post_started means composer intent, not navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNow = 0;
    mockIsLoading = false;
    appStateHandlers = [];
    installPerformanceNowMock();
    installAppStateMock();
  });

  afterEach(() => {
    restorePerformanceNow();
    jest.restoreAllMocks();
  });

  describe('does NOT fire post_started', () => {
    it('on plain mount (the Post tab being selected)', () => {
      render(<CreateBountyFlow deliberateTap entryPoint="need_help_tab" />);
      expect(eventsNamed('post_started')).toHaveLength(0);
    });

    it('on mount once the draft load settles', () => {
      mockIsLoading = true;
      const { rerender } = render(<CreateBountyFlow />);
      mockIsLoading = false;
      rerender(<CreateBountyFlow />);

      expect(eventsNamed('post_started')).toHaveLength(0);
    });

    it('on re-render', () => {
      const { rerender } = render(<CreateBountyFlow />);
      rerender(<CreateBountyFlow />);
      rerender(<CreateBountyFlow />);

      expect(eventsNamed('post_started')).toHaveLength(0);
    });

    it('on an app background/foreground cycle while the composer is visible', () => {
      render(<CreateBountyFlow />);
      setAppState('background');
      advance(30_000);
      setAppState('active');

      expect(eventsNamed('post_started')).toHaveLength(0);
    });

    it('when the poster switches away and back to the Post tab without composing', () => {
      // Ten round trips through the tab bar — the exact shape of the 29/29
      // production session.
      for (let i = 0; i < 10; i++) {
        const { unmount } = render(<CreateBountyFlow deliberateTap />);
        unmount();
      }

      expect(eventsNamed('post_started')).toHaveLength(0);
      expect(eventsNamed('post_abandoned')).toHaveLength(0);
      // The mount-level funnel still sees all ten, so no data is lost —
      // they are just correctly labelled as never-engaged.
      expect(eventsNamed('post_flow_started')).toHaveLength(10);
      expect(eventsNamed('post_step_abandoned')).toHaveLength(10);
      eventsNamed('post_step_abandoned').forEach(e => {
        expect(e).toMatchObject({ composer_started: false });
      });
    });
  });

  describe('DOES fire post_started', () => {
    it('exactly once when the poster focuses the title field', () => {
      render(<CreateBountyFlow deliberateTap entryPoint="need_help_tab" />);
      fireEvent(screen.getByLabelText('stub-title-input'), 'focus');

      expect(eventsNamed('post_started')).toHaveLength(1);
      expect(lastEventNamed('post_started')).toMatchObject({
        surface: 'create_flow',
        trigger: 'field_focus',
        entry_point: 'need_help_tab',
        deliberate_entry: true,
      });
    });

    it('exactly once when the poster types, however many keystrokes', () => {
      render(<CreateBountyFlow />);
      const input = screen.getByLabelText('stub-title-input');
      ['W', 'Wa', 'Wal', 'Walk', 'Walk my dog'].forEach(t => fireEvent.changeText(input, t));

      expect(eventsNamed('post_started')).toHaveLength(1);
      expect(lastEventNamed('post_started')).toMatchObject({ trigger: 'draft_edit' });
    });

    it('exactly once across focus, typing and advancing in one composition', () => {
      render(<CreateBountyFlow />);
      const input = screen.getByLabelText('stub-title-input');
      fireEvent(input, 'focus');
      fireEvent.changeText(input, 'Walk my dog');
      fireEvent.press(screen.getByLabelText('stub-next'));

      expect(eventsNamed('post_started')).toHaveLength(1);
      // The earliest boundary wins — a later trigger must not re-fire it.
      expect(lastEventNamed('post_started')).toMatchObject({ trigger: 'field_focus' });
    });

    it('when a resumed draft is advanced without the field ever being focused', () => {
      render(<CreateBountyFlow />);
      fireEvent.press(screen.getByLabelText('stub-next'));

      expect(eventsNamed('post_started')).toHaveLength(1);
      expect(lastEventNamed('post_started')).toMatchObject({ trigger: 'step_advance' });
    });

    it('reports resumed_draft from arrival state, not from what the poster typed', () => {
      render(<CreateBountyFlow />);
      // mockDraft carries a title, so this poster genuinely arrived resumed.
      fireEvent.changeText(screen.getByLabelText('stub-title-input'), 'Edited');

      expect(lastEventNamed('post_started')).toMatchObject({ resumed_draft: true });
    });

    it('does not survive navigation — a fresh composer can start again', () => {
      const first = render(<CreateBountyFlow />);
      fireEvent(screen.getByLabelText('stub-title-input'), 'focus');
      first.unmount();

      const second = render(<CreateBountyFlow />);
      fireEvent(screen.getByLabelText('stub-title-input'), 'focus');
      second.unmount();

      // Two deliberate compositions are two starts — repeated genuine
      // sessions must stay countable.
      expect(eventsNamed('post_started')).toHaveLength(2);
      expect(eventsNamed('post_abandoned')).toHaveLength(2);
    });
  });

  describe('post_abandoned mirrors genuine starts', () => {
    it('fires once with exit_method "tab" when a real composition is left via the tab bar', () => {
      const { unmount } = render(<CreateBountyFlow deliberateTap entryPoint="need_help_tab" />);
      fireEvent.changeText(screen.getByLabelText('stub-title-input'), 'Walk my dog');
      // No explicit exit path ran — the host screen just tore the flow down,
      // which is exactly what a bottom-nav tab switch does.
      unmount();

      expect(eventsNamed('post_abandoned')).toHaveLength(1);
      expect(lastEventNamed('post_abandoned')).toMatchObject({
        surface: 'create_flow',
        exit_method: 'tab',
        entry_point: 'need_help_tab',
        step: 1,
      });
    });

    it('attributes a teardown while backgrounded to "background", not "tab"', () => {
      const { unmount } = render(<CreateBountyFlow />);
      fireEvent(screen.getByLabelText('stub-title-input'), 'focus');
      setAppState('background');
      unmount();

      expect(lastEventNamed('post_abandoned')).toMatchObject({ exit_method: 'background' });
    });

    it('does not fire when the composer was never genuinely started', () => {
      const { unmount } = render(<CreateBountyFlow deliberateTap />);
      unmount();

      expect(eventsNamed('post_abandoned')).toHaveLength(0);
    });

    it('does not fire for a mount that only ever backgrounded and resumed', () => {
      const { unmount } = render(<CreateBountyFlow />);
      setAppState('background');
      setAppState('active');
      unmount();

      expect(eventsNamed('post_abandoned')).toHaveLength(0);
    });

    it('tags post_step_abandoned with composer_started so the mount funnel stays segmentable', () => {
      const { unmount } = render(<CreateBountyFlow deliberateTap />);
      fireEvent(screen.getByLabelText('stub-title-input'), 'focus');
      unmount();

      expect(lastEventNamed('post_step_abandoned')).toMatchObject({ composer_started: true });
    });
  });
});

// Exit paths that are NOT the tab bar, plus the one outcome that must never
// be counted as an abandon at all.
describe('CreateBountyFlow — abandonment is not the only way out', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNow = 0;
    mockIsLoading = false;
    appStateHandlers = [];
    installPerformanceNowMock();
    installAppStateMock();
  });

  afterEach(() => {
    restorePerformanceNow();
    jest.restoreAllMocks();
  });

  it('attributes an Android hardware-back exit to "back", not "tab"', () => {
    const { unmount } = render(<CreateBountyFlow />);
    fireEvent(screen.getByLabelText('stub-title-input'), 'focus');

    // The flow registers exactly one hardware-back handler; invoking it at
    // step 1 is what a real Android back press does.
    const backHandler = (useBackHandler as jest.Mock).mock.calls.at(-1)?.[0];
    expect(typeof backHandler).toBe('function');
    backHandler();
    unmount();

    expect(eventsNamed('post_abandoned')).toHaveLength(1);
    expect(lastEventNamed('post_abandoned')).toMatchObject({ exit_method: 'back' });
  });

  it('does not emit post_abandoned when the bounty actually publishes', async () => {
    // Let submit() run the real publish handler for this case only — the
    // shared mock above is a no-op, which would leave publishedRef false and
    // make a successful publish indistinguishable from a walk-away.
    (useFormSubmission as jest.Mock).mockImplementation((handler: () => Promise<void>) => ({
      submit: () => handler(),
      isSubmitting: false,
      error: null,
      reset: jest.fn(),
    }));
    (bountyService.createBounty as jest.Mock).mockResolvedValue({
      bounty: { id: 'bounty-1' },
      created: true,
    });

    const { unmount } = render(<CreateBountyFlow />);
    fireEvent(screen.getByLabelText('stub-title-input'), 'focus');
    fireEvent.press(screen.getByLabelText('stub-next')); // step 1 -> 2
    await act(async () => {
      fireEvent.press(screen.getByLabelText('stub-next')); // StepPay CTA publishes
    });

    expect(eventsNamed('post_published')).toHaveLength(1);

    unmount();

    // One genuine start, a publish, and no abandon — a successful post must
    // never land in the abandonment bucket.
    expect(eventsNamed('post_started')).toHaveLength(1);
    expect(eventsNamed('post_abandoned')).toHaveLength(0);
    expect(eventsNamed('post_step_abandoned')).toHaveLength(0);
  });
});
