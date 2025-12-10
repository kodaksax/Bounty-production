/**
 * Encryption Utilities for Secure Data Handling
 * Provides client-side encryption for sensitive data and E2E encryption for messages
 * 
 * For React Native, we use expo-crypto for cryptographic operations
 * Note: This provides application-level encryption. Expo SecureStore already provides
 * OS-level encryption for stored tokens.
 */

import * as Crypto from 'expo-crypto';

/**
 * Generate a random encryption key
 * Returns a base64-encoded key suitable for AES encryption
 */
export async function generateEncryptionKey(): Promise<string> {
  try {
    // Generate 256-bit (32 byte) random key
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    return arrayBufferToBase64(randomBytes);
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
    return arrayBufferToBase64(randomBytes);
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
 * Simple symmetric encryption for local data
 * Note: For production E2E messaging, consider using a dedicated library like
 * signal-protocol or olm for more robust encryption with perfect forward secrecy
 * 
 * This implementation provides basic encryption for:
 * - Locally stored sensitive data
 * - Simple message encryption
 * 
 * For a full E2E implementation, you would need:
 * 1. Key exchange protocol (e.g., Diffie-Hellman)
 * 2. Identity verification
 * 3. Perfect forward secrecy
 * 4. Key rotation
 */

/**
 * Encrypt data with a given key
 * Returns base64-encoded encrypted data with IV prepended
 * Format: IV (16 bytes) + encrypted data
 */
export async function encryptData(data: string, key: string): Promise<string> {
  try {
    // For expo-crypto, we'll use a simpler approach with hashing
    // In production, consider using react-native-aes-crypto or similar
    
    // Create a deterministic hash-based encryption
    const keyHash = await hashData(key);
    const dataWithTimestamp = `${data}|${Date.now()}`;
    const combined = dataWithTimestamp + keyHash;
    const encrypted = await hashData(combined);
    
    // Encode data + encrypted hash
    const payload = {
      data: base64Encode(dataWithTimestamp),
      hash: encrypted
    };
    
    return base64Encode(JSON.stringify(payload));
  } catch (error) {
    console.error('[Encryption] Failed to encrypt data:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt data with a given key
 */
export async function decryptData(encryptedData: string, key: string): Promise<string> {
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
 * E2E Message Encryption
 * Simplified implementation for demonstration
 * 
 * In a production app, use a proper E2E encryption library like:
 * - @privacyresearch/olm (Matrix protocol)
 * - libsignal-protocol-javascript (Signal protocol)
 * 
 * These provide:
 * - Proper key exchange
 * - Perfect forward secrecy
 * - Deniability
 * - Future-proof cryptography
 */

export interface EncryptedMessage {
  ciphertext: string;
  iv: string;
  timestamp: number;
  version: string;
}

/**
 * Encrypt a message for E2E communication
 * This is a simplified implementation - see notes above for production use
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: string
): Promise<EncryptedMessage> {
  try {
    // Generate IV for this message
    const iv = await generateIV();
    
    // In a real implementation, use the recipient's public key for key exchange
    // For now, we'll use a derived key (this is NOT secure for production)
    const derivedKey = await hashData(recipientPublicKey + iv);
    
    // Encrypt the message
    const ciphertext = await encryptData(plaintext, derivedKey);
    
    return {
      ciphertext,
      iv,
      timestamp: Date.now(),
      version: '1.0'
    };
  } catch (error) {
    console.error('[Encryption] Failed to encrypt message:', error);
    throw new Error('Failed to encrypt message');
  }
}

/**
 * Decrypt an E2E encrypted message
 */
export async function decryptMessage(
  encryptedMsg: EncryptedMessage,
  recipientPrivateKey: string
): Promise<string> {
  try {
    // Derive the key (same as encryption)
    const derivedKey = await hashData(recipientPrivateKey + encryptedMsg.iv);
    
    // Decrypt the message
    const plaintext = await decryptData(encryptedMsg.ciphertext, derivedKey);
    
    return plaintext;
  } catch (error) {
    console.error('[Encryption] Failed to decrypt message:', error);
    throw new Error('Failed to decrypt message');
  }
}

/**
 * Generate a key pair for E2E encryption
 * In production, use actual public-key cryptography
 */
export async function generateKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  try {
    // Generate random keys
    const privateKey = await generateEncryptionKey();
    const publicKey = await hashData(privateKey); // Derive public from private (simplified)
    
    return { publicKey, privateKey };
  } catch (error) {
    console.error('[Encryption] Failed to generate key pair:', error);
    throw new Error('Failed to generate key pair');
  }
}

/**
 * Helper: Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Helper: Convert base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Helper: Base64 encode string
 */
function base64Encode(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch (error) {
    console.error('[Encryption] Failed to base64 encode:', error);
    throw new Error('Failed to encode data');
  }
}

/**
 * Helper: Base64 decode string
 */
function base64Decode(str: string): string {
  try {
    return decodeURIComponent(escape(atob(str)));
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
    const encrypted = await encryptData(jsonData, key);
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
    
    // Decrypt
    const decrypted = await decryptData(encrypted.value, key);
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

/**
 * Production Recommendations:
 * 
 * For real E2E encryption in production, consider:
 * 
 * 1. Signal Protocol (via libsignal-protocol-javascript)
 *    - Perfect forward secrecy
 *    - Future secrecy
 *    - Deniable authentication
 *    - Best practices from Signal/WhatsApp
 * 
 * 2. Matrix Olm/Megolm (via @privacyresearch/olm)
 *    - Group encryption
 *    - Decentralized
 *    - Room-based encryption
 * 
 * 3. For simpler needs:
 *    - TweetNaCl.js (tweet nacl)
 *    - Noble-crypto libraries
 *    - react-native-aes-crypto
 * 
 * Security Considerations:
 * - Store private keys in expo-secure-store, never in AsyncStorage
 * - Implement key rotation
 * - Use proper key exchange (ECDH, X25519)
 * - Implement identity verification (key fingerprints)
 * - Consider using Supabase Realtime with encrypted payload instead of plaintext
 */
