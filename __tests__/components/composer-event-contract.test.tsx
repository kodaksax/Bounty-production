/**
 * Property-set contract for every composer drop-off event, against
 * COMPOSER_EVENT_PROPERTIES (app/screens/CreateBounty/composerTelemetry.ts).
 *
 * This file drives the step-level events through the real step screens. The
 * flow-level ones (post_step_viewed/_completed/_abandoned) are driven through
 * CreateBountyFlow in composer-flow-event-contract.test.tsx. Between them,
 * every event in the table must be seen at least once; the table and the two
 * lists below are checked against each other so a new event can't slip
 * through untested.
 *
 * It also checks that no event value carries text the poster typed: drafts
 * are seeded with sentinel words and every captured payload is searched for
 * them.
 */
import { AccessibilityInfo, Keyboard } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React, { useState } from 'react';

(AccessibilityInfo as unknown as { announceForAccessibility: jest.Mock }).announceForAccessibility =
  jest.fn();

const mockTrackEvent = jest.fn();
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  },
}));

const mockGeocodeAddress = jest.fn();
jest.mock('../../lib/services/address-autocomplete-service', () => ({
  addressAutocompleteService: {
    isConfigured: () => false,
    searchAddresses: jest.fn(),
    getPlaceDetails: jest.fn(),
  },
  isPlaceDetailsError: () => false,
}));
jest.mock('../../lib/services/location-service', () => ({
  locationService: {
    getPermissionStatus: jest.fn(),
    requestPermission: jest.fn(),
    getCurrentLocation: jest.fn(),
    geocodeAddress: (...args: unknown[]) => mockGeocodeAddress(...args),
    reverseGeocodeDetailed: jest.fn().mockResolvedValue(null),
  },
}));
jest.mock('../../lib/wallet-context', () => ({
  useWallet: jest.fn(() => ({ balance: 0 })),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('../../hooks/usePostingPolicy', () => {
  const policy = { honorPostsEnabled: true, minimumAmount: 1 };
  return { __esModule: true, default: () => policy, usePostingPolicy: () => policy };
});
jest.mock('../../hooks/usePostingCardGate', () => ({
  usePostingCardGate: () => ({
    cardStepExpected: false,
    checking: false,
    showCardSheet: false,
    dismissed: false,
    onCardSheetClose: () => {},
    requestPublish: (payment: unknown, proceed: (p: unknown) => void) => proceed(payment),
  }),
}));
jest.mock('../../components/payment-methods-modal', () => ({ PaymentMethodsModal: () => null }));

import {
  COMPOSER_EVENT_PROPERTIES,
  ctaVisibilityAboveKeyboard,
  createComposerTelemetry,
  type ComposerEventName,
} from '../../app/screens/CreateBounty/composerTelemetry';
import { StepPay } from '../../app/screens/CreateBounty/quick/StepPay';
import { KEYBOARD_MEASURE_DELAY_MS, StepTask } from '../../app/screens/CreateBounty/quick/StepTask';
import { StepWhere } from '../../app/screens/CreateBounty/quick/StepWhere';

/** Events this file drives. */
export const STEP_EVENTS: ComposerEventName[] = [
  'post_next_tapped',
  'post_title_first_typed',
  'post_detail_typed',
  'post_validation_shown',
  'post_keyboard_shown',
];
/** Events composer-flow-event-contract.test.tsx drives. Kept in sync by hand. */
const FLOW_EVENTS: ComposerEventName[] = ['post_step_viewed', 'post_step_completed', 'post_step_abandoned'];

// Words no template, step label or enum value contains. If any appears in an
// event payload, typed text has leaked into analytics.
const SENTINELS = ['Xylophone', 'Quokkapath', 'Zanzibarrr', '9917 Sentinel'];
const TITLE = 'Tune my Xylophone';
const DETAIL = 'Quokkapath Saturday afternoon, around 3pm, bring tools';
const ADDRESS = '9917 Sentinel Zanzibarrr Lane';
const DETAIL_LABEL = 'What exactly, and when?';
const TITLE_LABEL = 'What do you need done?';
const BLOCKED_TAP = 'blocked-tap-capture';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    title: '',
    description: '',
    amount: 0,
    isForHonor: false,
    category: 'other',
    workType: 'in_person',
    location: '',
    ...overrides,
  } as any;
}

function StepTaskHarness({
  telemetry,
  initial = {},
}: {
  telemetry: ReturnType<typeof createComposerTelemetry>;
  initial?: Record<string, unknown>;
}) {
  const [d, setD] = useState(draft(initial));
  return (
    <StepTask
      draft={d}
      onUpdate={(patch) => setD((prev: any) => ({ ...prev, ...patch }))}
      onNext={jest.fn()}
      telemetry={telemetry}
      step={1}
      totalSteps={3}
    />
  );
}

const keyboardAddListener = Keyboard.addListener as unknown as jest.Mock;
function showKeyboard(screenY: number, height: number) {
  const calls = keyboardAddListener.mock.calls.filter((c) => c[0] === 'keyboardDidShow');
  const handler = calls[calls.length - 1]?.[1];
  if (!handler) throw new Error('StepTask did not subscribe to keyboardDidShow');
  act(() => handler({ endCoordinates: { screenY, height } }));
}

/** Renders StepTask with Next measured at `ctaY` (window coords, 52pt tall). */
function renderWithCtaAt(ctaY: number, telemetry = createComposerTelemetry()) {
  return render(<StepTaskHarness telemetry={telemetry} initial={{ title: TITLE }} />, {
    createNodeMock: (el) =>
      (el.props as { testID?: string }).testID === 'step-task-next'
        ? { measureInWindow: (cb: (...n: number[]) => void) => cb(16, ctaY, 343, 52) }
        : null,
  });
}

const captured = () => mockTrackEvent.mock.calls.map((c) => ({ name: c[0] as string, props: c[1] ?? {} }));

beforeEach(() => {
  jest.clearAllMocks();
  keyboardAddListener.mockImplementation(() => ({ remove: jest.fn() }));
});

describe('COMPOSER_EVENT_PROPERTIES', () => {
  it('lists exactly the events the two contract files drive', () => {
    expect([...STEP_EVENTS, ...FLOW_EVENTS].sort()).toEqual(Object.keys(COMPOSER_EVENT_PROPERTIES).sort());
  });

  it('has no duplicate property names', () => {
    for (const props of Object.values(COMPOSER_EVENT_PROPERTIES)) {
      expect(new Set(props).size).toBe(props.length);
    }
  });
});

describe('step-level composer events', () => {
  async function driveEveryStepEvent() {
    // Task: first keystrokes, a blocked tap, a validation message, a keyboard
    // open with Next on screen, then an enabled tap.
    const telemetry = createComposerTelemetry();
    const task = render(<StepTaskHarness telemetry={telemetry} />, {
      createNodeMock: (el) =>
        (el.props as { testID?: string }).testID === 'step-task-next'
          ? { measureInWindow: (cb: (...n: number[]) => void) => cb(16, 400, 343, 52) }
          : null,
    });
    fireEvent(task.getByLabelText(TITLE_LABEL), 'focus');
    showKeyboard(500, 312);
    await waitFor(() =>
      expect(mockTrackEvent.mock.calls.some((c) => c[0] === 'post_keyboard_shown')).toBe(true)
    );
    fireEvent.changeText(task.getByLabelText(TITLE_LABEL), TITLE);
    fireEvent.changeText(task.getByLabelText(DETAIL_LABEL), 'Quokkapath');
    fireEvent.press(task.getByTestId(BLOCKED_TAP));
    fireEvent.changeText(task.getByLabelText(DETAIL_LABEL), DETAIL);
    fireEvent.press(task.getByLabelText('Next'));
    task.unmount();

    // Location: a blocked tap, then an address that fails to resolve.
    mockGeocodeAddress.mockResolvedValue(null);
    const where = render(
      <StepWhere
        draft={draft({ title: TITLE, description: DETAIL, location: ADDRESS })}
        onUpdate={jest.fn()}
        onNext={jest.fn()}
        onBack={jest.fn()}
        telemetry={telemetry}
        step={2}
        totalSteps={3}
      />
    );
    await act(async () => {
      fireEvent.press(where.getByLabelText('Continue'));
    });
    where.unmount();

    // Compensation: publish with no amount.
    const pay = render(
      <StepPay
        draft={draft({ title: TITLE, description: DETAIL, location: ADDRESS })}
        onUpdate={jest.fn()}
        onNext={jest.fn()}
        onBack={jest.fn()}
        telemetry={telemetry}
        step={3}
        totalSteps={3}
      />
    );
    const publish = pay.queryByTestId(BLOCKED_TAP) ?? pay.getByLabelText(/Post/);
    fireEvent.press(publish);
    pay.unmount();
  }

  it('each event carries exactly its declared properties', async () => {
    await driveEveryStepEvent();
    const events = captured().filter((e) => e.name in COMPOSER_EVENT_PROPERTIES);
    for (const name of STEP_EVENTS) {
      const seen = events.filter((e) => e.name === name);
      expect({ name, count: seen.length > 0 }).toEqual({ name, count: true });
      for (const e of seen) {
        expect({ name, keys: Object.keys(e.props).sort() }).toEqual({
          name,
          keys: [...COMPOSER_EVENT_PROPERTIES[name]].sort(),
        });
      }
    }
  });

  it('no event — composer or otherwise — carries text the poster typed', async () => {
    await driveEveryStepEvent();
    const payload = JSON.stringify(captured());
    for (const word of SENTINELS) {
      expect(payload).not.toContain(word);
    }
  });
});

describe('post_keyboard_shown (post_cta_visible_on_keyboard)', () => {
  it('reports Next visible when it sits fully above the keyboard', async () => {
    const utils = renderWithCtaAt(400);
    fireEvent(utils.getByLabelText(DETAIL_LABEL), 'focus');
    showKeyboard(500, 312);

    await waitFor(() =>
      expect(mockTrackEvent).toHaveBeenCalledWith('post_keyboard_shown', {
        step_index: 1,
        composer_screen: 'composer_task',
        focused_field: 'description',
        post_cta_visible_on_keyboard: true,
        cta_overlap_px: 0,
        keyboard_height: 312,
        window_height: 812,
      })
    );
  });

  it('reports Next hidden, and by how much, when the keyboard covers it', async () => {
    const utils = renderWithCtaAt(700);
    fireEvent(utils.getByLabelText(TITLE_LABEL), 'focus');
    showKeyboard(500, 312);

    await waitFor(() =>
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'post_keyboard_shown',
        expect.objectContaining({ post_cta_visible_on_keyboard: false, cta_overlap_px: 252 })
      )
    );
  });

  it('fires once per composer session, not on every keyboard open', async () => {
    const telemetry = createComposerTelemetry();
    const first = renderWithCtaAt(400, telemetry);
    showKeyboard(500, 312);
    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalledTimes(1));
    first.unmount();
    renderWithCtaAt(700, telemetry);
    showKeyboard(500, 312);
    await new Promise((r) => setTimeout(r, KEYBOARD_MEASURE_DELAY_MS + 20));

    expect(mockTrackEvent.mock.calls.filter((c) => c[0] === 'post_keyboard_shown')).toHaveLength(1);
  });

  it('does not listen at all without telemetry (a preloaded, off-screen flow)', () => {
    render(
      <StepTask draft={draft()} onUpdate={jest.fn()} onNext={jest.fn()} step={1} totalSteps={3} />
    );
    expect(keyboardAddListener.mock.calls.filter((c) => c[0] === 'keyboardDidShow')).toHaveLength(0);
  });

  it('stops listening when step 1 unmounts', () => {
    const remove = jest.fn();
    keyboardAddListener.mockImplementation(() => ({ remove }));
    const { unmount } = renderWithCtaAt(400);
    unmount();
    expect(remove).toHaveBeenCalled();
  });
});

describe('ctaVisibilityAboveKeyboard', () => {
  it.each([
    [{ y: 400, height: 52 }, 500, { visible: true, overlapPx: 0 }],
    [{ y: 448, height: 52 }, 500, { visible: true, overlapPx: 0 }],
    [{ y: 449, height: 52 }, 500, { visible: false, overlapPx: 1 }],
    [{ y: 700, height: 52 }, 500, { visible: false, overlapPx: 252 }],
    [{ y: -10, height: 52 }, 500, { visible: false, overlapPx: 0 }],
    [{ y: 400, height: 0 }, 500, { visible: false, overlapPx: 0 }],
  ])('%o against a keyboard top of %d', (cta, top, expected) => {
    expect(ctaVisibilityAboveKeyboard(cta, top)).toEqual(expected);
  });
});
