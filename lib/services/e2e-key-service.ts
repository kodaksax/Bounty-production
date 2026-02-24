/**
 * E2E Key Service
 *
 * Manages X25519 key pairs for end-to-end encrypted messaging:
 * - Private key: stored in expo-secure-store (never leaves the device)
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

const PRIVATE_KEY_STORE_KEY = 'e2e_private_key_v2';
const PUBLIC_KEY_CACHE_PREFIX = '@bountyexpo:e2e_pubkey_';

export const e2eKeyService = {
  /**
   * Get (or generate on first call) the current user's E2E key pair.
   * The private key is persisted in SecureStore; the public key is published
   * to Supabase so other users can encrypt messages for this user.
   */
  getOrGenerateKeyPair: async (
    userId: string
  ): Promise<{ publicKey: string; privateKey: string } | null> => {
    try {
      // Attempt to retrieve an existing private key
      const existingPrivateKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORE_KEY);

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

      // Persist private key in SecureStore (OS-level encrypted)
      await SecureStore.setItemAsync(PRIVATE_KEY_STORE_KEY, privateKey);

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
   * No-op if Supabase is not reachable.
   */
  publishPublicKey: async (userId: string, publicKey: string): Promise<void> => {
    try {
      await supabase
        .from('profiles')
        .update({ e2e_public_key: publicKey })
        .eq('id', userId);
    } catch (error) {
      console.error('[E2EKeyService] Failed to publish public key:', error);
    }
  },

  /**
   * Retrieve the E2E public key for a given user.
   * Results are cached in AsyncStorage to reduce network round-trips.
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
      const { data } = await supabase
        .from('profiles')
        .select('e2e_public_key')
        .eq('id', userId)
        .single();

      const key: string | null = (data as any)?.e2e_public_key ?? null;

      if (key) {
        // Cache for subsequent calls
        await AsyncStorage.setItem(cacheKey, key).catch(() => {});
      }

      return key;
    } catch (error) {
      console.error('[E2EKeyService] Failed to get recipient public key:', error);
      return null;
    }
  },

  /**
   * Clear the cached public key for a user (e.g., after a key rotation event).
   */
  clearCachedPublicKey: async (userId: string): Promise<void> => {
    await AsyncStorage.removeItem(PUBLIC_KEY_CACHE_PREFIX + userId).catch(() => {});
  },
};

export default e2eKeyService;
