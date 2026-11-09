/**
 * Coverage for the unserviceable-region waitlist step
 * (app/onboarding/waitlist.tsx).
 *
 * Invariants: the email is persisted and reaches PostHog only as a $set person
 * property (never as a plain event property, which also feeds HeyCatch and
 * Sentry), an invalid email fires nothing, and the screen is never a wall.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockInsert = jest.fn();
let mockParams: Record<string, string> = { country_code: 'GB', region: 'England' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: mockBack, canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../components/ui/keyboard-avoiding', () => {
  const { View } = require('react-native');
  return { KeyboardAwareScrollView: View, KeyboardAvoidingScreen: View };
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

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ insert: (...args: unknown[]) => mockInsert(...args) })),
  },
}));

jest.mock('../../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), success: jest.fn(), error: jest.fn(), medium: jest.fn() },
}));

import WaitlistScreen, { WaitlistContent } from '../../../app/onboarding/waitlist';

const eventsNamed = (name: string) => mockTrackEvent.mock.calls.filter(([e]) => e === name);

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = null;
  mockParams = { country_code: 'GB', region: 'England' };
  mockInsert.mockResolvedValue({ error: null });
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

  it('persists a valid email before capturing it as a PostHog-only person property', async () => {
    mockSession = { user: { id: 'u1', email: 'account@example.com' } };
    const { getByLabelText, getByText, queryByText } = render(<WaitlistScreen />);
    fireEvent.changeText(getByLabelText('Email address'), '  Ada@Example.com ');
    fireEvent.press(getByLabelText('Notify me'));

    await waitFor(() => expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'u1',
      email: 'ada@example.com',
      country_code: 'GB',
      region: 'England',
      source: 'mobile_onboarding',
    }));
    await waitFor(() => getByText("You're on the list"));
    const captured = eventsNamed('waitlist_captured');
    expect(captured).toHaveLength(1);
    const [, props, options] = captured[0];
    expect(props).toEqual({
      country_code: 'GB',
      region: 'England',
      intent: 'poster',
      source: 'onboarding_location',
      is_signed_in: true,
      email_matches_account: false,
    });
    expect(JSON.stringify(props)).not.toContain('@');
    expect(options.setPersonProperties).toMatchObject({
      waitlist_email: 'ada@example.com',
      waitlist_country_code: 'GB',
      waitlist_region: 'England',
    });

    expect(getByText(/We'll let you know/)).toBeTruthy();
    expect(queryByText(/ada@example\.com/i)).toBeNull();
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

  it('pre-fills the signed-in account email', async () => {
    mockSession = { user: { id: 'u1', email: 'me@bounty.test' } };
    const { getByLabelText } = render(<WaitlistScreen />);
    fireEvent.press(getByLabelText('Notify me'));

    await waitFor(() => expect(mockInsert).toHaveBeenCalled());
    const [, props, options] = eventsNamed('waitlist_captured')[0];
    expect(props).toMatchObject({ is_signed_in: true, email_matches_account: true });
    expect(options.setPersonProperties.waitlist_email).toBe('me@bounty.test');
  });

  it('keeps the form retryable when persistence fails', async () => {
    mockSession = { user: { id: 'u1', email: 'me@bounty.test' } };
    mockInsert.mockResolvedValueOnce({ error: { code: '42501' } });
    const { getByLabelText, getByText } = render(<WaitlistScreen />);
    fireEvent.press(getByLabelText('Notify me'));

    await waitFor(() => getByText("We couldn't save your email. Please try again."));
    expect(getByText(/Bounty isn't in/)).toBeTruthy();
    expect(eventsNamed('waitlist_captured')).toHaveLength(0);

    fireEvent.press(getByLabelText('Notify me'));
    await waitFor(() => getByText("You're on the list"));
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('lets the user continue without an email', () => {
    const { getByLabelText } = render(<WaitlistScreen />);
    fireEvent.press(getByLabelText('Continue anyway'));

    expect(mockPush).toHaveBeenCalledWith('/onboarding/role-select');
    expect(eventsNamed('unserviceable_region_continued')).toHaveLength(1);
    expect(eventsNamed('waitlist_captured')).toHaveLength(0);
  });

  describe('opened from the Post tab', () => {
    const renderPostTab = () => render(<WaitlistContent intent="none" origin="post_tab" />);

    it('tags the event with where it came from', () => {
      renderPostTab();
      expect(eventsNamed('unserviceable_region_shown')[0][1]).toMatchObject({ source: 'post_tab' });
    });

    it('goes back to the composer on "Continue anyway"', () => {
      const { getByLabelText } = renderPostTab();
      fireEvent.press(getByLabelText('Continue anyway'));
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('writes to the same table with its own source', async () => {
      mockSession = { user: { id: 'u1', email: 'me@bounty.test' } };
      const { getByLabelText, getByText } = renderPostTab();
      fireEvent.press(getByLabelText('Notify me'));
      await waitFor(() => getByText("You're on the list"));
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'me@bounty.test', source: 'mobile_post_tab' })
      );
      fireEvent.press(getByLabelText('Continue'));
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });
});
