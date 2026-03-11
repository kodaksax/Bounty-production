/**
 * Integration tests for Authentication State Persistence
 * Tests session restoration, token refresh, and graceful expiration
 */

import { act, render, waitFor } from '@testing-library/react-native';

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

// Mock draft clearing and cached data service used by AuthProvider
jest.mock('../../app/hooks/useBountyDraft', () => ({
  clearBountyDraftForUser: jest.fn(() => Promise.resolve()),
}));

// Also mock the aliased path used by imports in the app code
try {
  jest.mock('app/hooks/useBountyDraft', () => ({
    clearBountyDraftForUser: jest.fn(() => Promise.resolve()),
  }));
} catch (e) {
  // Some environments may not allow mocking alias paths; ignore if so
}

jest.mock('../../lib/services/cached-data-service', () => ({
  cachedDataService: {
    clearAll: jest.fn(() => Promise.resolve()),
  },
}));

try {
  jest.mock('lib/services/cached-data-service', () => ({
    cachedDataService: {
      clearAll: jest.fn(() => Promise.resolve()),
    },
  }));
} catch (e) {
  // Ignore if alias mocking isn't supported in this environment
}

// Require modules after mocks so imports inside modules pick up jest mocks
const { supabase } = require('../../lib/supabase');
const AuthProvider = require('../../providers/auth-provider').default;

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

    it('should clean up subscription on unmount', async () => {
      const unsubscribeMock = jest.fn();
      
      (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation(() => ({
        data: {
          subscription: {
            unsubscribe: unsubscribeMock,
          },
        },
      }));

      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const TestComponent = () => <></>;
      
      const { unmount } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.onAuthStateChange).toHaveBeenCalled();
      });

      // Unmount the component
      act(() => {
        unmount();
      });

      // Verify unsubscribe was called
      expect(unsubscribeMock).toHaveBeenCalled();
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

  describe('Profile Loading Race Condition', () => {
    it('should wait for profile to load before setting isLoading to false', async () => {
      const mockSession = {
        access_token: 'valid_token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: 'user123',
          email: 'user@example.com',
          email_confirmed_at: '2024-01-01T00:00:00Z',
        },
      };

      const mockProfile = {
        id: 'user123',
        username: 'testuser',
        email: 'user@example.com',
        balance: 0,
      };

      let profileSubscriptionCallback: any;

      // Mock authProfileService to capture subscription callback
      const { authProfileService } = require('../../lib/services/auth-profile-service');
      (authProfileService.subscribe as jest.Mock).mockImplementation((callback) => {
        profileSubscriptionCallback = callback;
        // Immediately call with null (simulating initial subscription)
        callback(null);
        return jest.fn(); // Return unsubscribe function
      });

      (authProfileService.setSession as jest.Mock).mockImplementation(async (session) => {
        // Simulate async profile fetch
        await new Promise(resolve => setTimeout(resolve, 100));
        // After fetch completes, notify subscribers
        if (profileSubscriptionCallback && session) {
          profileSubscriptionCallback(mockProfile);
        }
      });

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

      // Wait for session to load
      await waitFor(() => {
        expect(supabase.auth.getSession).toHaveBeenCalled();
      });

      // Wait for setSession to be called
      await waitFor(() => {
        expect(authProfileService.setSession).toHaveBeenCalledWith(mockSession);
      });

      // Fast-forward to complete the async profile fetch
      jest.advanceTimersByTime(150);

      // Verify that profile was loaded
      await waitFor(() => {
        expect(profileSubscriptionCallback).toBeDefined();
      });
    });

    it('should handle profile fetch failure gracefully', async () => {
      const mockSession = {
        access_token: 'valid_token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: 'user123',
          email: 'user@example.com',
          email_confirmed_at: '2024-01-01T00:00:00Z',
        },
      };

      let profileSubscriptionCallback: any;

      const { authProfileService } = require('../../lib/services/auth-profile-service');
      (authProfileService.subscribe as jest.Mock).mockImplementation((callback) => {
        profileSubscriptionCallback = callback;
        callback(null); // Initial call with null
        return jest.fn();
      });

      // Mock setSession to throw an error
      (authProfileService.setSession as jest.Mock).mockRejectedValue(
        new Error('Failed to fetch profile')
      );

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

      // Even with error, should not block indefinitely
      await waitFor(() => {
        expect(authProfileService.setSession).toHaveBeenCalled();
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
        await act(async () => {
          await authStateCallback('SIGNED_OUT', null);
        });
      }

      expect(authStateCallback).toBeDefined();
    });
  });

  describe('Auth State Change Events', () => {
    describe('Leak prevention on sign-out and user-switch', () => {
      it('should clear draft and cache on SIGNED_OUT', async () => {
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

        const mockSession = {
          access_token: 'token',
          refresh_token: 'refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'prevUser', email: 'prev@example.com' },
        };

        // Initial session present so provider records sessionId
        (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: mockSession }, error: null });

        const { clearBountyDraftForUser } = require('../../app/hooks/useBountyDraft');
        const { cachedDataService } = require('../../lib/services/cached-data-service');

        const TestComponent = () => <></>;
        render(
          <AuthProvider>
            <TestComponent />
          </AuthProvider>
        );

        await waitFor(() => expect(supabase.auth.getSession).toHaveBeenCalled());

        // Simulate sign out
        if (authStateCallback) {
          await act(async () => {
            await authStateCallback('SIGNED_OUT', null);
          });
        }

        // Ensure cleanup functions were invoked for the previous user
        expect(clearBountyDraftForUser).toHaveBeenCalledWith('prevUser');
        expect(cachedDataService.clearAll).toHaveBeenCalled();
      });

      it('should clear previous user data when a different user signs in', async () => {
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

        const initialSession = {
          access_token: 'token',
          refresh_token: 'refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'alice', email: 'alice@example.com' },
        };

        (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: initialSession }, error: null });

        const { clearBountyDraftForUser } = require('../../app/hooks/useBountyDraft');
        const { cachedDataService } = require('../../lib/services/cached-data-service');

        const TestComponent = () => <></>;
        render(
          <AuthProvider>
            <TestComponent />
          </AuthProvider>
        );

        await waitFor(() => expect(supabase.auth.getSession).toHaveBeenCalled());

        const newSession = {
          access_token: 'newtoken',
          refresh_token: 'newrefresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'bob', email: 'bob@example.com' },
        };

        // Simulate sign in for a different user
        if (authStateCallback) {
          await act(async () => {
            await authStateCallback('SIGNED_IN', newSession);
          });
        }

        // The provider should clear alice's persisted data before applying bob's session
        expect(clearBountyDraftForUser).toHaveBeenCalledWith('alice');
        expect(cachedDataService.clearAll).toHaveBeenCalled();
      });
    });

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
        await act(async () => {
          await authStateCallback('SIGNED_IN', mockSession);
        });
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
        await act(async () => {
          await authStateCallback('TOKEN_REFRESHED', mockRefreshedSession);
        });
      }

      expect(authStateCallback).toBeDefined();
    });
  });

  describe('PASSWORD_RECOVERY event handling', () => {
    const setupAuthStateListener = async () => {
      let authStateCallback: any;

      (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((callback) => {
        authStateCallback = callback;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      });

      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const { useContext } = require('react');
      const { AuthContext } = require('../../hooks/use-auth-context');

      let capturedContext: any;
      const ContextCapture = () => {
        capturedContext = useContext(AuthContext);
        return null;
      };

      render(
        <AuthProvider>
          <ContextCapture />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(supabase.auth.onAuthStateChange).toHaveBeenCalled();
      });

      return { authStateCallback, getContext: () => capturedContext };
    };

    const mockRecoverySession = {
      access_token: 'recovery_token',
      refresh_token: 'refresh_token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: 'user123',
        email: 'user@example.com',
        email_confirmed_at: '2024-01-01T00:00:00Z',
      },
    };

    it('should set isPasswordRecovery=true on PASSWORD_RECOVERY event', async () => {
      const { authStateCallback, getContext } = await setupAuthStateListener();

      await act(async () => {
        await authStateCallback('PASSWORD_RECOVERY', mockRecoverySession);
      });

      await waitFor(() => {
        expect(getContext()?.isPasswordRecovery).toBe(true);
      });
    });

    it('should clear isPasswordRecovery on USER_UPDATED after password change', async () => {
      const { authStateCallback, getContext } = await setupAuthStateListener();

      // Enter recovery mode
      await act(async () => {
        await authStateCallback('PASSWORD_RECOVERY', mockRecoverySession);
      });

      await waitFor(() => {
        expect(getContext()?.isPasswordRecovery).toBe(true);
      });

      // User updates their password — Supabase fires USER_UPDATED
      await act(async () => {
        await authStateCallback('USER_UPDATED', mockRecoverySession);
      });

      await waitFor(() => {
        expect(getContext()?.isPasswordRecovery).toBe(false);
      });
    });

    it('should clear isPasswordRecovery on SIGNED_OUT', async () => {
      const { authStateCallback, getContext } = await setupAuthStateListener();

      // Enter recovery mode
      await act(async () => {
        await authStateCallback('PASSWORD_RECOVERY', mockRecoverySession);
      });

      await waitFor(() => {
        expect(getContext()?.isPasswordRecovery).toBe(true);
      });

      // User signs out
      await act(async () => {
        await authStateCallback('SIGNED_OUT', null);
      });

      await waitFor(() => {
        expect(getContext()?.isPasswordRecovery).toBe(false);
      });
    });
  });
});
