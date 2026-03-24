/**
 * Done Onboarding Screen
 * Final step: confirm completion and navigate to app
 * Shows profile summary including skills, bio, title from onboarding
 */

import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { useAuthContext } from '../../hooks/use-auth-context';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { DEFERRED_PUSH_REGISTRATION_KEY } from '../../lib/constants';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { authProfileService } from '../../lib/services/auth-profile-service';
import { Profile } from '../../lib/services/database.types';
import { notificationService } from '../../lib/services/notification-service';
import { getOnboardingCompleteKey } from '../../lib/storage/onboarding';
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

export default function DoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: localProfile } = useUserProfile();
  const { profile: normalized } = useNormalizedProfile();
  const { userId } = useAuthProfile();
  const { session } = useAuthContext();
  const { data: onboardingData, clearData: clearOnboardingData } = useOnboarding();

  const displayUsername = onboardingData.username || normalized?.username || (localProfile as any)?.username;
  const displayName = onboardingData.displayName || normalized?.name || (localProfile as any)?.displayName;
  const displayTitle = onboardingData.title || normalized?.title || (localProfile as any)?.title;
  const displayBio = onboardingData.bio || normalized?.bio || (localProfile as any)?.bio;
  const displayLocation = onboardingData.location || normalized?.location || (localProfile as any)?.location;
  const displaySkills = onboardingData.skills.length > 0
    ? onboardingData.skills
    : normalized?.skills || (localProfile as any)?.skills || [];
  const hasPhone = !!onboardingData.phone || !!(normalized?._raw && (normalized as any)._raw.phone) || !!(localProfile as any)?.phone;

  const [scaleAnim] = useState(new Animated.Value(0));
  const [fadeAnim] = useState(new Animated.Value(0));
  const [isLoading, setIsLoading] = useState(false);
  const hasNavigatedRef = useRef(false);

  useEffect(() => {
    // Animation only — no Supabase writes here.
    // All profile persistence happens in handleContinue so we can guarantee
    // the database write completes before navigation (reviewer comment #1).
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [scaleAnim, fadeAnim]);

  const handleContinue = async () => {
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
    // guarantees the DB write is complete before we navigate. (reviewer comment #1)
    try {
      const profileUpdate: Partial<Profile> = { onboarding_completed: true };
      if (onboardingData.username) profileUpdate.username = onboardingData.username;
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

    // Step 3: Clear onboarding form context (reviewer comment #2 — wrapped in try-catch
    // so a failing AsyncStorage write doesn't strand the user on this screen)
    try {
      await clearOnboardingData();
    } catch (e) {
      console.error('[Onboarding] clearOnboardingData failed:', e);
    }

    // Step 3: Refresh secondary caches (best effort, non-blocking)
    try {
      const { cachedDataService, CACHE_KEYS } = await import('../../lib/services/cached-data-service');
      const { userProfileService } = await import('../../lib/services/userProfile');
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

    try {
      router.replace('/tabs/bounty-app');
      hasNavigatedRef.current = true;
    } catch (e) {
      console.error('[Onboarding] Navigation failed:', e);
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
  };

  // If the signed in user already has onboarding_completed, avoid flashing
  // the onboarding flow: show the button loading state briefly then go in.
  useEffect(() => {
    const alreadyCompleted = !!((normalized as any)?.onboarding_completed || (localProfile as any)?.onboarding_completed);
    if (!alreadyCompleted) return;
    if (hasNavigatedRef.current) return;

    (async () => {
      try {
        setIsLoading(true);
        // allow the button/animations to render briefly so there's no visual jump
        await new Promise((res) => setTimeout(res, 600));
        const refreshed = await withTimeout(
          authProfileService.refreshProfile(),
          PRE_NAV_TIMEOUT_MS,
          'auto-navigation refreshProfile'
        );
        if (refreshed === null) {
          console.error('[Onboarding] auto-navigation refreshProfile returned null (likely timeout); attempting navigation anyway');
        }

        try {
          router.replace('/tabs/bounty-app');
          hasNavigatedRef.current = true;
        } catch (e) {
          console.error('[Onboarding] Auto-navigation failed:', e);
          // `finally` will clear loading state; avoid redundant set here.
          return;
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, [normalized, localProfile, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Branding Header — fixed at top, never pushed by content */}
      <View style={styles.brandingHeader}>
        <BrandingLogo size="medium" />
      </View>

      {/* Content area (non-scrolling) */}
      <View style={styles.contentContainer}>
        {/* Success Animation */}
        <Animated.View style={[styles.checkCircle, { transform: [{ scale: scaleAnim }] }]}>
          <MaterialIcons name="check" size={72} color="#052e1b" />
        </Animated.View>

        <Animated.View style={{ opacity: fadeAnim, alignItems: 'center', width: '100%' }}>
          <Text style={styles.title}>You{"'"}re All Set!</Text>
          <Text style={styles.subtitle}>Welcome to Bounty, @{displayUsername || 'user'}!</Text>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Your Profile Summary</Text>

            <View style={styles.summaryItem}>
              <MaterialIcons name="person" size={18} color="#a7f3d0" />
              <Text style={styles.summaryLabel}>Username</Text>
              <Text style={styles.summaryValue}>@{displayUsername}</Text>
            </View>

            {displayName && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="badge" size={18} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Name</Text>
                <Text style={styles.summaryValue}>{displayName}</Text>
              </View>
            )}

            {displayTitle && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="work" size={18} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Title</Text>
                <Text style={styles.summaryValue}>{displayTitle}</Text>
              </View>
            )}

            {displayLocation && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="location-on" size={18} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Location</Text>
                <Text style={styles.summaryValue}>{displayLocation}</Text>
              </View>
            )}

            {displayBio && (
              <View style={styles.summaryItemColumn}>
                <View style={styles.summaryItemRow}>
                  <MaterialIcons name="info-outline" size={18} color="#a7f3d0" />
                  <Text style={styles.summaryLabel}>Bio</Text>
                </View>
                <Text style={styles.summaryBio}>{displayBio}</Text>
              </View>
            )}

            {displaySkills.length > 0 && (
              <View style={styles.summaryItemColumn}>
                <View style={styles.summaryItemRow}>
                  <MaterialIcons name="star" size={18} color="#a7f3d0" />
                  <Text style={styles.summaryLabel}>Skills</Text>
                </View>
                <View style={styles.skillsRow}>
                  {displaySkills.slice(0, 4).map((skill: string, index: number) => (
                    <View key={index} style={styles.skillBadge}>
                      <Text style={styles.skillBadgeText}>{skill}</Text>
                    </View>
                  ))}
                  {displaySkills.length > 4 && (
                    <Text style={styles.moreSkills}>+{displaySkills.length - 4} more</Text>
                  )}
                </View>
              </View>
            )}

            {hasPhone && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="phone" size={18} color="#a7f3d0" />
                <Text style={styles.summaryLabel}>Phone</Text>
                <Text style={styles.summaryValue}>✓ Added (private)</Text>
              </View>
            )}
          </View>

          <Text style={styles.infoText}>
            You can update your profile anytime from the Profile tab
          </Text>
        </Animated.View>
      </View>

      {/* Continue Button — pinned to bottom, always tappable */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <Animated.View style={{ opacity: fadeAnim, width: '100%' }}>
          <TouchableOpacity
            style={[styles.continueButton, isLoading ? { opacity: 0.8 } : {}]}
            onPress={handleContinue}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#052e1b" />
            ) : (
              <>
                <Text style={styles.continueButtonText}>Start Exploring</Text>
                <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.progressContainer}>
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
          <View style={[styles.progressDot, styles.progressDotActive]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
  },
  brandingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    zIndex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  // Combined style for non-scrolling content area — avoids mixing
  // `scrollView` (container) and `scrollContent` (inner content)
  contentContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  checkCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#a7f3d0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 24,
  },
  summaryCard: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a7f3d0',
    marginBottom: 12,
    textAlign: 'center',
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryItemColumn: {
    marginBottom: 10,
  },
  summaryItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginLeft: 8,
    minWidth: 70,
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  summaryBio: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    lineHeight: 18,
    marginLeft: 26,
  },
  skillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginLeft: 26,
  },
  skillBadge: {
    backgroundColor: 'rgba(167,243,208,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  skillBadgeText: {
    color: '#a7f3d0',
    fontSize: 11,
    fontWeight: '500',
  },
  moreSkills: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    alignSelf: 'center',
  },
  infoText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  bottomBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: '#059669',
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a7f3d0',
    paddingVertical: 16,
    borderRadius: 999,
    marginBottom: 16,
  },
  continueButtonText: {
    color: '#052e1b',
    fontSize: 18,
    fontWeight: 'bold',
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 4,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressDotActive: {
    backgroundColor: '#a7f3d0',
  },
});
