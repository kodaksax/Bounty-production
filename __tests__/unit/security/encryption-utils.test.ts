/**
 * Unit tests for encryption-utils (E2E message encryption)
 *
 * These tests exercise the nacl.box-based encrypt/decrypt round-trip and
 * verify that the key pair helpers produce compatible keys.
 */

// Mock expo-crypto: use actual random bytes so key pairs are unique and valid
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (n: number) => {
    const bytes = new Uint8Array(n);
    // Node v14+ has globalThis.crypto.getRandomValues available
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }),
  digestStringAsync: jest.fn(async (_alg: unknown, data: string) => `sha256:${data}`),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

import {
  generateKeyPair,
  encryptMessage,
  decryptMessage,
  type EncryptedMessage,
} from '../../../lib/security/encryption-utils';

describe('E2E Message Encryption (nacl.box)', () => {
  describe('generateKeyPair', () => {
    it('should return base64-encoded public and private keys', async () => {
      const { publicKey, privateKey } = await generateKeyPair();
      expect(typeof publicKey).toBe('string');
      expect(typeof privateKey).toBe('string');
      // X25519 keys are 32 bytes → 44 chars in base64 (with padding)
      expect(Buffer.from(publicKey, 'base64').length).toBe(32);
      expect(Buffer.from(privateKey, 'base64').length).toBe(32);
    });

    it('should produce different keys on each call', async () => {
      const kp1 = await generateKeyPair();
      const kp2 = await generateKeyPair();
      expect(kp1.publicKey).not.toBe(kp2.publicKey);
      expect(kp1.privateKey).not.toBe(kp2.privateKey);
    });
  });

  describe('encryptMessage / decryptMessage round-trip', () => {
    it('should encrypt and decrypt a simple message', async () => {
      const sender = await generateKeyPair();
      const recipient = await generateKeyPair();

      const plaintext = 'Hello, World!';
      const encrypted = await encryptMessage(
        plaintext,
        recipient.publicKey,
        sender.privateKey
      );

      expect(encrypted.version).toBe('2.0');
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.nonce).toBeTruthy();
      expect(encrypted.senderPublicKey).toBe(sender.publicKey);

      const decrypted = await decryptMessage(encrypted, recipient.privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt messages with unicode characters', async () => {
      const sender = await generateKeyPair();
      const recipient = await generateKeyPair();

      const plaintext = '🔐 Secure message: привет мир';
      const encrypted = await encryptMessage(plaintext, recipient.publicKey, sender.privateKey);
      const decrypted = await decryptMessage(encrypted, recipient.privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for the same plaintext (fresh nonce)', async () => {
      const sender = await generateKeyPair();
      const recipient = await generateKeyPair();

      const plaintext = 'Same message';
      const enc1 = await encryptMessage(plaintext, recipient.publicKey, sender.privateKey);
      const enc2 = await encryptMessage(plaintext, recipient.publicKey, sender.privateKey);

      // Nonces differ → ciphertexts differ
      expect(enc1.nonce).not.toBe(enc2.nonce);
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    });

    it('should fail to decrypt with the wrong private key', async () => {
      const sender = await generateKeyPair();
      const recipient = await generateKeyPair();
      const wrongRecipient = await generateKeyPair();

      const encrypted = await encryptMessage('Secret', recipient.publicKey, sender.privateKey);

      await expect(decryptMessage(encrypted, wrongRecipient.privateKey)).rejects.toThrow(
        'Failed to decrypt message'
      );
    });

    it('should fail to decrypt a tampered ciphertext', async () => {
      const sender = await generateKeyPair();
      const recipient = await generateKeyPair();

      const encrypted = await encryptMessage('Secret', recipient.publicKey, sender.privateKey);

      // Tamper with ciphertext (flip a byte by re-encoding with different content)
      const tampered: EncryptedMessage = {
        ...encrypted,
        ciphertext: btoa('tampered-garbage-data'),
      };

      await expect(decryptMessage(tampered, recipient.privateKey)).rejects.toThrow(
        'Failed to decrypt message'
      );
    });
    it('should include recipientPublicKey in the payload', async () => {
      const sender = await generateKeyPair();
      const recipient = await generateKeyPair();

      const encrypted = await encryptMessage('Hello', recipient.publicKey, sender.privateKey);
      expect(encrypted.recipientPublicKey).toBe(recipient.publicKey);
    });

    it('should allow sender to decrypt their own sent message using recipientPublicKey', async () => {
      const sender = await generateKeyPair();
      const recipient = await generateKeyPair();

      const plaintext = 'Message from sender';
      const encrypted = await encryptMessage(plaintext, recipient.publicKey, sender.privateKey);

      // Sender decrypts: swap senderPublicKey with recipientPublicKey
      const senderPayload: EncryptedMessage = {
        ...encrypted,
        senderPublicKey: encrypted.recipientPublicKey!,
      };
      const decryptedBySender = await decryptMessage(senderPayload, sender.privateKey);
      expect(decryptedBySender).toBe(plaintext);
    });
  });
});
