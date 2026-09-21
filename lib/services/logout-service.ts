import * as SecureStore from 'expo-secure-store';
import { clearAllSessionData } from '../auth-session-storage';
import { PROJECT_STORAGE_KEY, supabase } from '../supabase';
import { markIntentionalSignOut } from '../utils/session-handler';
import { authProfileService } from './auth-profile-service';
import { notificationService } from './notification-service';

export type LogoutDeps = Partial<{
  supabase: typeof supabase;
  authProfileService: typeof authProfileService;
  SecureStore: typeof SecureStore;
  markIntentionalSignOut: typeof markIntentionalSignOut;
  router: { replace: (path: string) => void } | null;
  currentUserId: string | null;
  deregisterPushToken: () => Promise<void>;
  clearNotificationCache: (userId: string | null) => Promise<void>;
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
    markIntentionalSignOut: markIntent = markIntentionalSignOut,
    router = null,
    currentUserId = null,
    deregisterPushToken = () => notificationService.deregisterPushToken(),
    clearNotificationCache = (userId: string | null) =>
      notificationService.clearCache(userId ?? undefined),
  } = deps;

  // Mark sign-out intentional so session-expiration alerts don't appear
  try {
    markIntent?.();
  } catch (e) {
    // ignore
  }

  // Deregister push token before invalidating the session. deregisterPushToken()
  // needs a live session (it reads the access token via supabase.auth.getSession())
  // to authorize its delete call, so it must resolve before signOut() below —
  // previously this fired fire-and-forget in parallel with signOut(), and
  // signOut() usually won the race, invalidating the session before the token
  // read happened and silently leaving the device's push token registered to
  // the now-logged-out user. Bounded by a short timeout so a slow/hung network
  // call can't delay logout.
  await Promise.race([
    deregisterPushToken().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);

  // Clear the signed-out user's notification cache — the in-memory copies and
  // the per-user AsyncStorage entry — so the next account on this device can't
  // read the previous account's notifications. Runs before signOut so the
  // session is still available when currentUserId wasn't supplied.
  await clearNotificationCache(currentUserId).catch(() => undefined);

  // Sign out this device only. `scope: 'local'` revokes just the current
  // session's refresh token instead of the SDK default (`scope: 'global'`),
  // which revokes EVERY session for the account. A global sign-out here was
  // silently kicking a user's *other* signed-in devices (e.g. logging out on
  // one phone invalidated the session on a different phone that was mid
  // bounty-submission), surfacing there as an unrelated-looking
  // "Failed to mark Ready" error. See lib/services/completion-service.ts.
  // Track whether sign-out ultimately failed so we only retry in background when needed
  let signOutFailed = false;
  try {
    await Promise.race([
      sup.auth.signOut({ scope: 'local' } as any),
      new Promise((_, reject) => setTimeout(() => reject(new Error('signOut timeout')), 3000)),
    ]);
    signOutFailed = false;
  } catch (err) {
    signOutFailed = true;
    // retry once more, still local-scoped, for immediate UI update
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
  const backgroundTasks: Promise<unknown>[] = [
    // Wipe the project-scoped session key (and the legacy shared key) from
    // SecureStore and the in-memory cache so no stale token can survive logout.
    clearAllSessionData(PROJECT_STORAGE_KEY).catch(() => undefined),
    Promise.all([
      Secure.deleteItemAsync('sb-access-token').catch(() => undefined),
      Secure.deleteItemAsync('sb-refresh-token').catch(() => undefined),
    ]),
  ];

  if (signOutFailed) {
    backgroundTasks.push(sup.auth.signOut({ scope: 'local' } as any).catch(() => undefined));
  }

  void Promise.all(backgroundTasks).catch(() => undefined);
}
