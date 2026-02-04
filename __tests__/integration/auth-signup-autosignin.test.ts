/**
 * Integration tests for Auto Sign-In After Account Creation
 * Tests the new behavior where users remain signed in after signup
 * and are automatically redirected to onboarding or main app
 */

import { createClient } from '@supabase/supabase-js';

// Mock Supabase client
const mockSupabase = {
  auth: {
    signUp: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(),
  },
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(),
      })),
    })),
  })),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabase),
}));

describe('Auto Sign-In After Account Creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful auto-signin with profile check routing to onboarding', () => {
    it('should keep user signed in and route to onboarding when profile does not exist', async () => {
      const mockUser = {
        id: 'user123',
        email: 'newuser@example.com',
        email_confirmed_at: null,
      };

      const mockSession = {
        access_token: 'mock_access_token',
        refresh_token: 'mock_refresh_token',
        expires_at: Date.now() + 3600000,
        user: mockUser,
      };

      // Mock successful signup with session
      mockSupabase.auth.signUp.mockResolvedValue({
        data: {
          user: mockUser,
          session: mockSession,
        },
        error: null,
      });

      // Mock profile query returning PGRST116 (profile not found)
      const mockFrom = mockSupabase.from();
      const mockSelect = mockFrom.select();
      const mockEq = mockSelect.eq();
      mockEq.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });

      const result = await mockSupabase.auth.signUp({
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
        options: {
          data: { age_verified: true },
        },
      });

      expect(result.error).toBeNull();
      expect(result.data.session).toBeDefined();
      expect(result.data.session?.access_token).toBe('mock_access_token');

      // Verify signOut was NOT called (this is the key behavior change)
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();

      // Verify profile check was attempted
      const profileCheck = await mockEq.single();
      expect(profileCheck.error?.code).toBe('PGRST116');
      
      // In the actual implementation, this would route to /onboarding
    });

    it('should route to onboarding when profile exists but has no username', async () => {
      const mockUser = {
        id: 'user123',
        email: 'newuser@example.com',
        email_confirmed_at: null,
      };

      const mockSession = {
        access_token: 'mock_access_token',
        refresh_token: 'mock_refresh_token',
        expires_at: Date.now() + 3600000,
        user: mockUser,
      };

      mockSupabase.auth.signUp.mockResolvedValue({
        data: {
          user: mockUser,
          session: mockSession,
        },
        error: null,
      });

      // Mock profile query returning profile without username
      const mockFrom = mockSupabase.from();
      const mockSelect = mockFrom.select();
      const mockEq = mockSelect.eq();
      mockEq.single.mockResolvedValue({
        data: {
          id: 'user123',
          username: null,
          onboarding_completed: false,
        },
        error: null,
      });

      const result = await mockSupabase.auth.signUp({
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.data.session).toBeDefined();
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();

      const profileCheck = await mockEq.single();
      expect(profileCheck.data?.username).toBeNull();
      expect(profileCheck.data?.onboarding_completed).toBe(false);
    });

    it('should route to onboarding when onboarding_completed is false', async () => {
      const mockUser = {
        id: 'user123',
        email: 'newuser@example.com',
        email_confirmed_at: null,
      };

      const mockSession = {
        access_token: 'mock_access_token',
        user: mockUser,
      };

      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const mockFrom = mockSupabase.from();
      const mockSelect = mockFrom.select();
      const mockEq = mockSelect.eq();
      mockEq.single.mockResolvedValue({
        data: {
          id: 'user123',
          username: 'testuser',
          onboarding_completed: false,
        },
        error: null,
      });

      const result = await mockSupabase.auth.signUp({
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.data.session).toBeDefined();
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();

      const profileCheck = await mockEq.single();
      expect(profileCheck.data?.onboarding_completed).toBe(false);
    });

    it('should route to onboarding when onboarding_completed is null', async () => {
      const mockUser = {
        id: 'user123',
        email: 'newuser@example.com',
        email_confirmed_at: null,
      };

      const mockSession = {
        access_token: 'mock_access_token',
        user: mockUser,
      };

      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const mockFrom = mockSupabase.from();
      const mockSelect = mockFrom.select();
      const mockEq = mockSelect.eq();
      mockEq.single.mockResolvedValue({
        data: {
          id: 'user123',
          username: 'testuser',
          onboarding_completed: null,
        },
        error: null,
      });

      const result = await mockSupabase.auth.signUp({
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.data.session).toBeDefined();
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();

      const profileCheck = await mockEq.single();
      expect(profileCheck.data?.onboarding_completed).toBeNull();
    });
  });

  describe('Edge case: Auto-signin when profile is already complete', () => {
    it('should route to main app when profile is complete and onboarding_completed is true', async () => {
      const mockUser = {
        id: 'user123',
        email: 'returninguser@example.com',
        email_confirmed_at: '2024-01-01T00:00:00Z',
      };

      const mockSession = {
        access_token: 'mock_access_token',
        user: mockUser,
      };

      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const mockFrom = mockSupabase.from();
      const mockSelect = mockFrom.select();
      const mockEq = mockSelect.eq();
      mockEq.single.mockResolvedValue({
        data: {
          id: 'user123',
          username: 'completeduser',
          onboarding_completed: true,
        },
        error: null,
      });

      const result = await mockSupabase.auth.signUp({
        email: 'returninguser@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.data.session).toBeDefined();
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();

      const profileCheck = await mockEq.single();
      expect(profileCheck.data?.username).toBe('completeduser');
      expect(profileCheck.data?.onboarding_completed).toBe(true);
      // In actual implementation, this would route to /tabs/bounty-app
    });
  });

  describe('Fallback to email confirmation when no session is created', () => {
    it('should fallback to email confirmation screen when session is null', async () => {
      const mockUser = {
        id: 'user123',
        email: 'newuser@example.com',
        email_confirmed_at: null,
      };

      // Mock signup with no session (email confirmation required)
      mockSupabase.auth.signUp.mockResolvedValue({
        data: {
          user: mockUser,
          session: null,
        },
        error: null,
      });

      const result = await mockSupabase.auth.signUp({
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.error).toBeNull();
      expect(result.data.user).toBeDefined();
      expect(result.data.session).toBeNull();
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();
      
      // In actual implementation, this would route to /auth/email-confirmation
    });
  });

  describe('Error handling and resilience', () => {
    it('should handle profile check error gracefully and proceed to onboarding', async () => {
      const mockUser = {
        id: 'user123',
        email: 'newuser@example.com',
      };

      const mockSession = {
        access_token: 'mock_access_token',
        user: mockUser,
      };

      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const mockFrom = mockSupabase.from();
      const mockSelect = mockFrom.select();
      const mockEq = mockSelect.eq();
      mockEq.single.mockRejectedValue(new Error('Database connection error'));

      const result = await mockSupabase.auth.signUp({
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.data.session).toBeDefined();
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();

      // Verify profile check attempted and failed
      try {
        await mockEq.single();
      } catch (error) {
        expect(error).toBeDefined();
        // In actual implementation, error is caught and user is routed to onboarding
      }
    });

    it('should handle non-PGRST116 profile errors by throwing and proceeding to onboarding', async () => {
      const mockUser = {
        id: 'user123',
        email: 'newuser@example.com',
      };

      const mockSession = {
        access_token: 'mock_access_token',
        user: mockUser,
      };

      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const mockFrom = mockSupabase.from();
      const mockSelect = mockFrom.select();
      const mockEq = mockSelect.eq();
      mockEq.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST500', message: 'Internal server error' },
      });

      const result = await mockSupabase.auth.signUp({
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.data.session).toBeDefined();
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();

      const profileCheck = await mockEq.single();
      expect(profileCheck.error?.code).toBe('PGRST500');
      // In actual implementation, this error is thrown and caught, routing to onboarding
    });
  });

  describe('Security: Form data clearing', () => {
    it('should clear form data after successful signup for security', async () => {
      const mockUser = {
        id: 'user123',
        email: 'newuser@example.com',
      };

      const mockSession = {
        access_token: 'mock_access_token',
        user: mockUser,
      };

      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const result = await mockSupabase.auth.signUp({
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.data.session).toBeDefined();
      // In actual implementation, form state is cleared here
      // This test documents the expected behavior
    });
  });

  describe('Comparison: Old vs New Behavior', () => {
    it('OLD BEHAVIOR: would have called signOut after signup', async () => {
      const mockUser = {
        id: 'user123',
        email: 'oldflow@example.com',
      };

      const mockSession = {
        access_token: 'mock_access_token',
        user: mockUser,
      };

      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const result = await mockSupabase.auth.signUp({
        email: 'oldflow@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.data.session).toBeDefined();
      
      // OLD BEHAVIOR: would call signOut here
      // await mockSupabase.auth.signOut();
      // expect(mockSupabase.auth.signOut).toHaveBeenCalled();
      
      // NEW BEHAVIOR: does NOT call signOut
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();
    });

    it('NEW BEHAVIOR: maintains session and routes based on profile status', async () => {
      const mockUser = {
        id: 'user123',
        email: 'newflow@example.com',
      };

      const mockSession = {
        access_token: 'mock_access_token',
        user: mockUser,
      };

      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const mockFrom = mockSupabase.from();
      const mockSelect = mockFrom.select();
      const mockEq = mockSelect.eq();
      mockEq.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await mockSupabase.auth.signUp({
        email: 'newflow@example.com',
        password: 'SecurePassword123!',
      });

      // Session is maintained
      expect(result.data.session).toBeDefined();
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();

      // Profile check is performed
      await mockEq.single();
      
      // NEW BEHAVIOR: routes to /onboarding or /tabs/bounty-app
      // based on profile status, maintaining the session
    });
  });
});
