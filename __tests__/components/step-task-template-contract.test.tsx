import { AccessibilityInfo, Animated, Keyboard } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { StepTask } from '../../app/screens/CreateBounty/quick/StepTask';
import { CONTACT_INFO_ERROR } from '../../lib/utils/bounty-validation';

// The RN jest preset's AccessibilityInfo mock omits announceForAccessibility,
// which InfoTooltip calls when it opens.
(AccessibilityInfo as unknown as { announceForAccessibility: jest.Mock }).announceForAccessibility =
  jest.fn();

const mockTrackEvent = jest.fn();
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  },
}));

const mockUseFeatureFlag = jest.fn();
jest.mock('../../lib/posthog', () => ({
  useFeatureFlag: (...args: unknown[]) => mockUseFeatureFlag(...args),
}));

const DETAIL_LABEL = 'What exactly, and when?';
const TITLE_LABEL = 'What do you need done?';
const TWENTY = 'One 30-minute walk!!';
const DETAIL_BLOCKED = 'Add a few words about what you need and when (20 characters or more).';
const TITLE_BLOCKED = 'Say what you need done (5 characters or more).';

function renderStep(
  draftOverrides: Record<string, unknown> = {},
  { telemetry, ...options }: { createNodeMock?: (element: any) => unknown; telemetry?: any } = {}
) {
  const onUpdate = jest.fn();
  const onNext = jest.fn();
  const onFieldFocus = jest.fn();
  const draft = {
    title: '',
    description: '',
    amount: 0,
    isForHonor: false,
    category: 'other',
    workType: 'in_person',
    ...draftOverrides,
  } as any;
  const utils = render(
    <StepTask
      draft={draft}
      onUpdate={onUpdate}
      onNext={onNext}
      onFieldFocus={onFieldFocus}
      telemetry={telemetry}
      step={1}
      totalSteps={3}
    />,
    options
  );
  return { ...utils, onUpdate, onNext, onFieldFocus };
}

const nextDisabled = (getByLabelText: (l: string) => any) =>
  getByLabelText('Next').props.accessibilityState?.disabled === true;

/**
 * jest.setup.js renders TextInput/ScrollView as host strings, whose refs are
 * null under the test renderer. createNodeMock hands each ref a stand-in that
 * records which field focus() was called on.
 */
function focusRecorder({ alreadyFocused = false } = {}) {
  const focused: string[] = [];
  const blurred: string[] = [];
  const scrollTo = jest.fn();
  const createNodeMock = (element: { props: { accessibilityLabel?: string } }) => ({
    focus: () => focused.push(element.props.accessibilityLabel ?? ''),
    blur: () => blurred.push(element.props.accessibilityLabel ?? ''),
    isFocused: () => alreadyFocused,
    scrollTo,
  });
  return { focused, blurred, scrollTo, createNodeMock };
}

/** jest.setup.js stubs Animated.event, so the scroll listener is called directly. */
const reportScroll = (y: number) => {
  const [, config] = (Animated.event as jest.Mock).mock.calls.at(-1);
  act(() => config.listener({ nativeEvent: { contentOffset: { y } } }));
};
const nextFrame = () => act(() => jest.advanceTimersByTime(20));

