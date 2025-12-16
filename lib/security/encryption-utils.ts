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
 * E2E Message Encryption
 * 
 * ⚠️ CRITICAL WARNING: These functions are DEMO-ONLY stubs and provide NO real security.
 * They MUST NOT be used in production.
 * 
 * For production E2E encryption, use:
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
 * DEMO-ONLY: This function does NOT provide real E2E encryption.
 * It must NOT be used in production. Throws error if NODE_ENV is production.
 * 
 * @throws {Error} Always throws in production environment
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: string
): Promise<EncryptedMessage> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[Encryption] encryptMessage is a DEMO-ONLY stub and must NOT be used in production. ' +
      'Please implement proper E2E encryption using a secure library (e.g. libsignal, olm).'
    );
  }
  
  console.error('[Encryption] Using DEMO-ONLY encryptMessage - DO NOT USE IN PRODUCTION');
  
  try {
    // Generate IV for this message
    const iv = await generateIV();
    
    // In a real implementation, use the recipient's public key for key exchange
    // For now, we'll use a derived key (this is NOT secure for production)
    const derivedKey = await hashData(recipientPublicKey + iv);
    
    // Obfuscate the message (NOT real encryption)
    const ciphertext = await obfuscateData(plaintext, derivedKey);
    
    return {
      ciphertext,
      iv,
      timestamp: Date.now(),
      version: '1.0-demo'
    };
  } catch (error) {
    console.error('[Encryption] Failed to encrypt message:', error);
    throw new Error('Failed to encrypt message');
  }
}

/**
 * DEMO-ONLY: This function does NOT provide real E2E decryption.
 * It must NOT be used in production. Throws error if NODE_ENV is production.
 * 
 * @throws {Error} Always throws in production environment
 */
export async function decryptMessage(
  encryptedMsg: EncryptedMessage,
  recipientPrivateKey: string
): Promise<string> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[Encryption] decryptMessage is a DEMO-ONLY stub and must NOT be used in production. ' +
      'Please implement proper E2E decryption using a secure library (e.g. libsignal, olm).'
    );
  }
  
  console.error('[Encryption] Using DEMO-ONLY decryptMessage - DO NOT USE IN PRODUCTION');
  
  try {
    // Derive the key (same as encryption)
    const derivedKey = await hashData(recipientPrivateKey + encryptedMsg.iv);
    
    // Deobfuscate the message (NOT real decryption)
    const plaintext = await deobfuscateData(encryptedMsg.ciphertext, derivedKey);
    
    return plaintext;
  } catch (error) {
    console.error('[Encryption] Failed to decrypt message:', error);
    throw new Error('Failed to decrypt message');
  }
}

/**
 * Generate a key pair for E2E encryption
 * 
 * ⚠️ CRITICAL WARNING: This is a DEMO-ONLY stub that is cryptographically INSECURE.
 * Deriving a public key from a private key via hashing is NOT how public-key crypto works.
 * This function throws an error in production.
 * 
 * For production, use proper public-key cryptography:
 * - libsodium (via react-native-sodium)
 * - tweetnacl (via tweetnacl-react-native-randombytes)
 * - Web Crypto API when available
 * 
 * @throws {Error} Always throws in production environment
 */
export async function generateKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[Encryption] generateKeyPair is INSECURE and must NOT be used in production. ' +
      'Use a proper crypto library (libsodium, tweetnacl) for real key pair generation.'
    );
  }
  
  console.error('[Encryption] generateKeyPair is DEMO-ONLY and cryptographically INSECURE');
  
  try {
    // PLACEHOLDER: Generate random keys (not actual key pair)
    const privateKey = await generateEncryptionKey();
    const publicKey = await hashData(privateKey); // NOT secure - placeholder only
    
    return { publicKey, privateKey };
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
