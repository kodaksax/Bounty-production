/**
 * Shared onboarding-completion logic.
 * Extracted from app/onboarding/done.tsx so multiple terminal onboarding
 * screens (done.tsx, bounty-posted.tsx) can finish onboarding identically
 * without duplicating this review-hardened sequence.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useAuthContext } from './use-auth-context';
import { useAuthProfile } from './useAuthProfile';
import { useBountyFormat } from '../lib/bounty-format-context';
import { CURRENT_ONBOARDING_VERSION, useOnboarding } from '../lib/context/onboarding-context';
import { DEFERRED_PUSH_REGISTRATION_KEY } from '../lib/constants';
import { analyticsService } from '../lib/services/analytics-service';
import { authProfileService } from '../lib/services/auth-profile-service';
import { Profile } from '../lib/services/database.types';
import { notificationService } from '../lib/services/notification-service';
import { getOnboardingCompleteKey } from '../lib/storage/onboarding';

/**
 * Maximum time to wait for pre-navigation work (e.g. profile sync, push registration)
 * before proceeding to the main app. 8s is a compromise: long enough for slow mobile
 * networks to complete in most cases, but short enough to avoid users getting stuck
 * on the final onboarding screen if a dependency hangs.
 */
const PRE_NAV_TIMEOUT_MS = 8000;

// Keep onboarding completion responsive even when a network dependency stalls.
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const clearTimer = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimer();
      console.warn(`[Onboarding] ${label} timed out after ${timeoutMs}ms`);
      resolve(null);
    }, timeoutMs);
  });

  const wrappedPromise = promise
    .then((value) => {
      settled = true;
      clearTimer();
      return value;
    })
    .catch((error) => {
      settled = true;
      clearTimer();
      throw error;
    });

  try {
    return await Promise.race([wrappedPromise, timeoutPromise]);
  } finally {
    // Ensure the losing branch cannot leave a pending timer behind.
    clearTimer();
  }
}

// expo-router's Href type covers plain path strings as well as
// { pathname, params } objects — matching the navigation-target shape
// already used elsewhere in the app (e.g. review-and-verify.tsx).
type OnboardingDestination = string | { pathname: string; params?: Record<string, string> };

/**
 * Runs the full onboarding-completion sequence (profile writes, push
 * registration, cache refresh, activation-moment enqueue, analytics) and
 * navigates to `destination` (or a per-call override) on success.
 */
