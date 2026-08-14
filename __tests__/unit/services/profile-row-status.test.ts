/* eslint-env jest */
/**
 * Regression guard: returning to a backgrounded app must not send an
 * already-onboarded user through onboarding.
 *
 * app/tabs/bounty-app.tsx verifies that the profile row still exists when the
 * local onboarding-completed flag is set but AuthContext has no profile yet —
 * the exact state a cold resume lands in. It used to do that with
 * `getProfileById`, which returns `null` for a missing row AND for every
 * failure mode (network error, expired JWT mid-refresh, PostgREST error), so a
 * request that merely failed on a just-woken radio was read as "this account
 * has no profile" and the user was redirected to /onboarding.
 *
 * `profileRowStatus` exists to keep those apart. These tests assert the
 * distinction, because the distinction is the fix.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
  isSupabaseConfigured: true,
  supabaseEnv: {},
}));
jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warning: jest.fn(), info: jest.fn() },
}));

const { authProfileService } = require('../../../lib/services/auth-profile-service');
const { supabase } = require('../../../lib/supabase');

/** Minimal chainable PostgREST stub resolving to `result` at `.maybeSingle()`. */
function makeQueryStub(result: any) {
  const stub: any = {};
  for (const m of ['select', 'eq']) {
    stub[m] = jest.fn(() => stub);
  }
  stub.maybeSingle = jest.fn(() => Promise.resolve(result));
  return stub;
}

describe('authProfileService.profileRowStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.from.mockReset();
  });

  it('reports "exists" when the query returns a row', async () => {
    supabase.from.mockReturnValue(makeQueryStub({ data: { id: 'user-1' }, error: null }));

    await expect(authProfileService.profileRowStatus('user-1')).resolves.toBe('exists');
  });

  it('reports "missing" only when the query succeeds with zero rows', async () => {
    supabase.from.mockReturnValue(makeQueryStub({ data: null, error: null }));

    await expect(authProfileService.profileRowStatus('user-1')).resolves.toBe('missing');
  });

  it('reports "unknown" — never "missing" — when the query errors', async () => {
    supabase.from.mockReturnValue(
      makeQueryStub({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } })
    );

    await expect(authProfileService.profileRowStatus('user-1')).resolves.toBe('unknown');
  });

  it('reports "unknown" when the request throws (offline on resume)', async () => {
    const stub = makeQueryStub(null);
    stub.maybeSingle = jest.fn(() => Promise.reject(new Error('Network request failed')));
    supabase.from.mockReturnValue(stub);

    await expect(authProfileService.profileRowStatus('user-1')).resolves.toBe('unknown');
  });

  it('reads the RLS-bypassing public_profiles view, so a mid-refresh JWT cannot cause a false "missing"', async () => {
    supabase.from.mockReturnValue(makeQueryStub({ data: { id: 'user-1' }, error: null }));

    await authProfileService.profileRowStatus('user-1');

    expect(supabase.from).toHaveBeenCalledWith('public_profiles');
  });
});
