/**
 * Secure Storage Utilities
 *
 * Provides a unified interface for storing sensitive data using SecureStore
 * and non-sensitive data using AsyncStorage.
 *
 * Key principle: Sensitive data (auth tokens, private keys, wallet info) goes to SecureStore,
 * while non-sensitive data (UI preferences, drafts) can use AsyncStorage for better performance.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// SecureStore options for iOS - ensures background access works
const SECURE_OPTS: SecureStore.SecureStoreOptions | undefined =
  Platform.OS === 'ios' ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : undefined;

// Explicit list of keys that are considered sensitive. For these keys we
// MUST NOT silently degrade to AsyncStorage because that would remove
// encryption-at-rest guarantees. If SecureStore is unavailable for these
// keys we throw a specific error so callers can surface a warning to users.
const SENSITIVE_KEYS = new Set([
  '@bountyexpo:secure:wallet_balance',
  '@bountyexpo:secure:wallet_transactions',
  '@bountyexpo:secure:wallet_last_deposit_ts',
  '@bountyexpo:secure:payment_token',
]);

/**
 * Sanitize keys for Expo SecureStore.
 * SecureStore only accepts alphanumeric characters, '.', '-', and '_'.
 * This helper replaces any other character with '_' and logs a warning
 * so existing constants can be updated over time.
 */
function sanitizeSecureKey(key: string): string {
  const sanitized = key.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!sanitized) throw new Error('Invalid secure storage key');
  if (sanitized !== key) {
    // eslint-disable-next-line no-console
    console.warn(
      `[SecureStorage] Sanitized key "${key}" -> "${sanitized}" for SecureStore compatibility.`
    );
  }
  return sanitized;
}

/**
 * Store sensitive data securely (encrypted at rest)
 * Use this for: auth tokens, private keys, wallet data, passwords
 */
export async function setSecureItem(key: string, value: string): Promise<void> {
  const secureKey = sanitizeSecureKey(key);
  const fallbackKey = `secure:${secureKey}`;
  try {
    await SecureStore.setItemAsync(secureKey, value, SECURE_OPTS);
    return;
  } catch (error) {
    // If the key is classified as sensitive, do NOT fall back — throw so
    // callers can surface an explicit warning and avoid silently degrading
    // security. For non-sensitive keys, fall back to AsyncStorage.
    if (SENSITIVE_KEYS.has(key)) {
      const err = new Error('SecureStoreUnavailable');
      // preserve original error on console for diagnostics
      console.error(
        `[SecureStorage] SecureStore.setItemAsync failed for sensitive key ${key}:`,
        error
      );
      throw err;
    }

    console.warn(
      `[SecureStorage] SecureStore unavailable for ${key}, falling back to AsyncStorage:`,
      error
    );
    try {
      await AsyncStorage.setItem(fallbackKey, value);
      return;
    } catch (err2) {
      console.error(`[SecureStorage] Error storing secure item ${key} in fallback storage:`, err2);
      throw new Error(
        `Failed to store secure data: ${err2 instanceof Error ? err2.message : 'Unknown error'}`
      );
    }
  }
}

/**
 * Retrieve sensitive data from secure storage
 */
export async function getSecureItem(key: string): Promise<string | null> {
  const secureKey = sanitizeSecureKey(key);
  const fallbackKey = `secure:${secureKey}`;
  try {
    const result = await SecureStore.getItemAsync(secureKey);
    // If SecureStore returned successfully (even null), treat that as
    // authoritative: only attempt AsyncStorage fallback when SecureStore
    // throws (unavailable). This avoids double storage calls for missing
    // keys.
    if (result !== null && result !== undefined) return result;
    return null;
  } catch (error) {
    if (SENSITIVE_KEYS.has(key)) {
      console.error(
        `[SecureStorage] SecureStore.getItemAsync failed for sensitive key ${key}:`,
        error
      );
      throw new Error('SecureStoreUnavailable');
    }
    console.warn(
      `[SecureStorage] SecureStore.getItemAsync failed for ${key}, trying fallback AsyncStorage:`,
      error
    );
  }
  try {
    const fallback = await AsyncStorage.getItem(fallbackKey);
    return fallback;
  } catch (err) {
    console.error(
      `[SecureStorage] Error retrieving secure item ${key} from fallback storage:`,
      err
    );
    return null;
  }
}

/**
 * Delete sensitive data from secure storage
 */
