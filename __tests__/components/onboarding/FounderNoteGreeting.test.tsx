/**
 * Coverage for the founder note's "Thank you, {name}." line
 * (app/onboarding/founder-note.tsx): first name only, from the onboarding
 * draft (poster profile step) or else the profile's display name, and left
 * out entirely when neither exists — never the username.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('../../../components/onboarding/CarouselGlow', () => ({
  CarouselGlow: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockDisplayName = '';
jest.mock('../../../lib/context/onboarding-context', () => ({
  useOnboarding: () => ({
    data: { intent: 'poster', displayName: mockDisplayName },
    updateData: jest.fn(),
  }),
}));

let mockProfile: { username: string; display_name?: string } | null = null;
jest.mock('../../../hooks/useAuthProfile', () => ({
  useAuthProfile: () => ({ profile: mockProfile, userId: 'u1' }),
}));

jest.mock('../../../hooks/useCompleteOnboarding', () => ({
  useCompleteOnboarding: () => ({ complete: jest.fn(), isLoading: false }),
}));

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('../../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), success: jest.fn(), error: jest.fn(), medium: jest.fn() },
}));

import FounderNoteScreen from '../../../app/onboarding/founder-note';

beforeEach(() => {
  mockDisplayName = '';
  mockProfile = null;
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
});

describe('founder note greeting', () => {
  it('thanks the user by the first name they entered on the profile step', () => {
    mockDisplayName = '  Maya Lopez ';
    mockProfile = { username: 'maya_r92', display_name: 'Someone Else' };
    const { getByText } = render(<FounderNoteScreen />);
    expect(getByText('Thank you, Maya.')).toBeTruthy();
  });

  it("falls back to the profile's display name when the draft has none", () => {
    mockProfile = { username: 'maya_r92', display_name: 'Maya Lopez' };
    const { getByText } = render(<FounderNoteScreen />);
    expect(getByText('Thank you, Maya.')).toBeTruthy();
  });

  it('leaves the line out rather than thanking a username', () => {
    mockProfile = { username: 'maya_r92' };
    const { queryByText } = render(<FounderNoteScreen />);
    expect(queryByText(/Thank you/)).toBeNull();
  });
});
