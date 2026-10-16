import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SkillsetEditScreen } from '../../components/skillset-edit-screen';
import { useAuthProfile } from '../../hooks/useAuthProfile';
jest.mock('../../hooks/useAuthProfile', () => ({ useAuthProfile: jest.fn() }));
jest.mock('../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }));
jest.mock('../../lib/services/analytics-service', () => ({ analyticsService: { trackEvent: jest.fn() } }));

const mockUpdate = jest.fn();
const mockProfile = { id: 'owner', skills: ['Organization'], skill_categories: [] };
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
it('preserves unsaved skills and categories through a background profile refresh', () => {
  const view = render(<SkillsetEditScreen />);
  fireEvent.changeText(view.getByDisplayValue('Organization'), 'Edited skill');
  fireEvent.press(view.getByLabelText('Add Labor skill category'));
  (useAuthProfile as jest.Mock).mockReturnValue({
    profile: { id: 'owner', skills: ['Refreshed skill'], skill_categories: [] },
    userId: 'owner', updateProfile: mockUpdate,
  });
  view.rerender(<SkillsetEditScreen />);
  expect(view.getByDisplayValue('Edited skill')).toBeTruthy();
  expect(view.getByLabelText('Remove Labor skill category')).toBeTruthy();
  expect(view.queryByDisplayValue('Refreshed skill')).toBeNull();
});
it('refreshes untouched fields when the authoritative profile resolves', () => {
  (useAuthProfile as jest.Mock).mockReturnValue({ profile: null, userId: 'owner', updateProfile: mockUpdate });
  const view = render(<SkillsetEditScreen />);
  (useAuthProfile as jest.Mock).mockReturnValue({ profile: mockProfile, userId: 'owner', updateProfile: mockUpdate });
  view.rerender(<SkillsetEditScreen />);
  expect(view.getByDisplayValue('Organization')).toBeTruthy();
});
it('discards dirty state when the authenticated owner changes', () => {
  const view = render(<SkillsetEditScreen />);
  fireEvent.changeText(view.getByDisplayValue('Organization'), 'First owner edit');
  fireEvent.press(view.getByLabelText('Add Labor skill category'));
  (useAuthProfile as jest.Mock).mockReturnValue({
    profile: { id: 'new-owner', skills: ['New owner skill'], skill_categories: [] },
    userId: 'new-owner', updateProfile: mockUpdate,
  });
  view.rerender(<SkillsetEditScreen />);
  expect(view.getByDisplayValue('New owner skill')).toBeTruthy();
  expect(view.getByLabelText('Add Labor skill category')).toBeTruthy();
  expect(view.queryByDisplayValue('First owner edit')).toBeNull();
});
it('blocks early editing and replacement saves before authoritative profile hydration', () => {
  (useAuthProfile as jest.Mock).mockReturnValue({
    profile: null, userId: 'owner', loading: true, updateProfile: mockUpdate,
  });
  const view = render(<SkillsetEditScreen />);
  fireEvent.press(view.getByLabelText('Add new skill'));
  fireEvent.press(view.getByLabelText('Add Labor skill category'));
  fireEvent.press(view.getByLabelText('Save skillsets'));
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(view.getByText('Load your profile before editing skills.')).toBeTruthy();
  (useAuthProfile as jest.Mock).mockReturnValue({
    profile: { ...mockProfile, skill_categories: ['design'] },
    userId: 'owner', loading: false, updateProfile: mockUpdate,
  });
  view.rerender(<SkillsetEditScreen />);
  expect(view.getByDisplayValue('Organization')).toBeTruthy();
  expect(view.getByLabelText('Remove Design skill category')).toBeTruthy();
  expect(view.getByLabelText('Add Labor skill category')).toBeTruthy();
});
it('blocks writes from an interim profile belonging to the previous owner', () => {
  (useAuthProfile as jest.Mock).mockReturnValue({
    profile: mockProfile, userId: 'new-owner', loading: false, updateProfile: mockUpdate,
  });
  const view = render(<SkillsetEditScreen />);
  fireEvent.press(view.getByLabelText('Save skillsets'));
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(view.queryByDisplayValue('Organization')).toBeNull();
});
it('blocks writes when authoritative profile fetching failed', () => {
  (useAuthProfile as jest.Mock).mockReturnValue({
    profile: mockProfile, userId: 'owner', loading: false,
    profileFetchError: 'network unavailable', updateProfile: mockUpdate,
  });
  const view = render(<SkillsetEditScreen />);
  fireEvent.press(view.getByLabelText('Save skillsets'));
  expect(mockUpdate).not.toHaveBeenCalled();
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
