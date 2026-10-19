/**
 * Username availability (SBA-08, docs/audits/shoal-behavioral-audit.md).
 *
 * profiles is readable own-row only, so the old direct SELECT never saw anyone
 * else's name and reported every username as available. The only source of an
 * answer is now the is_username_available RPC. Guarantees:
 *  - a boolean from the RPC is the answer ('available' / 'taken');
 *  - anything else (error, rate limit, missing RPC, NULL) is 'unknown', never
 *    'available', and there is no direct profiles query to fall back to;
 *  - isUsernameUnique (save paths) is false only for a server 'taken'.
 */

export {};

type RpcResult = { data: unknown; error: null | { code?: string; message: string } };
let rpcResult: RpcResult = { data: true, error: null };
let rpcThrows: Error | null = null;
const rpcCalls: { fn: string; args: unknown }[] = [];
const tablesRead: string[] = [];

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (rpcThrows) throw rpcThrows;
      return rpcResult;
    },
    from: (table: string) => {
      tablesRead.push(table);
      throw new Error(`unexpected direct read of ${table}`);
    },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

// Avoid pulling the real auth-profile-service (imports native deps)
jest.mock('../../lib/services/auth-profile-service', () => ({
  authProfileService: { getAuthUserId: () => null },
}));

import { checkUsernameAvailability, isUsernameUnique } from '../../lib/services/userProfile';

beforeEach(() => {
  rpcResult = { data: true, error: null };
  rpcThrows = null;
  rpcCalls.length = 0;
  tablesRead.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  expect(tablesRead).toEqual([]);
});

describe('checkUsernameAvailability', () => {
  // The production bug: own-row RLS hid every other profile, so the answer
  // was always "free". The RPC sees every profile.
  it('reports a taken name as taken', async () => {
    rpcResult = { data: false, error: null };
    await expect(checkUsernameAvailability('alice')).resolves.toBe('taken');
    expect(rpcCalls).toEqual([{ fn: 'is_username_available', args: { p_username: 'alice' } }]);
  });

  it('reports a free name as available (trimmed before asking)', async () => {
    await expect(checkUsernameAvailability('  fresh_name  ')).resolves.toBe('available');
    expect(rpcCalls[0].args).toEqual({ p_username: 'fresh_name' });
  });

  it('is unknown, not available, when the server rate-limits the check', async () => {
    rpcResult = { data: null, error: { code: 'rate_limited', message: 'Too many username checks. Try again shortly.' } };
    await expect(checkUsernameAvailability('alice')).resolves.toBe('unknown');
  });

  it('is unknown when the request fails outright (offline)', async () => {
    rpcThrows = new Error('Network request failed');
    await expect(checkUsernameAvailability('alice')).resolves.toBe('unknown');
  });

  it('is unknown when the backend has no RPC, with no blind fallback query', async () => {
    rpcResult = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    await expect(checkUsernameAvailability('alice')).resolves.toBe('unknown');
  });

  it('is unknown when the server calls the input malformed (NULL)', async () => {
    rpcResult = { data: null, error: null };
    await expect(checkUsernameAvailability('alice')).resolves.toBe('unknown');
  });

  it('does not ask about an empty name', async () => {
    await expect(checkUsernameAvailability('   ')).resolves.toBe('unknown');
    expect(rpcCalls).toEqual([]);
  });
});

describe('isUsernameUnique (save paths)', () => {
  it('is false only when the server says taken', async () => {
    rpcResult = { data: false, error: null };
    await expect(isUsernameUnique('alice', 'user-b')).resolves.toBe(false);
  });

  it('is true when free', async () => {
    await expect(isUsernameUnique('alice', 'user-a')).resolves.toBe(true);
  });

  it('lets the DB UNIQUE constraint decide when there is no answer', async () => {
    rpcThrows = new Error('offline');
    await expect(isUsernameUnique('alice')).resolves.toBe(true);
  });

  it('rejects empty / whitespace-only usernames', async () => {
    await expect(isUsernameUnique('')).resolves.toBe(false);
    await expect(isUsernameUnique('   ')).resolves.toBe(false);
  });
});
