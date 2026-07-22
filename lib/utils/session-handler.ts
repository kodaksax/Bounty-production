/**
 * Session Expiration Handler
 * Detects when auth session expires and prompts user to re-login
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { logger } from './error-logger';
import {
    resolveSupabaseAuthSubscription,
    safeUnsubscribe,
    SupabaseAuthSubscription,
} from './supabase-subscription';

const SESSION_CHECK_KEY = 'last_session_check';
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

export interface SessionState {
  isExpired: boolean;
  expiresAt: number | null;
  needsRefresh: boolean;
}

let sessionExpirationCallback: (() => void) | null = null;

/**
 * Flag to indicate if the current sign-out is intentional (user-initiated).
 * This prevents showing "Session Expired" alert when user explicitly logs out.
 */
let isIntentionalSignOut = false;

/**
 * Mark the upcoming sign-out as intentional (user-initiated).
 * This should be called before calling supabase.auth.signOut() from user actions.
 * The flag is automatically cleared after the SIGNED_OUT event is processed.
 */
export function markIntentionalSignOut(): void {
  isIntentionalSignOut = true;
  logger.info('Marked sign-out as intentional');
}

/**
 * Clear the intentional sign-out flag.
 */
export function clearIntentionalSignOut(): void {
  isIntentionalSignOut = false;
}

/**
 * Check if the current sign-out is intentional.
 */
export function isSignOutIntentional(): boolean {
  return isIntentionalSignOut;
}

/**
 * Register callback for when session expires
 */
export function onSessionExpiration(callback: () => void) {
  sessionExpirationCallback = callback;
  return () => {
    sessionExpirationCallback = null;
  };
}

/**
 * Check if current session is expired or about to expire
 */
export async function checkSessionExpiration(): Promise<SessionState> {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      logger.error('Error checking session', { error });
      return { isExpired: false, expiresAt: null, needsRefresh: false };
    }

    if (!session) {
      return { isExpired: true, expiresAt: null, needsRefresh: false };
    }

    const expiresAt = session.expires_at ? session.expires_at * 1000 : null;
    const now = Date.now();

    // Consider expired if less than 5 minutes remaining
    const bufferMs = 5 * 60 * 1000;
    const isExpired = expiresAt ? expiresAt - now < 0 : false;
    const needsRefresh = expiresAt ? expiresAt - now < bufferMs : false;

    return {
      isExpired,
      expiresAt,
      needsRefresh,
    };
  } catch (error) {
    logger.error('Unexpected error checking session', { error });
    return { isExpired: false, expiresAt: null, needsRefresh: false };
  }
}

export interface RefreshSessionResult {
  refreshed: boolean;
  /**
   * True when the failure looks like a transient connectivity problem
   * (offline, DNS hiccup, 5xx) rather than a definitive auth rejection
   * (revoked/invalid refresh token). Callers must NOT treat a network-error
   * failure as "the session is gone" — see checkAndRefresh below, which is
   * exactly the distinction AuthProvider.refreshTokenNow already makes
   * (providers/auth-provider.tsx) for its own proactive refresh.
   */
  isNetworkError: boolean;
}

/**
 * Attempt to refresh the session.
 */
export async function refreshSession(): Promise<RefreshSessionResult> {
  try {
    const { data, error } = await supabase.auth.refreshSession();

    if (error) {
      logger.error('Error refreshing session', { error });

      const isNetworkError =
        error.message?.includes('network') ||
        error.message?.includes('fetch') ||
        (error as { status?: number }).status === 503 ||
        (error as { status?: number }).status === 504;

      return { refreshed: false, isNetworkError };
    }

    if (!data.session) {
      logger.warning('Session refresh returned no session');
      return { refreshed: false, isNetworkError: false };
    }

    logger.info('Session refreshed successfully');
    return { refreshed: true, isNetworkError: false };
  } catch (error) {
    // A thrown (rather than returned) error from the SDK is almost always a
    // network-level failure (e.g. a rejected fetch), not a definitive auth
    // rejection — treat it as a network error rather than signing out.
    logger.error('Unexpected error refreshing session', { error });
    return { refreshed: false, isNetworkError: true };
  }
}

