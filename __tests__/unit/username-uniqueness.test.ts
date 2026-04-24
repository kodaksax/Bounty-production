/**
 * Tests for username exclusivity.
 *
 * Guarantees:
 *  - isUsernameUnique() treats the Supabase `profiles` table as the source of
 *    truth so two auth users can never share a username across devices.
 *  - The comparison is case-insensitive so `Alice` and `alice` collide.
 *  - A user keeps their own username (same id returned → still "unique").
 *  - When the Supabase query fails, we fall back to the local AsyncStorage
 *    index (also case-insensitive) instead of blindly allowing duplicates.
 */

export {};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const asyncStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(asyncStore[k] ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      asyncStore[k] = v;
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      delete asyncStore[k];
      return Promise.resolve();
    }),
  },
}));

type Row = { id: string; username: string };
let remoteRows: Row[] = [];
let remoteShouldError: null | { code?: string; message: string } = null;

jest.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    if (table !== 'profiles') {
      throw new Error(`unexpected table: ${table}`);
    }
    const state: { username: string | null } = { username: null };
    const chain = {
      select() {
        return chain;
      },
      ilike(_col: string, value: string) {
        state.username = String(value);
        return chain;
      },
      eq() {
        return chain;
      },
      limit() {
        return chain;
      },
      async maybeSingle() {
        if (remoteShouldError) {
          return { data: null, error: remoteShouldError };
        }
        // Simulate PostgreSQL ilike: case-insensitive, '%' → '.*', '_' → '.',
        // and '\%'/'\_' are literal. This lets tests verify we correctly
        // escape user-supplied metacharacters.
        const pattern = state.username ?? '';
        let regex = '^';
        for (let i = 0; i < pattern.length; i++) {
          const ch = pattern[i];
          if (ch === '\\' && i + 1 < pattern.length) {
            const next = pattern[i + 1];
            if (next === '%' || next === '_' || next === '\\') {
              regex += next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              i++;
              continue;
            }
          }
          if (ch === '%') regex += '.*';
          else if (ch === '_') regex += '.';
          else regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        regex += '$';
        const re = new RegExp(regex, 'i');
        const match = remoteRows.find((r) => r.username && re.test(r.username));
        return { data: match ?? null, error: null };
      },
    };
    return chain;
  };
  return { supabase: { from } };
});

// Avoid pulling the real auth-profile-service (imports native deps)
jest.mock('../../lib/services/auth-profile-service', () => ({
  authProfileService: { getAuthUserId: () => null },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { isUsernameUnique } from '../../lib/services/userProfile';

describe('isUsernameUnique (Supabase-backed)', () => {
  beforeEach(() => {
    remoteRows = [];
    remoteShouldError = null;
    for (const k of Object.keys(asyncStore)) delete asyncStore[k];
  });

  it('returns true when no profile uses the username', async () => {
    await expect(isUsernameUnique('alice')).resolves.toBe(true);
  });

  it('returns false when another user already has the username', async () => {
    remoteRows = [{ id: 'user-a', username: 'alice' }];
    await expect(isUsernameUnique('alice', 'user-b')).resolves.toBe(false);
  });

  it('treats the match as case-insensitive (Alice == alice)', async () => {
    remoteRows = [{ id: 'user-a', username: 'Alice' }];
    await expect(isUsernameUnique('alice', 'user-b')).resolves.toBe(false);
    await expect(isUsernameUnique('ALICE', 'user-b')).resolves.toBe(false);
  });

  it('does not treat underscore as a wildcard (ali_e ≠ alice)', async () => {
    // Usernames are allowed to contain underscores. Without escaping, PostgreSQL
    // ilike would treat '_' as "match any single character" and report alice as a
    // collision for ali_e, which would incorrectly reserve an unrelated name.
    remoteRows = [{ id: 'user-a', username: 'alice' }];
    await expect(isUsernameUnique('ali_e', 'user-b')).resolves.toBe(true);
  });

  it('allows the current user to keep their own username', async () => {
    remoteRows = [{ id: 'user-a', username: 'alice' }];
    await expect(isUsernameUnique('alice', 'user-a')).resolves.toBe(true);
  });

  it('falls back to local AsyncStorage index when Supabase errors', async () => {
    remoteShouldError = { code: 'NETWORK', message: 'offline' };
    asyncStore['BE:allProfiles'] = JSON.stringify({
      'user-a': { username: 'bob' },
    });

    // Case-insensitive fallback: Bob occupied by user-a, so user-b is blocked
    await expect(isUsernameUnique('BOB', 'user-b')).resolves.toBe(false);
    // And a fresh name is still free
    await expect(isUsernameUnique('charlie', 'user-b')).resolves.toBe(true);
  });

  it('rejects empty / whitespace-only usernames', async () => {
    await expect(isUsernameUnique('')).resolves.toBe(false);
    await expect(isUsernameUnique('   ')).resolves.toBe(false);
  });

  it('returns the username to the pool once the owning profile is removed', async () => {
    // Username initially taken
    remoteRows = [{ id: 'user-a', username: 'dave' }];
    await expect(isUsernameUnique('dave', 'user-b')).resolves.toBe(false);

    // Profile deleted (e.g. auth.users ON DELETE CASCADE) → name is free again
    remoteRows = [];
    await expect(isUsernameUnique('dave', 'user-b')).resolves.toBe(true);
  });
});
