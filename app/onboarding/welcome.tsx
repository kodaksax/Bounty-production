/**
 * Onboarding Welcome
 * First screen of onboarding: logo + social proof + role/intent pick.
 *
 * This used to A/B this screen's whole layout ('control' vs 'poster_first',
 * PostHog flag 'welcome-page-redesign') and, within the control layout,
 * whether role selection was shown upfront at all ('onboarding-skip-role-selection').
 * Both flags were resolved to a single winner and the losing branches were
 * deleted 2026-08-24:
 *   - 'welcome-page-redesign' was rolled out to 100% test / 0% control in
 *     PostHog — poster_first (this screen) is the only design real traffic
 *     could reach.
 *   - 'onboarding-skip-role-selection' was disabled (flag inactive) — the
 *     "skip role selection" arm was already unreachable.
 * Keeping the flag reads around them created a real bug: the assigned arm
 * was cached per-device (module state + AsyncStorage) and was never cleared
 * on account deletion, so a deleted-and-recreated account on the same
 * device replayed whatever arm its predecessor got instead of landing on
 * the current design.
 */

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PosterFirstWelcome } from '../../components/onboarding/PosterFirstWelcome';
import type { ProofCardActiveItem } from '../../components/onboarding/ProofCard';
import { useAuthContext } from '../../hooks/use-auth-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { analyticsService } from '../../lib/services/analytics-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

export default function OnboardingWelcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const { isLoggedIn, isLoading: authLoading } = useAuthContext();
  const { updateData } = useOnboarding();

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
    analyticsService.trackEvent('first_screen_viewed', { variant: 'poster_first' });
  }, [isLoggedIn]);

  const trackCtaTapped = (side: 'poster' | 'hunter' | 'login') => {
    const secondsOnScreen = (Date.now() - mountedAtRef.current) / 1000;
    analyticsService.trackEvent('first_screen_cta_tapped', {
      side,
      variant: 'poster_first',
      seconds_on_screen: secondsOnScreen,
      proof_index_at_tap: activeProofRef.current.index,
    });
  };

  const handleSelectIntent = (intent: 'poster' | 'hunter') => {
    hapticFeedback.light();
    setCtaStopped(true);
    analyticsService.trackEvent('role_selected', { role: intent, surface: 'onboarding' });
    trackCtaTapped(intent);
    updateData({ intent });
    router.replace('/onboarding/username');
  };

  const handleLogIn = () => {
    hapticFeedback.light();
    setCtaStopped(true);
    analyticsService.trackEvent('onboarding_login_tapped');
    trackCtaTapped('login');
    router.push('/auth/sign-in-form');
  };

  // Signed-in (or still-resolving) visitors are redirected by the effect
  // above and must never see the pre-auth CTAs even for one frame.
  if (authLoading || isLoggedIn) {
    return <View style={[styles.container, { backgroundColor: theme.background }]} />;
  }

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
