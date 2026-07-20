/**
 * Authentication Session Storage
 *
 * Storage adapter for Supabase that always persists the session to secure
 * storage, so a signed-in user stays recognized across app restarts, force
 * closes, device reboots, and any length of time away — the only way to be
 * signed out is an explicit Sign Out (see lib/services/logout-service.ts).
 *
 * There used to be a "Remember Me" checkbox that gated this behavior
 * (persist to SecureStore vs. an in-memory-only cache that died with the JS
 * process). That preference has been removed — persistence is no longer
 * optional. See docs/authentication/REMEMBER_ME_*.md for historical context
 * on the feature this replaced.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// LEGACY storage key used by Supabase for session data when no storageKey option
// is passed.  In this app we now pass a project-scoped storageKey to createClient
// so each environment uses its own slot (see lib/supabase.ts).  This constant is
// kept for the clearAllSessionData() legacy-cleanup path so that stale data under
// the OLD shared key is also wiped on sign-out.
// Reference: https://github.com/supabase/gotrue-js/blob/master/src/lib/constants.ts
const SUPABASE_SESSION_KEY = 'supabase.auth.token';

// SecureStore options for iOS
const SECURE_OPTS: SecureStore.SecureStoreOptions | undefined =
  Platform.OS === 'ios' ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : undefined;

// Chunking configuration for large session objects
const CHUNK_SIZE = 1900;
const CHUNK_META_SUFFIX = '__chunkCount';

// Read-through in-memory cache so repeated getItem calls within the same app
// session don't re-hit SecureStore on every access. Purely a performance
// optimization now — unlike the old remember-me design, this is never the
// only place a session lives; SecureStore is always the source of truth.
const inMemorySessionCache: Map<string, string> = new Map();

/**
 * Helper to delete a single session key and any associated chunks from SecureStore.
 * Handles both plain values and the __chunked__ format written by the storage adapter.
 */
