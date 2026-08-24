/**
 * Contract tests for AuthProfileService.isProfileResolved().
 *
 * This is the signal routing gates use to tell "no profile yet, still fetching"
 * apart from "fetch finished, this user genuinely has no profile" — the
 * distinction that decides whether a freshly-registered user is treated as an
 * authenticated new user or as an anonymous first-time visitor.
 *
 * It must also be re-armed on every user change, or the previous user's
 * resolution would vouch for the next one (and, worse, the previous user's
 * profile would still be readable through getCurrentProfile()).
 */

const rpc = jest.fn();
const from = jest.fn();

jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseEnv: { mismatch: false },
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
  getAllKeys: jest.fn().mockResolvedValue([]),
}));

jest.mock('lib/utils/error-logger', () => ({
  logger: { warning: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authProfileService } = require('../../../lib/services/auth-profile-service');

const sessionFor = (id: string) =>
  ({ access_token: 't', user: { id, email: `${id}@test.dev` } }) as any;

describe('AuthProfileService profile-resolution gate', () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  afterEach(async () => {
    await authProfileService.setSession(null);
  });

  it('reports resolved when there is no session (nothing to resolve)', async () => {
    await authProfileService.setSession(null);
    expect(authProfileService.isProfileResolved()).toBe(true);
  });

  it('is unresolved while the fetch is in flight, and resolved once it completes', async () => {
    let finish: (v: unknown) => void = () => {};
    rpc.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );

    const pending = authProfileService.setSession(sessionFor('user-1'));

    // The session is already installed, so getAuthUserId() answers — but the
    // profile has not come back yet.
    expect(authProfileService.getAuthUserId()).toBe('user-1');
    expect(authProfileService.isProfileResolved()).toBe(false);

    finish({ data: { id: 'user-1', username: 'one', onboarding_completed: true }, error: null });
    await pending;

    expect(authProfileService.isProfileResolved()).toBe(true);
    expect(authProfileService.getCurrentProfile()?.username).toBe('one');
  });

  it('resolves even when the fetch fails (a failure is still an answer)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network down' } });

    await authProfileService.setSession(sessionFor('user-2'));

    expect(authProfileService.isProfileResolved()).toBe(true);
    expect(authProfileService.getLastFetchError()).toBeTruthy();
  });

  it('resolves on a confirmed-missing profile row', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await authProfileService.setSession(sessionFor('user-3'));

    expect(authProfileService.isProfileResolved()).toBe(true);
    expect(authProfileService.getCurrentProfile()?.needs_onboarding).toBe(true);
    expect(authProfileService.getLastFetchError()).toBeNull();
  });

  it('re-arms the gate on a user switch and does not leak the previous profile', async () => {
    rpc.mockResolvedValue({
      data: { id: 'user-4', username: 'four', onboarding_completed: true },
      error: null,
    });
    await authProfileService.setSession(sessionFor('user-4'));
    expect(authProfileService.getCurrentProfile()?.username).toBe('four');

    let finish: (v: unknown) => void = () => {};
    rpc.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );

    const pending = authProfileService.setSession(sessionFor('user-5'));

    // The incoming user's profile is not known yet: the gate must be closed and
    // the outgoing user's profile must not still be readable.
    expect(authProfileService.isProfileResolved()).toBe(false);
    expect(authProfileService.getCurrentProfile()).toBeNull();

    finish({
      data: { id: 'user-5', username: 'five', onboarding_completed: false },
      error: null,
    });
    await pending;

    expect(authProfileService.isProfileResolved()).toBe(true);
    expect(authProfileService.getCurrentProfile()?.username).toBe('five');
  });

  it('re-arms the gate on sign-out', async () => {
    rpc.mockResolvedValue({
      data: { id: 'user-6', username: 'six', onboarding_completed: true },
      error: null,
    });
    await authProfileService.setSession(sessionFor('user-6'));
    expect(authProfileService.isProfileResolved()).toBe(true);

    await authProfileService.setSession(null);

    expect(authProfileService.getCurrentProfile()).toBeNull();
    // No session -> nothing to resolve.
    expect(authProfileService.isProfileResolved()).toBe(true);
  });

  it('does not let a superseded fetch move the gate off the current user', async () => {
    // A slow fetch for the OUTGOING account landing after a fast one for the
    // INCOMING account must not write its own userId into the gate: that would
    // point isProfileResolved() at a user who is no longer signed in, leaving
    // the real user's consumers stuck loading until the safety timeout.
    let finishSlow: (v: unknown) => void = () => {};
    rpc.mockReturnValueOnce(
      new Promise(resolve => {
        finishSlow = resolve;
      })
    );

    const slow = authProfileService.setSession(sessionFor('user-slow'));
    expect(authProfileService.isProfileResolved()).toBe(false);

    // A second account signs in and resolves first.
    rpc.mockResolvedValue({
      data: { id: 'user-fast', username: 'fast', onboarding_completed: true },
      error: null,
    });
    await authProfileService.setSession(sessionFor('user-fast'));
    expect(authProfileService.isProfileResolved()).toBe(true);
    expect(authProfileService.getCurrentProfile()?.username).toBe('fast');

    // Now the stale fetch finally lands.
    finishSlow({
      data: { id: 'user-slow', username: 'slow', onboarding_completed: false },
      error: null,
    });
    await slow;

    // The gate must still be open for the user who is actually signed in.
    expect(authProfileService.getAuthUserId()).toBe('user-fast');
    expect(authProfileService.isProfileResolved()).toBe(true);
  });

  it('does not let a fetch that finishes after sign-out open the gate', async () => {
    let finish: (v: unknown) => void = () => {};
    rpc.mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve;
      })
    );

    const pending = authProfileService.setSession(sessionFor('user-gone'));
    await authProfileService.setSession(null);

    finish({
      data: { id: 'user-gone', username: 'gone', onboarding_completed: true },
      error: null,
    });
    await pending;

    // Signed out: resolved is trivially true, but the gate must not be holding
    // a stale user id that a later sign-in by that same account would inherit.
    expect(authProfileService.getAuthUserId()).toBeNull();
    expect(authProfileService.isProfileResolved()).toBe(true);

    // Re-signing in as that user must still close the gate until a fresh fetch.
    let finishSecond: (v: unknown) => void = () => {};
    rpc.mockReturnValueOnce(
      new Promise(resolve => {
        finishSecond = resolve;
      })
    );
    const second = authProfileService.setSession(sessionFor('user-gone'));
    expect(authProfileService.isProfileResolved()).toBe(false);

    finishSecond({
      data: { id: 'user-gone', username: 'gone', onboarding_completed: true },
      error: null,
    });
    await second;
    expect(authProfileService.isProfileResolved()).toBe(true);
  });

  it('notifies subscribers again after the gate opens', async () => {
    const seen: Array<{ resolved: boolean; username: string | undefined }> = [];
    const unsubscribe = authProfileService.subscribe((p: any) => {
      seen.push({ resolved: authProfileService.isProfileResolved(), username: p?.username });
    });

    rpc.mockResolvedValue({
      data: { id: 'user-7', username: 'seven', onboarding_completed: true },
      error: null,
    });
    await authProfileService.setSession(sessionFor('user-7'));

    unsubscribe();

    // At least one notification must arrive with the gate open, otherwise a
    // consumer that only re-renders on notification would stay stuck loading.
    expect(seen.some(s => s.resolved && s.username === 'seven')).toBe(true);
  });
});
