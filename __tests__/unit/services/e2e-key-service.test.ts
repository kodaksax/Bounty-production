/**
 * Unit tests for e2e-key-service
 * Covers key generation, storage, publishing, and recipient key lookup.
 */

jest.mock('tweetnacl', () => {
  const actual = jest.requireActual('tweetnacl');
  return actual;
});

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Mock generateKeyPair so we don't need expo-crypto in this test
jest.mock('../../../lib/security/encryption-utils', () => {
  const nacl = require('tweetnacl');

  function uint8ToBase64(arr: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    return Buffer.from(binary, 'binary').toString('base64');
  }
  function base64ToUint8(str: string): Uint8Array {
    const binary = Buffer.from(str, 'base64').toString('binary');
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr;
  }

  return {
    generateKeyPair: jest.fn(async () => {
      const kp = nacl.box.keyPair();
      return {
        publicKey: uint8ToBase64(kp.publicKey),
        privateKey: uint8ToBase64(kp.secretKey),
      };
    }),
    uint8ToBase64,
    base64ToUint8,
  };
});

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../lib/supabase';
import { e2eKeyService } from '../../../lib/services/e2e-key-service';

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

function buildSupabaseMock(returnValue: any) {
  const singleFn = jest.fn().mockResolvedValue(returnValue);
  const eqFn = jest.fn().mockReturnValue({ single: singleFn });
  const selectFn = jest.fn().mockReturnValue({ eq: eqFn });
  const updateEqFn = jest.fn().mockResolvedValue(returnValue);
  const updateFn = jest.fn().mockReturnValue({ eq: updateEqFn });
  (supabase.from as jest.Mock).mockReturnValue({
    select: selectFn,
    update: updateFn,
  });
  return { singleFn, eqFn, selectFn, updateEqFn, updateFn };
}

describe('E2E Key Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrGenerateKeyPair', () => {
    it('should generate and store a new key pair when none exists', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);
      mockSecureStore.setItemAsync.mockResolvedValue(undefined);
      buildSupabaseMock({ data: {}, error: null });

      const result = await e2eKeyService.getOrGenerateKeyPair('user-123');

      expect(result).not.toBeNull();
      expect(typeof result!.publicKey).toBe('string');
      expect(typeof result!.privateKey).toBe('string');
      // Private key stored under a user-scoped key
      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
        'e2e_private_key_v2_user-123',
        result!.privateKey
      );
    });

    it('should return the existing key pair on subsequent calls', async () => {
      // Simulate an already-stored private key
      const nacl = require('tweetnacl');
      const kp = nacl.box.keyPair();

      function uint8ToBase64(arr: Uint8Array): string {
        return Buffer.from(arr).toString('base64');
      }
      const storedPrivateKey = uint8ToBase64(kp.secretKey);
      const expectedPublicKey = uint8ToBase64(kp.publicKey);

      mockSecureStore.getItemAsync.mockResolvedValue(storedPrivateKey);

      const result = await e2eKeyService.getOrGenerateKeyPair('user-123');

      expect(result).not.toBeNull();
      expect(result!.privateKey).toBe(storedPrivateKey);
      expect(result!.publicKey).toBe(expectedPublicKey);
      // Should NOT generate a new key
      const { generateKeyPair } = require('../../../lib/security/encryption-utils');
      expect(generateKeyPair).not.toHaveBeenCalled();
    });

    it('should scope the SecureStore key to the userId', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);
      mockSecureStore.setItemAsync.mockResolvedValue(undefined);
      buildSupabaseMock({ data: {}, error: null });

      await e2eKeyService.getOrGenerateKeyPair('alice');
      await e2eKeyService.getOrGenerateKeyPair('bob');

      const calls = mockSecureStore.getItemAsync.mock.calls.map(([key]) => key);
      expect(calls).toContain('e2e_private_key_v2_alice');
      expect(calls).toContain('e2e_private_key_v2_bob');
      expect(calls[0]).not.toBe(calls[1]);
    });
  });

  describe('publishPublicKey', () => {
    it('should update profiles table with the public key', async () => {
      const mocks = buildSupabaseMock({ data: {}, error: null });

      await e2eKeyService.publishPublicKey('user-123', 'my-public-key');

      expect(supabase.from).toHaveBeenCalledWith('profiles');
      expect(mocks.updateFn).toHaveBeenCalledWith({ e2e_public_key: 'my-public-key' });
      expect(mocks.updateEqFn).toHaveBeenCalledWith('id', 'user-123');
    });

    it('should throw when Supabase returns an error', async () => {
      const supabaseError = { message: 'RLS policy violation', code: '42501' };
      const updateEqFn = jest.fn().mockResolvedValue({ data: null, error: supabaseError });
      const updateFn = jest.fn().mockReturnValue({ eq: updateEqFn });
      (supabase.from as jest.Mock).mockReturnValue({ update: updateFn });

      await expect(
        e2eKeyService.publishPublicKey('user-123', 'my-public-key')
      ).rejects.toMatchObject(supabaseError);
    });
  });

  describe('getRecipientPublicKey', () => {
    it('should return cached key without hitting Supabase', async () => {
      mockAsyncStorage.getItem.mockResolvedValue('cached-pub-key');

      const key = await e2eKeyService.getRecipientPublicKey('user-456');

      expect(key).toBe('cached-pub-key');
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('should fetch from Supabase on cache miss and cache the result', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);
      mockAsyncStorage.setItem.mockResolvedValue(undefined);

      const singleFn = jest.fn().mockResolvedValue({
        data: { e2e_public_key: 'fetched-pub-key' },
        error: null,
      });
      const eqFn = jest.fn().mockReturnValue({ single: singleFn });
      const selectFn = jest.fn().mockReturnValue({ eq: eqFn });
      (supabase.from as jest.Mock).mockReturnValue({ select: selectFn });

      const key = await e2eKeyService.getRecipientPublicKey('user-456');

      expect(key).toBe('fetched-pub-key');
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        '@bountyexpo:e2e_pubkey_user-456',
        'fetched-pub-key'
      );
    });

    it('should return null and not cache on Supabase error', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);

      const supabaseError = { message: 'Row not found', code: 'PGRST116' };
      const singleFn = jest.fn().mockResolvedValue({ data: null, error: supabaseError });
      const eqFn = jest.fn().mockReturnValue({ single: singleFn });
      const selectFn = jest.fn().mockReturnValue({ eq: eqFn });
      (supabase.from as jest.Mock).mockReturnValue({ select: selectFn });

      const key = await e2eKeyService.getRecipientPublicKey('user-456');

      expect(key).toBeNull();
      // Must not cache null/error result
      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it('should return null when user has no e2e_public_key set', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);

      const singleFn = jest.fn().mockResolvedValue({
        data: { e2e_public_key: null },
        error: null,
      });
      const eqFn = jest.fn().mockReturnValue({ single: singleFn });
      const selectFn = jest.fn().mockReturnValue({ eq: eqFn });
      (supabase.from as jest.Mock).mockReturnValue({ select: selectFn });

      const key = await e2eKeyService.getRecipientPublicKey('user-456');

      expect(key).toBeNull();
      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('deleteLocalKeyPair', () => {
    it('should delete the user-scoped private key from SecureStore', async () => {
      mockSecureStore.deleteItemAsync.mockResolvedValue(undefined);

      await e2eKeyService.deleteLocalKeyPair('user-123');

      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('e2e_private_key_v2_user-123');
    });
  });
});
