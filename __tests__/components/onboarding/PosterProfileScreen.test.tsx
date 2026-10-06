/**
 * Coverage for the poster profile step (app/onboarding/poster-profile.tsx).
 *
 * Invariants: Continue commits the trimmed name/bio to the draft and advances
 * to the founder note; it stays disabled with nothing entered; Skip advances
 * without committing anything, so a half-typed name never reaches the profile.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useFocusEffect: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUpdateData = jest.fn();
let mockData = { displayName: '', bio: '', avatarUri: '', location: '' };
jest.mock('../../../lib/context/onboarding-context', () => ({
  useOnboarding: () => ({ data: mockData, updateData: mockUpdateData }),
}));

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('../../../lib/services/avatar-service', () => ({
  avatarService: { uploadAvatar: jest.fn() },
}));

jest.mock('../../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), success: jest.fn(), error: jest.fn(), medium: jest.fn() },
}));

jest.mock('../../../components/onboarding/OnboardingProgressDots', () => ({
  ONBOARDING_TOTAL_STEPS: 5,
  OnboardingProgressDots: () => null,
}));

import PosterProfileScreen from '../../../app/onboarding/poster-profile';

beforeEach(() => {
  jest.clearAllMocks();
  mockData = { displayName: '', bio: '', avatarUri: '', location: '' };
});

describe('onboarding poster profile step', () => {
  it('commits the trimmed name and bio, then advances to the founder note', () => {
    const { getByLabelText } = render(<PosterProfileScreen />);
    fireEvent.changeText(getByLabelText('Name'), '  Sam Rivera ');
    fireEvent.changeText(getByLabelText('Short bio'), ' Dog owner, pays fast. ');
    fireEvent.press(getByLabelText('Continue'));

    expect(mockUpdateData).toHaveBeenCalledWith({
      displayName: 'Sam Rivera',
      bio: 'Dog owner, pays fast.',
      avatarUri: '',
    });
    expect(mockPush).toHaveBeenCalledWith('/onboarding/founder-note');
  });

  it('keeps Continue disabled until something is entered', () => {
    const { getByLabelText } = render(<PosterProfileScreen />);
    fireEvent.press(getByLabelText('Continue'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockUpdateData).not.toHaveBeenCalled();
  });

  it('skips without writing anything to the draft', () => {
    const { getByLabelText } = render(<PosterProfileScreen />);
    fireEvent.changeText(getByLabelText('Name'), 'Half typ');
    fireEvent.press(getByLabelText('Skip for now'));

    expect(mockUpdateData).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/onboarding/founder-note');
  });

  it('shows the location from the location step in the preview', () => {
    mockData = { ...mockData, location: 'Fall Creek' };
    const { getByText } = render(<PosterProfileScreen />);
    expect(getByText('New poster · Fall Creek')).toBeTruthy();
  });

  it('resumes what was entered before', () => {
    mockData = { ...mockData, displayName: 'Sam', bio: 'Hi' };
    const { getByDisplayValue } = render(<PosterProfileScreen />);
    expect(getByDisplayValue('Sam')).toBeTruthy();
    expect(getByDisplayValue('Hi')).toBeTruthy();
  });
});
