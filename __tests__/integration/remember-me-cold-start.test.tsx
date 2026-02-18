/**
 * Integration test for "Remember Me" functionality on cold app starts
 * Tests that users who check "Remember Me" are automatically signed in on app restart
 */

import * as SecureStore from 'expo-secure-store';
import { 
  createAuthSessionStorageAdapter, 
  setRememberMePreference,
  getRememberMePreference,
  clearRememberMePreference,
  clearAllSessionData
} from '../../lib/auth-session-storage';

// Mock SecureStore
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK: 1,
}));

describe('Remember Me - Cold Start Integration', () => {
  const SUPABASE_SESSION_KEY = 'supabase.auth.token';
  const REMEMBER_ME_KEY = 'auth_remember_me_preference';
  
  const mockSession = JSON.stringify({
    access_token: 'test_token',
    refresh_token: 'test_refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user123', email: 'test@example.com' }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Reset all in-memory caches to simulate cold start
    // clearAllSessionData clears both session and preference caches
    await clearAllSessionData();
  });

  describe('Scenario: User signs in with Remember Me checked', () => {
    it('should persist both preference and session to SecureStore', async () => {
      // 1. User checks "Remember Me" before signing in
      await setRememberMePreference(true);
      
      // Verify preference was saved
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        REMEMBER_ME_KEY,
        'true',
        expect.any(Object)
      );
      
      // 2. User signs in successfully, Supabase stores session
      const adapter = createAuthSessionStorageAdapter();
      await adapter.setItem(SUPABASE_SESSION_KEY, mockSession);
      
      // Verify session was saved to SecureStore (not just memory)
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        SUPABASE_SESSION_KEY,
        mockSession,
        expect.any(Object)
      );
    });
  });

  describe('Scenario: App cold starts after Remember Me sign-in', () => {
    it('should restore session from SecureStore when preference is true', async () => {
      // Simulate app cold start: in-memory cache is empty
      // SecureStore has both preference and session from previous run
      
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
        if (key === REMEMBER_ME_KEY) return 'true';
        if (key === SUPABASE_SESSION_KEY) return mockSession;
        return null;
      });
      
      // 1. Check remember me preference (simulates what happens on app start)
      const preference = await getRememberMePreference();
      expect(preference).toBe(true);
      
      // 2. Supabase tries to restore session
      const adapter = createAuthSessionStorageAdapter();
      const session = await adapter.getItem(SUPABASE_SESSION_KEY);
      
      // 3. Session should be restored from SecureStore
      expect(session).toBe(mockSession);
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith(SUPABASE_SESSION_KEY);
    });

    it('should NOT restore session when preference is false (unchecked Remember Me)', async () => {
      // User signed in without checking "Remember Me"
      
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
        if (key === REMEMBER_ME_KEY) return 'false';
        if (key === SUPABASE_SESSION_KEY) return mockSession; // Session exists but shouldn't be used
        return null;
      });
      
      // 1. Check remember me preference
      const preference = await getRememberMePreference();
      expect(preference).toBe(false);
      
      // 2. Supabase tries to restore session
      const adapter = createAuthSessionStorageAdapter();
      const session = await adapter.getItem(SUPABASE_SESSION_KEY);
      
      // 3. Session should NOT be restored (returns null, forcing re-login)
      expect(session).toBeNull();
      // SecureStore should not be accessed for session when preference is false
    });

    it('should handle missing preference gracefully (defaults to false)', async () => {
      // Edge case: preference was never set or was corrupted
      
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
        if (key === REMEMBER_ME_KEY) return null; // Missing preference
        if (key === SUPABASE_SESSION_KEY) return mockSession;
        return null;
      });
      
      // 1. Check remember me preference (should default to false)
      const preference = await getRememberMePreference();
      expect(preference).toBe(false);
      
      // 2. Supabase tries to restore session
      const adapter = createAuthSessionStorageAdapter();
      const session = await adapter.getItem(SUPABASE_SESSION_KEY);
      
      // 3. Session should NOT be restored (safe default)
      expect(session).toBeNull();
    });
  });

  describe('Scenario: Session expires but preference is still true', () => {
    it('should still attempt to restore session (Supabase will handle expiration)', async () => {
      // User signed in with "Remember Me", but session expired
      const expiredSession = JSON.stringify({
        access_token: 'expired_token',
        refresh_token: 'expired_refresh',
        expires_at: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        user: { id: 'user123', email: 'test@example.com' }
      });
      
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
        if (key === REMEMBER_ME_KEY) return 'true';
        if (key === SUPABASE_SESSION_KEY) return expiredSession;
        return null;
      });
      
      // 1. Preference is still true
      const preference = await getRememberMePreference();
      expect(preference).toBe(true);
      
      // 2. Restore session (even if expired)
      const adapter = createAuthSessionStorageAdapter();
      const session = await adapter.getItem(SUPABASE_SESSION_KEY);
      
      // 3. Adapter returns the expired session
      // Supabase will detect expiration and attempt token refresh
      expect(session).toBe(expiredSession);
    });
  });

  describe('Scenario: User logs out', () => {
    it('should clear both session and preference', async () => {
      // Setup: user was signed in with Remember Me
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('true');
      await setRememberMePreference(true);
      
      // User logs out
      await clearRememberMePreference();
      
      // Verify preference was cleared
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(REMEMBER_ME_KEY);
      
      // Session would also be cleared by Supabase's signOut
      const adapter = createAuthSessionStorageAdapter();
      await adapter.removeItem(SUPABASE_SESSION_KEY);
      
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SUPABASE_SESSION_KEY);
    });
  });

  describe('Race condition: Multiple concurrent reads on cold start', () => {
    it('should handle concurrent getItem calls gracefully', async () => {
      // Simulate app cold start with multiple concurrent Supabase initialization calls
      
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
        // Simulate async delay
        await new Promise(resolve => setTimeout(resolve, 10));
        
        if (key === REMEMBER_ME_KEY) return 'true';
        if (key === SUPABASE_SESSION_KEY) return mockSession;
        return null;
      });
      
      const adapter = createAuthSessionStorageAdapter();
      
      // Make 3 concurrent calls (simulating race condition)
      const [result1, result2, result3] = await Promise.all([
        adapter.getItem(SUPABASE_SESSION_KEY),
        adapter.getItem(SUPABASE_SESSION_KEY),
        adapter.getItem(SUPABASE_SESSION_KEY),
      ]);
      
      // All should return the same session
      expect(result1).toBe(mockSession);
      expect(result2).toBe(mockSession);
      expect(result3).toBe(mockSession);
    });
  });
});
