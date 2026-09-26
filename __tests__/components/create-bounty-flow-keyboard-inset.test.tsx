/**
 * Integration tests for CreateBountyFlow's keyboard inset
 * (app/screens/CreateBounty/index.tsx).
 *
 * The flow pads itself by only the part of the keyboard that overlaps it: it
 * measures how far its own bottom edge sits above the window's bottom edge
 * (`measureInWindow` on layout) and subtracts that from the keyboard overlap
 * via useKeyboardInset's `offset`. Get that wrong and the step's pinned
 * Continue CTA either floats above the keyboard by the host's BottomNav
 * clearance (offset left at 0) or slides under it (too much subtracted).
 *
 * The step screens are stubbed — what's under test is the geometry: a mocked
 * measured frame for the flow's root, a mocked keyboard event, and the
 * resulting `paddingBottom` on the flow's container. The frame is derived
 * from the host tree actually rendered around the flow (the summed
 * `paddingBottom` of its ancestors), so the NeedHelpScreen cases follow that
 * screen's real clearance rather than a copy of it.
 *
 * Keyboard-event plumbing (screenY-derived overlap, clamping, timing) is
 * covered on its own in keyboard-avoiding.test.tsx.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Animated, Keyboard, View } from 'react-native';

// Matches jest.setup's Dimensions.get('window') mock, which both the flow's
// measurement and useKeyboardInset's overlap read.
const WINDOW_HEIGHT = 812;
const WINDOW_WIDTH = 375;

// ---- controllable test state ----

let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };

// ---- module mocks ----

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => mockInsets),
}));

jest.mock('hooks/useBackHandler', () => ({
  useBackHandler: jest.fn(),
}));

jest.mock('app/hooks/useBountyDraft', () => ({
  useBountyDraft: jest.fn(() => ({
    draft: {
      title: 'Test bounty',
      description: '',
      amount: 0,
      isForHonor: false,
      category: 'errands',
      workType: 'in_person',
      attachments: [],
    },
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

// The flow opens on StepTask; the rest are stubbed only so their own imports
// (expo-router et al.) never load.
jest.mock('app/screens/CreateBounty/quick/StepTask', () => ({
  StepTask: () => {
    const { Text } = require('react-native');
    return <Text>StepTask</Text>;
  },
}));
jest.mock('app/screens/CreateBounty/quick/StepPhotos', () => ({ StepPhotos: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepWhere', () => ({ StepWhere: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepWhen', () => ({ StepWhen: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepPay', () => ({ StepPay: () => null }));
jest.mock('app/screens/CreateBounty/quick/StepPostPublish', () => ({ StepPostPublish: () => null }));

// Pulled in by the funding gate; its expo-image import can't load under jest.
jest.mock('components/add-money-screen', () => ({
  AddMoneyScreen: () => null,
}));

// ---- import after mocks ----

import { CreateBountyFlow } from 'app/screens/CreateBounty/index';
import { NeedHelpScreen } from 'app/tabs/need-help-screen';

// ---- geometry harness ----

type Frame = { y: number; height: number };

/**
 * What the flow root's `measureInWindow` reports. Set by `layOutFlow` from the
 * rendered host tree before the layout event fires.
 */
let measuredFrame: Frame | null = null;

/** Every host ref in the tree answers measureInWindow with `measuredFrame`. */
function createNodeMock() {
  return {
    measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => {
      if (measuredFrame) cb(0, measuredFrame.y, WINDOW_WIDTH, measuredFrame.height);
    },
  };
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style as Record<string, unknown>;
}

/**
 * Lay the flow out where its host puts it: a `flex: 1` column filling the
 * window, inset top and bottom by whatever padding its host ancestors apply.
 * Then fire the flow root's onLayout, which is what triggers its measurement.
 */
function layOutFlow() {
  const flowRoot = screen.getByTestId('create-bounty-flow-root');
  let top = 0;
  let bottom = 0;
  for (let node = flowRoot.parent; node; node = node.parent) {
    if (typeof node.type !== 'string') continue;
    const style = flattenStyle(node.props.style);
    top += Number(style.paddingTop ?? 0);
    bottom += Number(style.paddingBottom ?? 0);
  }
  measuredFrame = { y: top, height: WINDOW_HEIGHT - top - bottom };
  fireEvent(flowRoot, 'layout', {
    nativeEvent: { layout: { x: 0, y: top, width: WINDOW_WIDTH, height: measuredFrame.height } },
  });
}

/** The paddingBottom the flow's container currently applies, in points. */
function effectiveInset(): number {
  const flowRoot = screen.getByTestId('create-bounty-flow-root');
  const container = flowRoot.children[0];
  if (typeof container === 'string') throw new Error('flow root has no container view');
  const paddingBottom = flattenStyle(container.props.style).paddingBottom as
    | { __getValue: () => number }
    | number;
  return typeof paddingBottom === 'number' ? paddingBottom : paddingBottom.__getValue();
}

// ---- keyboard harness ----

type Listeners = Record<string, ((event: unknown) => void)[]>;
let listeners: Listeners;

function emit(event: string, payload: unknown) {
  act(() => {
    (listeners[event] ?? []).forEach(handler => handler(payload));
  });
}

/** A keyboard whose top edge sits `overlap` points above the window bottom. */
function keyboardEvent(overlap: number) {
  return {
    duration: 250,
    easing: 'keyboard',
    endCoordinates: {
      screenY: WINDOW_HEIGHT - overlap,
      height: overlap,
      width: WINDOW_WIDTH,
      screenX: 0,
    },
  };
}

