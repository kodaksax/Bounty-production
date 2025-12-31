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

/**
 * Get the current remember me preference
 * Returns false if preference is not set or any error occurs
 */
export async function getRememberMePreference(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(REMEMBER_ME_KEY);
    return value === 'true';
  } catch (e) {
    console.error('[AuthSessionStorage] Error reading remember me preference:', e);
    return false;
  }
}

/**
 * Set the remember me preference
 */
export async function setRememberMePreference(remember: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(REMEMBER_ME_KEY, remember ? 'true' : 'false', SECURE_OPTS);
    console.log('[AuthSessionStorage] Remember me preference set to:', remember);
  } catch (e) {
    console.error('[AuthSessionStorage] Error setting remember me preference:', e);
  }
}

/**
 * Clear the remember me preference
 */
export async function clearRememberMePreference(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REMEMBER_ME_KEY);
    console.log('[AuthSessionStorage] Remember me preference cleared');
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
    // Clear in-memory cache
    inMemorySessionCache.clear();
    
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
    
    console.log('[AuthSessionStorage] All session data cleared from secure storage and in-memory cache');
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
        
        // Remember me is true, read from secure storage
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
          return out;
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
        
        // Also cache in memory for faster access
        inMemorySessionCache.set(key, value);
        
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
          
          return;
        }
        
        // Chunk the value
        const chunks = Math.ceil(value.length / CHUNK_SIZE);
        for (let i = 0; i < chunks; i++) {
          const part = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          await SecureStore.setItemAsync(`${key}__${i}`, part, SECURE_OPTS);
        }
        
        // Write marker and metadata
        await SecureStore.setItemAsync(key, '__chunked__', SECURE_OPTS);
        await SecureStore.setItemAsync(key + CHUNK_META_SUFFIX, String(chunks), SECURE_OPTS);
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
