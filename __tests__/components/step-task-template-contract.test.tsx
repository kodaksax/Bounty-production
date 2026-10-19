import { AccessibilityInfo } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
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

const DETAIL_LABEL = 'What exactly, and when?';
const TWENTY = 'One 30-minute walk!!';

function renderStep(
  draftOverrides: Record<string, unknown> = {},
  options: { createNodeMock?: (element: any) => unknown } = {}
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
function focusRecorder() {
  const focused: string[] = [];
  const createNodeMock = (element: { props: { accessibilityLabel?: string } }) => ({
    focus: () => focused.push(element.props.accessibilityLabel ?? ''),
    scrollTo: jest.fn(),
  });
  return { focused, createNodeMock };
}

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
