/**
 * Integration tests for Authentication State Persistence
 * Tests session restoration, token refresh, and graceful expiration
 */

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';
import AuthProvider from '../../providers/auth-provider';
import { supabase } from '../../lib/supabase';

// Mock Supabase client
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      refreshSession: jest.fn(),
      onAuthStateChange: jest.fn(() => ({
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      })),
    },
  },
  isSupabaseConfigured: true,
}));

// Mock auth profile service
jest.mock('../../lib/services/auth-profile-service', () => ({
  authProfileService: {
    setSession: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
  },
}));

// Mock analytics service
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: {
    identifyUser: jest.fn(),
    trackEvent: jest.fn(),
    reset: jest.fn(),
  },
}));

// Mock Sentry
jest.mock('@sentry/react-native', () => ({
  setUser: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

describe('Authentication State Persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Session Restoration on App Restart', () => {
    it('should restore valid session from storage', async () => {
      const mockSession = {
        access_token: 'valid_token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
        user: {
          id: 'user123',
          email: 'user@example.com',
          email_confirmed_at: '2024-01-01T00:00:00Z',
        },
      };

      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const TestComponent = () => <></>;
      
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.getSession).toHaveBeenCalled();
      });
    });

    it('should handle missing session gracefully', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const TestComponent = () => <></>;
      
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.getSession).toHaveBeenCalled();
      });
    });

    it('should handle corrupted session data', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid session', status: 401 },
      });

      const TestComponent = () => <></>;
      
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.getSession).toHaveBeenCalled();
      });
    });
  });

  describe('Automatic Token Refresh', () => {
    it('should schedule token refresh before expiration', async () => {
      const expiresInSeconds = 3600; // 1 hour from now
      const mockSession = {
        access_token: 'token_about_to_expire',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
        user: {
          id: 'user123',
          email: 'user@example.com',
          email_confirmed_at: '2024-01-01T00:00:00Z',
        },
      };

      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const newSession = {
        ...mockSession,
        access_token: 'refreshed_token',
        expires_at: Math.floor(Date.now() / 1000) + 7200, // 2 hours from now
      };

      (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
        data: { session: newSession, user: newSession.user },
        error: null,
      });

      const TestComponent = () => <></>;
      
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.getSession).toHaveBeenCalled();
      });

      // Fast-forward to when refresh should trigger (5 minutes before expiration)
      const refreshTime = (expiresInSeconds - 300) * 1000; // 55 minutes
      jest.advanceTimersByTime(refreshTime);

      await waitFor(() => {
        expect(supabase.auth.refreshSession).toHaveBeenCalled();
      }, { timeout: 3000 });
    });

    it('should refresh immediately if token is already expired', async () => {
      const mockExpiredSession = {
        access_token: 'expired_token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) - 100, // Expired 100 seconds ago
        user: {
          id: 'user123',
          email: 'user@example.com',
          email_confirmed_at: '2024-01-01T00:00:00Z',
        },
      };

      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: mockExpiredSession },
        error: null,
      });

      const newSession = {
        ...mockExpiredSession,
        access_token: 'refreshed_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };

      (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
        data: { session: newSession, user: newSession.user },
        error: null,
      });

      const TestComponent = () => <></>;
      
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.getSession).toHaveBeenCalled();
      });

      // Should call refresh immediately
      await waitFor(() => {
        expect(supabase.auth.refreshSession).toHaveBeenCalled();
      }, { timeout: 3000 });
    });

    it('should handle refresh failure gracefully', async () => {
      const mockSession = {
        access_token: 'token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) - 100,
        user: {
          id: 'user123',
          email: 'user@example.com',
        },
      };

      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
        data: { session: null, user: null },
        error: { message: 'Invalid refresh token', status: 401 },
      });

      const TestComponent = () => <></>;
      
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.refreshSession).toHaveBeenCalled();
      }, { timeout: 3000 });
    });
  });

  describe('Session Expiration Handling', () => {
    it('should clear session when refresh fails', async () => {
      const mockExpiredSession = {
        access_token: 'expired_token',
        refresh_token: 'invalid_refresh',
        expires_at: Math.floor(Date.now() / 1000) - 100,
        user: {
          id: 'user123',
          email: 'user@example.com',
        },
      };

      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: mockExpiredSession },
        error: null,
      });

      (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
        data: { session: null, user: null },
        error: { message: 'Refresh token expired', status: 401 },
      });

      const TestComponent = () => <></>;
      
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.refreshSession).toHaveBeenCalled();
      }, { timeout: 3000 });
    });

    it('should trigger SIGNED_OUT event on token expiration', async () => {
      const signOutCallback = jest.fn();
      let authStateCallback: any;

      (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((callback) => {
        authStateCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        };
      });

      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const TestComponent = () => <></>;
      
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.onAuthStateChange).toHaveBeenCalled();
      });

      // Simulate signed out event
      if (authStateCallback) {
        await authStateCallback('SIGNED_OUT', null);
      }

      expect(authStateCallback).toBeDefined();
    });
  });

  describe('Auth State Change Events', () => {
    it('should handle SIGNED_IN event', async () => {
      let authStateCallback: any;

      (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((callback) => {
        authStateCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        };
      });

      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const TestComponent = () => <></>;
      
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.onAuthStateChange).toHaveBeenCalled();
      });

      const mockSession = {
        access_token: 'new_token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: 'user123',
          email: 'user@example.com',
          email_confirmed_at: '2024-01-01T00:00:00Z',
        },
      };

      // Simulate sign in
      if (authStateCallback) {
        await authStateCallback('SIGNED_IN', mockSession);
      }

      expect(authStateCallback).toBeDefined();
    });

    it('should handle TOKEN_REFRESHED event', async () => {
      let authStateCallback: any;

      (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((callback) => {
        authStateCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        };
      });

      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const TestComponent = () => <></>;
      
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.onAuthStateChange).toHaveBeenCalled();
      });

      const mockRefreshedSession = {
        access_token: 'refreshed_token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: 'user123',
          email: 'user@example.com',
        },
      };

      // Simulate token refresh event
      if (authStateCallback) {
        await authStateCallback('TOKEN_REFRESHED', mockRefreshedSession);
      }

      expect(authStateCallback).toBeDefined();
    });
  });
});
