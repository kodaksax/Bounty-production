/**
 * Secure Storage Wrapper
 * 
 * Provides a unified interface for storing sensitive data using expo-secure-store
 * and non-sensitive data using AsyncStorage.
 * 
 * Usage Guidelines:
 * - Use SecureStorage for: tokens, keys, passwords, personal info, financial data
 * - Use AsyncStorage for: UI preferences, cached public data, non-sensitive settings
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// SecureStore options for iOS to prevent background access issues
const SECURE_OPTS: SecureStore.SecureStoreOptions | undefined =
  Platform.OS === 'ios' ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : undefined;

/**
 * Data classification for storage
 */
export enum DataSensitivity {
  /** Highly sensitive: auth tokens, encryption keys, passwords */
  CRITICAL = 'critical',
  /** Sensitive: user PII, financial data */
  SENSITIVE = 'sensitive',
  /** Non-sensitive: UI preferences, cached public data */
  PUBLIC = 'public',
}

/**
 * Secure storage interface
 */
export class SecureStorage {
  private static readonly SECURE_PREFIX = 'secure_';
  private static readonly PUBLIC_PREFIX = 'public_';

  /**
   * Store data based on sensitivity level
   */
  static async setItem(
    key: string,
    value: string,
    sensitivity: DataSensitivity = DataSensitivity.SENSITIVE
  ): Promise<void> {
    try {
      if (sensitivity === DataSensitivity.PUBLIC) {
        // Use AsyncStorage for non-sensitive data
        await AsyncStorage.setItem(this.PUBLIC_PREFIX + key, value);
      } else {
        // Use SecureStore for sensitive/critical data
        await SecureStore.setItemAsync(
          this.SECURE_PREFIX + key,
          value,
          SECURE_OPTS
        );
      }
    } catch (error) {
      console.error(`[SecureStorage] Failed to store ${sensitivity} data:`, error);
      throw new Error(`Failed to store data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Retrieve data based on sensitivity level
   */
  static async getItem(
    key: string,
    sensitivity: DataSensitivity = DataSensitivity.SENSITIVE
  ): Promise<string | null> {
    try {
      if (sensitivity === DataSensitivity.PUBLIC) {
        return await AsyncStorage.getItem(this.PUBLIC_PREFIX + key);
      } else {
        return await SecureStore.getItemAsync(this.SECURE_PREFIX + key);
      }
    } catch (error) {
      console.error(`[SecureStorage] Failed to retrieve ${sensitivity} data:`, error);
      return null;
    }
  }

  /**
   * Remove data
   */
  static async removeItem(
    key: string,
    sensitivity: DataSensitivity = DataSensitivity.SENSITIVE
  ): Promise<void> {
    try {
      if (sensitivity === DataSensitivity.PUBLIC) {
        await AsyncStorage.removeItem(this.PUBLIC_PREFIX + key);
      } else {
        await SecureStore.deleteItemAsync(this.SECURE_PREFIX + key);
      }
    } catch (error) {
      console.error(`[SecureStorage] Failed to remove ${sensitivity} data:`, error);
      throw new Error(`Failed to remove data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Store JSON data
   */
  static async setJSON<T>(
    key: string,
    value: T,
    sensitivity: DataSensitivity = DataSensitivity.SENSITIVE
  ): Promise<void> {
    try {
      const jsonString = JSON.stringify(value);
      await this.setItem(key, jsonString, sensitivity);
    } catch (error) {
      console.error('[SecureStorage] Failed to store JSON:', error);
      throw new Error(`Failed to store JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Retrieve JSON data
   */
  static async getJSON<T>(
    key: string,
    sensitivity: DataSensitivity = DataSensitivity.SENSITIVE
  ): Promise<T | null> {
    try {
      const jsonString = await this.getItem(key, sensitivity);
      if (!jsonString) return null;
      return JSON.parse(jsonString) as T;
    } catch (error) {
      console.error('[SecureStorage] Failed to retrieve JSON:', error);
      return null;
    }
  }

  /**
   * Check if a key exists
   */
  static async hasItem(
    key: string,
    sensitivity: DataSensitivity = DataSensitivity.SENSITIVE
  ): Promise<boolean> {
    try {
      const value = await this.getItem(key, sensitivity);
      return value !== null;
    } catch {
      return false;
    }
  }

  /**
   * Clear all secure data (use with caution!)
   * Does not clear public data
   */
  static async clearSecureData(): Promise<void> {
    try {
      // Note: SecureStore doesn't provide a way to list all keys
      // This is a security feature - you need to know what you're deleting
      console.warn('[SecureStorage] clearSecureData called - only clears known keys');
      
      // Clear known sensitive keys
      const knownKeys = [
        'auth_token',
        'refresh_token',
        'encryption_key',
        'user_credentials',
      ];
      
      for (const key of knownKeys) {
        try {
          await this.removeItem(key, DataSensitivity.CRITICAL);
        } catch {
          // Continue even if key doesn't exist
        }
      }
    } catch (error) {
      console.error('[SecureStorage] Failed to clear secure data:', error);
      throw new Error('Failed to clear secure data');
    }
  }

  /**
   * Migrate data from AsyncStorage to SecureStore
   * Use this to upgrade storage of sensitive data
   */
  static async migrateToSecure(
    key: string,
    removeOriginal: boolean = true
  ): Promise<boolean> {
    try {
      // Get from AsyncStorage
      const value = await AsyncStorage.getItem(key);
      if (!value) {
        return false; // Nothing to migrate
      }

      // Store in SecureStore
      await SecureStore.setItemAsync(
        this.SECURE_PREFIX + key,
        value,
        SECURE_OPTS
      );

      // Optionally remove from AsyncStorage
      if (removeOriginal) {
        await AsyncStorage.removeItem(key);
      }

      console.log(`[SecureStorage] Migrated ${key} to secure storage`);
      return true;
    } catch (error) {
      console.error(`[SecureStorage] Failed to migrate ${key}:`, error);
      return false;
    }
  }

  /**
   * Batch migration helper
   */
  static async migrateMultipleToSecure(
    keys: string[],
    removeOriginal: boolean = true
  ): Promise<{ succeeded: string[]; failed: string[] }> {
    const succeeded: string[] = [];
    const failed: string[] = [];

    for (const key of keys) {
      const success = await this.migrateToSecure(key, removeOriginal);
      if (success) {
        succeeded.push(key);
      } else {
        failed.push(key);
      }
    }

    return { succeeded, failed };
  }
}

/**
 * Convenience functions for common use cases
 */

/**
 * Store auth tokens securely
 */
export async function storeAuthToken(token: string): Promise<void> {
  await SecureStorage.setItem('auth_token', token, DataSensitivity.CRITICAL);
}

/**
 * Retrieve auth token
 */
export async function getAuthToken(): Promise<string | null> {
  return await SecureStorage.getItem('auth_token', DataSensitivity.CRITICAL);
}

/**
 * Remove auth token
 */
export async function removeAuthToken(): Promise<void> {
  await SecureStorage.removeItem('auth_token', DataSensitivity.CRITICAL);
}

/**
 * Store user encryption keys
 */
export async function storeEncryptionKey(
  keyId: string,
  key: string
): Promise<void> {
  await SecureStorage.setItem(
    `encryption_key_${keyId}`,
    key,
    DataSensitivity.CRITICAL
  );
}

/**
 * Retrieve user encryption key
 */
export async function getEncryptionKey(
  keyId: string
): Promise<string | null> {
  return await SecureStorage.getItem(
    `encryption_key_${keyId}`,
    DataSensitivity.CRITICAL
  );
}

/**
 * Store user credentials (temporary, e.g., for biometric re-auth)
 */
export async function storeCredentials(
  userId: string,
  credentials: { email?: string; hashedPassword?: string }
): Promise<void> {
  await SecureStorage.setJSON(
    `credentials_${userId}`,
    credentials,
    DataSensitivity.CRITICAL
  );
}

/**
 * Retrieve user credentials
 */
export async function getCredentials(
  userId: string
): Promise<{ email?: string; hashedPassword?: string } | null> {
  return await SecureStorage.getJSON(
    `credentials_${userId}`,
    DataSensitivity.CRITICAL
  );
}

/**
 * Store sensitive user profile data
 */
export async function storeSensitiveProfile(
  userId: string,
  data: {
    phoneNumber?: string;
    ssn?: string;
    bankAccount?: string;
    [key: string]: any;
  }
): Promise<void> {
  await SecureStorage.setJSON(
    `sensitive_profile_${userId}`,
    data,
    DataSensitivity.SENSITIVE
  );
}

/**
 * Retrieve sensitive user profile data
 */
export async function getSensitiveProfile(
  userId: string
): Promise<any | null> {
  return await SecureStorage.getJSON(
    `sensitive_profile_${userId}`,
    DataSensitivity.SENSITIVE
  );
}

/**
 * Store public user preferences (non-sensitive)
 */
export async function storePreferences(
  userId: string,
  preferences: Record<string, any>
): Promise<void> {
  await SecureStorage.setJSON(
    `preferences_${userId}`,
    preferences,
    DataSensitivity.PUBLIC
  );
}

/**
 * Retrieve public user preferences
 */
export async function getPreferences(
  userId: string
): Promise<Record<string, any> | null> {
  return await SecureStorage.getJSON(
    `preferences_${userId}`,
    DataSensitivity.PUBLIC
  );
}

/**
 * Check storage availability
 */
export function isSecureStorageAvailable(): boolean {
  try {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  } catch {
    return false;
  }
}

/**
 * Get storage recommendations for different data types
 */
export function getStorageRecommendation(dataType: string): DataSensitivity {
  const recommendations: Record<string, DataSensitivity> = {
    // Critical - always use SecureStore
    auth_token: DataSensitivity.CRITICAL,
    refresh_token: DataSensitivity.CRITICAL,
    password: DataSensitivity.CRITICAL,
    encryption_key: DataSensitivity.CRITICAL,
    private_key: DataSensitivity.CRITICAL,
    api_key: DataSensitivity.CRITICAL,
    
    // Sensitive - use SecureStore
    phone_number: DataSensitivity.SENSITIVE,
    email: DataSensitivity.SENSITIVE,
    address: DataSensitivity.SENSITIVE,
    payment_method: DataSensitivity.SENSITIVE,
    ssn: DataSensitivity.SENSITIVE,
    
    // Public - can use AsyncStorage
    theme: DataSensitivity.PUBLIC,
    language: DataSensitivity.PUBLIC,
    notifications_enabled: DataSensitivity.PUBLIC,
    cache: DataSensitivity.PUBLIC,
    ui_state: DataSensitivity.PUBLIC,
  };

  return recommendations[dataType] || DataSensitivity.SENSITIVE;
}

/**
 * Migration helper to identify AsyncStorage keys that should be migrated
 */
export async function identifyMigrationCandidates(): Promise<string[]> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    
    // Filter keys that might contain sensitive data
    const sensitivePatterns = [
      /token/i,
      /key/i,
      /password/i,
      /credential/i,
      /auth/i,
      /secret/i,
      /private/i,
    ];
    
    const candidates = allKeys.filter(key => 
      sensitivePatterns.some(pattern => pattern.test(key))
    );
    
    return candidates;
  } catch (error) {
    console.error('[SecureStorage] Failed to identify migration candidates:', error);
    return [];
  }
}

export default SecureStorage;
