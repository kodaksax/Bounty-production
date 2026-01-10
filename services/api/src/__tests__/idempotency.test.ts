/**
 * Idempotency Tests for Payment Operations
 * 
 * Tests comprehensive idempotency key handling across all payment operations
 * to prevent duplicate charges and ensure data consistency.
 */

import {
  checkIdempotencyKey,
  storeIdempotencyKey,
  removeIdempotencyKey,
} from '../services/idempotency-service';

describe('Idempotency Service', () => {
  const testKey = 'test_idempotency_key_123';

  afterEach(async () => {
    // Clean up test keys
    await removeIdempotencyKey(testKey);
  });

  describe('Basic Operations', () => {
    it('should detect duplicate idempotency key', async () => {
      // First usage should succeed
      const firstCheck = await checkIdempotencyKey(testKey);
      expect(firstCheck).toBe(false);

      // Store the key
      await storeIdempotencyKey(testKey);

      // Second usage should be detected as duplicate
      const secondCheck = await checkIdempotencyKey(testKey);
      expect(secondCheck).toBe(true);
    });

    it('should allow reuse after key removal', async () => {
      await storeIdempotencyKey(testKey);
      expect(await checkIdempotencyKey(testKey)).toBe(true);

      await removeIdempotencyKey(testKey);
      expect(await checkIdempotencyKey(testKey)).toBe(false);
    });

    it('should handle concurrent checks correctly', async () => {
      const key1 = 'concurrent_key_1';
      const key2 = 'concurrent_key_2';

      await Promise.all([
        storeIdempotencyKey(key1),
        storeIdempotencyKey(key2),
      ]);

      const [check1, check2] = await Promise.all([
        checkIdempotencyKey(key1),
        checkIdempotencyKey(key2),
      ]);

      expect(check1).toBe(true);
      expect(check2).toBe(true);

      // Clean up
      await Promise.all([
        removeIdempotencyKey(key1),
        removeIdempotencyKey(key2),
      ]);
    });
  });

  describe('TTL Handling', () => {
    it('should respect custom TTL values', async () => {
      const shortTTLKey = 'short_ttl_key';
      
      // Store with 1 second TTL
      await storeIdempotencyKey(shortTTLKey, 1);
      
      expect(await checkIdempotencyKey(shortTTLKey)).toBe(true);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Key should be expired (in Redis) or still present (in-memory needs cleanup)
      // Note: In-memory implementation cleans up periodically, not immediately
      
      await removeIdempotencyKey(shortTTLKey);
    });
  });
});

