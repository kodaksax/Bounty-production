/**
 * Unit tests for the auth session storage adapter.
 *
 * Session persistence is now unconditional — there is no "Remember Me"
 * preference gating whether the session survives an app restart. Every
 * signed-in session is written straight to SecureStore; the only way it
 * goes away is an explicit sign-out (removeItem) or clearAllSessionData().
 */

import * as SecureStore from 'expo-secure-store';
import {
  clearAllSessionData,
  createAuthSessionStorageAdapter,
} from '../../../lib/auth-session-storage';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
}));

const SESSION_KEY = 'supabase.auth.token.testproject';
const mockSession = JSON.stringify({
  access_token: 'test_token',
  refresh_token: 'test_refresh',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user123', email: 'test@example.com' },
});

describe('createAuthSessionStorageAdapter', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
    // Reset the module-level in-memory read-through cache between tests.
    await clearAllSessionData();
  });

  describe('setItem', () => {
    it('always persists to SecureStore, regardless of any prior preference', async () => {
      const adapter = createAuthSessionStorageAdapter();
      await adapter.setItem(SESSION_KEY, mockSession);

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION_KEY, mockSession, expect.any(Object));
    });

    it('chunks values larger than the single-item limit', async () => {
      const bigValue = 'x'.repeat(5000);
      const adapter = createAuthSessionStorageAdapter();
      await adapter.setItem(SESSION_KEY, bigValue);

      // Marker + metadata + at least 2 chunks
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION_KEY, '__chunked__', expect.any(Object));
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        SESSION_KEY + '__chunkCount',
        expect.any(String),
        expect.any(Object)
      );
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(`${SESSION_KEY}__0`, expect.any(String), expect.any(Object));
    });
  });

  describe('getItem', () => {
    it('reads a persisted session back from SecureStore on a cold cache', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
        if (key === SESSION_KEY) return mockSession;
        return null;
      });

      const adapter = createAuthSessionStorageAdapter();
      const session = await adapter.getItem(SESSION_KEY);

      expect(session).toBe(mockSession);
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith(SESSION_KEY);
    });

    it('serves subsequent reads from the in-memory cache without hitting SecureStore again', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
        if (key === SESSION_KEY) return mockSession;
        return null;
      });

      const adapter = createAuthSessionStorageAdapter();
      await adapter.getItem(SESSION_KEY);
      jest.clearAllMocks();

      const second = await adapter.getItem(SESSION_KEY);
      expect(second).toBe(mockSession);
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    });

    it('returns null when nothing has ever been written (e.g. after sign-out, or a fresh install)', async () => {
      const adapter = createAuthSessionStorageAdapter();
      const session = await adapter.getItem(SESSION_KEY);
      expect(session).toBeNull();
    });

    it('reassembles a chunked value written by setItem', async () => {
      const bigValue = 'y'.repeat(5000);
      const store = new Map<string, string>();
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
        store.set(key, value);
      });
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => store.get(key) ?? null);

      const writer = createAuthSessionStorageAdapter();
      await writer.setItem(SESSION_KEY, bigValue);

      // A fresh adapter instance still shares the module-level SecureStore
      // (via the mock `store` map) but starts with a cold in-memory cache —
      // this is what actually exercises the chunk-reassembly path in getItem
      // rather than just serving the cached write.
      await clearAllSessionData();
      const reader = createAuthSessionStorageAdapter();
      const readBack = await reader.getItem(SESSION_KEY);
      expect(readBack).toBe(bigValue);
    });
  });

  describe('removeItem', () => {
    it('deletes the session from SecureStore and the in-memory cache', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(mockSession);

      const adapter = createAuthSessionStorageAdapter();
      await adapter.setItem(SESSION_KEY, mockSession);
      await adapter.removeItem(SESSION_KEY);

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY);

      // Cache must be gone too — a subsequent getItem must not serve stale data.
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      const session = await adapter.getItem(SESSION_KEY);
      expect(session).toBeNull();
    });

    it('cleans up chunk parts for a chunked value', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
        if (key === SESSION_KEY) return '__chunked__';
        if (key === SESSION_KEY + '__chunkCount') return '2';
        return 'part';
      });

      const adapter = createAuthSessionStorageAdapter();
      await adapter.removeItem(SESSION_KEY);

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(`${SESSION_KEY}__0`);
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(`${SESSION_KEY}__1`);
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY + '__chunkCount');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY);
    });
  });

  describe('clearAllSessionData', () => {
    it('wipes both the legacy shared key and the project-scoped key', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(mockSession);

      await clearAllSessionData(SESSION_KEY);

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('supabase.auth.token');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY);
    });

    it('clears the in-memory cache so a subsequent getItem re-reads SecureStore', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(mockSession);
      const adapter = createAuthSessionStorageAdapter();
      await adapter.getItem(SESSION_KEY); // populate cache

      await clearAllSessionData(SESSION_KEY);
      jest.clearAllMocks();
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(mockSession);

      await adapter.getItem(SESSION_KEY);
      expect(SecureStore.getItemAsync).toHaveBeenCalled();
    });
  });

  describe('concurrent reads', () => {
    it('handles concurrent getItem calls for the same key gracefully', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return key === SESSION_KEY ? mockSession : null;
      });

      const adapter = createAuthSessionStorageAdapter();
      const [a, b, c] = await Promise.all([
        adapter.getItem(SESSION_KEY),
        adapter.getItem(SESSION_KEY),
        adapter.getItem(SESSION_KEY),
      ]);

      expect(a).toBe(mockSession);
      expect(b).toBe(mockSession);
      expect(c).toBe(mockSession);
    });
  });
});
