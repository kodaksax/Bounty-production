/**
 * Client lifecycle tests for the password-recovery deep link.
 *
 * These exercise the bug that made the whole flow unusable: Supabase returns
 * recovery credentials in the URL **fragment**, and expo-router strips the
 * fragment from native deep links before `useLocalSearchParams()` ever sees it.
 * The callback screen therefore has to read the raw URL from `expo-linking`.
 * A test that only feeds router params would pass against the broken code, so
 * every case here delivers the link the way the OS actually does.
 *
 * Covered: cold start, app already running (warm `url` event), resume, the same
 * link opened twice, expired links, malformed links, and the post-reset state.
 */

import { act, render, waitFor } from '@testing-library/react-native';

// ---- link fixtures: real production redirect shapes ----

const VALID_RECOVERY_URL =
  'bountyexpo-workspace://auth/callback#access_token=at-valid&refresh_token=rt-valid' +
  '&expires_in=3600&token_type=bearer&type=recovery';

const EXPIRED_RECOVERY_URL =
  'bountyexpo-workspace://auth/callback#error=access_denied&error_code=otp_expired' +
  '&error_description=Email+link+is+invalid+or+has+expired&sb=';

const MALFORMED_RECOVERY_URL = 'bountyexpo-workspace://auth/callback#type=recovery';

const SIGNUP_URL =
  'bountyexpo-workspace://auth/callback#access_token=at-s&refresh_token=rt-s&type=signup';

// ---- expo-linking: the raw-URL transport ----

let initialUrl: string | null = null;
let initialUrlDeferred: { resolve: (v: string | null) => void } | null = null;
const urlListeners: ((e: { url: string }) => void)[] = [];
const removeListener = jest.fn();

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(
    () =>
      new Promise<string | null>(resolve => {
        if (initialUrlDeferred) initialUrlDeferred.resolve = resolve;
        else resolve(initialUrl);
      })
  ),
  addEventListener: jest.fn((_event: string, cb: (e: { url: string }) => void) => {
    urlListeners.push(cb);
    return { remove: removeListener };
  }),
  canOpenURL: jest.fn().mockResolvedValue(false),
  openURL: jest.fn().mockResolvedValue(undefined),
}));

// ---- expo-router ----

const mockReplace = jest.fn();
let routerParams: Record<string, string | string[]> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useLocalSearchParams: () => routerParams,
}));

// ---- supabase ----

const mockSetSession = jest.fn();
const mockVerifyOtp = jest.fn();
const mockGetSession = jest.fn();
const mockUpdateUser = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: (...a: unknown[]) => mockSetSession(...a),
      verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
      getSession: (...a: unknown[]) => mockGetSession(...a),
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
      exchangeCodeForSession: jest.fn(),
    },
  },
}));

// ---- auth context ----

const mockBeginPasswordRecovery = jest.fn();
const mockEndPasswordRecovery = jest.fn();

jest.mock('../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({
    beginPasswordRecovery: mockBeginPasswordRecovery,
    endPasswordRecovery: mockEndPasswordRecovery,
  }),
}));

// ---- inert presentation deps ----

jest.mock('../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({
    theme: {
      background: '#000',
      surface: '#111',
      surfaceSecondary: '#222',
      border: '#333',
      text: '#fff',
      textSecondary: '#aaa',
      primary: '#059669',
      isDark: true,
    },
  }),
}));
jest.mock('../../app/initial-navigation/initialNavigation', () => ({
  markInitialNavigationDone: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resetConsumedRecoveryLink } = require('../../lib/auth/consume-auth-link');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AuthCallbackScreen = require('../../app/auth/callback').default;

const SESSION_OK = { data: { session: { access_token: 'at', user: { id: 'u1' } } }, error: null };

beforeEach(() => {
  jest.clearAllMocks();
  resetConsumedRecoveryLink();
  initialUrl = null;
  initialUrlDeferred = null;
  urlListeners.length = 0;
  routerParams = {};
  mockSetSession.mockResolvedValue(SESSION_OK);
  mockVerifyOtp.mockResolvedValue(SESSION_OK);
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
});

describe('cold start with a recovery link', () => {
  it('reads tokens from the fragment and routes to update-password', async () => {
    initialUrl = VALID_RECOVERY_URL;
    render(<AuthCallbackScreen />);

    await waitFor(() => {
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'at-valid',
        refresh_token: 'rt-valid',
      });
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/update-password'));
  });

  it('flags recovery mode before navigating', async () => {
    initialUrl = VALID_RECOVERY_URL;
    render(<AuthCallbackScreen />);

    await waitFor(() => expect(mockBeginPasswordRecovery).toHaveBeenCalled());
  });

  it('holds a verifying state until the cold-start lookup settles, then decides', async () => {
    // Deciding before getInitialURL resolves is exactly how a valid link used
    // to be reported as invalid.
    initialUrlDeferred = { resolve: () => {} };
    const screen = render(<AuthCallbackScreen />);

    expect(screen.getByText('Verifying your link')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      initialUrlDeferred!.resolve(VALID_RECOVERY_URL);
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/update-password'));
  });

  it('does not treat a signup link as recovery', async () => {
    initialUrl = SIGNUP_URL;
    render(<AuthCallbackScreen />);

    await waitFor(() => expect(mockSetSession).toHaveBeenCalled());
    expect(mockBeginPasswordRecovery).not.toHaveBeenCalled();
  });
});

describe('app already running / resumed from background', () => {
  it('handles a link delivered through the url event', async () => {
    render(<AuthCallbackScreen />);
    await waitFor(() => expect(urlListeners.length).toBeGreaterThan(0));

    await act(async () => {
      urlListeners.forEach(cb => cb({ url: VALID_RECOVERY_URL }));
    });

    await waitFor(() =>
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'at-valid',
        refresh_token: 'rt-valid',
      })
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/update-password'));
  });

  it('lets a warm link win over a stale cold-start URL', async () => {
    // iOS keeps returning the original launch URL from getInitialURL; the newer
    // event is the one the user just acted on.
    initialUrlDeferred = { resolve: () => {} };
    render(<AuthCallbackScreen />);
    await waitFor(() => expect(urlListeners.length).toBeGreaterThan(0));

    await act(async () => {
      urlListeners.forEach(cb => cb({ url: VALID_RECOVERY_URL }));
    });
    await act(async () => {
      initialUrlDeferred!.resolve('bountyexpo-workspace://bounty/123');
    });

    await waitFor(() =>
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'at-valid',
        refresh_token: 'rt-valid',
      })
    );
  });

  it('establishes the session exactly once even if the URL is redelivered', async () => {
    initialUrl = VALID_RECOVERY_URL;
    render(<AuthCallbackScreen />);
    await waitFor(() => expect(mockSetSession).toHaveBeenCalledTimes(1));

    await act(async () => {
      urlListeners.forEach(cb => cb({ url: VALID_RECOVERY_URL }));
    });

    expect(mockSetSession).toHaveBeenCalledTimes(1);
  });
});

