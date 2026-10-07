/**
 * Coverage for the poster profile step (app/onboarding/poster-profile.tsx).
 *
 * Invariants: Continue commits the trimmed name/bio to the draft and advances
 * to the founder note; it stays disabled with nothing entered; Skip advances
 * without committing anything, so a half-typed name never reaches the profile.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
const mockUploadAvatar = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useFocusEffect: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: mockRequestMediaLibraryPermissionsAsync,
  launchImageLibraryAsync: mockLaunchImageLibraryAsync,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUpdateData = jest.fn();
let mockData = {
  displayName: '',
  bio: '',
  avatarUri: '',
  location: '',
  locationPrecision: null as 'precise' | 'approximate' | 'denied' | 'skipped' | null,
};
jest.mock('../../../lib/context/onboarding-context', () => ({
  useOnboarding: () => ({ data: mockData, updateData: mockUpdateData }),
}));

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('../../../lib/services/avatar-service', () => ({
  avatarService: { uploadAvatar: mockUploadAvatar },
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
  mockData = { displayName: '', bio: '', avatarUri: '', location: '', locationPrecision: null };
  mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
  mockLaunchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///avatar.jpg', fileName: 'avatar.jpg', mimeType: 'image/jpeg', fileSize: 1024 }],
  });
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

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
    mockData = { ...mockData, location: 'Fall Creek', locationPrecision: 'approximate' };
    const { getByText } = render(<PosterProfileScreen />);
    expect(getByText('New poster · Fall Creek')).toBeTruthy();
  });

  it('does not show the precise location in the hunter preview', () => {
    mockData = { ...mockData, location: '12 Main St, Brooklyn, NY', locationPrecision: 'precise' };
    const { getByText, queryByText } = render(<PosterProfileScreen />);
    expect(getByText('New poster')).toBeTruthy();
    expect(queryByText('New poster · 12 Main St, Brooklyn, NY')).toBeNull();
  });

  it('resumes what was entered before', () => {
    mockData = { ...mockData, displayName: 'Sam', bio: 'Hi' };
    const { getByDisplayValue } = render(<PosterProfileScreen />);
    expect(getByDisplayValue('Sam')).toBeTruthy();
    expect(getByDisplayValue('Hi')).toBeTruthy();
  });

  it('saves a remotely uploaded avatar URL to the draft', async () => {
    mockUploadAvatar.mockResolvedValue({
      avatarUrl: 'https://cdn.example.com/avatar.jpg',
      error: null,
    });

    const { getByLabelText } = render(<PosterProfileScreen />);
    fireEvent.press(getByLabelText('Add profile photo'));
    await flush();
    fireEvent.press(getByLabelText('Continue'));

    expect(mockUploadAvatar).toHaveBeenCalledWith('file:///avatar.jpg', {
      fileName: 'avatar.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
    });
    expect(mockUpdateData).toHaveBeenCalledWith({
      displayName: '',
      bio: '',
      avatarUri: 'https://cdn.example.com/avatar.jpg',
    });
  });

  it('rejects a local fallback key when avatar upload fails', async () => {
    mockUploadAvatar.mockResolvedValue({
      avatarUrl: 'attachment-cache-avatar.jpg',
      error: null,
    });

    const { getByLabelText } = render(<PosterProfileScreen />);
    fireEvent.press(getByLabelText('Add profile photo'));
    await flush();
    fireEvent.press(getByLabelText('Continue'));

    expect(mockUpdateData).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('disables profile actions while the avatar is uploading', async () => {
    let finishUpload!: (result: { avatarUrl: string; error: null }) => void;
    mockUploadAvatar.mockReturnValue(
      new Promise<{ avatarUrl: string; error: null }>(resolve => {
        finishUpload = resolve;
      })
    );

    const { getByLabelText } = render(<PosterProfileScreen />);
    fireEvent.press(getByLabelText('Add profile photo'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getByLabelText('Change profile photo').props.disabled).toBe(true);
    expect(getByLabelText('Continue').props.disabled).toBe(true);
    expect(getByLabelText('Skip for now').props.disabled).toBe(true);

    await act(async () => {
      finishUpload({ avatarUrl: 'https://cdn.example.com/avatar.jpg', error: null });
    });
  });
});
