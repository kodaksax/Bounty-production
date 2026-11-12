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

const signInWithOtp = jest.fn();
jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signInWithOtp: (...a: unknown[]) => signInWithOtp(...a),
    },
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
  hasLocalOnboardingFlag: jest.fn().mockResolvedValue(false),
}));
jest.mock('lib/services/userProfile', () => ({
  isUsernameUnique: jest.fn().mockResolvedValue(true),
  validateUsername: jest.fn(() => ({ valid: true })),
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

// SignUpForm now shares its OAuth entry points with sign-in-form.tsx via
// useSocialAuth() (see WelcomeCarousel.tsx's top comment for why: role
// selection moved off the pre-auth welcome screen, so this screen picked up
// the "Continue with Apple/Google" buttons that used to live on
// onboarding/username.tsx). These mocks mirror sign-in-recovery.test.tsx's.
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Svg: 'Svg',
  Path: 'Path',
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: 'AppleAuthenticationButton',
  AppleAuthenticationButtonType: { SIGN_IN: 0 },
  AppleAuthenticationButtonStyle: { BLACK: 0 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  signInAsync: jest.fn(),
}));
jest.mock('expo-auth-session', () => ({ ResponseType: { IdToken: 'id_token' } }));
jest.mock('expo-auth-session/providers/google', () => ({
  useIdTokenAuthRequest: () => [null, null, jest.fn()],
}));
jest.mock('lib/posthog', () => ({
  capture: jest.fn(),
  identify: jest.fn(),
}));
jest.mock('lib/utils/auth-diagnostics', () => ({
  emitAuthLoginSuccess: jest.fn().mockResolvedValue(undefined),
  runAuthStageWithTimeout: ({ run }: { run: (s: AbortSignal) => PromiseLike<unknown> }) =>
    Promise.resolve(run(new AbortController().signal)),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SignUpForm } = require('../../app/auth/sign-up-form');

function fillValidForm(utils: ReturnType<typeof render>) {
  fireEvent.changeText(utils.getByPlaceholderText('username'), 'tester');
  fireEvent.changeText(utils.getByPlaceholderText('you@example.com'), 'new@user.test');
  fireEvent.changeText(utils.getByPlaceholderText('Create a password'), 'CorrectHorse1!');
  // No confirm-password field or age/terms checkboxes: pressing "Create
  // Account" is itself the consent (see the legal line in sign-up-form.tsx).
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

// Website checkout creates the poster's account with no password. When they
// later try to sign up in the app, register answers 409 for the email. That
// used to be a dead end ("sign in instead" — with what password?). It now
// offers one button that emails a code and opens sign-in on the code field.
describe('sign-up with an email that already has an account', () => {
  const conflict = () =>
    jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify({ error: 'Email already registered' }),
    });

  beforeEach(() => {
    trackEvent.mockClear();
    mockReplace.mockClear();
    signInWithOtp.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../../lib/auth/email-code-sign-in').clearEmailCodeHandoff();
  });

  it('replaces the dead-end error with a code offer and reports the detection', async () => {
    (global as any).fetch = conflict();

    const utils = render(<SignUpForm />);
    fillValidForm(utils);
    fireEvent.press(utils.getByLabelText('Create account'));

    await waitFor(() => expect(utils.getByText('You already have a Bounty account.')).toBeTruthy());
    expect(utils.getByText("We'll email you a 6-digit code to sign in.")).toBeTruthy();
    expect(utils.getByText('new@user.test')).toBeTruthy();
    expect(utils.queryByText(/Please sign in instead or use password reset/)).toBeNull();
    expect(trackEvent).toHaveBeenCalledWith('auth_existing_account_detected', {
      method: 'email',
      source: 'sign_up_form',
    });
  });

  it('sends the code with one tap, then opens sign-in on the code step for that address', async () => {
    (global as any).fetch = conflict();
    signInWithOtp.mockResolvedValue({ error: null });

    const utils = render(<SignUpForm />);
    fillValidForm(utils);
    fireEvent.press(utils.getByLabelText('Create account'));
    await waitFor(() => expect(utils.getByLabelText('Email me a code')).toBeTruthy());

    fireEvent.press(utils.getByLabelText('Email me a code'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/sign-in-form'));
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'new@user.test',
      // Never make a second, empty account from this screen.
      options: { shouldCreateUser: false },
    });
    expect(trackEvent).toHaveBeenCalledWith('auth_otp_sent', {
      method: 'email_otp',
      source: 'signup_existing_account',
      is_resend: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { peekEmailCodeHandoff } = require('../../lib/auth/email-code-sign-in');
    expect(peekEmailCodeHandoff()).toEqual(
      expect.objectContaining({ email: 'new@user.test', source: 'signup_existing_account' })
    );
    // The address goes to sign-in in memory, never in route params or events.
    expect(JSON.stringify(mockReplace.mock.calls)).not.toContain('new@user.test');
    expect(JSON.stringify(trackEvent.mock.calls)).not.toContain('new@user.test');
  });

  it('stays on the offer and says why when the code cannot be sent', async () => {
    (global as any).fetch = conflict();
    signInWithOtp.mockResolvedValue({
      error: { message: 'For security purposes, you can only request this after 42 seconds.', status: 429, code: 'over_email_send_rate_limit' },
    });

    const utils = render(<SignUpForm />);
    fillValidForm(utils);
    fireEvent.press(utils.getByLabelText('Create account'));
    await waitFor(() => expect(utils.getByLabelText('Email me a code')).toBeTruthy());

    fireEvent.press(utils.getByLabelText('Email me a code'));

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        'auth_otp_failed',
        expect.objectContaining({
          method: 'email_otp',
          source: 'signup_existing_account',
          stage: 'send',
          error_code: 'over_email_send_rate_limit',
        })
      )
    );
    expect(mockReplace).not.toHaveBeenCalledWith('/auth/sign-in-form');
    expect(utils.getByText('You already have a Bounty account.')).toBeTruthy();
    await waitFor(() =>
      expect(
        utils.getByText('We just sent a code. You can ask for another in 42 seconds.')
      ).toBeTruthy()
    );
  });

  it('lets the person go back and use a different email', async () => {
    (global as any).fetch = conflict();

    const utils = render(<SignUpForm />);
    fillValidForm(utils);
    fireEvent.press(utils.getByLabelText('Create account'));
    await waitFor(() => expect(utils.getByLabelText('Use a different email')).toBeTruthy());

    fireEvent.press(utils.getByLabelText('Use a different email'));

    expect(utils.queryByText('You already have a Bounty account.')).toBeNull();
    expect(utils.getByLabelText('Create account')).toBeTruthy();
  });
});

// SBA-13: `signup_completed` is sent by the server once per new profile, for
// every sign-in method (20261020140000_server_signup_completed_event.sql). The
// email form sending it as well would count email signups twice.
describe('sign-up success analytics', () => {
  beforeEach(() => {
    trackEvent.mockClear();
    mockReplace.mockClear();
  });

  it('does not send a client signup_completed after a successful registration', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
      json: async () => ({ success: true }),
    });
    // No session and no error = confirmation required: the branch right after
    // the point where the client event used to fire.
    const { supabase } = jest.requireMock('lib/supabase');
    supabase.auth.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error: null });

    const utils = render(<SignUpForm />);
    fillValidForm(utils);
    fireEvent.press(utils.getByLabelText('Create account'));

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('auth_signup_requires_confirmation', {
        method: 'email',
      })
    );
    expect(trackEvent.mock.calls.map(([event]) => event)).not.toContain('signup_completed');
  });
});

