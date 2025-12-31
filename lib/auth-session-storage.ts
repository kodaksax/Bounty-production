/**
 * Authentication Session Storage
 * Handles session persistence based on "remember me" preference
 * 
 * This module provides a storage adapter for Supabase that respects
 * the user's session persistence preference. When "remember me" is checked,
 * sessions are persisted to secure storage. When unchecked, sessions are
 * kept only in memory and cleared on app reload.
 * 
 * IMPORTANT: The storage adapter checks the preference on EVERY operation.
 * This means:
 * - On sign-in with remember me = false: session is stored in memory only
 * - On app reload: preference is false (or missing), so getItem returns null
 * - Result: User is redirected to login screen (expected behavior)
 * 
 * - On sign-in with remember me = true: session is stored in secure storage
 * - On app reload: preference is true, so getItem reads from secure storage
 * - Result: User stays logged in (expected behavior)
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Storage key for remember me preference
const REMEMBER_ME_KEY = 'auth_remember_me_preference';

// Storage key used by Supabase for session data
// This is the default key that Supabase uses internally
// Reference: https://github.com/supabase/gotrue-js/blob/master/src/lib/constants.ts
const SUPABASE_SESSION_KEY = 'supabase.auth.token';

// SecureStore options for iOS
const SECURE_OPTS: SecureStore.SecureStoreOptions | undefined =
  Platform.OS === 'ios' ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : undefined;

// Chunking configuration for large session objects
const CHUNK_SIZE = 1900;
const CHUNK_META_SUFFIX = '__chunkCount';

// In-memory session cache for when remember me is false
// This allows the session to work during the current app session
// but not persist across app restarts
const inMemorySessionCache: Map<string, string> = new Map();

// In-memory cache for remember me preference
// This avoids race conditions when reading from SecureStore immediately after writing
// The preference is cached in memory and immediately available
let inMemoryRememberMeCache: boolean | null = null;

/**
 * Get the current remember me preference
 * Returns false if preference is not set or any error occurs
 * 
 * IMPORTANT: Checks in-memory cache first to avoid race conditions.
 * The cache is populated immediately when setRememberMePreference() is called.
 */
export async function getRememberMePreference(): Promise<boolean> {
  try {
    // Check in-memory cache first (fast path, avoids race conditions)
    if (inMemoryRememberMeCache !== null) {
      return inMemoryRememberMeCache;
    }
    
    // Cache miss: read from secure storage and populate cache
    const value = await SecureStore.getItemAsync(REMEMBER_ME_KEY);
    const preference = value === 'true';
    inMemoryRememberMeCache = preference;
    return preference;
  } catch (e) {
    console.error('[AuthSessionStorage] Error reading remember me preference:', e);
    return false;
  }
}

/**
 * Set the remember me preference
 * 
 * IMPORTANT: Updates in-memory cache IMMEDIATELY before writing to secure storage.
 * This ensures subsequent reads get the correct value without waiting for async storage.
 */
export async function setRememberMePreference(remember: boolean): Promise<void> {
  try {
    // Update in-memory cache immediately (synchronous, no race condition)
    inMemoryRememberMeCache = remember;
    console.log('[AuthSessionStorage] Remember me preference cached in memory:', remember);
    
    // Then persist to secure storage (asynchronous, but cache already updated)
    await SecureStore.setItemAsync(REMEMBER_ME_KEY, remember ? 'true' : 'false', SECURE_OPTS);
    console.log('[AuthSessionStorage] Remember me preference persisted to secure storage:', remember);
  } catch (e) {
    console.error('[AuthSessionStorage] Error setting remember me preference:', e);
  }
}

/**
 * Clear the remember me preference
 */
export async function clearRememberMePreference(): Promise<void> {
  try {
    // Clear in-memory cache immediately
    inMemoryRememberMeCache = null;
    
    // Then clear from secure storage
    await SecureStore.deleteItemAsync(REMEMBER_ME_KEY);
    console.log('[AuthSessionStorage] Remember me preference cleared from memory and secure storage');
  } catch (e) {
    console.error('[AuthSessionStorage] Error clearing remember me preference:', e);
  }
}

/**
 * Clear all session data from secure storage and in-memory cache
 * This is called during sign out to ensure no session data remains
 */
export async function clearAllSessionData(): Promise<void> {
  try {
    // Clear in-memory caches
    inMemorySessionCache.clear();
    inMemoryRememberMeCache = null;
    
    // Check if it's chunked
    const val = await SecureStore.getItemAsync(SUPABASE_SESSION_KEY);
    if (val === '__chunked__') {
      const countStr = await SecureStore.getItemAsync(SUPABASE_SESSION_KEY + CHUNK_META_SUFFIX);
      const count = parseInt(countStr || '0', 10);
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${SUPABASE_SESSION_KEY}__${i}`);
      }
      await SecureStore.deleteItemAsync(SUPABASE_SESSION_KEY + CHUNK_META_SUFFIX);
    }
    await SecureStore.deleteItemAsync(SUPABASE_SESSION_KEY);
    
    console.log('[AuthSessionStorage] All session data and preferences cleared from secure storage and memory');
  } catch (e) {
    console.error('[AuthSessionStorage] Error clearing session data:', e);
  }
}

/**
 * Storage adapter for Supabase that respects remember me preference
 * 
 * KEY BEHAVIOR:
 * - getItem: Returns in-memory cache if remember me is false (for current session)
 *           Returns secure storage if remember me is true (persists across restarts)
 *           Returns null if no session exists (forces re-login on reload)
 * - setItem: Stores in memory if remember me is false (current session only)
 *           Persists to secure storage if remember me is true (survives restart)
 * - removeItem: Clears both secure storage and in-memory cache
 * 
 * This design ensures:
 * - Users without "remember me" can use the app during current session
 * - Session expired alerts don't appear during active sessions
 * - App requires re-login after restart when remember me is false
 * - Session persists across restarts when remember me is true
 */
export const createAuthSessionStorageAdapter = () => {
  return {
    getItem: async (key: string): Promise<string | null> => {
      try {
        // Check remember me preference
        const rememberMe = await getRememberMePreference();
        
        if (!rememberMe) {
          // Check in-memory cache first for current session
          const cached = inMemorySessionCache.get(key);
          if (cached) {
            console.log('[AuthSessionStorage] Remember me is false, returning in-memory session');
            return cached;
          }
          
          // No cached session and remember me is false
          // This happens after app restart - require re-authentication
          console.log('[AuthSessionStorage] Remember me is false, no in-memory session, returning null');
          return null;
        }
        
        // Remember me is true, check in-memory cache first for better performance
        const cached = inMemorySessionCache.get(key);
        if (cached) {
          console.log('[AuthSessionStorage] Remember me is true, returning cached session for performance');
          return cached;
        }
        
        // Cache miss, read from secure storage
        console.log('[AuthSessionStorage] Remember me is true, reading from secure storage');
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
          
          // Cache the result for future reads
          if (out) {
            inMemorySessionCache.set(key, out);
          }
          
          return out;
        }
        
        // Cache the result for future reads
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
        
        // Check the remember me preference
        const rememberMe = await getRememberMePreference();
        
        if (!rememberMe) {
          // Store in memory for current session only
          // This allows the session to work during the app session
          // but not persist across app restarts
          console.log('[AuthSessionStorage] Remember me is false, storing session in memory only');
          inMemorySessionCache.set(key, value);
          return;
        }
        
        // Remember me is true, persist to secure storage with chunking support
        console.log('[AuthSessionStorage] Remember me is true, persisting session to secure storage');
        
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
          console.log('[AuthSessionStorage] Session persisted to secure storage and cached');
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
