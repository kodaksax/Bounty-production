/**
 * Integration tests for Profile Loading and Creation
 * Tests that profiles are properly created during auth and loading states are cleared
 */

import { authProfileService, type AuthProfile } from '../../lib/services/auth-profile-service';

// Mock Supabase client - define inside the mock factory to avoid hoisting issues
jest.mock('../../lib/supabase', () => {
  const mockSupabase = {
    from: jest.fn(),
    auth: {
      getSession: jest.fn(),
    },
  };
  
  return {
    supabase: mockSupabase,
    isSupabaseConfigured: true,
    supabaseEnv: {
      url: 'https://test.supabase.co',
      anonKey: 'test-key',
    },
  };
});

// Mock logger
jest.mock('../../lib/utils/error-logger', () => ({
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Profile Loading and Creation', () => {
  let mockSupabase: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get reference to the mocked supabase
    const { supabase } = require('../../lib/supabase');
    mockSupabase = supabase;
    
    // Reset the singleton instance
    (authProfileService as any).currentProfile = null;
    (authProfileService as any).currentSession = null;
    (authProfileService as any).listeners = [];
  });

  describe('Profile Creation on Auth User Creation', () => {
    it('should return onboarding needed state when user has no profile', async () => {
      const userId = 'test-user-123';
      const mockSession = {
        user: {
          id: userId,
          email: 'test@example.com',
          email_confirmed_at: '2024-01-01T00:00:00Z',
          user_metadata: {
            age_verified: true,
          },
        },
      };

      // Mock profile query - returns no profile (PGRST116 error)
      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'No rows returned' },
      });

      mockSupabase.from.mockReturnValue({
        select: mockSelect,
      });

      mockSelect.mockReturnValue({
        eq: mockEq,
      });

      mockEq.mockReturnValue({
        single: mockSingle,
      });

      try {
        // Set session
        await authProfileService.setSession(mockSession as any);

        // Profile should indicate onboarding is needed
        const profile = authProfileService.getCurrentProfile();
        expect(profile).not.toBeNull();
        expect(profile?.id).toBe(userId);
        expect(profile?.onboarding_completed).toBe(false);
        expect(profile?.needs_onboarding).toBe(true);
        expect(profile?.username).toBe(''); // Empty until onboarding
      } catch (err) {
        // Test should not throw errors
        expect(err).toBeFalsy();
      }
    });

    it('should notify listeners even when profile fetch fails', async () => {
      const userId = 'test-user-456';
      const mockSession = {
        user: {
          id: userId,
          email: 'test2@example.com',
        },
      };

      // Mock profile query - throws error
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockRejectedValue(new Error('Network error')),
      });

      let listenerCalledWithNull = false;
      authProfileService.subscribe((profile) => {
        if (profile === null) {
          listenerCalledWithNull = true;
        }
      });

      try {
        // Set session - should handle error gracefully
        await authProfileService.setSession(mockSession as any);

        // Listener should be called with null to clear loading states
        expect(listenerCalledWithNull).toBe(true);
      } catch (err) {
        // Error should be handled gracefully
        expect(listenerCalledWithNull).toBe(true);
      }
    });
  });

  describe('Loading State Management', () => {
    it('should clear loading state when profile fetch fails', async () => {
      const userId = 'test-user-789';

      // Mock profile query - throws error
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockRejectedValue(new Error('Database error')),
      });

      let listenerCalls = 0;
      authProfileService.subscribe(() => {
        listenerCalls++;
      });

      try {
        // Attempt to fetch profile
        const profile = await authProfileService.fetchAndSyncProfile(userId);

        // Should return null
        expect(profile).toBeNull();
        // Listener should have been called to clear loading state
        expect(listenerCalls).toBeGreaterThan(0);
      } catch (err) {
        // Even if error is thrown, listener should be called
        expect(listenerCalls).toBeGreaterThan(0);
      }
    });

    it('should notify listeners when no data is returned from query', async () => {
      const userId = 'test-user-999';
      const mockSession = {
        user: {
          id: userId,
          email: 'test3@example.com',
        },
      };

      // Mock profile query - returns no data and no error (onboarding needed state)
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
        insert: jest.fn().mockReturnThis(),
      });

      let listenerCalled = false;
      authProfileService.subscribe(() => {
        listenerCalled = true;
      });

      try {
        // Set session
        await authProfileService.setSession(mockSession as any);

        // Listener should be called (with onboarding_needed profile)
        expect(listenerCalled).toBe(true);
        
        // Should have an onboarding needed state
        const profile = authProfileService.getCurrentProfile();
        expect(profile?.needs_onboarding).toBe(true);
      } catch (err) {
        // Test should not throw errors
        expect(err).toBeFalsy();
      }
    });
  });

  describe('Race Condition Handling', () => {
    it('should handle concurrent profile access attempts', async () => {
      const userId = 'test-user-concurrent';
      const mockSession = {
        user: {
          id: userId,
          email: 'concurrent@example.com',
        },
      };

      const existingProfile = {
        id: userId,
        username: 'concurrent_user',
        email: 'concurrent@example.com',
        balance: 0,
        age_verified: false,
        onboarding_completed: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Mock to return existing profile
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: existingProfile,
              error: null,
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      try {
        // Set session
        await authProfileService.setSession(mockSession as any);

        // Should have the existing profile
        const profile = authProfileService.getCurrentProfile();
        expect(profile).not.toBeNull();
        expect(profile?.username).toBe('concurrent_user');
      } catch (err) {
        // Test should not throw errors
        expect(err).toBeFalsy();
      }
    });
  });

  describe('Onboarding Completion Tracking', () => {
    it('should return onboarding_needed state for users without profiles', async () => {
      const userId = 'test-user-onboarding';
      const mockSession = {
        user: {
          id: userId,
          email: 'onboarding@example.com',
        },
      };

      // Mock to return PGRST116 (no profile found)
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116', message: 'No rows returned' },
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      try {
        // Set session
        await authProfileService.setSession(mockSession as any);

        // Profile should have onboarding_completed = false and needs_onboarding = true
        const profile = authProfileService.getCurrentProfile();
        expect(profile?.onboarding_completed).toBe(false);
        expect(profile?.needs_onboarding).toBe(true);
      } catch (err) {
        // Test should not throw errors
        expect(err).toBeFalsy();
      }
    });
  });
});