export async function deleteSecureItem(key: string): Promise<void> {
  const secureKey = sanitizeSecureKey(key);
  const fallbackKey = `secure:${secureKey}`;
  // Determine where the key actually exists before deleting so we don't
  // blindly erase both stores. If SecureStore is unavailable for sensitive
  // keys, throw and do not touch fallback storage.
  let securePresent = false;
  let fallbackPresent = false;

  try {
    const val = await SecureStore.getItemAsync(secureKey);
    securePresent = val !== null && val !== undefined;
  } catch (error) {
    if (SENSITIVE_KEYS.has(key)) {
      console.error(
        `[SecureStorage] SecureStore.getItemAsync failed for sensitive key ${key}:`,
        error
      );
      throw new Error('SecureStoreUnavailable');
    }
    console.warn(
      `[SecureStorage] SecureStore.getItemAsync failed for ${key}, will check fallback storage:`,
      error
    );
    securePresent = false;
  }

  try {
    const fb = await AsyncStorage.getItem(fallbackKey);
    fallbackPresent = fb !== null && fb !== undefined;
  } catch (err) {
    console.error(`[SecureStorage] Error checking fallback storage for ${key}:`, err);
    // Continue - we may still delete SecureStore if present
    fallbackPresent = false;
  }

  // If secure store has the item, delete it. If deletion fails and the key is
  // sensitive, rethrow to avoid leaving data in fallback while secure deletion
  // failed.
  if (securePresent) {
    try {
      await SecureStore.deleteItemAsync(secureKey);
    } catch (error) {
      if (SENSITIVE_KEYS.has(key)) {
        console.error(
          `[SecureStorage] SecureStore.deleteItemAsync failed for sensitive key ${key}:`,
          error
        );
        throw new Error('SecureStoreUnavailable');
      }
      console.warn(
        `[SecureStorage] SecureStore.deleteItemAsync failed for ${key}, continuing to fallback if present:`,
        error
      );
    }
  }

  // Only remove from AsyncStorage if the fallback key actually exists.
  if (fallbackPresent) {
    try {
      await AsyncStorage.removeItem(fallbackKey);
    } catch (err) {
      console.error(
        `[SecureStorage] Error deleting secure item ${key} from fallback storage:`,
        err
      );
      throw new Error(
        `Failed to delete secure data: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
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
    throw new Error(
      `Failed to store data: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
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
    throw new Error(
      `Failed to delete data: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
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

// The AsyncStorage flag that records whether the one-time key-format migration
// has already been completed on this device.
const KEY_MIGRATION_V1_FLAG = '@bountyexpo:keyMigrationV1Done';

// The old colon-containing key names that were written to SecureStore before
// the sanitization logic was introduced. These are the keys we need to read
// in order to migrate data to the current sanitized format.
const LEGACY_KEYS = [
  '@bountyexpo:secure:wallet_balance',
  '@bountyexpo:secure:wallet_transactions',
  '@bountyexpo:secure:wallet_last_deposit_ts',
  '@bountyexpo:secure:payment_token',
];

/**
 * One-time migration: for iOS devices that stored sensitive wallet keys under
 * the old colon-containing key names (before sanitization was applied), read
 * each old key directly from SecureStore, write the value under the current
 * sanitized key name, and delete the old key.
 *
 * Legacy colon-containing keys can only exist on iOS (the Keychain allows
 * arbitrary key names). On Android, SecureStore enforces the same character
 * restrictions as sanitizeSecureKey, so no migration is needed.
 *
 * A flag in AsyncStorage (`@bountyexpo:keyMigrationV1Done`) prevents this
 * migration from running more than once per device. The flag is only written
 * when every key is processed without error, so a transient failure allows a
 * retry on the next launch.
 */
export async function migrateSecureStorageKeys(): Promise<void> {
  try {
    // Check whether the migration has already been completed on this device.
    const alreadyDone = await AsyncStorage.getItem(KEY_MIGRATION_V1_FLAG);
    if (alreadyDone === 'true') {
      return;
    }

    // Legacy colon-containing keys can only exist on iOS.
    // On Android, set the flag immediately and skip probing to avoid spurious
    // Keychain warnings on every fresh install.
    if (Platform.OS !== 'ios') {
      await AsyncStorage.setItem(KEY_MIGRATION_V1_FLAG, 'true');
      return;
    }

    let hadError = false;
    for (const oldKey of LEGACY_KEYS) {
      try {
        // Read directly from SecureStore using the legacy colon-containing key.
        const value = await SecureStore.getItemAsync(oldKey, SECURE_OPTS);
        if (value !== null) {
          // Derive the sanitized destination key the same way setSecureItem does.
          const newKey = sanitizeSecureKey(oldKey);
          // Write under the sanitized key name.
          await SecureStore.setItemAsync(newKey, value, SECURE_OPTS);
          // Remove the old key so we don't leave stale data in the Keychain.
          await SecureStore.deleteItemAsync(oldKey, SECURE_OPTS);
        }
      } catch (keyError) {
        // expo-secure-store validates keys before any native call and throws
        // "Invalid key provided to SecureStore..." for keys containing '@' or
        // ':'. Those characters exist in every LEGACY_KEYS entry, so this error
        // is permanent — not a transient Keychain failure. Treat it as "key not
        // found" (nothing can ever be stored under such a key name in the current
        // library version) and skip without setting hadError, so the migration
        // flag is still written and we don't re-run forever.
        if (keyError instanceof Error && keyError.message.startsWith('Invalid key')) {
          continue;
        }
        // Log but continue — a failure on one key must not block the others.
        // Set hadError so the flag is withheld and migration can retry next launch.
        hadError = true;
        console.warn(`[SecureStorage] Migration failed for key "${oldKey}":`, keyError);
      }
    }

    // Only mark migration as done when all keys were processed without error.
    // If hadError is true, the migration will retry on the next app launch.
    if (!hadError) {
      await AsyncStorage.setItem(KEY_MIGRATION_V1_FLAG, 'true');
    }
  } catch (error) {
    // Non-fatal: if the flag check or write fails, the migration may re-run on
    // the next launch, which is idempotent (existing new-format keys are simply
    // overwritten with the same value).
    console.warn('[SecureStorage] migrateSecureStorageKeys error:', error);
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
      return true;
    }

    // Get from AsyncStorage
    const value = await getItem(key);
    if (!value) {
      return false;
    }

    // Move to SecureStore
    await setSecureItem(key, value);

    // Remove from AsyncStorage
    await deleteItem(key);

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
  WALLET_LAST_DEPOSIT_TS: '@bountyexpo:secure:wallet_last_deposit_ts',

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
