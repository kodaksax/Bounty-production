import * as SecureStore from 'expo-secure-store';
import { clearRememberMePreference } from '../auth-session-storage';
import { supabase } from '../supabase';
import { markIntentionalSignOut } from '../utils/session-handler';
import { authProfileService } from './auth-profile-service';

export type LogoutDeps = Partial<{
  supabase: typeof supabase;
  authProfileService: typeof authProfileService;
  SecureStore: typeof SecureStore;
  clearRememberMePreference: typeof clearRememberMePreference;
  markIntentionalSignOut: typeof markIntentionalSignOut;
  router: { replace: (path: string) => void } | null;
  currentUserId: string | null;
}>;

/**
 * Perform a user logout with sensible fallbacks and background cleanup.
 * Accepts optional dependency overrides for easier unit testing.
 */
export async function performLogout(deps: LogoutDeps = {}) {
  const {
    supabase: sup = supabase,
    authProfileService: profileSvc = authProfileService,
    SecureStore: Secure = SecureStore,
    clearRememberMePreference: clearRemember = clearRememberMePreference,
    markIntentionalSignOut: markIntent = markIntentionalSignOut,
    router = null,
    currentUserId = null,
  } = deps;

  // Mark sign-out intentional so session-expiration alerts don't appear
  try {
    markIntent?.();
  } catch (e) {
    // ignore
  }

  // Try a full sign-out and wait for it (short timeout), fall back to local sign-out
  // Track whether sign-out ultimately failed so we only retry in background when needed
  let signOutFailed = false;
  try {
    await Promise.race([
      sup.auth.signOut(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('signOut timeout')), 3000)),
    ]);
    signOutFailed = false;
  } catch (err) {
    signOutFailed = true;
    // fallback to local sign-out for immediate UI update
    try {
      await sup.auth.signOut({ scope: 'local' } as any);
      // fallback succeeded, no need for further background retry
      signOutFailed = false;
    } catch (e) {
      // swallow; we still proceed with UI navigation
      console.warn('[LogoutService] fallback local signOut failed', e);
    }
  }

  // Ensure profile/session caches are cleared synchronously so subscribers update quickly
  try {
    if (currentUserId) {
      await profileSvc.clearUserDraftData(currentUserId).catch(() => undefined);
    }
  } catch (e) {
    /* ignore */
  }

  try {
    await profileSvc.setSession(null).catch(() => undefined);
  } catch (e) {
    /* ignore */
  }

  // Navigate to sign-in screen if a router was provided
  try {
    router?.replace('/auth/sign-in-form');
  } catch (e) {
    console.error('[LogoutService] Router navigation failed', e);
  }

  // Fire-and-forget background cleanup. Only attempt a redundant signOut when prior attempts failed.
  const backgroundTasks: Array<Promise<unknown>> = [
    (clearRemember?.() as Promise<unknown>)?.catch?.(() => undefined),
    Promise.all([
      Secure.deleteItemAsync('sb-access-token').catch(() => undefined),
      Secure.deleteItemAsync('sb-refresh-token').catch(() => undefined),
    ]),
  ];

  if (signOutFailed) {
    backgroundTasks.push(sup.auth.signOut().catch(() => undefined));
  }

  void Promise.all(backgroundTasks).catch(() => undefined);
}
