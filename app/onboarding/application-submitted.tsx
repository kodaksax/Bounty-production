/**
 * Application Submitted Onboarding Screen
 * Terminal step for the hunter branch only: celebrates the user's first
 * bounty application and teaches them where to track it (Applications,
 * Activity, Messages) before dismissing into the main app.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfettiAnimation, SuccessAnimation } from '../../components/ui/success-animation';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { useBackHandler } from '../../hooks/useBackHandler';
import { useCompleteOnboarding } from '../../hooks/useCompleteOnboarding';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { ROUTES } from '../../lib/routes';
import { analyticsService } from '../../lib/services/analytics-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export default function ApplicationSubmittedScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);
  const { data: onboardingData } = useOnboarding();
  const { complete, isLoading } = useCompleteOnboarding(ROUTES.TABS.BOUNTY_APP);

  const [showSuccess, setShowSuccess] = useState(true);
  const [showConfetti, setShowConfetti] = useState(true);
  const [fadeAnim] = useState(new Animated.Value(0));

  // Point-of-no-return screen: the application already exists, so the only
  // way forward is a CTA that finishes onboarding. Block Android hardware
  // back to prevent looping back into the sample-bounty screen (see
  // gestureEnabled: false on this screen's Stack.Screen entry for the iOS
  // swipe-back side).
  useBackHandler(() => true);

  useEffect(() => {
    analyticsService.trackEvent('onboarding_application_submitted_screen_shown', {
      bountyId: onboardingData.firstAppliedBountyId ?? undefined,
    });
    // Only fire once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAnimationComplete = () => {
    setShowSuccess(false);
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  };

  const handlePrimaryCta = () => {
    hapticFeedback.light();
    complete();
  };

  const goToApplications = () => {
    hapticFeedback.light();
    complete({
      pathname: ROUTES.TABS.BOUNTY_APP,
      params: { screen: 'postings', initialTab: 'inProgress' },
    });
  };

  const goToActivity = () => {
    hapticFeedback.light();
    complete({
      pathname: ROUTES.TABS.BOUNTY_APP,
      params: { screen: 'postings', initialTab: 'inProgress' },
    });
  };

  const goToMessages = () => {
    hapticFeedback.light();
    complete({
      pathname: ROUTES.TABS.BOUNTY_APP,
      params: { screen: 'messages' },
    });
  };

  const goBrowseMore = () => {
    hapticFeedback.light();
    complete({
      pathname: ROUTES.TABS.BOUNTY_APP,
      params: { screen: 'bounty' },
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.brandingHeader}>
        <BrandingLogo size="medium" />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, width: '100%', alignItems: 'center' }}>
          <View style={styles.checkCircle}>
            <MaterialIcons name="check" size={56} color="#052e1b" />
          </View>

          <Text style={styles.headline}>
            🎉 Congratulations! Your application has been submitted.
          </Text>
          <Text style={styles.supporting}>
            The poster has received your application and will review it soon.
            You{"'"}ll be notified if you{"'"}re selected — you can check your
            application status anytime from the Applications tab.
          </Text>

          <Text style={styles.sectionTitle}>What&apos;s Next?</Text>

          <TouchableOpacity
            style={styles.card}
            onPress={goToApplications}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Go to Applications"
          >
            <View style={styles.cardIcon}>
              <MaterialIcons name="assignment-turned-in" size={22} color={theme.primary} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Applications</Text>
              <Text style={styles.cardBody}>
                View the bounties you{"'"}ve applied to, monitor their status,
                and know right away when you{"'"}re accepted or declined.
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.card}
            onPress={goToActivity}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Go to Activity"
          >
            <View style={styles.cardIcon}>
              <MaterialIcons name="trending-up" size={22} color={theme.primary} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Activity</Text>
              <Text style={styles.cardBody}>
                Track your active jobs, see what you{"'"}ve completed, and
                keep a running history of the bounties you{"'"}ve earned.
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.card}
            onPress={goToMessages}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Go to Messages"
          >
            <View style={styles.cardIcon}>
              <MaterialIcons name="chat-bubble-outline" size={22} color={theme.primary} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Messages</Text>
              <Text style={styles.cardBody}>
                Talk directly with posters, respond quickly if you{"'"}re
                selected, and stay on top of updates about your work.
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <Animated.View style={{ opacity: fadeAnim, width: '100%' }}>
          <TouchableOpacity
            style={[styles.primaryButton, isLoading ? { opacity: 0.8 } : {}]}
            onPress={handlePrimaryCta}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Start exploring Bounty"
            accessibilityState={{ disabled: isLoading, busy: isLoading }}
          >
            <Text style={styles.primaryButtonText}>Start Exploring Bounty</Text>
            <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryLink}
            onPress={goBrowseMore}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Browse more bounties"
          >
            <Text style={styles.secondaryLinkText}>Browse More Bounties</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      <SuccessAnimation
        visible={showSuccess}
        icon="check-circle"
        size={80}
        color={theme.primary}
        onComplete={handleAnimationComplete}
      />
      <ConfettiAnimation visible={showConfetti} onComplete={() => setShowConfetti(false)} />
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
      paddingTop: 8,
      paddingBottom: 24,
    },
    checkCircle: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: theme.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 20,
    },
    headline: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.text,
      textAlign: 'center',
      marginBottom: 12,
    },
    supporting: {
      fontSize: 15,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 21,
      marginBottom: 28,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.text,
      alignSelf: 'flex-start',
      marginBottom: 12,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
      width: '100%',
      borderWidth: 2,
      borderColor: theme.border,
      marginBottom: 12,
      gap: 12,
    },
    cardIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cardText: {
      flex: 1,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 4,
    },
    cardBody: {
      fontSize: 13,
      color: theme.textSecondary,
      lineHeight: 18,
    },
    bottomBar: {
      paddingHorizontal: 24,
      paddingTop: 12,
      backgroundColor: theme.background,
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: 16,
      borderRadius: 999,
      gap: 8,
    },
    primaryButtonText: {
      color: '#052e1b',
      fontSize: 18,
      fontWeight: 'bold',
    },
    secondaryLink: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
    },
    secondaryLinkText: {
      color: theme.primary,
      fontSize: 14,
      fontWeight: '600',
    },
  });
}
