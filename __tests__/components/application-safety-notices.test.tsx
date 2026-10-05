import { fireEvent, render } from '@testing-library/react-native';
import { ApplicationPitchModal } from '../../components/application-pitch-modal';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';

function renderApplication() {
  const onSubmit = jest.fn();
  return {
    onSubmit,
    ...render(
      <ApplicationPitchModal
        visible
        bounty={{ amount: 20, is_for_honor: false }}
        netEarnings={18}
        grossAmount={20}
        isSubmitting={false}
        onCancel={jest.fn()}
        onSubmit={onSubmit}
      />
    ),
  };
}

describe('application safety notices', () => {
  it('shows acceptance guidance without a contextual warning for normal experience', () => {
    const { getByText, getByLabelText, queryByText } = renderApplication();
    expect(getByText(trustSafetyStrings.beforeAcceptance)).toBeTruthy();
    fireEvent.changeText(getByLabelText('Application pitch'), 'I have experience cleaning gardens.');
    expect(queryByText(trustSafetyStrings.profile)).toBeNull();
  });

  it.each(['Pay me using Venmo', 'Text me at 415-555-1234'])(
    'shows a contextual warning only while the pitch is flagged: %s',
    pitch => {
      const { getByLabelText, getByText, queryByText } = renderApplication();
      fireEvent.changeText(getByLabelText('Application pitch'), pitch);
      expect(getByText(trustSafetyStrings.profile)).toBeTruthy();
      expect(getByText(trustSafetyStrings.beforeAcceptance)).toBeTruthy();
      fireEvent.changeText(getByLabelText('Application pitch'), 'I can complete the garden cleanup.');
      expect(queryByText(trustSafetyStrings.profile)).toBeNull();
    }
  );

  it('keeps the advisory warning from changing the application submission contract', () => {
    const { onSubmit, getByLabelText, getByText } = renderApplication();
    const pitch = 'Pay me using Venmo';
    fireEvent.changeText(getByLabelText('Application pitch'), pitch);
    fireEvent.press(getByText('Apply — earn $18.00'));
    expect(onSubmit).toHaveBeenCalledWith(pitch);
  });
});