const showKeyboard = (overlap: number) => emit('keyboardWillChangeFrame', keyboardEvent(overlap));
const hideKeyboard = () => emit('keyboardWillHide', keyboardEvent(0));

// jest.setup's Animated.Value mock discards setValue, so nothing could be read
// back from the flow's padding. Swap in one that holds its value for the
// duration of this suite.
const AnimatedValue = Animated.Value as unknown as jest.Mock;
const originalAnimatedValue = AnimatedValue.getMockImplementation();

beforeEach(() => {
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  measuredFrame = null;
  listeners = {};

  AnimatedValue.mockImplementation((initial: number) => {
    const value = {
      _value: initial,
      setValue: (next: number) => {
        value._value = next;
      },
      interpolate: jest.fn(() => value),
      __getValue: () => value._value,
    };
    return value;
  });
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, handler: any) => {
    (listeners[event] ??= []).push(handler);
    return {
      remove: () => {
        listeners[event] = (listeners[event] ?? []).filter(h => h !== handler);
      },
    };
  }) as any);
  // Land every animation on its final value immediately; the curve is UIKit's.
  jest.spyOn(Animated, 'timing').mockImplementation(((value: any, config: any) => ({
    start: (cb?: (r: { finished: boolean }) => void) => {
      value.setValue(config.toValue);
      cb?.({ finished: true });
    },
    stop: () => {},
  })) as any);
  jest.spyOn(Animated, 'parallel').mockImplementation(((animations: any[]) => ({
    start: (cb?: (r: { finished: boolean }) => void) => {
      animations.forEach(animation => animation.start());
      cb?.({ finished: true });
    },
    stop: () => {},
  })) as any);
});

afterEach(() => {
  jest.restoreAllMocks();
  AnimatedValue.mockImplementation(originalAnimatedValue);
});

describe('CreateBountyFlow — keyboard inset under each host layout', () => {
  describe('NeedHelpScreen (the live post-a-bounty tab, inset by the BottomNav clearance)', () => {
    const renderHost = () =>
      render(
        <NeedHelpScreen activeScreen="postings" setActiveScreen={jest.fn()} />,
        { createNodeMock }
      );

    it('home-indicator iPhone: pads by the keyboard overlap minus the BottomNav + safe-area strip', () => {
      mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
      renderHost();
      layOutFlow();

      // NeedHelpScreen clears 60pt of visible BottomNav + the 34pt safe area,
      // so the flow ends 94pt above the window bottom — keyboard already
      // covers that strip.
      expect(measuredFrame).toEqual({ y: 47, height: WINDOW_HEIGHT - 47 - 94 });

      showKeyboard(336);
      expect(effectiveInset()).toBe(336 - 94);
    });

    it('home-button iPhone: uses the 12pt minimum safe-area padding in the clearance', () => {
      mockInsets = { top: 20, bottom: 0, left: 0, right: 0 };
      renderHost();
      layOutFlow();

      showKeyboard(260);
      // 60pt BottomNav + max(0, 12) = 72pt already under the keyboard.
      expect(effectiveInset()).toBe(260 - 72);
    });

    it('adds no padding at rest and drops back to none when the keyboard hides', () => {
      mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
      renderHost();
      layOutFlow();

      // The clearance is subtracted from the overlap, never kept as padding
      // (which is what KeyboardAvoidingScreen's `offset` would have done).
      expect(effectiveInset()).toBe(0);

      showKeyboard(336);
      expect(effectiveInset()).toBe(242);

      hideKeyboard();
      expect(effectiveInset()).toBe(0);
    });

    it('clamps at zero when the keyboard is shorter than the strip below the flow', () => {
      mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
      renderHost();
      layOutFlow();

      // A hardware keyboard's shortcut bar: 55pt, entirely within the 94pt
      // the host already clears.
      showKeyboard(55);
      expect(effectiveInset()).toBe(0);
    });
  });

  describe('full-bleed host (flow reaches the window bottom, BottomNav floats over it)', () => {
    // PostingsScreen's "New" tab layout: the flow sits in plain `flex: 1`
    // columns with no bottom padding. PostingsScreen itself is too heavy to
    // mount here (and is not currently routed to), so its wrapper structure
    // is reproduced directly.
    const renderHost = () =>
      render(
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1, paddingTop: 120 }}>
            <View style={{ flex: 1 }}>
              <CreateBountyFlow entryPoint="postings_new_tab" />
            </View>
          </View>
        </View>,
        { createNodeMock }
      );

    it('pads by the full keyboard overlap, since nothing below the flow is already covered', () => {
      mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
      renderHost();
      layOutFlow();

      expect(measuredFrame).toEqual({ y: 120, height: WINDOW_HEIGHT - 120 });

      showKeyboard(336);
      expect(effectiveInset()).toBe(336);
    });
  });

  it('re-measures when the host layout changes, so a later keyboard uses the new clearance', () => {
    mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
    render(<NeedHelpScreen activeScreen="postings" setActiveScreen={jest.fn()} />, { createNodeMock });
    layOutFlow();
    showKeyboard(336);
    expect(effectiveInset()).toBe(242);
    hideKeyboard();

    // The host shrinks the flow further (e.g. a banner docks below it).
    measuredFrame = { y: 47, height: WINDOW_HEIGHT - 47 - 150 };
    fireEvent(screen.getByTestId('create-bounty-flow-root'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 47, width: WINDOW_WIDTH, height: measuredFrame.height } },
    });

    showKeyboard(336);
    expect(effectiveInset()).toBe(336 - 150);
  });
});
