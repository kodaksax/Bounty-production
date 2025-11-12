/**
 * Session Expiration Handler
 * Detects when auth session expires and prompts user to re-login
 */

import { supabase } from '../supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './error-logger';

const SESSION_CHECK_KEY = 'last_session_check';
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

export interface SessionState {
  isExpired: boolean;
  expiresAt: number | null;
  needsRefresh: boolean;
}

let sessionExpirationCallback: (() => void) | null = null;

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
    const { data: { session }, error } = await supabase.auth.getSession();
    
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

/**
 * Attempt to refresh the session
 */
export async function refreshSession(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    
    if (error) {
      logger.error('Error refreshing session', { error });
      return false;
    }
    
    if (!data.session) {
      logger.warning('Session refresh returned no session');
      return false;
    }
    
    logger.info('Session refreshed successfully');
    return true;
  } catch (error) {
    logger.error('Unexpected error refreshing session', { error });
    return false;
  }
}

/**
 * Handle session expiration - sign out and notify callback
 */
export async function handleSessionExpiration(): Promise<void> {
  try {
    logger.info('Handling session expiration');
    
    // Sign out from Supabase
    await supabase.auth.signOut();
    
    // Clear any local session data
    await AsyncStorage.removeItem(SESSION_CHECK_KEY);
    
    // Notify callback
    if (sessionExpirationCallback) {
      sessionExpirationCallback();
    }
  } catch (error) {
    logger.error('Error handling session expiration', { error });
  }
}

/**
 * Start periodic session checking
 */
export function startSessionMonitoring(): () => void {
  let intervalId: NodeJS.Timeout;
  
  const checkAndRefresh = async () => {
    const state = await checkSessionExpiration();
    
    if (state.isExpired) {
      await handleSessionExpiration();
    } else if (state.needsRefresh) {
      const refreshed = await refreshSession();
      if (!refreshed) {
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
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (event, session) => {
      logger.info('Auth state changed', { event });
      
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        if (event === 'SIGNED_OUT' && sessionExpirationCallback) {
          sessionExpirationCallback();
        }
      }
      
      if (event === 'TOKEN_REFRESHED' && session) {
        logger.info('Token refreshed automatically');
      }
    }
  );
  
  return () => {
    subscription.unsubscribe();
  };
}
