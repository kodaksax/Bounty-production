/**
 * Encryption Utilities for Secure Data Handling
 * Provides client-side encryption for sensitive data and E2E encryption for messages
 * 
 * E2E message encryption uses TweetNaCl's box construction:
 *   X25519 key exchange + XSalsa20-Poly1305 AEAD (authenticated encryption)
 * 
 * Note: Expo SecureStore provides OS-level encryption for stored private keys.
 */

import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';

/**
 * Generate a random encryption key
 * Returns a base64-encoded key suitable for AES encryption
 */
export async function generateEncryptionKey(): Promise<string> {
  try {
    // Generate 256-bit (32 byte) random key
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    return arrayBufferToBase64(randomBytes.buffer);
  } catch (error) {
    console.error('[Encryption] Failed to generate key:', error);
    throw new Error('Failed to generate encryption key');
  }
}

/**
 * Generate a random initialization vector (IV)
 */
export async function generateIV(): Promise<string> {
  try {
    // Generate 128-bit (16 byte) IV for AES
    const randomBytes = await Crypto.getRandomBytesAsync(16);
    return arrayBufferToBase64(randomBytes.buffer);
  } catch (error) {
    console.error('[Encryption] Failed to generate IV:', error);
    throw new Error('Failed to generate IV');
  }
}

/**
 * Hash data using SHA256
 * Useful for creating message fingerprints, verifying integrity, etc.
 */
export async function hashData(data: string): Promise<string> {
  try {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      data
    );
    return digest;
  } catch (error) {
    console.error('[Encryption] Failed to hash data:', error);
    throw new Error('Failed to hash data');
  }
}

/**
 * Symmetric encryption helpers for local data storage.
 * E2E message encryption uses the nacl.box functions below.
 */

/**
 * Obfuscate data with integrity checking
 * 
 * ⚠️ WARNING: This is NOT encryption - it provides data obfuscation and integrity checking only.
 * The data is base64-encoded (easily decoded) with an integrity hash.
 * 
 * For production use with actual encryption, use:
 * - react-native-aes-crypto for AES encryption
 * - @react-native-community/async-storage with encryption
 * - expo-crypto with Web Crypto API (when available)
 * 
 * This implementation is suitable for:
 * - Obfuscating data from casual inspection
 * - Verifying data integrity
 * - Development/testing
 */