// Shoal 19 Oct: the live hint said "@x is available" under a red "already
// taken" banner. The server's 409 is the final word, so the hint follows it.
describe('sign-up username taken at submit', () => {
  it('flips the live hint to taken when register answers 409 for the username', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify({ error: 'Username already taken' }),
    });

    const utils = render(<SignUpForm />);
    fillValidForm(utils);
    await waitFor(() => expect(utils.getByText('@tester is available')).toBeTruthy());

    fireEvent.press(utils.getByLabelText('Create account'));

    await waitFor(() => expect(utils.getByText('@tester is already taken')).toBeTruthy());
    expect(utils.queryByText('@tester is available')).toBeNull();
  });
});

// SBA-06: the field used to say only "At least 8 characters" and reveal the
// other four rules after a failed submit (4 of 6 Shoal posters hit it).
describe('sign-up password checklist', () => {
  const RULES = ['length', 'uppercase', 'lowercase', 'number', 'special'];
  const isMet = (utils: ReturnType<typeof render>, id: string) =>
    /: done$/.test(utils.getByTestId(`password-rule-${id}`).props.accessibilityLabel);

  it('states every rule before the first keystroke', () => {
    const utils = render(<SignUpForm />);
    for (const id of RULES) expect(isMet(utils, id)).toBe(false);
    expect(utils.getByText('Symbol @$!%*?&')).toBeTruthy();
  });

  it('ticks each rule as the password satisfies it', () => {
    const utils = render(<SignUpForm />);
    const field = utils.getByPlaceholderText('Create a password');

    fireEvent.changeText(field, 'correcthorse12');
    expect(RULES.filter(id => isMet(utils, id))).toEqual(['length', 'lowercase', 'number']);

    fireEvent.changeText(field, 'CorrectHorse1!');
    expect(RULES.every(id => isMet(utils, id))).toBe(true);
  });
});
