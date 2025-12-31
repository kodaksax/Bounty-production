/**
 * Unit tests for Auth Session Storage - Race Condition Fix
 * 
 * Tests the in-memory cache for remember me preference to ensure
 * race conditions are avoided when reading from SecureStore immediately
 * after writing.
 */

import * as SecureStore from 'expo-secure-store';
import {
  getRememberMePreference,
  setRememberMePreference,
  clearRememberMePreference,
  clearAllSessionData,
} from '../../../lib/auth-session-storage';

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
}));

describe('Auth Session Storage - Remember Me Preference', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Reset mock implementations
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  describe('setRememberMePreference', () => {
    it('should cache preference in memory immediately before SecureStore write', async () => {
      await setRememberMePreference(true);
      
      // Verify SecureStore was called
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'auth_remember_me_preference',
        'true',
        expect.any(Object)
      );
      
      // Immediately read preference (before SecureStore write completes)
      // This should return from memory cache, not SecureStore
      const preference = await getRememberMePreference();
      
      // Should get cached value without calling SecureStore.getItemAsync
      // because it was cached in memory
      expect(preference).toBe(true);
    });

    it('should cache false preference correctly', async () => {
      await setRememberMePreference(false);
      
      // Verify SecureStore was called with 'false'
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'auth_remember_me_preference',
        'false',
        expect.any(Object)
      );
      
      // Read immediately from cache
      const preference = await getRememberMePreference();
      expect(preference).toBe(false);
    });

    it('should handle SecureStore write failure gracefully', async () => {
      // Mock SecureStore to fail
      (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('SecureStore write failed'));
      
      // Should not throw - error is caught and logged
      await expect(setRememberMePreference(true)).resolves.not.toThrow();
      
      // Cache should still be updated even if SecureStore fails
      const preference = await getRememberMePreference();
      expect(preference).toBe(true);
    });
  });

  describe('getRememberMePreference', () => {
    it('should return cached value without calling SecureStore after initial set', async () => {
      // Set preference (populates cache)
      await setRememberMePreference(true);
      
      // Clear mock call count
      jest.clearAllMocks();
      
      // Get preference multiple times
      const result1 = await getRememberMePreference();
      const result2 = await getRememberMePreference();
      const result3 = await getRememberMePreference();
      
      // Should all return true
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
      
      // SecureStore.getItemAsync should NOT be called (using cache)
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    });

    it('should read from SecureStore on cache miss and populate cache', async () => {
      // Mock SecureStore to return 'true'
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('true');
      
      // First call - cache miss, reads from SecureStore
      const result1 = await getRememberMePreference();
      expect(result1).toBe(true);
      expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);
      
      // Clear mock call count
      jest.clearAllMocks();
      
      // Second call - cache hit, no SecureStore call
      const result2 = await getRememberMePreference();
      expect(result2).toBe(true);
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    });

    it('should return false by default if no preference is set', async () => {
      // Mock SecureStore to return null (no preference set)
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      
      const preference = await getRememberMePreference();
      expect(preference).toBe(false);
    });

    it('should handle SecureStore read failure gracefully', async () => {
      // Mock SecureStore to fail
      (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('SecureStore read failed'));
      
      // Should not throw and should return false
      const preference = await getRememberMePreference();
      expect(preference).toBe(false);
    });
  });

  describe('clearRememberMePreference', () => {
    it('should clear both memory cache and SecureStore', async () => {
      // Set preference first
      await setRememberMePreference(true);
      
      // Verify it's cached
      let preference = await getRememberMePreference();
      expect(preference).toBe(true);
      
      // Clear preference
      await clearRememberMePreference();
      
      // Verify SecureStore.deleteItemAsync was called
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_remember_me_preference');
      
      // Mock SecureStore to return null (as if cleared)
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      
      // Verify cache was cleared - should read from SecureStore now
      preference = await getRememberMePreference();
      expect(preference).toBe(false);
    });

    it('should handle SecureStore delete failure gracefully', async () => {
      // Mock SecureStore to fail
      (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error('SecureStore delete failed'));
      
      // Should not throw
      await expect(clearRememberMePreference()).resolves.not.toThrow();
    });
  });

  describe('clearAllSessionData', () => {
    it('should clear remember me preference cache', async () => {
      // Set preference
      await setRememberMePreference(true);
      
      // Verify it's cached
      let preference = await getRememberMePreference();
      expect(preference).toBe(true);
      
      // Clear all session data
      await clearAllSessionData();
      
      // Mock SecureStore to return null
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      
      // Cache should be cleared, reads from SecureStore
      preference = await getRememberMePreference();
      expect(preference).toBe(false);
      expect(SecureStore.getItemAsync).toHaveBeenCalled();
    });
  });

  describe('Race Condition Scenarios', () => {
    it('should handle rapid set followed by get without race condition', async () => {
      // Simulate the sign-in flow where preference is set then immediately read
      await setRememberMePreference(false);
      
      // Immediately read (simulates Supabase storage adapter reading preference)
      // This happens before SecureStore.setItemAsync has a chance to complete
      const preference = await getRememberMePreference();
      
      // Should get the correct value from cache, not from SecureStore
      expect(preference).toBe(false);
      
      // SecureStore.getItemAsync should NOT be called because cache was hit
      // (We only expect setItemAsync from the set call, not getItemAsync)
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    });

    it('should handle multiple rapid sets correctly', async () => {
      // Rapidly change preference
      await setRememberMePreference(true);
      await setRememberMePreference(false);
      await setRememberMePreference(true);
      
      // Final value should be correct
      const preference = await getRememberMePreference();
      expect(preference).toBe(true);
    });

    it('should handle concurrent set and get operations', async () => {
      // Start set operation
      const setPromise = setRememberMePreference(true);
      
      // Immediately try to get (before set completes)
      const getPromise = getRememberMePreference();
      
      // Wait for both to complete
      await Promise.all([setPromise, getPromise]);
      
      // Get should have returned the correct value from cache
      const preference = await getRememberMePreference();
      expect(preference).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null cache correctly', async () => {
      // Don't set any preference
      // Mock SecureStore to return null
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      
      const preference = await getRememberMePreference();
      expect(preference).toBe(false);
    });

    it('should handle switching between true and false', async () => {
      await setRememberMePreference(true);
      let preference = await getRememberMePreference();
      expect(preference).toBe(true);
      
      await setRememberMePreference(false);
      preference = await getRememberMePreference();
      expect(preference).toBe(false);
      
      await setRememberMePreference(true);
      preference = await getRememberMePreference();
      expect(preference).toBe(true);
    });

    it('should persist cache across multiple get calls', async () => {
      await setRememberMePreference(true);
      
      // Call get multiple times
      for (let i = 0; i < 10; i++) {
        const preference = await getRememberMePreference();
        expect(preference).toBe(true);
      }
      
      // SecureStore.setItemAsync should only be called once (from set)
      expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    });
  });
});
