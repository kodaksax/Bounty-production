/**
 * Onboarding Welcome
 * First screen of onboarding: logo + core trust points + role/intent pick
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useMemo, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { PosterFirstWelcome } from '../../components/onboarding/PosterFirstWelcome';
import type { ProofCardActiveItem } from '../../components/onboarding/ProofCard';
import { useAuthContext } from '../../hooks/use-auth-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { analyticsService } from '../../lib/services/analytics-service';
import { useFeatureFlag } from '../../lib/posthog';
import { useFirstScreenVariant } from '../../lib/experiments/first-screen-variant';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

// 'onboarding-skip-role-selection' PostHog experiment. Resolved once here and
// persisted onto the onboarding draft (onboarding-context.tsx) so every later
// screen reads the same value instead of re-checking the flag mid-flow. This
// is independent of the 'welcome-page-redesign' arm below (see
// lib/experiments/first-screen-variant.ts) — it only applies within the
// control (unchanged) layout.
const ROLE_SELECTION_FLAG_KEY = 'onboarding-skip-role-selection';

export default function OnboardingWelcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const { isLoggedIn, isLoading: authLoading } = useAuthContext();
  const { data: onboardingData, updateData } = useOnboarding();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const flagValue = useFeatureFlag(ROLE_SELECTION_FLAG_KEY);
  const { variant: firstScreenVariant, ready: firstScreenVariantReady } = useFirstScreenVariant();
  const isPosterFirst = firstScreenVariant === 'poster_first';

  const mountedAtRef = useRef(Date.now());
  const activeProofRef = useRef<ProofCardActiveItem>({ index: 0, proofState: 'fallback', bountyId: null });
  const [ctaStopped, setCtaStopped] = useState(false);

  // This is the PRE-AUTH entry screen: it offers "Log In" and the role CTAs.
  // Showing it to someone who already has a session tells them their account
  // doesn't exist and invites them to authenticate a second time — the exact
  // "successful sign-up sends me back to Welcome" beta failure. The gate in
  // app/onboarding/index.tsx no longer routes signed-in users here; this is a
  // backstop for every other way this route can be reached (back gesture,
  // deep link, a stale router entry, or a session that arrives while the
  // screen is already open).
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (authLoading || !isLoggedIn || redirectedRef.current) return;
    redirectedRef.current = true;
    router.replace('/onboarding');
  }, [authLoading, isLoggedIn, router]);

  useEffect(() => {
    if (isLoggedIn) return;
    analyticsService.trackEvent('onboarding_welcome_viewed');
  }, [isLoggedIn]);

  // Fade in once the arm is known — the screen renders an empty background
  // until then (see the render guard below), so starting the fade earlier
  // would burn it on a blank view.
  useEffect(() => {
    if (!firstScreenVariantReady) return;
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [firstScreenVariantReady, fadeAnim]);

  // first_screen_viewed fires once, after the variant assignment is
  // confirmed (not on the transient 'control' default guess), so every
  // impression is attributed to the arm that actually rendered.
  useEffect(() => {
    if (!firstScreenVariantReady) return;
    analyticsService.trackEvent('first_screen_viewed', { variant: firstScreenVariant });
  }, [firstScreenVariantReady, firstScreenVariant]);

  // Resolve the experiment arm exactly once per draft. A resumed draft that
  // already recorded an arm keeps it, even if the flag were to re-evaluate
  // differently on a later reload.
  useEffect(() => {
    if (onboardingData.experimentVariant !== null) return;
    if (flagValue === undefined) return;
    updateData({ experimentVariant: flagValue === 'test' ? 'test' : 'control' });
  }, [flagValue, onboardingData.experimentVariant, updateData]);

  const isTestArm = onboardingData.experimentVariant === 'test';

  const trackCtaTapped = (side: 'poster' | 'hunter' | 'login') => {
    const secondsOnScreen = (Date.now() - mountedAtRef.current) / 1000;
    analyticsService.trackEvent('first_screen_cta_tapped', {
      side,
      variant: firstScreenVariant,
      seconds_on_screen: secondsOnScreen,
      ...(isPosterFirst ? { proof_index_at_tap: activeProofRef.current.index } : {}),
    });
  };

  const handleSelectIntent = (intent: 'poster' | 'hunter') => {
    hapticFeedback.light();
    setCtaStopped(true);
    analyticsService.trackEvent('onboarding_role_selected', { role: intent });
    trackCtaTapped(intent);
    updateData({ intent });
    router.replace('/onboarding/username');
  };

  const handleGetStarted = () => {
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_role_selection_skipped');
    router.replace('/onboarding/username');
  };

  const handleLogIn = () => {
    hapticFeedback.light();
    setCtaStopped(true);
    analyticsService.trackEvent('onboarding_login_tapped');
    trackCtaTapped('login');
    router.push('/auth/sign-in-form');
  };

  // Hold the first paint until the 'welcome-page-redesign' arm is resolved, so
  // a device PostHog buckets into 'test' never sees the control screen flash
  // first. useFirstScreenVariant gives up after ~400ms, so this is bounded.
  // Signed-in (or still-resolving) visitors are redirected by the effect above
  // and must never see the pre-auth CTAs even for one frame.
  if (!firstScreenVariantReady || authLoading || isLoggedIn) {
    return <View style={styles.container} />;
  }

  if (isPosterFirst) {
    return (
      <PosterFirstWelcome
        theme={theme}
        insets={insets}
        stopped={ctaStopped}
        onProofActiveChange={item => {
          activeProofRef.current = item;
        }}
        onProofImpression={item => {
          analyticsService.trackEvent('first_screen_proof_impression', {
            bounty_id: item.bountyId ?? 'fallback',
            proof_state: item.proofState,
            index: item.index,
          });
        }}
        onPosterPress={() => handleSelectIntent('poster')}
        onHunterPress={() => handleSelectIntent('hunter')}
        onLoginPress={handleLogIn}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top * 0.3, paddingBottom: insets.bottom }]}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <BrandingLogo size="large" containerStyle={styles.logo} />

        <View style={styles.point}>
          <View style={[styles.pointIcon, { backgroundColor: theme.surface }]}>
            <MaterialIcons name="check" size={32} color="#6ee7b7" />
          </View>
          <Text style={styles.pointText}>You set the price</Text>
        </View>

        <View style={styles.point}>
          <View style={[styles.pointIcon, { backgroundColor: theme.surface }]}>
            <MaterialIcons name="lock" size={32} color="#9CA3AF" />
          </View>
          <Text style={styles.pointText}>Your money stays protected until the job&rsquo;s done</Text>
        </View>
      </Animated.View>

      <View style={styles.actionContainer}>
        {isTestArm ? (
          <TouchableOpacity
            style={[styles.hunterButton, { backgroundColor: theme.primary }]}
            onPress={handleGetStarted}
            accessibilityRole="button"
            accessibilityLabel="Get started"
          >
            <Text style={styles.hunterButtonText}>Get started</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={styles.posterButton}
              onPress={() => handleSelectIntent('poster')}
              accessibilityRole="button"
              accessibilityLabel="Get something done — post a task and hire someone nearby"
            >
              <Text style={styles.posterButtonText}>Get something done</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.hunterButton, { backgroundColor: theme.primary }]}
              onPress={() => handleSelectIntent('hunter')}
              accessibilityRole="button"
              accessibilityLabel="Start earning nearby — browse and accept paid tasks"
            >
              <Text style={styles.hunterButtonText}>Start earning nearby</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          style={styles.loginButton}
          onPress={handleLogIn}
          accessibilityRole="button"
          accessibilityLabel="Log in to an existing account"
        >
          <Text style={styles.loginButtonText}>Log In</Text>
        </TouchableOpacity>
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
    content: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingHorizontal: 40,
    },
    logo: {
      marginBottom: 64,
    },
    point: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 28,
      width: '100%',
    },
    pointIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 16,
      borderWidth: 3,
      borderColor: theme.border,
    },
    pointText: {
      flex: 1,
      fontSize: 20,
      fontWeight: '600',
      color: theme.text,
    },
    actionContainer: {
      paddingHorizontal: 24,
      paddingBottom: 40,
      gap: 12,
    },
    posterButton: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#ffffff',
      borderWidth: 2,
      borderColor: '#000000',
      paddingVertical: 16,
      borderRadius: 999,
    },
    posterButtonText: {
      color: '#000000',
      fontSize: 18,
      fontWeight: 'bold',
    },
    hunterButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      borderRadius: 999,
    },
    hunterButtonText: {
      color: '#052e1b',
      fontSize: 18,
      fontWeight: 'bold',
    },
    loginButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    loginButtonText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
