/**
 * Regression coverage for the post-registration sign-in.
 *
 * Registration and session creation are two separate round trips
 * (supabase/functions/auth/index.ts creates the user with `email_confirm: true`,
 * then the client signs in). A brand-new user must never be asked to
 * authenticate a second time, so a single transient failure on that second
 * round trip must not decide whether they get in — and the states that are NOT
 * transient (confirmation required, bad credentials) must be reported
 * distinctly rather than retried into a timeout.
 */

const signInWithPassword = jest.fn();

jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { signInWithPassword: (...a: unknown[]) => signInWithPassword(...a) } },
}));

// The module under test pulls in the whole sign-up screen; stub the pieces that
// need a native runtime or a configured backend.
jest.mock('lib/config/api', () => ({ API_BASE_URL: 'https://example.test/functions/v1' }));
jest.mock('lib/config', () => ({ config: { supabase: { anonKey: 'anon' } } }));
jest.mock('lib/hooks/useScreenBackground', () => ({ __esModule: true, default: () => {} }));
jest.mock('lib/storage', () => ({ storage: { setItem: jest.fn(), getItem: jest.fn() } }));
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { signInAfterRegister } = require('../../../app/auth/sign-up-form');

const SESSION = { access_token: 'tok', user: { id: 'user-abc' } };

describe('signInAfterRegister', () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
  });

  it('returns the session on the happy path', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: SESSION }, error: null });

    await expect(signInAfterRegister('a@b.test', 'pw', 'corr')).resolves.toBe(SESSION);
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('retries once through a transient network failure rather than stranding the user', async () => {
    signInWithPassword
      .mockResolvedValueOnce({
        data: { session: null },
        error: { message: 'Network request failed' },
      })
      .mockResolvedValueOnce({ data: { session: SESSION }, error: null });

    await expect(signInAfterRegister('a@b.test', 'pw', 'corr')).resolves.toBe(SESSION);
    expect(signInWithPassword).toHaveBeenCalledTimes(2);
  });

  it('retries once when the call throws outright', async () => {
    signInWithPassword
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({ data: { session: SESSION }, error: null });

    await expect(signInAfterRegister('a@b.test', 'pw', 'corr')).resolves.toBe(SESSION);
    expect(signInWithPassword).toHaveBeenCalledTimes(2);
  });

  it('reports "no session" (confirmation required) without retrying', async () => {
    // The backend deliberately withheld a session — retrying cannot change it.
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });

    await expect(signInAfterRegister('a@b.test', 'pw', 'corr')).resolves.toBeNull();
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('treats "Email not confirmed" as a definitive confirmation-required answer', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Email not confirmed' },
    });

    await expect(signInAfterRegister('a@b.test', 'pw', 'corr')).resolves.toBeNull();
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-retryable rejection', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    });

    await expect(signInAfterRegister('a@b.test', 'pw', 'corr')).rejects.toBeDefined();
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('throws (so the caller can show the recovery screen) when both attempts fail', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Network request failed' },
    });

    await expect(signInAfterRegister('a@b.test', 'pw', 'corr')).rejects.toBeDefined();
    expect(signInWithPassword).toHaveBeenCalledTimes(2);
  });
});
