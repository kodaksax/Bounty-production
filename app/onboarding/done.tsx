/**
 * Done Onboarding Screen
 * Final step: confirm completion and navigate to app
 * Shows profile summary including skills, bio, title from onboarding
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OnboardingProgressDots } from '../../components/onboarding/OnboardingProgressDots';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { useCompleteOnboarding } from '../../hooks/useCompleteOnboarding';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

// Generic (no intent) is a 4-step flow; poster/hunter branches are 5 steps.
// See app/onboarding/username.tsx's totalStepsFor for the matching logic.
function totalStepsFor(intent: 'poster' | 'hunter' | null) {
  return intent ? 5 : 4;
}

export default function DoneScreen() {
  const insets = useSafeAreaInsets();
  const { profile: localProfile } = useUserProfile();
  const { profile: normalized } = useNormalizedProfile();
  const { data: onboardingData } = useOnboarding();
  const { complete, isLoading, hasNavigatedRef } = useCompleteOnboarding('/tabs/bounty-app');

  const displayUsername = normalized?.username || (localProfile as any)?.username;
  const displayName = onboardingData.displayName || normalized?.name || (localProfile as any)?.displayName;
  const displayTitle = onboardingData.title || normalized?.title || (localProfile as any)?.title;
  const displayBio = onboardingData.bio || normalized?.bio || (localProfile as any)?.bio;
  const displayLocation = onboardingData.location || normalized?.location || (localProfile as any)?.location;
  const displaySkills = onboardingData.skills.length > 0
    ? onboardingData.skills
    : normalized?.skills || (localProfile as any)?.skills || [];
  const hasPhone = !!onboardingData.phone || !!(normalized?._raw && (normalized as any)._raw.phone) || !!(localProfile as any)?.phone;

  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);
  const [scaleAnim] = useState(new Animated.Value(0));
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    // Animation only — no Supabase writes here.
    // All profile persistence happens in useCompleteOnboarding's complete()
    // so we can guarantee the database write completes before navigation.
    hapticFeedback.success();
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [scaleAnim, fadeAnim]);

  const handleContinue = () => {
    complete();
  };

  // If the signed in user already has onboarding_completed, avoid flashing
  // the onboarding flow: show the button loading state briefly then go in.
  useEffect(() => {
    const alreadyCompleted = !!((normalized as any)?.onboarding_completed || (localProfile as any)?.onboarding_completed);
    if (!alreadyCompleted) return;
    if (hasNavigatedRef.current) return;

    (async () => {
      // allow the button/animations to render briefly so there's no visual jump
      await new Promise((res) => setTimeout(res, 600));
      await complete();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, localProfile]);

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
              <MaterialIcons name="person" size={18} color={theme.textSecondary} />
              <Text style={styles.summaryLabel}>Username</Text>
              <Text style={styles.summaryValue}>@{displayUsername}</Text>
            </View>

            {displayName && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="badge" size={18} color="#9CA3AF" />
                <Text style={styles.summaryLabel}>Name</Text>
                <Text style={styles.summaryValue}>{displayName}</Text>
              </View>
            )}

            {displayTitle && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="work" size={18} color="#9CA3AF" />
                <Text style={styles.summaryLabel}>Title</Text>
                <Text style={styles.summaryValue}>{displayTitle}</Text>
              </View>
            )}

            {displayLocation && (
              <View style={styles.summaryItem}>
                <MaterialIcons name="location-on" size={18} color="#9CA3AF" />
                <Text style={styles.summaryLabel}>Location</Text>
                <Text style={styles.summaryValue}>{displayLocation}</Text>
              </View>
            )}

            {displayBio && (
              <View style={styles.summaryItemColumn}>
                <View style={styles.summaryItemRow}>
                  <MaterialIcons name="info-outline" size={18} color="#9CA3AF" />
                  <Text style={styles.summaryLabel}>Bio</Text>
                </View>
                <Text style={styles.summaryBio}>{displayBio}</Text>
              </View>
            )}

            {displaySkills.length > 0 && (
              <View style={styles.summaryItemColumn}>
                <View style={styles.summaryItemRow}>
                  <MaterialIcons name="star" size={18} color="#9CA3AF" />
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
                <MaterialIcons name="phone" size={18} color="#9CA3AF" />
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
            onPress={() => {
              hapticFeedback.light();
              handleContinue();
            }}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Start exploring"
            accessibilityState={{ disabled: isLoading, busy: isLoading }}
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

        <OnboardingProgressDots
          total={totalStepsFor(onboardingData.intent)}
          activeIndex={totalStepsFor(onboardingData.intent) - 1}
          style={styles.progressContainer}
        />
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
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
      backgroundColor: theme.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: theme.textSecondary,
      marginBottom: 24,
    },
    summaryCard: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
      width: '100%',
      borderWidth: 2,
      borderColor: theme.border,
      marginBottom: 16,
    },
    summaryTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textSecondary,
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
      color: theme.textSecondary,
      fontSize: 13,
      marginLeft: 8,
      minWidth: 70,
    },
    summaryValue: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '500',
      flex: 1,
    },
    summaryBio: {
      color: theme.textSecondary,
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
      backgroundColor: theme.surfaceSecondary,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 12,
    },
    skillBadgeText: {
      color: theme.textSecondary,
      fontSize: 11,
      fontWeight: '500',
    },
    moreSkills: {
      color: theme.textSecondary,
      fontSize: 11,
      alignSelf: 'center',
    },
    infoText: {
      color: theme.textSecondary,
      fontSize: 13,
      textAlign: 'center',
      lineHeight: 18,
    },
    bottomBar: {
      paddingHorizontal: 24,
      paddingTop: 12,
      backgroundColor: theme.background,
    },
    continueButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: 16,
      borderRadius: 999,
      gap: 8,
      marginBottom: 16,
    },
    continueButtonText: {
      color: '#052e1b',
      fontSize: 18,
      fontWeight: 'bold',
    },
    progressContainer: {
      paddingBottom: 4,
    },
  });
}