describe('StepTask template tap (SBA-03)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefills title, category and price, emits both analytics events, and stays on step 1', () => {
    const { getByLabelText, onUpdate, onNext, onFieldFocus } = renderStep({ title: 'Existing title' });

    fireEvent.press(getByLabelText('Assemble my furniture, suggested $40'));

    expect(onFieldFocus).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({
      title: 'Assemble my furniture',
      category: 'labor',
      amount: 40,
      isForHonor: false,
    });
    expect(mockTrackEvent).toHaveBeenNthCalledWith(
      1,
      'category_selected',
      expect.objectContaining({
        surface: 'create_flow',
        category: 'labor',
        method: 'template',
        template_id: 'assemble_furniture',
      })
    );
    expect(mockTrackEvent).toHaveBeenNthCalledWith(
      2,
      'post_chip_tapped',
      expect.objectContaining({
        surface: 'create_flow',
        chip_id: 'assemble_furniture',
        category: 'labor',
        amount: 40,
      })
    );
    expect(onNext).not.toHaveBeenCalled();
  });

  it('focuses the required details field', () => {
    const { focused, createNodeMock } = focusRecorder();
    const { getByLabelText } = renderStep({}, { createNodeMock });

    fireEvent.press(getByLabelText('Walk my dog, suggested $20'));

    expect(focused).toEqual([DETAIL_LABEL]);
  });

  it('keeps details the poster already typed', () => {
    const { getByLabelText, onUpdate } = renderStep({ description: 'Sunday after 2pm, two flights up' });

    fireEvent.press(getByLabelText('Help me move in, suggested $90'));

    expect(onUpdate.mock.calls[0][0]).not.toHaveProperty('description');
  });

  it('keeps the templates and their order', () => {
    const { getAllByLabelText } = renderStep();
    const rows = getAllByLabelText(/, suggested \$\d+$/).map((r: any) => r.props.accessibilityLabel);
    expect(rows).toEqual([
      'Hold my spot in the merch line, suggested $25',
      'Take lecture notes for me, suggested $20',
      'Cut my hair at my place, suggested $65',
      'Mount my TV, suggested $35',
      'Explain my insurance policy, suggested $30',
      'Hem my gown, suggested $45',
      'Tagalog language translator, suggested $55',
      'Walk my dog, suggested $20',
      'Clean out my closet, suggested $60',
      'Help me move in, suggested $90',
      'Design an artwork, suggested $100',
      'Assemble my furniture, suggested $40',
    ]);
  });
});

describe('StepTask "What exactly, and when?" field', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the label and a placeholder that fits the template', () => {
    const { getByText, getByLabelText } = renderStep({ title: 'Walk my dog' });
    expect(getByText(DETAIL_LABEL)).toBeTruthy();
    expect(getByLabelText(DETAIL_LABEL).props.placeholder).toBe(
      'One 30-minute walk for a friendly lab, Saturday morning'
    );
  });

  it('uses a generic placeholder for a typed title', () => {
    const { getByLabelText } = renderStep({ title: 'Fix my bike chain' });
    expect(getByLabelText(DETAIL_LABEL).props.placeholder).toBe(
      'Two boxes from my car up to the 3rd floor, Sunday after 2pm'
    );
  });

  it('saves what the poster types as the description', () => {
    const { getByLabelText, onUpdate } = renderStep({ title: 'Walk my dog' });
    fireEvent.changeText(getByLabelText(DETAIL_LABEL), 'Saturday 9am, 30 minutes');
    expect(onUpdate).toHaveBeenCalledWith({ description: 'Saturday 9am, 30 minutes' });
  });

  it('shows what is already in the draft (resumed draft, or Back from step 2)', () => {
    const { getByLabelText } = renderStep({ title: 'Walk my dog', description: 'Saturday 9am, 30 minutes' });
    expect(getByLabelText(DETAIL_LABEL).props.value).toBe('Saturday 9am, 30 minutes');
  });

  it.each([
    ['a template title', 'Walk my dog'],
    ['a typed title', 'Fix my bike chain'],
  ])('keeps Next disabled with %s until the details reach 20 characters', (_label, title) => {
    const short = renderStep({ title, description: 'x'.repeat(19) });
    expect(nextDisabled(short.getByLabelText)).toBe(true);
    short.unmount();

    const enough = renderStep({ title, description: TWENTY });
    expect(nextDisabled(enough.getByLabelText)).toBe(false);
    fireEvent.press(enough.getByLabelText('Next'));
    expect(enough.onNext).toHaveBeenCalledTimes(1);
  });

  it('does not count surrounding whitespace', () => {
    const { getByLabelText } = renderStep({ title: 'Walk my dog', description: `   ${'x'.repeat(19)}   ` });
    expect(nextDisabled(getByLabelText)).toBe(true);
  });

  it('counts down the characters still needed', () => {
    const { getByText } = renderStep({ title: 'Walk my dog', description: 'Saturday 9am' });
    expect(getByText('8 more characters')).toBeTruthy();
  });

  it('still requires a valid title', () => {
    const { getByLabelText } = renderStep({ title: 'abc', description: TWENTY });
    expect(nextDisabled(getByLabelText)).toBe(true);
  });

  it('blocks contact details in the details field', () => {
    const { getByLabelText, getByText } = renderStep({
      title: 'Walk my dog',
      description: 'Saturday morning, text me at 410-555-1212',
    });
    expect(getByText(CONTACT_INFO_ERROR)).toBeTruthy();
    expect(nextDisabled(getByLabelText)).toBe(true);
  });

  it('moves from the title to the details field on return, rather than advancing', () => {
    const { focused, createNodeMock } = focusRecorder();
    const { getByLabelText, onNext } = renderStep({ title: 'Walk my dog' }, { createNodeMock });

    fireEvent(getByLabelText('What do you need done?'), 'submitEditing');

    expect(focused).toEqual([DETAIL_LABEL]);
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('StepTask with composer-template-details off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFeatureFlag.mockReturnValue(false);
  });

  afterEach(() => {
    mockUseFeatureFlag.mockReset();
  });

  it('keeps Next disabled on an empty detail and the original hint', () => {
    const { getByLabelText, getByText } = renderStep({ title: 'Walk my dog' });
    expect(nextDisabled(getByLabelText)).toBe(true);
    expect(getByText('Add what and when to continue')).toBeTruthy();
  });

  it('shows the example without an "e.g." prefix', () => {
    const { getByLabelText } = renderStep({ title: 'Walk my dog' });
    expect(getByLabelText(DETAIL_LABEL).props.placeholder).toBe(
      'One 30-minute walk for a friendly lab, Saturday morning'
    );
  });

  it('focuses the details in the same tick as the template tap', () => {
    const { focused, createNodeMock } = focusRecorder();
    const { getByLabelText } = renderStep({}, { createNodeMock });

    fireEvent.press(getByLabelText('Mount my TV, suggested $35'));

    expect(focused).toEqual([DETAIL_LABEL]);
  });

  it('records a blocked tap but shows nothing and moves no focus', () => {
    const { focused, createNodeMock } = focusRecorder();
    const telemetry = { nextTapped: jest.fn(), validationShown: jest.fn() };
    const { getByTestId, queryByText } = renderStep({ title: 'Walk my dog' }, { createNodeMock, telemetry });

    fireEvent.press(getByTestId('blocked-tap-capture'));

    expect(telemetry.nextTapped).toHaveBeenCalledWith(
      expect.objectContaining({ blocked: true, missingField: 'description' })
    );
    expect(focused).toEqual([]);
    expect(queryByText(DETAIL_BLOCKED)).toBeNull();
  });

  it('has no tap capture without telemetry', () => {
    const { queryByTestId } = renderStep({ title: 'Walk my dog' });
    expect(queryByTestId('blocked-tap-capture')).toBeNull();
  });
});

