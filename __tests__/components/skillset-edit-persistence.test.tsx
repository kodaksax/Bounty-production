import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SkillsetEditScreen } from '../../components/skillset-edit-screen';
import { useAuthProfile } from '../../hooks/useAuthProfile';
jest.mock('../../hooks/useAuthProfile', () => ({ useAuthProfile: jest.fn() }));
jest.mock('../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }));
jest.mock('../../lib/services/analytics-service', () => ({ analyticsService: { trackEvent: jest.fn() } }));

const mockUpdate = jest.fn();
const mockProfile = { skills: ['Organization'], skill_categories: [] };
beforeEach(() => {
  jest.clearAllMocks();
  (useAuthProfile as jest.Mock).mockReturnValue({ profile: mockProfile, userId: 'owner', updateProfile: mockUpdate });
});
it('uses persisted skills instead of invented defaults or supplied local cached skills', () => {
  const view = render(<SkillsetEditScreen initialSkills={[{ id: 'cached', icon: 'code', text: 'Fake cached credential' }]} />);
  expect(view.getByDisplayValue('Organization')).toBeTruthy();
  expect(view.queryByDisplayValue('Fake cached credential')).toBeNull();
  expect(view.queryByDisplayValue('Private Investigator Certification')).toBeNull();
});
it.each([false, 'reject'])('does not close or signal save success on failed server persistence: %s', async result => {
  if (result === 'reject') mockUpdate.mockRejectedValue(new Error('unavailable'));
  else mockUpdate.mockResolvedValue(false);
  const onBack = jest.fn();
  const onSave = jest.fn();
  const view = render(<SkillsetEditScreen onBack={onBack} onSave={onSave} />);
  fireEvent.press(view.getByLabelText('Save skillsets'));
  await waitFor(() => expect(view.getByText(result === 'reject' ? 'Error saving skills' : 'Error saving skills to profile')).toBeTruthy());
  expect(onBack).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});
it('closes only after confirmed persisted success', async () => {
  mockUpdate.mockResolvedValue(true);
  const onBack = jest.fn();
  const onSave = jest.fn();
  const view = render(<SkillsetEditScreen onBack={onBack} onSave={onSave} />);
  fireEvent.press(view.getByLabelText('Save skillsets'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(mockUpdate).toHaveBeenCalledWith({ skills: ['Organization'], skill_categories: [] });
  expect(onBack).toHaveBeenCalledTimes(1);
});
