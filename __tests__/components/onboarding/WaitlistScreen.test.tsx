/**
 * Coverage for the unserviceable-region waitlist step
 * (app/onboarding/waitlist.tsx).
 *
 * Invariants: the email reaches PostHog only as a $set person property (never
 * as a plain event property, which also feeds HeyCatch and Sentry), an invalid
 * email fires nothing, and the screen is never a wall.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
let mockParams: Record<string, string> = { country_code: 'GB', region: 'England' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../components/ui/keyboard-avoiding', () => {
  const { View } = require('react-native');
  return { KeyboardAvoidingScreen: View };
});

let mockSession: { user: { id: string; email?: string } } | null = null;
jest.mock('../../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: mockSession }),
}));

jest.mock('../../../lib/context/onboarding-context', () => ({
  useOnboarding: () => ({ data: { intent: 'poster' }, updateData: jest.fn() }),
}));

const mockTrackEvent = jest.fn();
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => mockTrackEvent(...args) },
}));

jest.mock('../../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), success: jest.fn(), error: jest.fn(), medium: jest.fn() },
}));

import WaitlistScreen from '../../../app/onboarding/waitlist';

const eventsNamed = (name: string) => mockTrackEvent.mock.calls.filter(([e]) => e === name);

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = null;
  mockParams = { country_code: 'GB', region: 'England' };
});

describe('onboarding waitlist step', () => {
  it('fires unserviceable_region_shown once on mount', () => {
    render(<WaitlistScreen />);
    expect(eventsNamed('unserviceable_region_shown')).toEqual([
      [
        'unserviceable_region_shown',
        { country_code: 'GB', region: 'England', intent: 'poster', source: 'onboarding_location' },
      ],
    ]);
  });

  it('captures a valid email as a PostHog-only person property', () => {
    const { getByLabelText, getByText } = render(<WaitlistScreen />);
    fireEvent.changeText(getByLabelText('Email address'), '  Ada@Example.com ');
    fireEvent.press(getByLabelText('Notify me'));

    const captured = eventsNamed('waitlist_captured');
    expect(captured).toHaveLength(1);
    const [, props, options] = captured[0];
    expect(props).toEqual({
      country_code: 'GB',
      region: 'England',
      intent: 'poster',
      source: 'onboarding_location',
      is_signed_in: false,
      email_matches_account: false,
    });
    expect(JSON.stringify(props)).not.toContain('@');
    expect(options.setPersonProperties).toMatchObject({
      waitlist_email: 'ada@example.com',
      waitlist_country_code: 'GB',
      waitlist_region: 'England',
    });

    getByText("You're on the list");
    fireEvent.press(getByLabelText('Continue'));
    expect(mockPush).toHaveBeenCalledWith('/onboarding/role-select');
    // Continuing after a submit isn't a skip.
    expect(eventsNamed('unserviceable_region_continued')).toHaveLength(0);
  });

  it('rejects an invalid email without firing the event', () => {
    const { getByLabelText, getByText } = render(<WaitlistScreen />);
    fireEvent.changeText(getByLabelText('Email address'), 'not-an-email');
    fireEvent.press(getByLabelText('Notify me'));

    getByText('Enter a valid email address.');
    expect(eventsNamed('waitlist_captured')).toHaveLength(0);
  });

  it('pre-fills the signed-in account email', () => {
    mockSession = { user: { id: 'u1', email: 'me@bounty.test' } };
    const { getByLabelText } = render(<WaitlistScreen />);
    fireEvent.press(getByLabelText('Notify me'));

    const [, props, options] = eventsNamed('waitlist_captured')[0];
    expect(props).toMatchObject({ is_signed_in: true, email_matches_account: true });
    expect(options.setPersonProperties.waitlist_email).toBe('me@bounty.test');
  });

  it('lets the user continue without an email', () => {
    const { getByLabelText } = render(<WaitlistScreen />);
    fireEvent.press(getByLabelText('Continue anyway'));

    expect(mockPush).toHaveBeenCalledWith('/onboarding/role-select');
    expect(eventsNamed('unserviceable_region_continued')).toHaveLength(1);
    expect(eventsNamed('waitlist_captured')).toHaveLength(0);
  });
});