/**
 * Handle session expiration - sign out and notify callback
 * This function is called by session monitoring when it detects an expired session.
 */
export async function handleSessionExpiration(): Promise<void> {
  try {
    logger.info('Handling session expiration');

    // Sign out from Supabase
    // This will trigger the SIGNED_OUT event in setupAuthStateListener.
    // Since handleSessionExpiration is only called by session monitoring (not user action),
    // isIntentionalSignOut will be false, so the callback will be triggered by the listener.
    await supabase.auth.signOut();

    // Clear any local session data
    await AsyncStorage.removeItem(SESSION_CHECK_KEY);

    // Note: We don't call sessionExpirationCallback directly here.
    // The auth state listener handles it based on the isIntentionalSignOut flag.
  } catch (error) {
    logger.error('Error handling session expiration', { error });
  }
}

/**
 * Start periodic session checking
 */
export function startSessionMonitoring(): () => void {
  let intervalId: ReturnType<typeof setInterval>;

  const checkAndRefresh = async () => {
    const state = await checkSessionExpiration();

    if (state.isExpired) {
      await handleSessionExpiration();
    } else if (state.needsRefresh) {
      const { refreshed, isNetworkError } = await refreshSession();
      // Only a definitive failure (bad/revoked refresh token, or the SDK
      // returning no session at all) means the user is actually signed
      // out. A network error just means this attempt didn't go through —
      // leave the session alone and let the next scheduled check (or
      // AuthProvider's own proactive refresh) retry once connectivity is
      // back, instead of forcing a real sign-out for a connectivity blip.
      if (!refreshed && !isNetworkError) {
        await handleSessionExpiration();
      }
    }

    // Update last check time
    await AsyncStorage.setItem(SESSION_CHECK_KEY, Date.now().toString());
  };

  // Check immediately
  checkAndRefresh();

  // Then check periodically
  intervalId = setInterval(checkAndRefresh, SESSION_CHECK_INTERVAL);

  // Register interval for test cleanup
  if (process.env.NODE_ENV === 'test') {
    const _i = intervalId as any;
    if (typeof _i?.unref === 'function') {
      try {
        _i.unref();
      } catch {
        /* ignore */
      }
    }
    (globalThis as any).__BACKGROUND_INTERVALS = (globalThis as any).__BACKGROUND_INTERVALS || [];
    (globalThis as any).__BACKGROUND_INTERVALS.push(intervalId);
  }

  // Return cleanup function
  return () => {
    if (intervalId) {
      clearInterval(intervalId);
    }
  };
}

/**
 * Listen to Supabase auth state changes
 */
export function setupAuthStateListener(): () => void {
  let cleanupRequested = false;
  let subscription: SupabaseAuthSubscription | undefined;

  const ret = supabase.auth.onAuthStateChange(async (event, session) => {
    logger.info('Auth state changed', { event });

    if (event === 'SIGNED_OUT') {
      // Only trigger session expiration callback if this was NOT an intentional sign-out
      // Intentional sign-outs (user clicking "Log Out") handle their own notification
      if (!isIntentionalSignOut && sessionExpirationCallback) {
        sessionExpirationCallback();
      }
      // Clear the flag after processing
      clearIntentionalSignOut();
    }

    if (event === 'TOKEN_REFRESHED' && session) {
      logger.info('Token refreshed automatically');
    }
  });

  resolveSupabaseAuthSubscription(
    ret,
    resolvedSubscription => {
      subscription = resolvedSubscription;
      if (cleanupRequested) {
        safeUnsubscribe(subscription);
      }
    },
    error => {
      logger.error('Failed to resolve auth state listener subscription', { error });
    }
  );

  return () => {
    cleanupRequested = true;
    safeUnsubscribe(subscription);
  };
}
