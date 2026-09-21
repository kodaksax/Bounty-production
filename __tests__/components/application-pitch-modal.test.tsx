/**
 * ApplicationPitchModal — the "why me?" pitch sheet on the public bounty
 * route. These tests pin the fix for the dead apply button: on a bounty that
 * requires a pitch ($150+), the primary button must stay pressable so a short
 * pitch produces an inline reason and a blocked-tap event instead of silent
 * nothing, and the character counter must be visible the whole time.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { ApplicationPitchModal } from '../../components/application-pitch-modal';
import { PITCH_REQUIRED_MIN_LENGTH } from '../../lib/utils/pitch-requirement';

const REQUIRED_BOUNTY = { amount: 200, is_for_honor: false, category: 'labor' };
const OPTIONAL_BOUNTY = { amount: 20, is_for_honor: false, category: 'labor' };

function renderModal(overrides: Partial<React.ComponentProps<typeof ApplicationPitchModal>> = {}) {
  const props = {
    visible: true,
    bounty: REQUIRED_BOUNTY,
    netEarnings: 180,
    grossAmount: 200,
    isSubmitting: false,
    onCancel: jest.fn(),
    onSubmit: jest.fn(),
    onPitchSubmitted: jest.fn(),
    onPitchBlocked: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<ApplicationPitchModal {...props} />) };
}

describe('ApplicationPitchModal required-pitch gate', () => {
  it('shows the character counter as soon as a pitch is required', () => {
    const { getByText } = renderModal();
    expect(getByText(`0/${PITCH_REQUIRED_MIN_LENGTH}`)).toBeTruthy();
  });

  it('lets a too-short apply tap through: no submit, a blocked event, an inline reason', () => {
    const { props, getByText, queryByText } = renderModal();

    fireEvent.press(getByText('Apply — earn $180.00'));

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onPitchSubmitted).not.toHaveBeenCalled();
    expect(props.onPitchBlocked).toHaveBeenCalledWith(0);
    expect(queryByText(/Write at least/)).toBeTruthy();
  });

  it('submits once the pitch meets the minimum length', () => {
    const pitch = 'x'.repeat(PITCH_REQUIRED_MIN_LENGTH);
    const { props, getByLabelText, getByText } = renderModal();

    fireEvent.changeText(getByLabelText('Application pitch'), pitch);
    fireEvent.press(getByText('Apply — earn $180.00'));

    expect(props.onPitchBlocked).not.toHaveBeenCalled();
    expect(props.onPitchSubmitted).toHaveBeenCalledWith(pitch);
    expect(props.onSubmit).toHaveBeenCalledWith(pitch);
  });

  it('clears the inline error once the pitch becomes long enough', () => {
    const { getByLabelText, getByText, queryByText } = renderModal();

    fireEvent.press(getByText('Apply — earn $180.00'));
    expect(queryByText(/Write at least/)).toBeTruthy();

    fireEvent.changeText(getByLabelText('Application pitch'), 'x'.repeat(PITCH_REQUIRED_MIN_LENGTH));
    expect(queryByText(/Write at least/)).toBeNull();
  });

  it('announces the blocked-tap reason to screen readers on both platforms', () => {
    const { getByText } = renderModal();

    fireEvent.press(getByText('Apply — earn $180.00'));

    const errorText = getByText(/Write at least/);
    // accessibilityLiveRegion alone only announces on Android; accessibilityRole
    // "alert" is what gets this spoken by VoiceOver on iOS too.
    expect(errorText.props.accessibilityRole).toBe('alert');
    expect(errorText.props.accessibilityLiveRegion).toBe('assertive');
  });
});

describe('ApplicationPitchModal optional pitch', () => {
  it('submits straight away and never blocks when no pitch is required', () => {
    const { props, getByText, queryByText } = renderModal({ bounty: OPTIONAL_BOUNTY });

    // No required counter on a low-amount bounty.
    expect(queryByText(`0/${PITCH_REQUIRED_MIN_LENGTH}`)).toBeNull();

    fireEvent.press(getByText('Apply — earn $180.00'));
    expect(props.onPitchBlocked).not.toHaveBeenCalled();
    expect(props.onSubmit).toHaveBeenCalledWith(null);
  });
});
