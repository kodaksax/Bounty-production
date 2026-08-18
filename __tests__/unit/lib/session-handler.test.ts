/**
 * Unit tests for lib/utils/session-handler.ts's refreshSession(), focused on
 * the network-error vs. genuine-auth-failure distinction.
 *
 * Regression coverage for a real bug found while auditing auth persistence:
 * the periodic session monitor (useSessionMonitor + startSessionMonitoring)
 * used to treat ANY refreshSession() failure — including a transient
 * network error — as "the session is gone", forcing a real signOut() and a
 * blocking "Session Expired" alert. That directly contradicted the "stay
 * signed in until an explicit Sign Out" goal: a brief connectivity blip
 * could force a real logout. refreshSession() now reports whether a
 * failure looks like a network problem so callers can distinguish "retry
 * later" from "actually sign out" — mirroring the same distinction
 * AuthProvider.refreshTokenNow already makes for its own proactive refresh.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      refreshSession: jest.fn(),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import { supabase } from '../../../lib/supabase';
import { refreshSession, startSessionMonitoring } from '../../../lib/utils/session-handler';

describe('refreshSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports success when the SDK returns a new session', async () => {
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: { session: { access_token: 'new', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    });

    const result = await refreshSession();
    expect(result).toEqual({ refreshed: true, isNetworkError: false });
  });

  it.each([
    ['a message mentioning "network"', { message: 'network request failed' }],
    ['a message mentioning "fetch"', { message: 'fetch failed' }],
    ['a 503 status', { message: 'Service unavailable', status: 503 }],
    ['a 504 status', { message: 'Gateway timeout', status: 504 }],
  ])('classifies %s as a network error, not a real session loss', async (_label, error) => {
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error,
    });

    const result = await refreshSession();
    expect(result).toEqual({ refreshed: false, isNetworkError: true });
  });

  it('classifies an invalid/revoked refresh token as a genuine failure, not a network error', async () => {
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid refresh token', status: 401 },
    });

    const result = await refreshSession();
    expect(result).toEqual({ refreshed: false, isNetworkError: false });
  });

  it('classifies the SDK returning no session (and no error) as a genuine failure', async () => {
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const result = await refreshSession();
    expect(result).toEqual({ refreshed: false, isNetworkError: false });
  });

  it('treats a thrown (rejected) call as a network error rather than a sign-out trigger', async () => {
    (supabase.auth.refreshSession as jest.Mock).mockRejectedValue(new Error('fetch failed'));

    const result = await refreshSession();
    expect(result).toEqual({ refreshed: false, isNetworkError: true });
  });
});

describe('startSessionMonitoring immediate check', () => {
  // Regression coverage for auth-persistence audit findings:
  //  - An expired access token used to trigger signOut() with NO refresh
  //    attempt. JS timers are paused while backgrounded, so the built-in
  //    auto-refresh routinely misses its window and the app foregrounds with
  //    an already-expired token — that must refresh, not log the user out.
  //  - A transiently unreadable session (cold start, secure-storage stall)
  //    reported isExpired=true with no session at all, and signOut() then
  //    destroyed the valid persisted session on disk.
  let stop: (() => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it('refreshes an expired session instead of signing the user out', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { expires_at: Math.floor(Date.now() / 1000) - 60 } },
      error: null,
    });
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: { session: { access_token: 'fresh' } },
      error: null,
    });

    stop = startSessionMonitoring();
    await flush();

    expect(supabase.auth.refreshSession).toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('keeps an expired session when the refresh fails for a network reason', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { expires_at: Math.floor(Date.now() / 1000) - 60 } },
      error: null,
    });
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: { message: 'network request failed' },
    });

    stop = startSessionMonitoring();
    await flush();

    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('signs out only when an expired session is definitively unrefreshable', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { expires_at: Math.floor(Date.now() / 1000) - 60 } },
      error: null,
    });
    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid refresh token', status: 401 },
    });

    stop = startSessionMonitoring();
    await flush();

    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it('never signs out when no session could be read at all', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: null,
    });

    stop = startSessionMonitoring();
    await flush();

    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });
});
