// lib/admin-context.tsx - Admin authentication and role management context
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { isSupabaseConfigured, supabase } from './supabase';
import { logAuthLifecycleEvent, runAuthStageWithTimeout } from './utils/auth-diagnostics';
import { generateCorrelationId } from './utils/auth-errors';
import {
    resolveSupabaseAuthSubscription,
    safeUnsubscribe,
    SupabaseAuthSubscription,
} from './utils/supabase-subscription';

interface AdminContextValue {
  isAdmin: boolean;
  isAdminTabEnabled: boolean;
  isLoading: boolean;
  setIsAdmin: (value: boolean) => void;
  setAdminTabEnabled: (value: boolean) => void;
  verifyAdminStatus: () => Promise<boolean>;
}

const AdminContext = createContext<AdminContextValue | undefined>(undefined);

const ADMIN_KEY = 'BE:isAdmin';
const ADMIN_TAB_ENABLED_KEY = 'BE:adminTabEnabled';
const ADMIN_VERIFIED_AT_KEY = 'BE:adminVerifiedAt';
const VERIFICATION_EXPIRY = 5 * 60 * 1000; // 5 minutes

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdminState] = useState(false);
  const [isAdminTabEnabled, setIsAdminTabEnabledState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Define helpers BEFORE any useEffect that references them, with useCallback
  // so the function identities are stable across re-renders. This prevents the
  // stale-closure crash that occurred when onAuthStateChange fired TOKEN_REFRESHED
  // (~1 hour after login) and called the initial-render version of these functions.
  const setIsAdmin = useCallback(async (value: boolean) => {
    try {
      await AsyncStorage.setItem(ADMIN_KEY, String(value));
      if (!value) {
        await AsyncStorage.removeItem(ADMIN_VERIFIED_AT_KEY);
      }
      setIsAdminState(value);
    } catch (error) {
      console.error('[AdminContext] Error saving admin status:', error);
    }
  }, []);

  const setAdminTabEnabled = useCallback(async (value: boolean) => {
    try {
      await AsyncStorage.setItem(ADMIN_TAB_ENABLED_KEY, String(value));
      setIsAdminTabEnabledState(value);
    } catch (error) {
      console.error('[AdminContext] Error saving admin tab preference:', error);
    }
  }, []);

  const verifyAdminStatus = useCallback(async (): Promise<boolean> => {
    if (!isSupabaseConfigured) {
      console.error('[AdminContext] Supabase not configured - cannot verify admin status');
      return false;
    }

    try {
      const {
        data: { session },
        error: sessionError,
      } = await runAuthStageWithTimeout({
        correlationId: generateCorrelationId('admin_verify'),
        stage: 'admin:getSession',
        timeoutMs: 12000,
        run: () => supabase.auth.getSession(),
        metadata: { surface: 'admin-context', reason: 'verify-admin-status' },
      });

      if (sessionError || !session) {
        await setIsAdmin(false);
        return false;
      }

      // Check app_metadata for admin role (not user_metadata, which is user-writable)
      const isAdminUser = session.user?.app_metadata?.role === 'admin';

      if (isAdminUser) {
        await AsyncStorage.setItem(ADMIN_VERIFIED_AT_KEY, Date.now().toString());
      }

      await setIsAdmin(isAdminUser);
      return isAdminUser;
    } catch (error) {
      console.error('[AdminContext] Error verifying admin status:', error);
      await setIsAdmin(false);
      return false;
    }
  }, [setIsAdmin]);

  // Refs so the long-lived onAuthStateChange subscription always calls the
  // current function, not the one captured at mount.
  const verifyAdminStatusRef = useRef(verifyAdminStatus);
  verifyAdminStatusRef.current = verifyAdminStatus;
  const setIsAdminRef = useRef(setIsAdmin);
  setIsAdminRef.current = setIsAdmin;
  const setAdminTabEnabledRef = useRef(setAdminTabEnabled);
  setAdminTabEnabledRef.current = setAdminTabEnabled;

  // Load and verify admin status on mount
  useEffect(() => {
    const loadAdminStatus = async () => {
      try {
        // Always reset the admin tab toggle on fresh mounts so the nav defaults to the profile tab
        try {
          await AsyncStorage.setItem(ADMIN_TAB_ENABLED_KEY, 'false');
        } catch (error) {
          console.error('[AdminContext] Error resetting admin tab preference:', error);
        }
        setIsAdminTabEnabledState(false);

        const stored = await AsyncStorage.getItem(ADMIN_KEY);
        const verifiedAt = await AsyncStorage.getItem(ADMIN_VERIFIED_AT_KEY);

        if (stored === 'true' && verifiedAt) {
          const verifiedTime = parseInt(verifiedAt, 10);
          const isExpired = Date.now() - verifiedTime > VERIFICATION_EXPIRY;

          if (!isExpired) {
            // Use cached value if recent
            setIsAdminState(true);
            setIsLoading(false);
            // Still verify in background
            verifyAdminStatusRef.current();
            return;
          }
        }

        // Verify with backend if cache expired or not found
        await verifyAdminStatusRef.current();
      } catch (error) {
        console.error('[AdminContext] Error loading admin status:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadAdminStatus();
  }, []);

  // Listen for auth state changes
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cleanupRequested = false;
    let authSubscription: SupabaseAuthSubscription | undefined;

    const ret = supabase.auth.onAuthStateChange((event, session) => {
      const correlationId = generateCorrelationId(`admin_event_${String(event).toLowerCase()}`);
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();

      logAuthLifecycleEvent({
        correlationId,
        stage: 'admin:onAuthStateChange',
        status: 'started',
        startedAt,
        metadata: {
          event,
          hasSession: !!session,
          userId: session?.user?.id ?? null,
        },
      });

      // Keep callback lock-safe: do not await Supabase calls or long async work here.
      // Supabase dispatches auth events while holding its internal auth lock; awaiting
      // lock-reentrant calls (e.g., getSession) can deadlock startup/sign-in.
      if (event === 'SIGNED_OUT') {
        void setIsAdminRef.current(false).catch(e => {
          console.error('[AdminContext] Error clearing admin status on sign-out:', e);
        });
        void setAdminTabEnabledRef.current(false).catch(e => {
          console.error('[AdminContext] Error resetting admin tab on sign-out:', e);
        });
      } else if (event === 'SIGNED_IN') {
        void setAdminTabEnabledRef.current(false).catch(e => {
          console.error('[AdminContext] Error resetting admin tab on sign-in:', e);
        });

        // Fast-path: derive admin role from the event session immediately.
        if (session?.user) {
          const isAdminUser = session.user?.app_metadata?.role === 'admin';
          void setIsAdminRef.current(isAdminUser).catch(e => {
            console.error('[AdminContext] Error applying admin status from event session:', e);
          });
        }

        // Background verify in a macrotask to run after the auth lock is released.
        setTimeout(() => {
          void verifyAdminStatusRef.current().catch(e => {
            console.error('[AdminContext] Deferred admin status verification failed:', e);
          });
        }, 0);
      }

      logAuthLifecycleEvent({
        correlationId,
        stage: 'admin:onAuthStateChange',
        status: 'success',
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAtMs,
        metadata: { event },
        outcome: 'event_handled',
      });
      // TOKEN_REFRESHED is intentionally not handled here: admin role doesn't change.
    });

    resolveSupabaseAuthSubscription(
      ret,
      resolvedSubscription => {
        authSubscription = resolvedSubscription;
        if (cleanupRequested) {
          safeUnsubscribe(authSubscription);
        }
      },
      error => {
        console.error('[AdminContext] Failed to register auth listener:', error);
      }
    );

    return () => {
      cleanupRequested = true;
      safeUnsubscribe(authSubscription);
    };
  }, [isSupabaseConfigured]);

  const value = useMemo(
    () => ({
      isAdmin,
      isAdminTabEnabled,
      isLoading,
      setIsAdmin,
      setAdminTabEnabled,
      verifyAdminStatus,
    }),
    [isAdmin, isAdminTabEnabled, isLoading, setIsAdmin, setAdminTabEnabled, verifyAdminStatus]
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdmin must be used within AdminProvider');
  }
  return context;
}

// Hook to require admin access - redirects if not admin
export function useRequireAdmin() {
  const { isAdmin, isLoading } = useAdmin();
  return { isAdmin, isLoading, hasAccess: isAdmin };
}
