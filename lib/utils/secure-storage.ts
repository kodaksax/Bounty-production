/**
 * Secure Storage Utilities
 * 
 * Provides a unified interface for storing sensitive data using SecureStore
 * and non-sensitive data using AsyncStorage.
 * 
 * Key principle: Sensitive data (auth tokens, private keys, wallet info) goes to SecureStore,
 * while non-sensitive data (UI preferences, drafts) can use AsyncStorage for better performance.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// SecureStore options for iOS - ensures background access works
const SECURE_OPTS: SecureStore.SecureStoreOptions | undefined =
  Platform.OS === 'ios' 
    ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } 
    : undefined;

/**
 * Store sensitive data securely (encrypted at rest)
 * Use this for: auth tokens, private keys, wallet data, passwords
 */
export async function setSecureItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value, SECURE_OPTS);
  } catch (error) {
    console.error(`[SecureStorage] Error storing secure item ${key}:`, error);
    throw new Error(`Failed to store secure data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Retrieve sensitive data from secure storage
 */
export async function getSecureItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    console.error(`[SecureStorage] Error retrieving secure item ${key}:`, error);
    return null;
  }
}

/**
 * Delete sensitive data from secure storage
 */
export async function deleteSecureItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    console.error(`[SecureStorage] Error deleting secure item ${key}:`, error);
    throw new Error(`Failed to delete secure data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Store JSON object securely
 */
export async function setSecureJSON<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  await setSecureItem(key, json);
}

/**
 * Retrieve JSON object from secure storage
 */
export async function getSecureJSON<T>(key: string): Promise<T | null> {
  const json = await getSecureItem(key);
  if (!json) return null;
  
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    console.error(`[SecureStorage] Error parsing JSON for ${key}:`, error);
    return null;
  }
}

/**
 * Store non-sensitive data (uses AsyncStorage for better performance)
 * Use this for: UI preferences, drafts, cache
 */
export async function setItem(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (error) {
    console.error(`[Storage] Error storing item ${key}:`, error);
    throw new Error(`Failed to store data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Retrieve non-sensitive data
 */
export async function getItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (error) {
    console.error(`[Storage] Error retrieving item ${key}:`, error);
    return null;
  }
}

/**
 * Delete non-sensitive data
 */
export async function deleteItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.error(`[Storage] Error deleting item ${key}:`, error);
    throw new Error(`Failed to delete data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Store JSON object (non-sensitive)
 */
export async function setJSON<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  await setItem(key, json);
}

/**
 * Retrieve JSON object (non-sensitive)
 */
export async function getJSON<T>(key: string): Promise<T | null> {
  const json = await getItem(key);
  if (!json) return null;
  
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    console.error(`[Storage] Error parsing JSON for ${key}:`, error);
    return null;
  }
}

/**
 * Migrate data from AsyncStorage to SecureStore
 * Use this when upgrading existing AsyncStorage keys to secure storage
 */
export async function migrateToSecureStorage(key: string): Promise<boolean> {
  try {
    // Check if already in SecureStore
    const existingSecure = await getSecureItem(key);
    if (existingSecure) {
      console.log(`[SecureStorage] Key ${key} already in SecureStore`);
      return true;
    }
    
    // Get from AsyncStorage
    const value = await getItem(key);
    if (!value) {
      console.log(`[SecureStorage] No data to migrate for key ${key}`);
      return false;
    }
    
    // Move to SecureStore
    await setSecureItem(key, value);
    
    // Remove from AsyncStorage
    await deleteItem(key);
    
    console.log(`[SecureStorage] Successfully migrated ${key} to SecureStore`);
    return true;
  } catch (error) {
    console.error(`[SecureStorage] Migration failed for ${key}:`, error);
    return false;
  }
}

// Key naming conventions
export const SecureKeys = {
  // Wallet
  WALLET_BALANCE: '@bountyexpo:secure:wallet_balance',
  WALLET_TRANSACTIONS: '@bountyexpo:secure:wallet_transactions',
  
  // Privacy & Security Settings
  PRIVACY_SETTINGS: '@bountyexpo:secure:privacy_settings',
  
  // Payment tokens (if stored)
  PAYMENT_TOKEN: '@bountyexpo:secure:payment_token',
} as const;

export const StorageKeys = {
  // UI Preferences (non-sensitive)
  THEME: '@bountyexpo:theme',
  NOTIFICATION_PREFS: '@bountyexpo:notification_prefs',
  
  // Drafts (non-sensitive)
  PROFILE_DRAFT: '@bountyexpo:profile_draft',
  BOUNTY_DRAFT: '@bountyexpo:bounty_draft',
  
  // Cache (non-sensitive)
  CONVERSATIONS_CACHE: '@bountyexpo:conversations_cache',
  MESSAGES_CACHE_PREFIX: '@bountyexpo:messages_',
} as const;
