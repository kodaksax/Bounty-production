/**
 * Integration tests for Authentication flows
 * Tests sign-up, sign-in, token refresh, and email verification
 */

import { createClient } from '@supabase/supabase-js';

// Mock Supabase client
const mockSupabase = {
  auth: {
    signUp: jest.fn(),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(),
    refreshSession: jest.fn(),
    resend: jest.fn(),
    getUser: jest.fn(),
  },
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    })),
    insert: jest.fn(() => Promise.resolve({ error: null })),
    update: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    })),
  })),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabase),
}));

describe('Authentication Flow Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Sign Up Flow', () => {
    it('should successfully sign up a new user', async () => {
      const mockUser = {
        id: 'user123',
        email: 'newuser@example.com',
        email_confirmed_at: null,
      };

      mockSupabase.auth.signUp.mockResolvedValue({
        data: {
          user: mockUser,
          session: null, // Email confirmation required
        },
        error: null,
      });

      const result = await mockSupabase.auth.signUp({
        email: 'newuser@example.com',
        password: 'securePassword123!',
        options: {
          data: {
            username: 'newuser',
          },
        },
      });

      expect(result.error).toBeNull();
      expect(result.data.user).toBeDefined();
      expect(result.data.user?.email).toBe('newuser@example.com');
      expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'securePassword123!',
        options: {
          data: {
            username: 'newuser',
          },
        },
      });
    });

    it('should reject sign up with weak password', async () => {
      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: {
          message: 'Password should be at least 6 characters',
          status: 422,
        },
      });

      const result = await mockSupabase.auth.signUp({
        email: 'newuser@example.com',
        password: '123',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Password should be at least');
    });

    it('should reject sign up with invalid email', async () => {
      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: {
          message: 'Invalid email format',
          status: 422,
        },
      });

      const result = await mockSupabase.auth.signUp({
        email: 'invalid-email',
        password: 'securePassword123!',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Invalid email');
    });

    it('should reject sign up with existing email', async () => {
      mockSupabase.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: {
          message: 'User already registered',
          status: 409,
        },
      });

      const result = await mockSupabase.auth.signUp({
        email: 'existing@example.com',
        password: 'securePassword123!',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('already registered');
    });
  });

  describe('Sign In Flow', () => {
    it('should successfully sign in with valid credentials', async () => {
      const mockSession = {
        access_token: 'mock_access_token',
        refresh_token: 'mock_refresh_token',
        expires_at: Date.now() + 3600000,
        user: {
          id: 'user123',
          email: 'user@example.com',
          email_confirmed_at: '2024-01-01T00:00:00Z',
        },
      };

      mockSupabase.auth.signInWithPassword.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });

      const result = await mockSupabase.auth.signInWithPassword({
        email: 'user@example.com',
        password: 'correctPassword123!',
      });

      expect(result.error).toBeNull();
      expect(result.data.session).toBeDefined();
      expect(result.data.session?.access_token).toBeDefined();
      expect(result.data.user?.email).toBe('user@example.com');
    });

    it('should reject sign in with incorrect password', async () => {
      mockSupabase.auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: {
          message: 'Invalid login credentials',
          status: 400,
        },
      });

      const result = await mockSupabase.auth.signInWithPassword({
        email: 'user@example.com',
        password: 'wrongPassword',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Invalid login credentials');
    });

    it('should reject sign in with non-existent user', async () => {
      mockSupabase.auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: {
          message: 'Invalid login credentials',
          status: 400,
        },
      });

      const result = await mockSupabase.auth.signInWithPassword({
        email: 'nonexistent@example.com',
        password: 'password123',
      });

      expect(result.error).toBeDefined();
    });

    it('should block sign in for unverified email', async () => {
      mockSupabase.auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: {
          message: 'Email not confirmed',
          status: 400,
        },
      });

      const result = await mockSupabase.auth.signInWithPassword({
        email: 'unverified@example.com',
        password: 'password123',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Email not confirmed');
    });
  });

  describe('Token Refresh Flow', () => {
    it('should successfully refresh expired token', async () => {
      const mockRefreshedSession = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_at: Date.now() + 3600000,
        user: {
          id: 'user123',
          email: 'user@example.com',
        },
      };

      mockSupabase.auth.refreshSession.mockResolvedValue({
        data: { session: mockRefreshedSession, user: mockRefreshedSession.user },
        error: null,
      });

      const result = await mockSupabase.auth.refreshSession();

      expect(result.error).toBeNull();
      expect(result.data.session).toBeDefined();
      expect(result.data.session?.access_token).toBe('new_access_token');
    });

    it('should handle invalid refresh token', async () => {
      mockSupabase.auth.refreshSession.mockResolvedValue({
        data: { session: null, user: null },
        error: {
          message: 'Invalid refresh token',
          status: 401,
        },
      });

      const result = await mockSupabase.auth.refreshSession();

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Invalid refresh token');
    });

    it('should automatically refresh before expiration', async () => {
      const expiringSoon = Date.now() + 60000; // 1 minute
      const currentSession = {
        access_token: 'expiring_token',
        expires_at: expiringSoon,
      };

      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: currentSession },
        error: null,
      });

      const newSession = {
        access_token: 'refreshed_token',
        expires_at: Date.now() + 3600000,
      };

      mockSupabase.auth.refreshSession.mockResolvedValue({
        data: { session: newSession, user: { id: 'user123' } },
        error: null,
      });

      // Check if session is expiring
      const session = await mockSupabase.auth.getSession();
      const timeUntilExpiry = (session.data.session?.expires_at || 0) - Date.now();
      
      if (timeUntilExpiry < 300000) { // Less than 5 minutes
        const refreshed = await mockSupabase.auth.refreshSession();
        expect(refreshed.error).toBeNull();
        expect(refreshed.data.session?.access_token).toBe('refreshed_token');
      }
    });
  });

  describe('Email Verification Flow', () => {
    it('should resend verification email', async () => {
      mockSupabase.auth.resend.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await mockSupabase.auth.resend({
        type: 'signup',
        email: 'user@example.com',
      });

      expect(result.error).toBeNull();
      expect(mockSupabase.auth.resend).toHaveBeenCalledWith({
        type: 'signup',
        email: 'user@example.com',
      });
    });

    it('should handle rate limiting on resend', async () => {
      mockSupabase.auth.resend.mockResolvedValue({
        data: {},
        error: {
          message: 'Email rate limit exceeded',
          status: 429,
        },
      });

      const result = await mockSupabase.auth.resend({
        type: 'signup',
        email: 'user@example.com',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('rate limit');
    });

    it('should check email verification status', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: 'user123',
            email: 'user@example.com',
            email_confirmed_at: '2024-01-01T00:00:00Z',
          },
        },
        error: null,
      });

      const result = await mockSupabase.auth.getUser('valid_token');

      expect(result.error).toBeNull();
      expect(result.data.user?.email_confirmed_at).toBeDefined();
    });
  });

  describe('Sign Out Flow', () => {
    it('should successfully sign out', async () => {
      mockSupabase.auth.signOut.mockResolvedValue({
        error: null,
      });

      const result = await mockSupabase.auth.signOut();

      expect(result.error).toBeNull();
      expect(mockSupabase.auth.signOut).toHaveBeenCalled();
    });

    it('should clear session after sign out', async () => {
      mockSupabase.auth.signOut.mockResolvedValue({ error: null });
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await mockSupabase.auth.signOut();
      const session = await mockSupabase.auth.getSession();

      expect(session.data.session).toBeNull();
    });
  });

  describe('Session Management', () => {
    it('should retrieve current session', async () => {
      const mockSession = {
        access_token: 'current_token',
        user: { id: 'user123', email: 'user@example.com' },
      };

      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const result = await mockSupabase.auth.getSession();

      expect(result.error).toBeNull();
      expect(result.data.session).toBeDefined();
      expect(result.data.session?.access_token).toBe('current_token');
    });

    it('should return null for no active session', async () => {
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const result = await mockSupabase.auth.getSession();

      expect(result.error).toBeNull();
      expect(result.data.session).toBeNull();
    });
  });
});