describe('StepTask with composer-template-details on', () => {
  const frameGlobals = globalThis as unknown as {
    requestAnimationFrame?: (callback: () => void) => unknown;
    cancelAnimationFrame?: (id: unknown) => void;
  };
  const originalFrame = frameGlobals.requestAnimationFrame;
  const originalCancelFrame = frameGlobals.cancelAnimationFrame;

  // Not defined under this jest environment; a frame is a short timer here.
  // Restored in afterAll because the renderer's cleanup unmounts after afterEach.
  beforeAll(() => {
    frameGlobals.requestAnimationFrame = (callback) => setTimeout(callback, 16);
    frameGlobals.cancelAnimationFrame = (id) => clearTimeout(id as ReturnType<typeof setTimeout>);
  });

  afterAll(() => {
    frameGlobals.requestAnimationFrame = originalFrame;
    frameGlobals.cancelAnimationFrame = originalCancelFrame;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockUseFeatureFlag.mockReturnValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    mockUseFeatureFlag.mockReset();
  });

  it('reads the agreed flag', () => {
    renderStep();
    expect(mockUseFeatureFlag).toHaveBeenCalledWith('composer-template-details');
  });

  it('fills the template, leaves the description alone and focuses the details a frame later', () => {
    const { focused, createNodeMock } = focusRecorder();
    const { getByLabelText, onUpdate, onNext } = renderStep({}, { createNodeMock });

    fireEvent.press(getByLabelText('Mount my TV, suggested $35'));

    expect(onUpdate.mock.calls[0][0]).toMatchObject({ title: 'Mount my TV', amount: 35 });
    expect(onUpdate.mock.calls[0][0]).not.toHaveProperty('description');
    expect(focused).toEqual([]);
    nextFrame();
    expect(focused).toEqual([DETAIL_LABEL]);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('scrolls the card into view first and focuses once the scroll lands', () => {
    const { focused, scrollTo: scrollToMock, createNodeMock } = focusRecorder();
    const { getByLabelText } = renderStep({}, { createNodeMock });
    reportScroll(400);

    fireEvent.press(getByLabelText('Mount my TV, suggested $35'));
    expect(scrollToMock).toHaveBeenCalledWith({ y: 0, animated: true });

    reportScroll(180);
    nextFrame();
    expect(focused).toEqual([]);

    reportScroll(0);
    nextFrame();
    expect(focused).toEqual([DETAIL_LABEL]);
  });

  it('scrolls to the top of the card, clear of the top inset', () => {
    const { scrollTo: scrollToMock, createNodeMock } = focusRecorder();
    const utils = render(
      <StepTask
        draft={{ title: '', description: '', amount: 0, isForHonor: false, category: 'other', workType: 'in_person' } as any}
        onUpdate={jest.fn()}
        onNext={jest.fn()}
        topInset={44}
        step={1}
        totalSteps={3}
      />,
      { createNodeMock }
    );
    fireEvent(utils.getByTestId('step-task-card'), 'layout', { nativeEvent: { layout: { y: 200 } } });

    fireEvent.press(utils.getByLabelText('Mount my TV, suggested $35'));

    expect(scrollToMock).toHaveBeenCalledWith({ y: 144, animated: true });
  });

  it('still focuses if the scroll never reports landing', () => {
    const { focused, createNodeMock } = focusRecorder();
    const { getByLabelText } = renderStep({}, { createNodeMock });
    reportScroll(400);

    fireEvent.press(getByLabelText('Mount my TV, suggested $35'));
    act(() => jest.advanceTimersByTime(499));
    expect(focused).toEqual([]);
    act(() => jest.advanceTimersByTime(20));

    expect(focused).toEqual([DETAIL_LABEL]);
  });

  it('reopens the keyboard on a field that kept focus after the keyboard was hidden', () => {
    // jest.setup.js's Keyboard mock has no isVisible.
    const keyboard = Keyboard as unknown as { isVisible?: () => boolean };
    keyboard.isVisible = () => false;
    const { focused, blurred, createNodeMock } = focusRecorder({ alreadyFocused: true });
    const { getByLabelText } = renderStep({}, { createNodeMock });

    fireEvent.press(getByLabelText('Mount my TV, suggested $35'));
    nextFrame();

    expect(blurred).toEqual([DETAIL_LABEL]);
    expect(focused).toEqual([DETAIL_LABEL]);
    delete keyboard.isVisible;
  });

  it('advances from a template with no details typed', () => {
    const { getByLabelText, queryByTestId, onNext } = renderStep({ title: 'Mount my TV' });

    expect(nextDisabled(getByLabelText)).toBe(false);
    expect(queryByTestId('blocked-tap-capture')).toBeNull();
    fireEvent.press(getByLabelText('Next'));

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('treats whitespace-only details as empty', () => {
    const { getByLabelText } = renderStep({ title: 'Mount my TV', description: '    ' });
    expect(nextDisabled(getByLabelText)).toBe(false);
  });

  it('holds started details to 20 characters', () => {
    const short = renderStep({ title: 'Mount my TV', description: 'x'.repeat(19) });
    expect(nextDisabled(short.getByLabelText)).toBe(true);
    expect(short.getByText('1 more character')).toBeTruthy();
    short.unmount();

    const enough = renderStep({ title: 'Mount my TV', description: TWENTY });
    expect(nextDisabled(enough.getByLabelText)).toBe(false);
  });

  it('still requires a valid title and blocks contact details', () => {
    expect(nextDisabled(renderStep({ title: 'abc' }).getByLabelText)).toBe(true);
    expect(
      nextDisabled(renderStep({ title: 'Mount my TV', description: 'Text me at 410-555-1212 today' }).getByLabelText)
    ).toBe(true);
  });

  it('marks the placeholder as an example and the field as optional', () => {
    const { getByLabelText, getByText } = renderStep({ title: 'Walk my dog' });
    const input = getByLabelText(DETAIL_LABEL);
    expect(input.props.placeholder).toBe('e.g. One 30-minute walk for a friendly lab, Saturday morning');
    expect(input.props.accessibilityHint).toMatch(/^Optional\./);
    expect(getByText('Optional, but details help people say yes')).toBeTruthy();
  });

  it('keeps the generic hint until there is a title', () => {
    expect(renderStep().getByText('Location and reward come next')).toBeTruthy();
  });

  it('on a blocked tap for short details, focuses them and shows one message', () => {
    const { focused, createNodeMock } = focusRecorder();
    const { getByLabelText, getByTestId, getByText, queryByText, onNext } = renderStep(
      { title: 'Mount my TV', description: 'Saturday' },
      { createNodeMock }
    );
    fireEvent(getByLabelText(DETAIL_LABEL), 'blur');
    expect(getByText('Description must be at least 20 characters')).toBeTruthy();

    fireEvent.press(getByTestId('blocked-tap-capture'));
    nextFrame();

    expect(focused).toEqual([DETAIL_LABEL]);
    expect(getByText(DETAIL_BLOCKED)).toBeTruthy();
    expect(queryByText('Description must be at least 20 characters')).toBeNull();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('on a blocked tap for the title, focuses the title and says why', () => {
    const { focused, createNodeMock } = focusRecorder();
    const { getByTestId, getByText } = renderStep({ title: '' }, { createNodeMock });

    fireEvent.press(getByTestId('blocked-tap-capture'));
    nextFrame();

    expect(focused).toEqual([TITLE_LABEL]);
    expect(getByText(TITLE_BLOCKED)).toBeTruthy();
  });

  it('on a blocked tap for contact details in the title, focuses the title and shows the error once', () => {
    const { focused, createNodeMock } = focusRecorder();
    const { getByTestId, getAllByText } = renderStep({ title: 'Text 410-555-1212' }, { createNodeMock });

    fireEvent.press(getByTestId('blocked-tap-capture'));
    nextFrame();

    expect(focused).toEqual([TITLE_LABEL]);
    expect(getAllByText(CONTACT_INFO_ERROR)).toHaveLength(1);
  });

  it('on a blocked tap for contact details in the description, focuses the description', () => {
    const { focused, createNodeMock } = focusRecorder();
    const { getByTestId, getAllByText } = renderStep(
      { title: 'Mount my TV', description: 'Saturday morning, text me at 410-555-1212' },
      { createNodeMock }
    );

    fireEvent.press(getByTestId('blocked-tap-capture'));
    nextFrame();

    expect(focused).toEqual([DETAIL_LABEL]);
    expect(getAllByText(CONTACT_INFO_ERROR)).toHaveLength(1);
  });

  it('drops the message once the field is no longer in the way', () => {
    const props = { onUpdate: jest.fn(), onNext: jest.fn(), step: 1, totalSteps: 3 };
    const base = { title: 'Mount my TV', amount: 35, isForHonor: false, category: 'other', workType: 'in_person' };
    const utils = render(<StepTask {...props} draft={{ ...base, description: 'Saturday' } as any} />);

    fireEvent.press(utils.getByTestId('blocked-tap-capture'));
    expect(utils.getByText(DETAIL_BLOCKED)).toBeTruthy();

    utils.rerender(<StepTask {...props} draft={{ ...base, description: TWENTY } as any} />);
    expect(utils.queryByText(DETAIL_BLOCKED)).toBeNull();
  });

  it('keeps firing post_next_tapped through telemetry on a blocked tap', () => {
    const telemetry = { nextTapped: jest.fn(), validationShown: jest.fn(), detailFirstTyped: jest.fn() };
    const { getByTestId } = renderStep({ title: 'Mount my TV', description: 'Saturday' }, { telemetry });

    fireEvent.press(getByTestId('blocked-tap-capture'));

    expect(telemetry.nextTapped).toHaveBeenCalledWith(
      expect.objectContaining({ blocked: true, missingField: 'description' })
    );
  });

  it('reports no length validation for an empty detail', () => {
    const telemetry = { nextTapped: jest.fn(), validationShown: jest.fn() };
    renderStep({ title: 'Mount my TV' }, { telemetry });
    expect(telemetry.validationShown).not.toHaveBeenCalled();
  });
});

describe('StepTask contextual help tooltips', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits post_help_opened with the term when the bounty tooltip opens', () => {
    const { getByLabelText } = renderStep({ title: 'Existing title' });

    fireEvent.press(getByLabelText('Help: How a bounty works'));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'post_help_opened',
      expect.objectContaining({ surface: 'create_flow', step_index: 1, term: 'bounty' })
    );
  });
});
