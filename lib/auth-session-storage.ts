/**
 * Authentication Session Storage
 * Handles session persistence based on "remember me" preference
 * 
 * This module provides a storage adapter for Supabase that respects
 * the user's session persistence preference. When "remember me" is checked,
 * sessions are persisted to secure storage. When unchecked, sessions are
 * kept only in memory and cleared on app reload.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Storage key for remember me preference
const REMEMBER_ME_KEY = 'auth_remember_me_preference';

// In-memory storage for non-persistent sessions
const sessionMemoryStorage: Map<string, string> = new Map();

// SecureStore options for iOS
const SECURE_OPTS: SecureStore.SecureStoreOptions | undefined =
  Platform.OS === 'ios' ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : undefined;

// Chunking configuration for large session objects
const CHUNK_SIZE = 1900;
const CHUNK_META_SUFFIX = '__chunkCount';

/**
 * Get the current remember me preference
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
 * Clear all session data (both memory and persistent)
 */
export async function clearAllSessionData(): Promise<void> {
  try {
    // Clear in-memory storage
    sessionMemoryStorage.clear();
    
    // Clear the Supabase session key from secure storage
    // The key used by Supabase is typically 'supabase.auth.token'
    const sessionKey = 'supabase.auth.token';
    
    // Check if it's chunked
    const val = await SecureStore.getItemAsync(sessionKey);
    if (val === '__chunked__') {
      const countStr = await SecureStore.getItemAsync(sessionKey + CHUNK_META_SUFFIX);
      const count = parseInt(countStr || '0', 10);
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${sessionKey}__${i}`);
      }
      await SecureStore.deleteItemAsync(sessionKey + CHUNK_META_SUFFIX);
    }
    await SecureStore.deleteItemAsync(sessionKey);
    
    console.log('[AuthSessionStorage] All session data cleared');
  } catch (e) {
    console.error('[AuthSessionStorage] Error clearing session data:', e);
  }
}

/**
 * Storage adapter for Supabase that respects remember me preference
 */
export const createAuthSessionStorageAdapter = () => {
  return {
    getItem: async (key: string): Promise<string | null> => {
      try {
        // Always check the remember me preference first
        const rememberMe = await getRememberMePreference();
        
        if (!rememberMe) {
          // If remember me is not set, only use memory storage
          const memValue = sessionMemoryStorage.get(key);
          return memValue || null;
        }
        
        // If remember me is set, read from secure storage
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
        throw e;
      }
    },

    setItem: async (key: string, value: string): Promise<void> => {
      try {
        if (typeof value !== 'string') value = String(value);
        
        // Always check the remember me preference
        const rememberMe = await getRememberMePreference();
        
        if (!rememberMe) {
          // If remember me is not set, only store in memory
          sessionMemoryStorage.set(key, value);
          console.log('[AuthSessionStorage] Session stored in memory only');
          return;
        }
        
        // If remember me is set, store in secure storage with chunking support
        console.log('[AuthSessionStorage] Session stored in secure storage');
        
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
        // Remove from memory
        sessionMemoryStorage.delete(key);
        
        // Remove from secure storage (check for chunked data)
        const val = await SecureStore.getItemAsync(key);
        if (val === '__chunked__') {
          const countStr = await SecureStore.getItemAsync(key + CHUNK_META_SUFFIX);
          const count = parseInt(countStr || '0', 10);
          for (let i = 0; i < count; i++) {
            await SecureStore.deleteItemAsync(`${key}__${i}`);
          }
          await SecureStore.deleteItemAsync(key + CHUNK_META_SUFFIX);
          await SecureStore.deleteItemAsync(key);
        } else {
          await SecureStore.deleteItemAsync(key);
        }
        
        console.log('[AuthSessionStorage] Session removed');
      } catch (e) {
        console.error('[AuthSessionStorage] Error removing item:', e);
        throw e;
      }
    },
  };
};
