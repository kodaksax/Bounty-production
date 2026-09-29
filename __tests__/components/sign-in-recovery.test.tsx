/**
 * Regression coverage for the reported beta bug:
 * "sign-in becomes unusable after an incorrect password".
 *
 * Three separate mechanisms turned a wrong password into a permanently broken
 * Sign In button, all reproduced here:
 *
 *  1. `loginAttempts` was persisted and only ever cleared by a SUCCESSFUL
 *     sign-in, so three fumbled passwords at any point in the app's lifetime
 *     left the CAPTCHA armed across restarts — and an unsolved CAPTCHA makes
 *     the form reject the tap locally, before any request is sent.
 *  2. Reaching the lockout threshold left the counter at/above the threshold,
 *     so every later failure re-armed another full lockout.
 *  3. The submission debounce was measured from the START of the previous
 *     attempt and returned silently, swallowing the retry tap that follows a
 *     fast local rejection.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';

const signInWithPassword = jest.fn();
const mfaLevel = jest.fn().mockResolvedValue({
  data: { currentLevel: 'aal1', nextLevel: 'aal1' },
});
const profileSingle = jest.fn().mockResolvedValue({
  data: { username: 'veteran', onboarding_completed: true },
  error: null,
});

jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      signInWithIdToken: jest.fn(),
      mfa: { getAuthenticatorAssuranceLevel: () => mfaLevel() },
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: () => profileSingle() }) }),
    }),
  },
}));

const store = new Map<string, string>();
jest.mock('lib/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  },
}));

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
}));

jest.mock('expo-image', () => ({ Image: 'Image' }));
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
jest.mock('lib/hooks/useScreenBackground', () => ({ __esModule: true, default: () => {} }));
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
jest.mock('lib/utils/auth-diagnostics', () => ({
  emitAuthLoginSuccess: jest.fn().mockResolvedValue(undefined),
  // Pass straight through: the real helper races a NetInfo probe we don't need here.
  runAuthStageWithTimeout: ({ run }: { run: (s: AbortSignal) => PromiseLike<unknown> }) =>
    Promise.resolve(run(new AbortController().signal)),
}));
jest.mock('lib/storage/onboarding', () => ({
  hasLocalOnboardingFlag: jest.fn().mockResolvedValue(false),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SignInForm } = require('../../app/auth/sign-in-form');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CAPTCHA_THRESHOLD } = require('../../lib/utils/captcha');

const GOOD_SESSION = {
  session: { access_token: 'tok', user: { id: 'user-abc', email: 'a@b.test' } },
};

const INVALID_CREDENTIALS = {
  data: { session: null },
  error: { message: 'Invalid login credentials', status: 400 },
};

function fillCredentials(utils: ReturnType<typeof render>, password = 'CorrectHorse1!') {
  fireEvent.changeText(utils.getByPlaceholderText('you@example.com'), 'a@b.test');
  fireEvent.changeText(utils.getByPlaceholderText('Password'), password);
}

async function tapSignIn(utils: ReturnType<typeof render>) {
  fireEvent.press(utils.getByLabelText('Sign in'));
  // Let the submission promise chain settle.
  await waitFor(() => expect(true).toBe(true));
}

describe('sign-in recovery after a failed attempt', () => {
  beforeEach(() => {
    store.clear();
    signInWithPassword.mockReset();
    mockReplace.mockClear();
    mockPush.mockClear();
    mockBack.mockClear();
    mockCanGoBack.mockClear();
    mockCanGoBack.mockReturnValue(true);
    profileSingle.mockClear();
  });

  it('sends "Create an account" to the sign-up form, not the onboarding landing page', () => {
    const utils = render(<SignInForm />);

    fireEvent.press(utils.getByLabelText('Create an account'));

    expect(mockPush).toHaveBeenCalledWith('/auth/sign-up-form');
    expect(mockPush).not.toHaveBeenCalledWith('/onboarding/welcome');
  });

  it('gives a back control that leaves the auth flow', () => {
    const utils = render(<SignInForm />);

    fireEvent.press(utils.getByLabelText('Go back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('executes a second real request after a wrong password', async () => {
    signInWithPassword
      .mockResolvedValueOnce(INVALID_CREDENTIALS)
      .mockResolvedValueOnce({ data: GOOD_SESSION, error: null });

    const utils = render(<SignInForm />);
    fillCredentials(utils, 'wrong-password');

    await tapSignIn(utils);
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));

    // Correct the password and try again — the request must actually go out.
    fireEvent.changeText(utils.getByPlaceholderText('Password'), 'CorrectHorse1!');
    await tapSignIn(utils);

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  });

  it('does not enable Google sign-in on Android from an iOS client ID', () => {
    const originalOs = Platform.OS;
    // The react-native jest preset ships the iOS Platform mock, whose
    // `select` hardcodes the `.ios` branch and never consults `Platform.OS`.
    // The component gates Google config through `Platform.select`, so without
    // a select() that honors the overridden OS this test can't exercise the
    // Android path at all.
    const originalSelect = Platform.select;
    const originalIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    const originalAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
    const originalWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    Platform.select = (spec: Record<string, unknown>) =>
      (Platform.OS in spec ? spec[Platform.OS] : spec.default ?? spec.native);
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-client.apps.googleusercontent.com';
    delete process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

    try {
      const utils = render(<SignInForm />);
      // Unconfigured Google is hidden entirely, not shown as an inert button.
      expect(utils.queryByLabelText('Continue with Google')).toBeNull();
      expect(utils.queryByLabelText('Google sign-in unavailable')).toBeNull();
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOs });
      Platform.select = originalSelect;
      if (originalIosClientId === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
      else process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = originalIosClientId;
      if (originalAndroidClientId === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
      else process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID = originalAndroidClientId;
      if (originalWebClientId === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
      else process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = originalWebClientId;
    }
  });

  it('keeps executing requests across repeated wrong passwords', async () => {
    signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);

    const utils = render(<SignInForm />);
    fillCredentials(utils, 'wrong-password');

    for (let i = 1; i <= CAPTCHA_THRESHOLD; i++) {
      // eslint-disable-next-line no-await-in-loop
      await tapSignIn(utils);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(i));
    }
  });

  it('shows the CAPTCHA once the threshold is reached and lets it be solved', async () => {
    signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);

    const utils = render(<SignInForm />);
    fillCredentials(utils, 'wrong-password');

    for (let i = 0; i < CAPTCHA_THRESHOLD; i++) {
      // eslint-disable-next-line no-await-in-loop
      await tapSignIn(utils);
    }

    // The challenge appears, and it must be a solvable challenge — not just a
    // silent gate that makes the button look broken.
    const answerInput = await waitFor(() => utils.getByLabelText(/Enter the answer to/i));
    expect(answerInput).toBeTruthy();

    const label = answerInput.props.accessibilityLabel as string;
    const match = label.match(/(\d+)\s*([+-])\s*(\d+)$/);
    expect(match).toBeTruthy();
    const [, a, op, b] = match!;
    const answer = op === '+' ? Number(a) + Number(b) : Number(a) - Number(b);

    signInWithPassword.mockResolvedValue({ data: GOOD_SESSION, error: null });
    fireEvent.changeText(answerInput, String(answer));
    fireEvent.changeText(utils.getByPlaceholderText('Password'), 'CorrectHorse1!');

    const callsBefore = signInWithPassword.mock.calls.length;
    await tapSignIn(utils);

    await waitFor(() =>
      expect(signInWithPassword.mock.calls.length).toBeGreaterThan(callsBefore)
    );
  });

  it('discards a stale persisted attempt count instead of arming the CAPTCHA forever', async () => {
    // Simulates a device that failed three sign-ins some time ago. Under the
    // old behaviour this count survived indefinitely and every later Sign In
    // tap was rejected locally by the CAPTCHA gate.
    store.set('loginAttempts', String(CAPTCHA_THRESHOLD));
    store.set('loginAttemptsAt', String(Date.now() - 60 * 60 * 1000)); // 1 hour ago

    signInWithPassword.mockResolvedValue({ data: GOOD_SESSION, error: null });

    const utils = render(<SignInForm />);
    // Wait for the throttle hydration effect to run.
    await waitFor(() => expect(utils.queryByLabelText(/Enter the answer to/i)).toBeNull());

    fillCredentials(utils);
    await tapSignIn(utils);

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));
  });

  it('does not restart the throttle TTL just because the screen was reopened', async () => {
    // The production Android trap: the write-back effect stamped
    // `loginAttemptsAt` with Date.now() every time the screen mounted and
    // rehydrated a stored count, so the 15-minute TTL restarted on every
    // visit and could never elapse. A user who once failed three times kept a
    // permanently-armed CAPTCHA and every later Sign In tap was rejected
    // locally — production telemetry showed 25 AUTH_CAPTCHA_SHOWN against a
    // single AUTH_CAPTCHA_SOLVED on Android, with users cycling for 20+
    // minutes without ever getting in.
    const originalFailureAt = Date.now() - 14 * 60 * 1000; // 14 min ago: still fresh
    store.set('loginAttempts', String(CAPTCHA_THRESHOLD));
    store.set('loginAttemptsAt', String(originalFailureAt));

    // Visit 1: the CAPTCHA is legitimately still armed.
    const first = render(<SignInForm />);
    await waitFor(() => expect(first.queryByLabelText(/Enter the answer to/i)).not.toBeNull());
    first.unmount();

    // The stored timestamp must still describe the ORIGINAL failure, not this
    // visit. Before the fix it had been rewritten to "now".
    expect(Number(store.get('loginAttemptsAt'))).toBe(originalFailureAt);

    // Visit 2, past the TTL measured from the original failure: the throttle
    // must have aged out and the CAPTCHA must be gone.
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(originalFailureAt + 16 * 60 * 1000);
    try {
      signInWithPassword.mockResolvedValue({ data: GOOD_SESSION, error: null });
      const second = render(<SignInForm />);
      await waitFor(() => expect(second.queryByLabelText(/Enter the answer to/i)).toBeNull());

      fillCredentials(second);
      await tapSignIn(second);

      // The tap must reach the network, not be rejected locally by the gate.
      await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('honours a FRESH persisted attempt count', async () => {
    store.set('loginAttempts', String(CAPTCHA_THRESHOLD));
    store.set('loginAttemptsAt', String(Date.now()));

    const utils = render(<SignInForm />);

    await waitFor(() => expect(utils.getByLabelText(/Enter the answer to/i)).toBeTruthy());
  });

  it('clears a lockout that has already elapsed, and does not leave the CAPTCHA armed', async () => {
    store.set('lockoutUntil', String(Date.now() - 1000));
    store.set('loginAttempts', '5');
    store.set('loginAttemptsAt', String(Date.now()));

    signInWithPassword.mockResolvedValue({ data: GOOD_SESSION, error: null });

    const utils = render(<SignInForm />);
    fillCredentials(utils);

    await waitFor(() => expect(store.has('lockoutUntil')).toBe(false));
    await tapSignIn(utils);

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalled());
  });

  it('always resolves the loading state after a failure', async () => {
    signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);

    const utils = render(<SignInForm />);
    fillCredentials(utils, 'wrong-password');
    await tapSignIn(utils);

    // The email field is only editable when the form is not submitting, so a
    // stuck loading state would leave it disabled forever.
    await waitFor(() =>
      expect(utils.getByPlaceholderText('you@example.com').props.editable).toBe(true)
    );
  });

  it('reports a real reason on AUTH_ATTEMPT_FAILED, not "unknown"', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { capture } = require('lib/posthog');
    capture.mockClear();
    signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);

    const utils = render(<SignInForm />);
    fillCredentials(utils, 'wrong-password');
    await tapSignIn(utils);

    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith(
        'AUTH_ATTEMPT_FAILED',
        expect.objectContaining({ error_code: 'invalid_credentials', outcome: 'rejected' })
      )
    );
  });

  it('labels the Sign In button with a live lockout countdown, keeping it findable', async () => {
    store.set('lockoutUntil', String(Date.now() + 5 * 60 * 1000));

    const utils = render(<SignInForm />);

    // The button reads as a countdown, not a dead control...
    await waitFor(() => expect(utils.getByText(/Try again in \d+s/)).toBeTruthy());
    // ...while its action label stays stable so it is still reachable.
    expect(utils.getByLabelText('Sign in')).toBeTruthy();
  });

  it('labels the Sign In button with the CAPTCHA gate once the challenge arms', async () => {
    signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);

    const utils = render(<SignInForm />);
    fillCredentials(utils, 'wrong-password');

    for (let i = 0; i < CAPTCHA_THRESHOLD; i++) {
      // eslint-disable-next-line no-await-in-loop
      await tapSignIn(utils);
    }

    await waitFor(() => expect(utils.getByText('Complete the security check')).toBeTruthy());
    // The action label is unchanged, so screen readers and taps still work.
    expect(utils.getByLabelText('Sign in')).toBeTruthy();
  });

  it('resets the attempt counter on a successful sign-in', async () => {
    signInWithPassword
      .mockResolvedValueOnce(INVALID_CREDENTIALS)
      .mockResolvedValueOnce({ data: GOOD_SESSION, error: null });

    const utils = render(<SignInForm />);
    fillCredentials(utils, 'wrong-password');
    await tapSignIn(utils);
    await waitFor(() => expect(store.get('loginAttempts')).toBe('1'));

    fireEvent.changeText(utils.getByPlaceholderText('Password'), 'CorrectHorse1!');
    await tapSignIn(utils);

    await waitFor(() => expect(store.has('loginAttempts')).toBe(false));
  });
});
