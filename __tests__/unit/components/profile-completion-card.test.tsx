/**
 * The complete_profile moment as a dismissible card on Profile (2026-11-17).
 * Same rule as the moment (no bio or no location); a dismissal is remembered
 * for a week on this device.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

import {
  isProfileCardSnoozed,
  ProfileCompletionCard,
  profileNeedsCompleting,
} from '../../../components/profile-completion-card';
import { analyticsService } from '../../../lib/services/analytics-service';

const DAY = 24 * 3600_000;

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('profile completion card', () => {
  it('uses the moment\'s rule: a missing bio or location', () => {
    expect(profileNeedsCompleting({ about: '', location: 'Austin, TX' })).toBe(true);
    expect(profileNeedsCompleting({ about: 'Retired teacher', location: null })).toBe(true);
    expect(profileNeedsCompleting({ about: 'Retired teacher', location: 'Austin, TX' })).toBe(false);
  });

  it('shows on Profile and opens the profile editor', async () => {
    const { findByTestId, getByText } = render(
      <ProfileCompletionCard userId="u1" profile={{ about: null, location: null }} isActive />
    );
    await findByTestId('profile-completion-card');
    fireEvent.press(getByText('Complete profile'));
    expect(mockPush).toHaveBeenCalledWith('/profile/edit');
  });

  it('hides when dismissed and stays hidden for a week', async () => {
    const { findByTestId, queryByTestId, getByLabelText } = render(
      <ProfileCompletionCard userId="u1" profile={{ about: null, location: null }} isActive />
    );
    await findByTestId('profile-completion-card');
    await act(async () => {
      fireEvent.press(getByLabelText('Hide this for now'));
    });
    expect(queryByTestId('profile-completion-card')).toBeNull();

    const remount = render(<ProfileCompletionCard userId="u1" profile={{ about: null, location: null }} />);
    await waitFor(() => expect(mockStore.size).toBe(1));
    await act(async () => {});
    expect(remount.queryByTestId('profile-completion-card')).toBeNull();

    const dismissedAt = [...mockStore.values()][0];
    expect(isProfileCardSnoozed(dismissedAt, new Date(dismissedAt).getTime() + 6 * DAY)).toBe(true);
    expect(isProfileCardSnoozed(dismissedAt, new Date(dismissedAt).getTime() + 7 * DAY)).toBe(false);
  });

  it('never shows for a finished profile', async () => {
    const { queryByTestId } = render(
      <ProfileCompletionCard
        userId="u1"
        profile={{ about: 'Retired teacher', location: 'Austin, TX' }}
        isActive
      />
    );
    await act(async () => {});
    expect(queryByTestId('profile-completion-card')).toBeNull();
  });

  it('does not track an impression until Profile is visible', async () => {
    const trackEvent = analyticsService.trackEvent as jest.Mock;
    const view = render(
      <ProfileCompletionCard userId="u1" profile={{ about: null, location: null }} isActive={false} />
    );
    await act(async () => {});
    expect(view.queryByTestId('profile-completion-card')).toBeNull();
    expect(trackEvent).not.toHaveBeenCalledWith('profile_completion_card_shown', {});

    view.rerender(
      <ProfileCompletionCard userId="u1" profile={{ about: null, location: null }} isActive />
    );
    await view.findByTestId('profile-completion-card');
    expect(trackEvent).toHaveBeenCalledWith('profile_completion_card_shown', {});
  });
});
