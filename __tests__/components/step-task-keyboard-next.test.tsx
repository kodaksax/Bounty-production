/**
 * Step 1 with the keyboard up: Next and its hint stay reachable, and a tap on
 * the disabled Next takes the poster to whatever is still missing.
 *
 * Background: two Android posters stalled on this step. On a Galaxy A23 the
 * keyboard covered the card footer (hint + Next) for four minutes of typing;
 * on a Galaxy Tab A9 the poster never found the field Next was waiting on.
 */
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import React, { useState } from 'react';

(AccessibilityInfo as unknown as { announceForAccessibility: jest.Mock }).announceForAccessibility =
  jest.fn();

const mockTrackEvent = jest.fn();
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  },
}));

import { createComposerTelemetry } from '../../app/screens/CreateBounty/composerTelemetry';
import { StepTask } from '../../app/screens/CreateBounty/quick/StepTask';

const TITLE_LABEL = 'What do you need done?';
const DETAIL_LABEL = 'What exactly, and when?';
const BLOCKED_TAP = 'blocked-tap-capture';
const PINNED = 'step-task-pinned-footer';
const TWENTY = 'One 30-minute walk!!';

const eventsNamed = (name: string) =>
  mockTrackEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

/**
 * Host refs are null under the test renderer; this gives each one a stand-in
 * that records focus() (by the input's label) and scrollTo().
 */
function nodeRecorder() {
  const focused: string[] = [];
  const scrolls: { y: number; animated?: boolean }[] = [];
  const createNodeMock = (element: { props: { accessibilityLabel?: string } }) => ({
    focus: () => focused.push(element.props.accessibilityLabel ?? ''),
    scrollTo: (opts: { y: number; animated?: boolean }) => scrolls.push(opts),
  });
  return { focused, scrolls, createNodeMock };
}

function Harness({ initial = {}, onNext = jest.fn() }: { initial?: Record<string, unknown>; onNext?: () => void }) {
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    amount: 0,
    isForHonor: false,
    category: 'other',
    workType: 'in_person',
    ...initial,
  } as any);
  const [telemetry] = useState(() => createComposerTelemetry());
  return (
    <StepTask
      draft={draft}
      onUpdate={(patch) => setDraft((d: any) => ({ ...d, ...patch }))}
      onNext={onNext}
      telemetry={telemetry}
      step={1}
      totalSteps={3}
    />
  );
}

function renderStep(initial: Record<string, unknown> = {}) {
  const recorder = nodeRecorder();
  const utils = render(<Harness initial={initial} />, { createNodeMock: recorder.createNodeMock });
  return { ...utils, ...recorder };
}

const layout = (height: number, y = 0) => ({
  nativeEvent: { layout: { x: 0, y, width: 360, height } },
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a tap on the disabled Next', () => {
  it('focuses the first missing field, says what it needs, and is reported as blocked', () => {
    const { getByTestId, getByLabelText, focused } = renderStep({
      title: 'Walk my dog',
      description: 'Saturday',
    });

    fireEvent.press(getByTestId(BLOCKED_TAP));

    expect(focused).toEqual([DETAIL_LABEL]);
    expect(getByTestId('step-task-hint')).toHaveTextContent(
      'Add a few words about what and when — 12 more letters'
    );
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Add a few words about what and when — 12 more letters'
    );
    expect(eventsNamed('post_next_tapped')).toEqual([
      expect.objectContaining({ blocked: true, missing_field: 'description', detail_length: 8 }),
    ]);
    // Next itself stays disabled; the tap only guided.
    expect(getByLabelText('Next').props.accessibilityState).toEqual({ disabled: true });
  });

  it('goes to the title first when the title is what is missing', () => {
    const { getByTestId, focused } = renderStep({ title: '', description: TWENTY });
    fireEvent.press(getByTestId(BLOCKED_TAP));
    expect(focused).toEqual([TITLE_LABEL]);
    expect(getByTestId('step-task-hint')).toHaveTextContent('Say what you need done first, like “walk my dog”');
    expect(eventsNamed('post_next_tapped')[0]).toMatchObject({ blocked: true, missing_field: 'title' });
  });

  it.each([
    ['the title', { title: 'Call 410-555-1212 now', description: TWENTY }, TITLE_LABEL],
    ['the details', { title: 'Walk my dog', description: 'Saturday, text me at 410-555-1212' }, DETAIL_LABEL],
  ])('goes to %s when that is where the contact details are', (_where, initial, label) => {
    const { getByTestId, focused } = renderStep(initial);
    fireEvent.press(getByTestId(BLOCKED_TAP));
    expect(focused).toEqual([label]);
    expect(eventsNamed('post_next_tapped')[0]).toMatchObject({ blocked: true, missing_field: 'contact' });
  });

  it('scrolls the missing field into view above the keyboard', () => {
    const { getByTestId, scrolls } = renderStep({ title: 'Walk my dog', description: 'Saturday' });
    // 300pt of scroll body left above the keyboard; the card starts 150pt
    // down and the details block sits 120–190pt into it — partly hidden.
    fireEvent(getByTestId('step-task-scroll'), 'layout', layout(300));
    fireEvent(getByTestId('step-task-card'), 'layout', layout(420, 150));
    fireEvent(getByTestId('step-task-detail-block'), 'layout', layout(70, 120));

    fireEvent.press(getByTestId(BLOCKED_TAP));
    act(() => jest.runOnlyPendingTimers());

    // Bottom of the block (150 + 190) plus a 12pt margin, less the viewport.
    expect(scrolls).toContainEqual({ y: 352 - 300, animated: true });
  });

  it('keeps the notice current while the poster types, and drops it once Next enables', () => {
    const { getByTestId, getByLabelText } = renderStep({ title: 'Walk my dog', description: 'Saturday' });
    fireEvent.press(getByTestId(BLOCKED_TAP));

    fireEvent.changeText(getByLabelText(DETAIL_LABEL), 'Saturday 9am');
    expect(getByTestId('step-task-hint')).toHaveTextContent(
      'Add a few words about what and when — 8 more letters'
    );

    fireEvent.changeText(getByLabelText(DETAIL_LABEL), TWENTY);
    expect(getByTestId('step-task-hint')).toHaveTextContent('Location and reward come next');
    expect(getByLabelText('Next').props.accessibilityState).toEqual({ disabled: false });
  });
});

