/**
 * E2E Key Service
 *
 * Manages X25519 key pairs for end-to-end encrypted messaging:
 * - Private key: stored in expo-secure-store (never leaves the device), scoped per userId
 * - Public key: stored in Supabase `profiles.e2e_public_key` so other users can encrypt for us
 *
 * Usage:
 *   const { publicKey, privateKey } = await e2eKeyService.getOrGenerateKeyPair(userId);
 *   const recipientKey = await e2eKeyService.getRecipientPublicKey(recipientUserId);
 */

import nacl from 'tweetnacl';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { generateKeyPair, uint8ToBase64, base64ToUint8 } from '../security/encryption-utils';

const PUBLIC_KEY_CACHE_PREFIX = '@bountyexpo:e2e_pubkey_';

/** Per-user SecureStore key to prevent cross-account key reuse on shared devices */
function privateKeyStoreKey(userId: string): string {
  return `e2e_private_key_v2_${userId}`;
}

export const e2eKeyService = {
  /**
   * Get (or generate on first call) the current user's E2E key pair.
   * The private key is persisted in SecureStore scoped to the userId; the public
   * key is published to Supabase so other users can encrypt messages for this user.
   */
  getOrGenerateKeyPair: async (
    userId: string
  ): Promise<{ publicKey: string; privateKey: string } | null> => {
    try {
      const storeKey = privateKeyStoreKey(userId);

      // Attempt to retrieve an existing private key
      const existingPrivateKey = await SecureStore.getItemAsync(storeKey);

      if (existingPrivateKey) {
        // Derive the matching public key from the stored private key using nacl
        const secretKeyBytes = base64ToUint8(existingPrivateKey);
        const keyPair = nacl.box.keyPair.fromSecretKey(secretKeyBytes);
        return {
          publicKey: uint8ToBase64(keyPair.publicKey),
          privateKey: existingPrivateKey,
        };
      }

      // No key pair yet — generate one
      const { publicKey, privateKey } = await generateKeyPair();

      // Persist private key in SecureStore (OS-level encrypted, scoped to userId)
      await SecureStore.setItemAsync(storeKey, privateKey);

      // Publish public key so other users can encrypt for this user
      await e2eKeyService.publishPublicKey(userId, publicKey);

      return { publicKey, privateKey };
    } catch (error) {
      console.error('[E2EKeyService] Failed to get/generate key pair:', error);
      return null;
    }
  },

  /**
   * Publish this user's public key to their Supabase profile row.
   * Throws if the Supabase update fails (e.g., RLS/permission error).
   */
  publishPublicKey: async (userId: string, publicKey: string): Promise<void> => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ e2e_public_key: publicKey })
        .eq('id', userId);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('[E2EKeyService] Failed to publish public key:', error);
      throw error;
    }
  },

  /**
   * Retrieve the E2E public key for a given user.
   * Results are cached in AsyncStorage to reduce network round-trips.
   * Returns null (without caching) when the key is missing or a Supabase error occurs.
   */
  getRecipientPublicKey: async (userId: string): Promise<string | null> => {
    const cacheKey = PUBLIC_KEY_CACHE_PREFIX + userId;

    // Check local cache first
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) return cached;
    } catch {
      // Cache miss — continue to Supabase lookup
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('e2e_public_key')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('[E2EKeyService] Failed to get recipient public key from Supabase:', {
          userId,
          message: (error as any).message,
          code: (error as any).code,
        });
        return null;
      }

      const key: string | null = (data as any)?.e2e_public_key ?? null;

      if (key) {
        // Only cache successful, non-null results
        await AsyncStorage.setItem(cacheKey, key).catch(() => {});
      }

      return key;
    } catch (unexpectedError) {
      console.error('[E2EKeyService] Unexpected error while getting recipient public key:', unexpectedError);
      return null;
    }
  },

  /**
   * Clear the cached public key for a user (e.g., after a key rotation event).
   */
  clearCachedPublicKey: async (userId: string): Promise<void> => {
    await AsyncStorage.removeItem(PUBLIC_KEY_CACHE_PREFIX + userId).catch(() => {});
  },

  /**
   * Delete this user's private key from SecureStore (call on logout to prevent
   * the next account on the same device from inheriting stale keys).
   */
  deleteLocalKeyPair: async (userId: string): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(privateKeyStoreKey(userId));
    } catch (error) {
      console.error('[E2EKeyService] Failed to delete local key pair:', error);
    }
  },
};

export default e2eKeyService;