async function _deleteSessionKey(key: string): Promise<void> {
  try {
    const val = await SecureStore.getItemAsync(key);
    if (val === '__chunked__') {
      const countStr = await SecureStore.getItemAsync(key + CHUNK_META_SUFFIX);
      const count = parseInt(countStr || '0', 10);
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}__${i}`);
      }
      await SecureStore.deleteItemAsync(key + CHUNK_META_SUFFIX);
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Ignore — key may not exist
  }
}

/**
 * Clear all session data from secure storage and in-memory cache.
 * Called during sign out to ensure no session data remains.
 */
export async function clearAllSessionData(projectStorageKey?: string): Promise<void> {
  try {
    inMemorySessionCache.clear();

    // Delete the legacy shared key (pre-project-scoped builds) and the
    // project-scoped key (current builds) so all environments are wiped.
    await _deleteSessionKey(SUPABASE_SESSION_KEY);
    if (projectStorageKey && projectStorageKey !== SUPABASE_SESSION_KEY) {
      await _deleteSessionKey(projectStorageKey);
    }

    console.log('[AuthSessionStorage] All session data cleared from secure storage and memory');
  } catch (e) {
    console.error('[AuthSessionStorage] Error clearing session data:', e);
  }
}

/**
 * Storage adapter for Supabase — always persists to secure storage.
 *
 * KEY BEHAVIOR:
 * - getItem: Reads from the in-memory cache first (performance), falling
 *   back to secure storage. Returns null only if no session was ever
 *   written (e.g. the user has never signed in, or explicitly signed out).
 * - setItem: Persists to secure storage (survives restarts, force-close,
 *   device reboot) and updates the in-memory cache.
 * - removeItem: Clears both secure storage and the in-memory cache — used
 *   by sign-out to make the loss of session permanent and immediate.
 */
export const createAuthSessionStorageAdapter = () => {
  console.log('[AuthSessionStorage] createAuthSessionStorageAdapter called')
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Sentry = require('@sentry/react-native');
    if (Sentry && typeof Sentry.addBreadcrumb === 'function') {
      Sentry.addBreadcrumb({ category: 'auth', message: 'createAuthSessionStorageAdapter called', level: 'info', data: { platform: Platform.OS } });
    }
  } catch (e) {
    // Sentry not available in this runtime (e.g., Expo Go) - ignore
  }

  return {
    getItem: async (key: string): Promise<string | null> => {
      try {
        const cached = inMemorySessionCache.get(key);
        if (cached) {
          return cached;
        }

        // Cache miss, read from secure storage
        const val = await SecureStore.getItemAsync(key);

        // Handle chunked storage
        if (val === '__chunked__') {
          const countStr = await SecureStore.getItemAsync(key + CHUNK_META_SUFFIX);
          const count = parseInt(countStr || '0', 10);
          let out = '';
          for (let i = 0; i < count; i++) {
            const part = await SecureStore.getItemAsync(`${key}__${i}`);
            out += part ?? '';
          }

          if (out) {
            inMemorySessionCache.set(key, out);
          }

          return out;
        }

        if (val) {
          inMemorySessionCache.set(key, val);
        }

        return val;
      } catch (e) {
        console.error('[AuthSessionStorage] Error getting item:', e);
        // On error, return null to force re-authentication
        return null;
      }
    },

    setItem: async (key: string, value: string): Promise<void> => {
      try {
        if (typeof value !== 'string') value = String(value);

        try {
          // If value fits in one item, store directly
          if (value.length <= CHUNK_SIZE) {
            await SecureStore.setItemAsync(key, value, SECURE_OPTS);

            // Clean up any old chunks
            const prevCountStr = await SecureStore.getItemAsync(key + CHUNK_META_SUFFIX);
            if (prevCountStr) {
              const prevCount = parseInt(prevCountStr, 10) || 0;
              for (let i = 0; i < prevCount; i++) {
                await SecureStore.deleteItemAsync(`${key}__${i}`);
              }
              await SecureStore.deleteItemAsync(key + CHUNK_META_SUFFIX);
            }
          } else {
            // Chunk the value
            const chunks = Math.ceil(value.length / CHUNK_SIZE);
            for (let i = 0; i < chunks; i++) {
              const part = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
              await SecureStore.setItemAsync(`${key}__${i}`, part, SECURE_OPTS);
            }

            // Write marker and metadata
            await SecureStore.setItemAsync(key, '__chunked__', SECURE_OPTS);
            await SecureStore.setItemAsync(key + CHUNK_META_SUFFIX, String(chunks), SECURE_OPTS);
          }

          // Only cache in memory after successful secure storage write
          // This ensures consistency between cache and storage
          inMemorySessionCache.set(key, value);
        } catch (storageError) {
          // If secure storage fails, clear the cache to maintain consistency
          // User will need to re-authenticate, but we won't have stale cached data
          inMemorySessionCache.delete(key);
          console.error('[AuthSessionStorage] Secure storage failed, cache cleared to maintain consistency:', storageError);
          throw storageError;
        }
      } catch (e) {
        console.error('[AuthSessionStorage] Error setting item:', e);
        throw e;
      }
    },

    removeItem: async (key: string): Promise<void> => {
      try {
        // Clear from in-memory cache
        inMemorySessionCache.delete(key);

        // Always remove from secure storage (if it exists)
        const val = await SecureStore.getItemAsync(key);
        if (val === '__chunked__') {
          const countStr = await SecureStore.getItemAsync(key + CHUNK_META_SUFFIX);
          const count = parseInt(countStr || '0', 10);
          for (let i = 0; i < count; i++) {
            await SecureStore.deleteItemAsync(`${key}__${i}`);
          }
          await SecureStore.deleteItemAsync(key + CHUNK_META_SUFFIX);
          await SecureStore.deleteItemAsync(key);
        } else if (val !== null) {
          await SecureStore.deleteItemAsync(key);
        }

        console.log('[AuthSessionStorage] Session removed from secure storage and in-memory cache');
      } catch (e) {
        console.error('[AuthSessionStorage] Error removing item:', e);
        // Don't throw - best effort removal
      }
    },
  };
};