describe('Next while a field is focused', () => {
  it('sits in the card at rest and moves to the pinned bar while a field is focused', () => {
    const { getByLabelText, getAllByLabelText, getByTestId, queryByTestId } = renderStep({
      title: 'Walk my dog',
      description: 'Saturday',
    });
    expect(queryByTestId(PINNED)).toBeNull();

    fireEvent(getByLabelText(DETAIL_LABEL), 'focus');

    const pinned = getByTestId(PINNED);
    expect(within(pinned).getByLabelText('Next')).toBeTruthy();
    expect(within(pinned).getByTestId('step-task-hint')).toHaveTextContent('12 more letters');
    // Moved, not duplicated.
    expect(getAllByLabelText('Next')).toHaveLength(1);
  });

  it('stays pinned when focus moves from the title to the details', () => {
    const { getByLabelText, getByTestId } = renderStep({ title: 'Walk my dog' });
    fireEvent(getByLabelText(TITLE_LABEL), 'focus');
    fireEvent(getByLabelText(TITLE_LABEL), 'blur');
    fireEvent(getByLabelText(DETAIL_LABEL), 'focus');
    act(() => jest.runOnlyPendingTimers());
    expect(getByTestId(PINNED)).toBeTruthy();
  });

  it('goes back into the card once nothing is focused', () => {
    const { getByLabelText, queryByTestId } = renderStep({ title: 'Walk my dog' });
    fireEvent(getByLabelText(DETAIL_LABEL), 'focus');
    fireEvent(getByLabelText(DETAIL_LABEL), 'blur');
    act(() => jest.runOnlyPendingTimers());
    expect(queryByTestId(PINNED)).toBeNull();
  });

  it('advances from the pinned bar once the details are long enough', () => {
    const onNext = jest.fn();
    const recorder = nodeRecorder();
    const { getByLabelText, getByTestId } = render(
      <Harness initial={{ title: 'Walk my dog' }} onNext={onNext} />,
      { createNodeMock: recorder.createNodeMock }
    );
    fireEvent(getByLabelText(DETAIL_LABEL), 'focus');
    fireEvent.changeText(getByLabelText(DETAIL_LABEL), TWENTY);
    fireEvent.press(within(getByTestId(PINNED)).getByLabelText('Next'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe('a template tap', () => {
  it('fills the title, focuses the details field, and leaves Next and its hint pinned in view', () => {
    const { getByLabelText, getByTestId, focused } = renderStep();

    fireEvent.press(getByLabelText('Walk my dog, suggested $20'));
    expect(getByLabelText(TITLE_LABEL).props.value).toBe('Walk my dog');
    expect(focused).toEqual([DETAIL_LABEL]);

    // The OS reports the focus that focus() asked for.
    fireEvent(getByLabelText(DETAIL_LABEL), 'focus');
    const pinned = getByTestId(PINNED);
    expect(within(pinned).getByLabelText('Next')).toBeTruthy();
    expect(within(pinned).getByTestId('step-task-hint')).toHaveTextContent('Add what and when to continue');
  });
});