export function useCompleteOnboarding(destination: OnboardingDestination = '/tabs/bounty-app') {
  const router = useRouter();
  const { userId } = useAuthProfile();
  const { session } = useAuthContext();
  const { data: onboardingData, clearData: clearOnboardingData } = useOnboarding();
  const { bountyFormat } = useBountyFormat();
  const [isLoading, setIsLoading] = useState(false);
  const hasNavigatedRef = useRef(false);

  const complete = useCallback(async (overrideDestination?: OnboardingDestination) => {
    const resolvedUserId = userId || session?.user?.id;

    if (hasNavigatedRef.current || isLoading) return;
    hasNavigatedRef.current = true;
    setIsLoading(true);

    // Write the per-user onboarding-completed flag immediately to reduce
    // the race window where the profile write/refresh may still be pending.
    // This is intentionally early: we accept temporary inconsistency to
    // avoid users being redirected back into onboarding when network calls
    // are slow. We'll still attempt the later persistence as redundancy.
    try {
      if (resolvedUserId) {
        await AsyncStorage.setItem(getOnboardingCompleteKey(resolvedUserId), 'true');
        console.log('[Onboarding] Early AsyncStorage onboarding flag written');
      } else {
        console.warn('[Onboarding] Early AsyncStorage write skipped: userId not available');
      }
    } catch (err) {
      console.error('[Onboarding] Early AsyncStorage write failed:', err);
    }

    // Step 1: Write ALL onboarding data + onboarding_completed: true to Supabase
    // AND patch the in-memory AuthContext profile in one atomic call.
    // Using authProfileService.updateProfile() instead of a bare supabase.update()
    // because it: (a) writes to the DB, (b) updates the in-memory profile, (c) notifies
    // AuthContext listeners — so bounty-app.tsx sees onboarding_completed: true on
    // its very first render and never redirects back. Doing this here (not on mount)
    // guarantees the DB write is complete before we navigate.
    try {
      const profileUpdate: Partial<Profile> = {
        onboarding_completed: true,
        onboarding_version: CURRENT_ONBOARDING_VERSION,
      };
      // Persist the marketplace persona picked on welcome.tsx — previously
      // this was held only in local AsyncStorage and discarded here, so the
      // backend never learned whether someone onboarded as a poster or a
      // hunter. `role` is a distinct column (platform authorization), so
      // this writes `primary_role` instead.
      if (onboardingData.intent === 'poster' || onboardingData.intent === 'hunter') {
        profileUpdate.primary_role = onboardingData.intent;
      }
      if (onboardingData.displayName) profileUpdate.display_name = onboardingData.displayName;
      if (onboardingData.title) profileUpdate.title = onboardingData.title;
      if (onboardingData.bio) profileUpdate.about = onboardingData.bio;
      if (onboardingData.location) profileUpdate.location = onboardingData.location;
      if (onboardingData.skills?.length > 0) profileUpdate.skills = onboardingData.skills;
      if (onboardingData.avatarUri && !onboardingData.avatarUri.startsWith('file://')) {
        profileUpdate.avatar = onboardingData.avatarUri;
      }
      if (onboardingData.phone) profileUpdate.phone = onboardingData.phone;

      const updated = await withTimeout(
        authProfileService.updateProfile(profileUpdate as any),
        PRE_NAV_TIMEOUT_MS,
        'updateProfile'
      );
      if (!updated) {
        console.error('[Onboarding] updateProfile returned null (timeout or empty response); running refresh fallback');
        // updateProfile returned null (in-memory profile was not refreshed); force a
        // refresh so the DB's onboarding_completed=true is pulled into the AuthContext
        // before we navigate — preventing the redirect loop in bounty-app.tsx.
        const fallbackProfile = await withTimeout(
          authProfileService.refreshProfile(),
          PRE_NAV_TIMEOUT_MS,
          'refreshProfile fallback'
        );
        if (fallbackProfile === null) {
          console.error('[Onboarding] refreshProfile fallback returned null (likely timeout); proceeding to avoid blocking navigation');
        }
      }
      console.log('[Onboarding] Profile written to Supabase + AuthContext updated');
    } catch (e) {
      console.error('[Onboarding] updateProfile failed:', e);
      // Even if the Supabase write failed, try refreshing the profile — the DB may have
      // partially succeeded or a prior write may have set onboarding_completed.
      const refreshAfterError = await withTimeout(
        authProfileService.refreshProfile(),
        PRE_NAV_TIMEOUT_MS,
        'refreshProfile after update error'
      );
      if (refreshAfterError === null) {
        console.error('[Onboarding] refreshProfile after update error returned null (likely timeout); navigation may rely on AsyncStorage fallback');
      }
    }

    // Persist the onboarding-completed flag locally, scoped to this user.
    // This is intentionally in its own try/catch so a storage failure doesn't
    // mask a profile-update failure above, and errors are attributed correctly.
    try {
      if (resolvedUserId) {
        await AsyncStorage.setItem(getOnboardingCompleteKey(resolvedUserId), 'true');
      } else {
        console.warn('[Onboarding] AsyncStorage write skipped: userId is not available');
      }
    } catch (err) {
      console.error('[Onboarding] AsyncStorage write failed:', err);
    }

    // Step 2: Request notification permissions (best effort, non-blocking).
    // Only do this if an active session exists; for brand-new users who
    // are not yet signed in, set a flag so AuthProvider will register
    // the token after the user signs in (avoids calling auth-required
    // endpoints with no Authorization header).
    try {
      if (session?.access_token) {
        await withTimeout(
          notificationService.requestPermissionsAndRegisterToken(),
          PRE_NAV_TIMEOUT_MS,
          'notification permission/token registration'
        );
      } else {
        try {
          await AsyncStorage.setItem(DEFERRED_PUSH_REGISTRATION_KEY, 'true');
          if (__DEV__) console.log('[Onboarding] Deferred push registration until sign-in');
        } catch (e) {
          console.warn('[Onboarding] Failed to persist deferred push registration flag', e);
        }
      }
    } catch (e) {
      console.error('[Onboarding] Notification permission error:', e);
    }

    // Step 3: Clear onboarding form context (wrapped in try-catch
    // so a failing AsyncStorage write doesn't strand the user on this screen)
    try {
      await clearOnboardingData();
    } catch (e) {
      console.error('[Onboarding] clearOnboardingData failed:', e);
    }

    // Step 3b: Refresh secondary caches (best effort, non-blocking)
    try {
      const { cachedDataService, CACHE_KEYS } = await import('../lib/services/cached-data-service');
      const { userProfileService } = await import('../lib/services/userProfile');
      if (resolvedUserId) {
        const profile = await userProfileService.getProfile(resolvedUserId);
        const completeness = await userProfileService.checkCompleteness(resolvedUserId);
        await cachedDataService.setCache(CACHE_KEYS.USER_PROFILE(resolvedUserId), { profile, completeness });
      }
    } catch (e) {
      // Non-critical cache refresh failure should not block completion.
      console.error('[Onboarding] Secondary cache refresh failed:', e);
    }

    // Step 4: Ensure AuthContext has the latest profile before navigating.
    // We explicitly refresh the auth profile instead of relying on a fixed timeout.
    try {
      const finalRefresh = await withTimeout(
        authProfileService.refreshProfile(),
        PRE_NAV_TIMEOUT_MS,
        'final refreshProfile'
      );
      if (finalRefresh === null) {
        console.error('[Onboarding] final refreshProfile returned null (likely timeout); continuing with local onboarding-complete flag');
      }
    } catch (e) {
      console.error('[Onboarding] refreshProfile failed (continuing to app):', e);
    }

    analyticsService.trackEvent('onboarding_completed', {
      intent: onboardingData.intent ?? 'none',
      hasAvatar: !!onboardingData.avatarUri,
      hasBio: !!onboardingData.bio,
      skillCount: onboardingData.skills?.length ?? 0,
      bountyFormat,
    });

    // Deliberately NOT priming any Moments Queue prompts here. The
    // marketplace-activation moments (post_first_bounty / accept_first_bounty)
    // are enqueued by lib/moments/backfill.ts on the user's next
    // MomentsProvider session instead, and stay ineligible to actually show
    // until the user has returned for a later session and is on a relevant
    // screen (see registry.ts) — so finishing onboarding never redirects
    // straight into another prompt.

    try {
      router.replace((overrideDestination ?? destination) as any);
      hasNavigatedRef.current = true;
    } catch (e) {
      console.error('[Onboarding] Navigation failed:', e);
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    userId,
    session,
    onboardingData,
    bountyFormat,
    clearOnboardingData,
    router,
    destination,
    isLoading,
  ]);

  return { complete, isLoading, hasNavigatedRef };
}