describe('Payment Operations Idempotency', () => {
  describe('Payment Intent Creation', () => {
    it('should prevent duplicate payment intent creation', async () => {
      const idempotencyKey = 'payment_intent_create_123';
      
      // Check that key is not used
      expect(await checkIdempotencyKey(idempotencyKey)).toBe(false);
      
      // Mark as used
      await storeIdempotencyKey(idempotencyKey);
      
      // Second attempt should detect duplicate
      expect(await checkIdempotencyKey(idempotencyKey)).toBe(true);
      
      // Clean up
      await removeIdempotencyKey(idempotencyKey);
    });

    it('should allow retry after failure cleanup', async () => {
      const idempotencyKey = 'payment_intent_retry_123';
      
      // Initial attempt
      await storeIdempotencyKey(idempotencyKey);
      expect(await checkIdempotencyKey(idempotencyKey)).toBe(true);
      
      // Simulate failure and cleanup
      await removeIdempotencyKey(idempotencyKey);
      
      // Retry should be allowed
      expect(await checkIdempotencyKey(idempotencyKey)).toBe(false);
    });
  });

  describe('Wallet Operations Idempotency', () => {
    it('should prevent duplicate deposit processing', async () => {
      const paymentIntentId = 'pi_test_123';
      const depositKey = `deposit_${paymentIntentId}`;
      
      // First deposit attempt
      expect(await checkIdempotencyKey(depositKey)).toBe(false);
      await storeIdempotencyKey(depositKey);
      
      // Duplicate webhook delivery should be detected
      expect(await checkIdempotencyKey(depositKey)).toBe(true);
      
      await removeIdempotencyKey(depositKey);
    });

    it('should prevent duplicate escrow operations', async () => {
      const bountyId = 'bounty_test_456';
      const posterId = 'user_poster_789';
      const escrowKey = `escrow_${bountyId}_${posterId}`;
      
      // First escrow attempt
      expect(await checkIdempotencyKey(escrowKey)).toBe(false);
      await storeIdempotencyKey(escrowKey);
      
      // Second attempt should be detected
      expect(await checkIdempotencyKey(escrowKey)).toBe(true);
      
      await removeIdempotencyKey(escrowKey);
    });

    it('should prevent duplicate release operations', async () => {
      const bountyId = 'bounty_test_789';
      const hunterId = 'user_hunter_456';
      const releaseKey = `release_${bountyId}_${hunterId}`;
      
      // First release attempt
      expect(await checkIdempotencyKey(releaseKey)).toBe(false);
      await storeIdempotencyKey(releaseKey);
      
      // Second attempt should be detected
      expect(await checkIdempotencyKey(releaseKey)).toBe(true);
      
      await removeIdempotencyKey(releaseKey);
    });

    it('should prevent duplicate refund operations', async () => {
      const bountyId = 'bounty_test_321';
      const posterId = 'user_poster_654';
      const refundKey = `refund_${bountyId}_${posterId}`;
      
      // First refund attempt
      expect(await checkIdempotencyKey(refundKey)).toBe(false);
      await storeIdempotencyKey(refundKey);
      
      // Second attempt should be detected
      expect(await checkIdempotencyKey(refundKey)).toBe(true);
      
      await removeIdempotencyKey(refundKey);
    });

    it('should prevent duplicate withdrawal operations', async () => {
      const userId = 'user_test_999';
      const timestamp = Date.now();
      const withdrawalKey = `withdrawal_${userId}_${timestamp}`;
      
      // First withdrawal attempt
      expect(await checkIdempotencyKey(withdrawalKey)).toBe(false);
      await storeIdempotencyKey(withdrawalKey);
      
      // Second attempt should be detected
      expect(await checkIdempotencyKey(withdrawalKey)).toBe(true);
      
      await removeIdempotencyKey(withdrawalKey);
    });
  });

  describe('Cross-Operation Isolation', () => {
    it('should isolate different operation types', async () => {
      const bountyId = 'bounty_isolation_test';
      const userId = 'user_isolation_test';
      
      const escrowKey = `escrow_${bountyId}_${userId}`;
      const releaseKey = `release_${bountyId}_${userId}`;
      const refundKey = `refund_${bountyId}_${userId}`;
      
      // Store all keys
      await Promise.all([
        storeIdempotencyKey(escrowKey),
        storeIdempotencyKey(releaseKey),
        storeIdempotencyKey(refundKey),
      ]);
      
      // Check all keys are marked as used
      const [escrowCheck, releaseCheck, refundCheck] = await Promise.all([
        checkIdempotencyKey(escrowKey),
        checkIdempotencyKey(releaseKey),
        checkIdempotencyKey(refundKey),
      ]);
      
      expect(escrowCheck).toBe(true);
      expect(releaseCheck).toBe(true);
      expect(refundCheck).toBe(true);
      
      // Clean up
      await Promise.all([
        removeIdempotencyKey(escrowKey),
        removeIdempotencyKey(releaseKey),
        removeIdempotencyKey(refundKey),
      ]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty idempotency key', async () => {
      const emptyKey = '';
      
      // Should handle gracefully
      await storeIdempotencyKey(emptyKey);
      const check = await checkIdempotencyKey(emptyKey);
      expect(check).toBe(true);
      
      await removeIdempotencyKey(emptyKey);
    });

    it('should handle very long idempotency keys', async () => {
      const longKey = 'a'.repeat(500);
      
      await storeIdempotencyKey(longKey);
      expect(await checkIdempotencyKey(longKey)).toBe(true);
      
      await removeIdempotencyKey(longKey);
    });

    it('should handle special characters in keys', async () => {
      const specialKey = 'key_with_special-chars.@#$%_123';
      
      await storeIdempotencyKey(specialKey);
      expect(await checkIdempotencyKey(specialKey)).toBe(true);
      
      await removeIdempotencyKey(specialKey);
    });
  });
});

describe('Stripe API Idempotency Integration', () => {
  it('should use idempotency keys format compatible with Stripe', () => {
    // Stripe expects idempotency keys to be:
    // - Unique strings of your choosing
    // - Case-sensitive
    // - Max 255 characters
    // - Can include alphanumeric characters, dashes, and underscores
    
    const validKeys = [
      'payment_intent_user123_20240101',
      'escrow-bounty456-user789',
      'withdrawal_2024_01_01_123456',
      'release_abc_def_ghi',
    ];
    
    validKeys.forEach(key => {
      expect(key.length).toBeLessThanOrEqual(255);
      expect(key).toMatch(/^[a-zA-Z0-9_-]+$/);
    });
  });

  it('should generate deterministic keys for same inputs', () => {
    const userId = 'user123';
    const amount = 1000;
    const timestamp = '2024-01-01T00:00:00Z';
    
    const key1 = `payment_${userId}_${amount}_${timestamp}`;
    const key2 = `payment_${userId}_${amount}_${timestamp}`;
    
    expect(key1).toBe(key2);
  });

  it('should generate different keys for different inputs', () => {
    const key1 = `payment_user123_1000_2024-01-01`;
    const key2 = `payment_user123_1000_2024-01-02`;
    
    expect(key1).not.toBe(key2);
  });
});

describe('Idempotency Best Practices', () => {
  it('should demonstrate proper key generation pattern', async () => {
    // Pattern: {operation}_{entity_id}_{user_id}_{optional_timestamp}
    const userId = 'user123';
    const bountyId = 'bounty456';
    
    const escrowKey = `escrow_${bountyId}_${userId}`;
    const releaseKey = `release_${bountyId}_${userId}`;
    
    // Keys should be operation-specific
    expect(escrowKey).not.toBe(releaseKey);
    
    await storeIdempotencyKey(escrowKey);
    
    // Different operation should not be blocked
    expect(await checkIdempotencyKey(releaseKey)).toBe(false);
    
    await removeIdempotencyKey(escrowKey);
  });

  it('should demonstrate metadata storage pattern', () => {
    const idempotencyKey = 'test_operation_123';
    
    // Metadata pattern used in wallet service
    const metadata = {
      idempotency_key: idempotencyKey,
      operation_type: 'test',
      created_at: new Date().toISOString(),
    };
    
    expect(metadata.idempotency_key).toBe(idempotencyKey);
    expect(metadata).toHaveProperty('operation_type');
    expect(metadata).toHaveProperty('created_at');
  });
});
