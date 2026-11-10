/**
 * Property-set contract for the flow-level composer events
 * (post_step_viewed, post_step_completed, post_step_abandoned), against
 * COMPOSER_EVENT_PROPERTIES. The step-level half, and the check that the two
 * files together cover every event in the table, is in
 * composer-event-contract.test.tsx.
 *
 * Module mocks and helpers below are copied from
 * create-bounty-flow-timing-analytics.test.tsx (jest.mock is hoisted per
 * file, so they can't be shared by import).
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
// StepWhere is a required pre-publish step (Task -> Location -> Compensation),
// so this stub also exposes a back control for the cases that leave and
// re-enter a step.
jest.mock('app/screens/CreateBounty/quick/StepWhere', () => ({
  StepWhere: (props: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <TouchableOpacity accessibilityLabel="stub-next" onPress={props.onNext}>
          <Text>StepWhere</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel="stub-back" onPress={props.onBack}>
          <Text>Back</Text>
        </TouchableOpacity>
      </View>
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
// The post-publish celebration is purely visual and fades itself out.
jest.mock('app/screens/CreateBounty/quick/PostCelebration', () => ({
  PostCelebration: () => null,
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

import { COMPOSER_EVENT_PROPERTIES, type ComposerEventName } from 'app/screens/CreateBounty/composerTelemetry';

const FLOW_EVENTS: ComposerEventName[] = ['post_step_viewed', 'post_step_completed', 'post_step_abandoned'];

const keysOf = (props: Record<string, unknown>) => Object.keys(props).sort();
const declared = (name: ComposerEventName) => [...COMPOSER_EVENT_PROPERTIES[name]].sort();

describe('flow-level composer events: exact property sets', () => {
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

  it('every flow event carries exactly its declared properties, entry_point included', () => {
    const { unmount } = render(<CreateBountyFlow deliberateTap entryPoint="moment_post_first_bounty" />);
    fireEvent.changeText(screen.getByLabelText('stub-title-input'), 'Move a couch');
    fireEvent.press(screen.getByLabelText('stub-next')); // -> Location
    fireEvent.press(screen.getByLabelText('stub-back')); // <- Task (direction: back)
    fireEvent.press(screen.getByLabelText('stub-next')); // -> Location
    unmount(); // abandon on Location

    for (const name of FLOW_EVENTS) {
      const seen = eventsNamed(name);
      expect({ name, seen: seen.length > 0 }).toEqual({ name, seen: true });
      for (const props of seen) {
        expect({ name, keys: keysOf(props) }).toEqual({ name, keys: declared(name) });
      }
    }
    for (const props of eventsNamed('post_step_viewed')) {
      expect(props.entry_point).toBe('moment_post_first_bounty');
    }
    expect(lastEventNamed('post_step_abandoned')).toMatchObject({
      entry_point: 'moment_post_first_bounty',
      step_name: 'Location',
      last_field: 'title',
      fields_touched: ['title'],
    });
  });

  it('a preloaded flow reports the entry point it was opened with, not the one it mounted with', () => {
    const { rerender, unmount } = render(
      <CreateBountyFlow deliberateTap isActive={false} entryPoint="need_help_tab" />
    );
    rerender(<CreateBountyFlow deliberateTap isActive entryPoint="moment_post_first_bounty" />);
    rerender(<CreateBountyFlow deliberateTap isActive entryPoint="need_help_tab" />);
    unmount();

    expect(eventsNamed('post_step_viewed').map(e => e.entry_point)).toEqual(['moment_post_first_bounty']);
    expect(lastEventNamed('post_step_abandoned').entry_point).toBe('moment_post_first_bounty');
  });

  it("defaults entry_point to 'unknown', never omits it", () => {
    const { unmount } = render(<CreateBountyFlow />);
    unmount();
    expect(eventsNamed('post_step_viewed')[0].entry_point).toBe('unknown');
    expect(lastEventNamed('post_step_abandoned').entry_point).toBe('unknown');
  });

  it('flow events never carry the typed title', () => {
    const { unmount } = render(<CreateBountyFlow deliberateTap />);
    fireEvent.changeText(screen.getByLabelText('stub-title-input'), 'Tune my Xylophone');
    fireEvent.press(screen.getByLabelText('stub-next'));
    unmount();
    expect(JSON.stringify(trackEvent.mock.calls)).not.toContain('Xylophone');
  });
});