describe('the same link opened twice', () => {
  it('forwards instead of erroring when the session from the first tap still holds', async () => {
    // First tap consumed the token in this app run.
    initialUrl = VALID_RECOVERY_URL;
    const first = render(<AuthCallbackScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/update-password'));
    first.unmount();
    mockReplace.mockClear();

    // Second tap: Supabase now says the link is expired, but we hold the session.
    initialUrl = EXPIRED_RECOVERY_URL;
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'at' } }, error: null });
    render(<AuthCallbackScreen />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/update-password'));
  });
});

describe('links that cannot be used', () => {
  it('shows an expired state with a request-new-link path', async () => {
    initialUrl = EXPIRED_RECOVERY_URL;
    const screen = render(<AuthCallbackScreen />);

    await waitFor(() => expect(screen.getByText('Reset Link Expired')).toBeTruthy());
    expect(screen.getByText('Request New Reset Link')).toBeTruthy();
    expect(screen.getByText('Back to Sign In')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('never shows the raw Supabase error text to the user', async () => {
    initialUrl = EXPIRED_RECOVERY_URL;
    const screen = render(<AuthCallbackScreen />);

    await waitFor(() => expect(screen.getByText('Reset Link Expired')).toBeTruthy());
    expect(screen.queryByText(/Email link is invalid or has expired/)).toBeNull();
  });

  it('shows an invalid state for a malformed link', async () => {
    initialUrl = MALFORMED_RECOVERY_URL;
    const screen = render(<AuthCallbackScreen />);

    await waitFor(() => expect(screen.getByText('Reset Link Invalid')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows an invalid state when the app is opened with no link at all', async () => {
    initialUrl = null;
    const screen = render(<AuthCallbackScreen />);

    await waitFor(() => expect(screen.getByText('Reset Link Invalid')).toBeTruthy());
  });

  it('offers a retry for a transient network failure and does not offer one otherwise', async () => {
    initialUrl = VALID_RECOVERY_URL;
    mockSetSession.mockRejectedValue(new Error('Network request failed'));
    const screen = render(<AuthCallbackScreen />);

    await waitFor(() => expect(screen.getByText('Something Went Wrong')).toBeTruthy());
    expect(screen.getByText('Try Again')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not offer a retry for an expired link, which retrying cannot fix', async () => {
    initialUrl = EXPIRED_RECOVERY_URL;
    const screen = render(<AuthCallbackScreen />);

    await waitFor(() => expect(screen.getByText('Reset Link Expired')).toBeTruthy());
    expect(screen.queryByText('Try Again')).toBeNull();
  });

  it('does not leak token values into console output', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    initialUrl = VALID_RECOVERY_URL;
    render(<AuthCallbackScreen />);

    await waitFor(() => expect(mockSetSession).toHaveBeenCalled());

    const logged = log.mock.calls.map(c => JSON.stringify(c)).join('\n');
    expect(logged).not.toContain('at-valid');
    expect(logged).not.toContain('rt-valid');
    log.mockRestore();
  });
});

describe('web transport', () => {
  it("accepts the fragment through expo-router's reserved '#' param", async () => {
    // On web the fragment survives and expo-router exposes it this way.
    initialUrl = null;
    routerParams = { '#': 'access_token=at-web&refresh_token=rt-web&type=recovery' };
    render(<AuthCallbackScreen />);

    await waitFor(() =>
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'at-web',
        refresh_token: 'rt-web',
      })
    );
  });

  it('accepts a token_hash query link', async () => {
    initialUrl = 'bountyexpo-workspace://auth/callback?token_hash=hash1&type=recovery';
    render(<AuthCallbackScreen />);

    await waitFor(() =>
      expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'hash1', type: 'recovery' })
    );
  });
});

describe('update-password screen', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { UpdatePasswordScreen } = require('../../app/auth/update-password');

  it('gates on the real Supabase session, not on a URL token', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const screen = render(<UpdatePasswordScreen />);

    await waitFor(() => expect(screen.getByText('Invalid Reset Link')).toBeTruthy());
    expect(screen.getByText('Request New Reset Link')).toBeTruthy();
  });

  it('shows the form when a session exists', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'at' } }, error: null });
    const screen = render(<UpdatePasswordScreen />);

    await waitFor(() => expect(screen.getByText('Create New Password')).toBeTruthy());
  });

  it('clears recovery state after a successful password change so a restart cannot resume it', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'at' } }, error: null });
    mockUpdateUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });

    const screen = render(<UpdatePasswordScreen />);
    await waitFor(() => expect(screen.getByText('Create New Password')).toBeTruthy());

    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.changeText(screen.getByPlaceholderText('Enter new password'), 'Str0ng!Pass1');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm new password'), 'Str0ng!Pass1');
    await act(async () => {
      fireEvent.press(screen.getByText('Update Password'));
    });

    await waitFor(() => expect(screen.getByText('Password Updated!')).toBeTruthy());
    expect(mockEndPasswordRecovery).toHaveBeenCalled();
    expect(require('../../lib/auth/consume-auth-link').hasConsumedRecoveryLink()).toBe(false);
  });

  it('drops to the request-a-new-link screen when the session lapsed mid-submit', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'at' } }, error: null });
    mockUpdateUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Token has expired' },
    });

    const screen = render(<UpdatePasswordScreen />);
    await waitFor(() => expect(screen.getByText('Create New Password')).toBeTruthy());

    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.changeText(screen.getByPlaceholderText('Enter new password'), 'Str0ng!Pass1');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm new password'), 'Str0ng!Pass1');
    await act(async () => {
      fireEvent.press(screen.getByText('Update Password'));
    });

    await waitFor(() => expect(screen.getByText('Invalid Reset Link')).toBeTruthy());
  });

  it('submits updateUser only once for a double tap', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'at' } }, error: null });
    let resolveUpdate: (v: unknown) => void = () => {};
    mockUpdateUser.mockReturnValue(
      new Promise(resolve => {
        resolveUpdate = resolve;
      })
    );

    const screen = render(<UpdatePasswordScreen />);
    await waitFor(() => expect(screen.getByText('Create New Password')).toBeTruthy());

    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.changeText(screen.getByPlaceholderText('Enter new password'), 'Str0ng!Pass1');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm new password'), 'Str0ng!Pass1');

    const button = screen.getByText('Update Password');
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    expect(mockUpdateUser).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveUpdate({ data: { user: { id: 'u1' } }, error: null });
    });
  });

  it('does not log the new password', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'at' } }, error: null });
    mockUpdateUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });

    const screen = render(<UpdatePasswordScreen />);
    await waitFor(() => expect(screen.getByText('Create New Password')).toBeTruthy());

    const { fireEvent } = require('@testing-library/react-native');
    fireEvent.changeText(screen.getByPlaceholderText('Enter new password'), 'Uniq3!Secret9');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm new password'), 'Uniq3!Secret9');
    await act(async () => {
      fireEvent.press(screen.getByText('Update Password'));
    });

    const logged = [...log.mock.calls, ...errorLog.mock.calls]
      .map(c => JSON.stringify(c))
      .join('\n');
    expect(logged).not.toContain('Uniq3!Secret9');
    log.mockRestore();
    errorLog.mockRestore();
  });
});

describe('Site-URL fallback landing on /auth instead of /auth/callback', () => {
  // Production's Site URL is `bountyexpo-workspace://auth`, so a link with an
  // absent or unlisted redirect_to lands on the bare /auth route. Verified
  // live: it arrives as `bountyexpo-workspace://auth#access_token=…&type=recovery`.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AuthIndex = require('../../app/auth/index').default;

  it('handles recovery credentials that land on /auth', async () => {
    initialUrl =
      'bountyexpo-workspace://auth#access_token=at-siteurl&refresh_token=rt-siteurl' +
      '&expires_in=3600&token_type=bearer&type=recovery';

    render(<AuthIndex />);

    await waitFor(() =>
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'at-siteurl',
        refresh_token: 'rt-siteurl',
      })
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/update-password'));
  });

  it('reports an expired link that lands on /auth rather than a blank screen', async () => {
    initialUrl = EXPIRED_RECOVERY_URL.replace('/auth/callback', '/auth');
    const screen = render(<AuthIndex />);

    await waitFor(() => expect(screen.getByText('Reset Link Expired')).toBeTruthy());
  });
});
