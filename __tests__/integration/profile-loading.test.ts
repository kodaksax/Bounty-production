/**
 * Integration tests for Profile Loading and Creation
 * Tests that profiles are properly created during auth and loading states are cleared
 */

import { authProfileService, type AuthProfile } from '../../lib/services/auth-profile-service';
import { supabase } from '../../lib/supabase';

// Mock Supabase client
const mockSupabase = {
  from: jest.fn(),
  auth: {
    getSession: jest.fn(),
  },
};

jest.mock('../../lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  supabaseEnv: {
    url: 'https://test.supabase.co',
    anonKey: 'test-key',
  },
}));

// Mock logger
jest.mock('../../lib/utils/error-logger', () => ({
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Profile Loading and Creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton instance
    (authProfileService as any).currentProfile = null;
    (authProfileService as any).currentSession = null;
    (authProfileService as any).listeners = [];
  });

  describe('Profile Creation on Auth User Creation', () => {
    it('should create a minimal profile when user has no profile', async () => {
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

      // Mock profile insert - returns new profile
      const mockInsert = jest.fn().mockReturnThis();
      const mockInsertSelect = jest.fn().mockReturnThis();
      const mockInsertSingle = jest.fn().mockResolvedValue({
        data: {
          id: userId,
          username: 'test',
          email: 'test@example.com',
          balance: 0,
          age_verified: true,
          age_verified_at: new Date().toISOString(),
          onboarding_completed: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      });

      // Setup chain for insert
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          let isInsert = false;
          return {
            select: mockSelect,
            insert: (...args: any[]) => {
              isInsert = true;
              mockInsert(...args);
              return {
                select: mockInsertSelect,
              };
            },
            eq: mockEq,
            single: isInsert ? mockInsertSingle : mockSingle,
          };
        }
        return { select: mockSelect };
      });

      // Set session first
      await authProfileService.setSession(mockSession as any);

      // Profile should be created
      const profile = authProfileService.getCurrentProfile();
      expect(profile).not.toBeNull();
      expect(profile?.id).toBe(userId);
      expect(profile?.onboarding_completed).toBe(false);
      expect(profile?.age_verified).toBe(true);
    });

    it('should notify listeners even when profile creation fails', async () => {
      const userId = 'test-user-456';
      const mockSession = {
        user: {
          id: userId,
          email: 'test2@example.com',
        },
      };

      // Mock profile query - returns error
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

      // Set session - should handle error gracefully
      await authProfileService.setSession(mockSession as any);

      // Listener should be called with null to clear loading states
      expect(listenerCalledWithNull).toBe(true);
    });
  });

  describe('Loading State Management', () => {
    it('should clear loading state when profile fetch fails', async () => {
      const userId = 'test-user-789';

      // Mock profile query - returns error
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockRejectedValue(new Error('Database error')),
      });

      let listenerCalls = 0;
      authProfileService.subscribe(() => {
        listenerCalls++;
      });

      // Attempt to fetch profile
      const profile = await authProfileService.fetchAndSyncProfile(userId);

      // Should return null
      expect(profile).toBeNull();
      // Listener should have been called to clear loading state
      expect(listenerCalls).toBeGreaterThan(0);
    });

    it('should notify listeners when no data is returned from query', async () => {
      const userId = 'test-user-999';
      const mockSession = {
        user: {
          id: userId,
          email: 'test3@example.com',
        },
      };

      // Mock profile query - returns no data and no error
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

      // Set session
      await authProfileService.setSession(mockSession as any);

      // Listener should be called (with null or with created profile)
      expect(listenerCalled).toBe(true);
    });
  });

  describe('Race Condition Handling', () => {
    it('should handle concurrent profile creation attempts', async () => {
      const userId = 'test-user-concurrent';
      const mockSession = {
        user: {
          id: userId,
          email: 'concurrent@example.com',
        },
      };

      let insertCallCount = 0;
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

      // First query returns no profile
      // Insert fails with duplicate key error
      // Second query returns existing profile
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockImplementation(() => {
              if (insertCallCount === 0) {
                return Promise.resolve({
                  data: null,
                  error: { code: 'PGRST116' },
                });
              }
              return Promise.resolve({
                data: existingProfile,
                error: null,
              });
            }),
            maybeSingle: jest.fn().mockResolvedValue({
              data: existingProfile,
              error: null,
            }),
            insert: jest.fn().mockImplementation(() => {
              insertCallCount++;
              return {
                select: jest.fn().mockReturnThis(),
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: { code: '23505', message: 'duplicate key' },
                }),
              };
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      // Set session
      await authProfileService.setSession(mockSession as any);

      // Should have the existing profile
      const profile = authProfileService.getCurrentProfile();
      expect(profile).not.toBeNull();
      expect(profile?.username).toBe('concurrent_user');
    });
  });

  describe('Onboarding Completion Tracking', () => {
    it('should create profiles with onboarding_completed = false for new users', async () => {
      const userId = 'test-user-onboarding';
      const mockSession = {
        user: {
          id: userId,
          email: 'onboarding@example.com',
        },
      };

      const createdProfile = {
        id: userId,
        username: 'onboarding',
        email: 'onboarding@example.com',
        balance: 0,
        age_verified: false,
        onboarding_completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          let insertData: any = null;
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
            insert: jest.fn().mockImplementation((data: any) => {
              insertData = data;
              return {
                select: jest.fn().mockReturnThis(),
                single: jest.fn().mockResolvedValue({
                  data: { ...createdProfile, ...insertData },
                  error: null,
                }),
              };
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      // Set session
      await authProfileService.setSession(mockSession as any);

      // Profile should have onboarding_completed = false
      const profile = authProfileService.getCurrentProfile();
      expect(profile?.onboarding_completed).toBe(false);
    });
  });
});
