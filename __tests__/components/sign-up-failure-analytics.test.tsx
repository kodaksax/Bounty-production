/**
 * Regression coverage for the reported analytics blind spot:
 * a rejected email registration left no trace in analytics.
 *
 * Every backend-rejection branch of the sign-up form only called setAuthError
 * and returned, and the outer catch never runs for a resolved HTTP response,
 * so `auth_signup_failed` never fired. This asserts the failure is now captured
 * with the HTTP status and a groupable reason.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

const trackEvent = jest.fn();
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: unknown[]) => trackEvent(...a) },
}));

jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { signInWithPassword: jest.fn() },
    from: () => ({ select: () => ({ eq: () => ({ single: jest.fn() }) }) }),
  },
}));

jest.mock('lib/config', () => ({ config: { supabase: { anonKey: 'anon-key' } } }));
jest.mock('lib/config/api', () => ({ API_BASE_URL: 'https://api.test' }));

jest.mock('lib/storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('lib/storage/onboarding', () => ({
  markDeviceHasSignedIn: jest.fn(),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('lib/hooks/useScreenBackground', () => ({ __esModule: true, default: () => {} }));
jest.mock('components/ui/branding-logo', () => ({ BrandingLogo: () => null }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SignUpForm } = require('../../app/auth/sign-up-form');

function fillValidForm(utils: ReturnType<typeof render>) {
  fireEvent.changeText(utils.getByPlaceholderText('Choose a username (3-24 chars)'), 'tester');
  fireEvent.changeText(utils.getByPlaceholderText('you@example.com'), 'new@user.test');
  fireEvent.changeText(utils.getByPlaceholderText('At least 8 characters'), 'CorrectHorse1!');
  fireEvent.changeText(utils.getByPlaceholderText('Confirm password'), 'CorrectHorse1!');
  // Age + Terms checkboxes (no accessibility label, so match on the role prop).
  utils.UNSAFE_getAllByProps({ accessibilityRole: 'checkbox' }).forEach(box =>
    fireEvent.press(box)
  );
}

describe('sign-up failure analytics', () => {
  beforeEach(() => {
    trackEvent.mockClear();
    mockReplace.mockClear();
  });

  it('captures auth_signup_failed with status and reason on a 409 rejection', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify({ error: 'Email already registered' }),
    });

    const utils = render(<SignUpForm />);
    fillValidForm(utils);
    fireEvent.press(utils.getByLabelText('Create account'));

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        'auth_signup_failed',
        expect.objectContaining({
          method: 'email',
          status: 409,
          reason: 'email_already_registered',
        })
      )
    );
  });

  it('reports a server_error reason on a 500 rejection', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Internal Server Error',
    });

    const utils = render(<SignUpForm />);
    fillValidForm(utils);
    fireEvent.press(utils.getByLabelText('Create account'));

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        'auth_signup_failed',
        expect.objectContaining({ method: 'email', status: 500, reason: 'server_error' })
      )
    );
  });
});
