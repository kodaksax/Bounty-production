import { AccessibilityInfo } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { StepTask } from '../../app/screens/CreateBounty/quick/StepTask';

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

describe('StepTask template tap contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefills draft fields, emits both analytics events, and advances', () => {
    const onUpdate = jest.fn();
    const onNext = jest.fn();
    const onFieldFocus = jest.fn();

    const draft = {
      title: 'Existing title',
      description: '',
      amount: 0,
      isForHonor: false,
      category: 'other',
      workType: 'in_person',
    } as any;

    const { getByLabelText } = render(
      <StepTask
        draft={draft}
        onUpdate={onUpdate}
        onNext={onNext}
        onFieldFocus={onFieldFocus}
        step={1}
        totalSteps={6}
      />
    );

    fireEvent.press(getByLabelText('Assemble furniture, suggested $40'));

    expect(onFieldFocus).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({
      title: 'Assemble furniture',
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
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe('StepTask contextual help tooltips', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const draft = {
    title: 'Existing title',
    description: '',
    amount: 0,
    isForHonor: false,
    category: 'other',
    workType: 'in_person',
  } as any;

  const renderStep = () =>
    render(
      <StepTask
        draft={draft}
        onUpdate={jest.fn()}
        onNext={jest.fn()}
        onFieldFocus={jest.fn()}
        step={1}
        totalSteps={6}
      />
    );

  it('emits post_help_opened with the term when the bounty tooltip opens', () => {
    const { getByLabelText } = renderStep();

    fireEvent.press(getByLabelText('Help: How a bounty works'));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'post_help_opened',
      expect.objectContaining({ surface: 'create_flow', step_index: 1, term: 'bounty' })
    );
  });

  it('emits post_help_opened with the term when the price tooltip opens', () => {
    const { getByLabelText } = renderStep();

    fireEvent.press(getByLabelText('Help: About these prices'));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'post_help_opened',
      expect.objectContaining({ surface: 'create_flow', step_index: 1, term: 'price' })
    );
  });
});
