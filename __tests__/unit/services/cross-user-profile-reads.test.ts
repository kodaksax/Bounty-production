/* eslint-env jest */
/**
 * Regression guard for the 2026-07-22 "feed shows only my own bounties / inbox
 * shows every sender as Unknown" bug.
 *
 * Root cause: 20260719060100_drop_redundant_permissive_profiles_select_authenticated_policy.sql
 * dropped the last permissive cross-user SELECT policy on `public.profiles`,
 * leaving only self-only policies (`auth.uid() = id`). Any code path that reads
 * ANOTHER user's profile from the base `profiles` table therefore returns zero
 * rows. That silently:
 *   - filtered the bounty feed down to the caller's own bounties (the feed used
 *     an `!inner` PostgREST embed of `profiles`, and an inner join against an
 *     empty set drops every row), and
 *   - made every conversation in the inbox fall through to the 'Unknown'
 *     display-name default.
 *
 * The fix routes all cross-user profile reads through the `public_profiles`
 * view, which exposes a curated safe-columns set and intentionally bypasses
 * base-table RLS. These tests assert the *table name*, because that is the
 * thing that regressed — the column lists were already correct.
 *
 * See docs/withdrawals/08-profiles-rls-migration-strategy.md.
 */

jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
  isSupabaseConfigured: true,
}));
jest.mock('../../../lib/utils/bounty-validation', () => ({ validateTitle: jest.fn() }));
jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warning: jest.fn(), info: jest.fn() },
}));
jest.mock('../../../lib/utils/network', () => ({
  getReachableApiBaseUrl: jest.fn(() => 'http://localhost:3001'),
}));
jest.mock('../../../lib/utils/postgrest-utils', () => ({
  escapeIlike: jest.fn((s: string) => s),
  quotePostgrestValue: jest.fn((s: string) => `"${s}"`),
}));
jest.mock('../../../lib/services/offline-queue-service', () => ({
  offlineQueueService: { enqueue: jest.fn() },
}));
jest.mock('../../../lib/services/websocket-adapter', () => ({
  wsAdapter: { isConnected: jest.fn(), send: jest.fn() },
}));

const { bountyService } = require('../../../lib/services/bounty-service');
const { supabase } = require('../../../lib/supabase');

/**
 * Minimal chainable PostgREST stub. Every builder method returns `this`; the
 * chain resolves to `result` when awaited or when a terminal method is called.
 */
function makeQueryStub(result: any) {
  const stub: any = {
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'or', 'gte', 'order', 'range', 'limit', 'is']) {
    stub[m] = jest.fn(() => stub);
  }
  stub.single = jest.fn(() => Promise.resolve(result));
  stub.maybeSingle = jest.fn(() => Promise.resolve(result));
  return stub;
}

describe('cross-user profile reads go through public_profiles, never profiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.from.mockReset();
  });

  it('bountyService.getAll returns bounties from OTHER posters (feed regression)', async () => {
    const fromCalls: string[] = [];
    const posters = ['poster-a', 'poster-b', 'poster-c'];

    supabase.from.mockImplementation((table: string) => {
      fromCalls.push(table);
      if (table === 'bounties') {
        return makeQueryStub({
          data: posters.map((p, i) => ({ id: i + 1, poster_id: p, status: 'open' })),
          error: null,
        });
      }
      if (table === 'public_profiles') {
        return makeQueryStub({
          data: posters.map(p => ({ id: p, username: `user_${p}`, avatar: `${p}.png` })),
          error: null,
        });
      }
      throw new Error(`Unexpected table read: ${table}`);
    });

    const res = await bountyService.getAll({ status: 'open', limit: 10, offset: 0 });

    // The core regression: all three posters' bounties come back, not just one.
    expect(res).toHaveLength(3);
    expect(res.map((b: any) => b.username).sort()).toEqual([
      'user_poster-a',
      'user_poster-b',
      'user_poster-c',
    ]);
    expect(res[0].poster_avatar).toBe('poster-a.png');

    expect(fromCalls).toContain('public_profiles');
    expect(fromCalls).not.toContain('profiles');
  });

  it('bountyService.getAll drops bounties whose poster profile no longer exists', async () => {
    // Preserves the semantic the removed `!inner` embed used to provide.
    supabase.from.mockImplementation((table: string) => {
      if (table === 'bounties') {
        return makeQueryStub({
          data: [
            { id: 1, poster_id: 'alive', status: 'open' },
            { id: 2, poster_id: 'deleted-account', status: 'open' },
          ],
          error: null,
        });
      }
      return makeQueryStub({
        data: [{ id: 'alive', username: 'still_here', avatar: null }],
        error: null,
      });
    });

    const res = await bountyService.getAll({ status: 'open' });

    expect(res).toHaveLength(1);
    expect(res[0].username).toBe('still_here');
  });
});
