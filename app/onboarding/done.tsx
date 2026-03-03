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
  Animated,
  ScrollView,
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
import { useOnboarding } from '../../lib/context/onboarding-context';
import { authProfileService } from '../../lib/services/auth-profile-service';
import { Profile } from '../../lib/services/database.types';
import { notificationService } from '../../lib/services/notification-service';
import { supabase } from '../../lib/supabase';

const ONBOARDING_COMPLETE_KEY = '@bounty_onboarding_completed';

export default function DoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: localProfile } = useUserProfile();
  const { profile: normalized } = useNormalizedProfile();
  const { userId } = useAuthProfile();
  const { profile: authProfile } = useAuthContext();
  const { data: onboardingData, clearData: clearOnboardingData } = useOnboarding();

  // Use onboarding data primarily, fallback to normalized/local
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

  // readyToNavigate: set to true only after authProfileService has confirmed
  // onboarding_completed: true in React state. We watch authProfile from
  // useAuthContext — when it flips to true we know both index.tsx AND
  // bounty-app.tsx will see the correct value and won't redirect back.
  const [readyToNavigate, setReadyToNavigate] = useState(false);
  const hasSavedRef = useRef(false);
  const hasNavigatedRef = useRef(false);

  // --- Step 1: Animate + save profile on mount ---
  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    const saveAndMark = async () => {
      if (hasSavedRef.current) return;
      hasSavedRef.current = true;

      try {
        await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');

        if (userId) {
          const profileUpdate: Partial<Profile> = { onboarding_completed: true };

          if (onboardingData.username) profileUpdate.username = onboardingData.username;
          if (onboardingData.displayName) profileUpdate.display_name = onboardingData.displayName;
          if (onboardingData.title) profileUpdate.title = onboardingData.title;
          if (onboardingData.bio) profileUpdate.about = onboardingData.bio;
          if (onboardingData.location) profileUpdate.location = onboardingData.location;
          if (onboardingData.skills?.length > 0) profileUpdate.skills = onboardingData.skills;
          if (onboardingData.avatarUri && !onboardingData.avatarUri.startsWith('file://')) {
            profileUpdate.avatar_url = onboardingData.avatarUri;
          }
          if (onboardingData.phone) profileUpdate.phone = onboardingData.phone;

          const { error } = await supabase
            .from('profiles')
            .update(profileUpdate)
            .eq('id', userId);

          if (error) {
            console.error('[Onboarding] Supabase update error:', error);
          } else {
            console.log('[Onboarding] Profile saved to Supabase');
          }
        }

        // CRITICAL: Call authProfileService.updateProfile so the in-memory AuthContext
        // profile is updated synchronously before any navigation happens.
        // This is what causes readyToNavigate to flip via the useEffect below.
        await authProfileService.updateProfile({ onboarding_completed: true });
        console.log('[Onboarding] authProfileService updated — waiting for React state commit');

        try {
          const token = await notificationService.requestPermissionsAndRegisterToken();
          console.log('[Onboarding] Notification token:', token ? 'granted' : 'denied');
        } catch (e) {
          console.error('[Onboarding] Notification permission error:', e);
        }
      } catch (error) {
        console.error('[Onboarding] saveAndMark error:', error);
      }
    };

    saveAndMark();
  }, [scaleAnim, fadeAnim, userId, onboardingData]);

  // --- Step 2: Watch authProfile from React context ---
  // Only set readyToNavigate when AuthContext has committed onboarding_completed: true.
  // At this point BOTH index.tsx and bounty-app.tsx guards will see the correct value
  // and will NOT redirect back to /onboarding.
  useEffect(() => {
    if (authProfile?.onboarding_completed === true) {
      console.log('[Onboarding] authProfile confirmed onboarding_completed: true — ready to navigate');
      setReadyToNavigate(true);
    }
  }, [authProfile]);

  // --- Step 3: Navigate only when button was pressed AND profile is confirmed ---
  const [buttonPressed, setButtonPressed] = useState(false);

  useEffect(() => {
    if (buttonPressed && readyToNavigate && !hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      console.log('[Onboarding] Navigating to bounty-app');
      router.replace('/tabs/bounty-app');
    }
  }, [buttonPressed, readyToNavigate, router]);

  const handleContinue = async () => {
    await clearOnboardingData();

    // Refresh secondary caches (non-blocking, best effort)
    try {
      const { cachedDataService, CACHE_KEYS } = await import('../../lib/services/cached-data-service');
      const { userProfileService } = await import('../../lib/services/userProfile');
      if (userId) {
        const profile = await userProfileService.getProfile(userId);
        const completeness = await userProfileService.checkCompleteness(userId);
        await cachedDataService.setCache(CACHE_KEYS.USER_PROFILE(userId), { profile, completeness });
      }
    } catch (e) {
      // non-critical
    }

    // Signal that the button was pressed. Navigation fires in the useEffect
    // above once readyToNavigate is also true, guaranteeing AuthContext has
    // already committed onboarding_completed: true before bounty-app.tsx renders.
    setButtonPressed(true);

    // If authProfileService already updated before the button was pressed
    // (the common path), readyToNavigate is already true and navigation
    // fires on the next tick. If not (slow network), the useEffect above
    // will fire as soon as the profile update propagates.
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Branding Header — fixed at top, never pushed by content */}
      <View style={styles.brandingHeader}>
        <BrandingLogo size="medium" />
      </View>

      {/* Scrollable content area */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
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
      </ScrollView>

      {/* Continue Button — pinned to bottom, always tappable */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <Animated.View style={{ opacity: fadeAnim, width: '100%' }}>
          <TouchableOpacity
            style={[styles.continueButton, buttonPressed && !readyToNavigate && styles.continueButtonLoading]}
            onPress={handleContinue}
            disabled={buttonPressed && !readyToNavigate}
          >
            <Text style={styles.continueButtonText}>
              {buttonPressed && !readyToNavigate ? 'Almost there...' : 'Start Exploring'}
            </Text>
            {(!buttonPressed || readyToNavigate) && (
              <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
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
    gap: 6,
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
    gap: 8,
    marginBottom: 16,
  },
  continueButtonLoading: {
    opacity: 0.7,
  },
  continueButtonText: {
    color: '#052e1b',
    fontSize: 18,
    fontWeight: 'bold',
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
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