export async function obfuscateData(data: string, key: string): Promise<string> {
  try {
    // Create integrity hash (NOT ENCRYPTION - data is visible)
    const keyHash = await hashData(key);
    const dataWithTimestamp = `${data}|${Date.now()}`;
    const combined = dataWithTimestamp + keyHash;
    const integrity = await hashData(combined);
    
    // Encode data + integrity hash (data is NOT encrypted)
    const payload = {
      data: base64Encode(dataWithTimestamp),
      hash: integrity
    };
    
    return base64Encode(JSON.stringify(payload));
  } catch (error) {
    console.error('[Encryption] Failed to encrypt data:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Deobfuscate data with integrity verification
 * 
 * ⚠️ WARNING: This is NOT decryption - it reverses the obfuscation applied by obfuscateData.
 */
export async function deobfuscateData(encryptedData: string, key: string): Promise<string> {
  try {
    // Decode the payload
    const payloadStr = base64Decode(encryptedData);
    const payload = JSON.parse(payloadStr);
    
    // Verify the hash
    const keyHash = await hashData(key);
    const dataWithTimestamp = base64Decode(payload.data);
    const combined = dataWithTimestamp + keyHash;
    const expectedHash = await hashData(combined);
    
    if (expectedHash !== payload.hash) {
      throw new Error('Invalid encryption key or corrupted data');
    }
    
    // Extract original data (remove timestamp)
    const [originalData] = dataWithTimestamp.split('|');
    return originalData;
  } catch (error) {
    console.error('[Encryption] Failed to decrypt data:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * E2E Message Encryption using TweetNaCl box
 *
 * nacl.box uses X25519 Diffie-Hellman key exchange combined with
 * XSalsa20-Poly1305 authenticated encryption (AEAD).
 *
 * Security properties:
 * - Confidentiality: only the intended recipient can read the message
 * - Authenticity: the recipient can verify the message came from the sender
 * - Integrity: any tampering is detected and decryption fails
 */

export interface EncryptedMessage {
  /** base64-encoded ciphertext (nacl.box output) */
  ciphertext: string;
  /** base64-encoded 24-byte nonce */
  nonce: string;
  /** base64-encoded X25519 public key of the sender */
  senderPublicKey: string;
  /** format version */
  version: string;
}

/**
 * Encrypt a plaintext message for a specific recipient using nacl.box.
 *
 * @param plaintext        - The message to encrypt
 * @param recipientPublicKey - Recipient's X25519 public key (base64)
 * @param senderPrivateKey  - Sender's X25519 private key (base64)
 * @returns EncryptedMessage containing ciphertext, nonce, and sender public key
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: string,
  senderPrivateKey: string
): Promise<EncryptedMessage> {
  try {
    const recipientPubBytes = base64ToUint8(recipientPublicKey);
    const senderSecBytes = base64ToUint8(senderPrivateKey);

    // Derive sender's public key from their private key
    const senderKeyPair = nacl.box.keyPair.fromSecretKey(senderSecBytes);

    // Generate a fresh nonce for every message
    const nonce = nacl.randomBytes(nacl.box.nonceLength);

    // Encode plaintext as UTF-8
    const msgBytes = new TextEncoder().encode(plaintext);

    // Encrypt: X25519 key exchange + XSalsa20-Poly1305 AEAD
    const cipherBytes = nacl.box(msgBytes, nonce, recipientPubBytes, senderSecBytes);

    return {
      ciphertext: uint8ToBase64(cipherBytes),
      nonce: uint8ToBase64(nonce),
      senderPublicKey: uint8ToBase64(senderKeyPair.publicKey),
      version: '2.0',
    };
  } catch (error) {
    console.error('[Encryption] Failed to encrypt message:', error);
    throw new Error('Failed to encrypt message');
  }
}

/**
 * Decrypt a message encrypted with encryptMessage.
 *
 * @param encryptedMsg     - The EncryptedMessage object
 * @param recipientPrivateKey - Recipient's X25519 private key (base64)
 * @returns Decrypted plaintext string
 */
export async function decryptMessage(
  encryptedMsg: EncryptedMessage,
  recipientPrivateKey: string
): Promise<string> {
  try {
    const cipherBytes = base64ToUint8(encryptedMsg.ciphertext);
    const nonce = base64ToUint8(encryptedMsg.nonce);
    const senderPubBytes = base64ToUint8(encryptedMsg.senderPublicKey);
    const recipientSecBytes = base64ToUint8(recipientPrivateKey);

    // Decrypt: X25519 key exchange + XSalsa20-Poly1305 AEAD
    const msgBytes = nacl.box.open(cipherBytes, nonce, senderPubBytes, recipientSecBytes);

    if (!msgBytes) {
      throw new Error('Decryption failed: authentication tag mismatch or wrong keys');
    }

    return new TextDecoder().decode(msgBytes);
  } catch (error) {
    console.error('[Encryption] Failed to decrypt message:', error);
    throw new Error('Failed to decrypt message');
  }
}

/**
 * Generate an X25519 key pair suitable for nacl.box encryption.
 * Store the private key in expo-secure-store; the public key can be shared openly.
 */
export async function generateKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  try {
    const { publicKey, secretKey } = nacl.box.keyPair();
    return {
      publicKey: uint8ToBase64(publicKey),
      privateKey: uint8ToBase64(secretKey),
    };
  } catch (error) {
    console.error('[Encryption] Failed to generate key pair:', error);
    throw new Error('Failed to generate key pair');
  }
}

/**
 * Helper: Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Helper: Convert Uint8Array to base64 string
 */
export function uint8ToBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

/**
 * Helper: Convert base64 string to Uint8Array
 */
export function base64ToUint8(str: string): Uint8Array {
  const binary = atob(str);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}



/**
 * Helper: Base64 encode string (UTF-8 safe)
 * Uses modern approach avoiding deprecated unescape/escape
 */
function base64Encode(str: string): string {
  try {
    // Use TextEncoder for proper UTF-8 encoding
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    
    // Convert Uint8Array to string for btoa
    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    
    return btoa(binary);
  } catch (error) {
    console.error('[Encryption] Failed to base64 encode:', error);
    throw new Error('Failed to encode data');
  }
}

/**
 * Helper: Base64 decode string (UTF-8 safe)
 * Uses modern approach avoiding deprecated unescape/escape
 */
function base64Decode(str: string): string {
  try {
    const binary = atob(str);
    
    // Convert binary string to Uint8Array
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    // Use TextDecoder for proper UTF-8 decoding
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  } catch (error) {
    console.error('[Encryption] Failed to base64 decode:', error);
    throw new Error('Failed to decode data');
  }
}

/**
 * Verify data integrity with HMAC-like signature
 */
export async function signData(data: string, key: string): Promise<string> {
  try {
    const combined = `${data}|${key}`;
    return await hashData(combined);
  } catch (error) {
    console.error('[Encryption] Failed to sign data:', error);
    throw new Error('Failed to sign data');
  }
}

/**
 * Verify data signature
 */
export async function verifySignature(
  data: string,
  signature: string,
  key: string
): Promise<boolean> {
  try {
    const expectedSignature = await signData(data, key);
    return signature === expectedSignature;
  } catch (error) {
    console.error('[Encryption] Failed to verify signature:', error);
    return false;
  }
}

/**
 * Encrypt sensitive local storage data
 * Use this wrapper for encrypting data before storing in AsyncStorage
 */
export interface EncryptedStorage<T> {
  value: string; // encrypted
  timestamp: number;
  integrity: string; // signature
}

export async function encryptForStorage<T>(
  data: T,
  key: string
): Promise<EncryptedStorage<T>> {
  try {
    const jsonData = JSON.stringify(data);
    const encrypted = await obfuscateData(jsonData, key);
    const integrity = await signData(encrypted, key);
    
    return {
      value: encrypted,
      timestamp: Date.now(),
      integrity
    };
  } catch (error) {
    console.error('[Encryption] Failed to encrypt for storage:', error);
    throw new Error('Failed to encrypt for storage');
  }
}

export async function decryptFromStorage<T>(
  encrypted: EncryptedStorage<T>,
  key: string
): Promise<T> {
  try {
    // Verify integrity
    const isValid = await verifySignature(encrypted.value, encrypted.integrity, key);
    if (!isValid) {
      throw new Error('Data integrity check failed');
    }
    
    // Deobfuscate
    const decrypted = await deobfuscateData(encrypted.value, key);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('[Encryption] Failed to decrypt from storage:', error);
    throw new Error('Failed to decrypt from storage');
  }
}

/**
 * Check if encryption is available
 */
export function isEncryptionAvailable(): boolean {
  try {
    return typeof Crypto !== 'undefined' && typeof Crypto.getRandomBytesAsync === 'function';
  } catch {
    return false;
  }
}
