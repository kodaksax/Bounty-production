/**
 * Onboarding Welcome
 * Pre-auth entry screen: a self-rotating four-slide stage (not swipeable —
 * it advances on a timer) above a fixed Sign Up / Log In footer
 * (components/onboarding/WelcomeCarousel.tsx). Role
 * (poster vs. hunter) is picked on its own screen after auth — see that
 * component's top comment for why.
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

import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WelcomeCarousel } from '../../components/onboarding/WelcomeCarousel';
import type { WelcomeCarouselSlide } from '../../lib/strings/welcomeCarousel';
import { useAuthContext } from '../../hooks/use-auth-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';


export default function OnboardingWelcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Follows the app's light/dark preference like every other step. This screen
  // was pinned to darkTheme for its carousel art; the carousel takes every
  // colour from the theme it's handed (see WelcomeCarousel.tsx), so it renders
  // correctly in either mode and a light-mode visitor is no longer flipped to
  // dark for the first three screens of the funnel.
  const { theme } = useAppThemeContext();
  const { isLoggedIn, isLoading: authLoading } = useAuthContext();

  const mountedAtRef = useRef(Date.now());

  // This is the PRE-AUTH entry screen: it offers "Sign Up" and "Log In".
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
    analyticsService.trackEvent('first_screen_viewed', { variant: 'carousel' });
  }, [isLoggedIn]);

  const trackCtaTapped = (side: 'signup' | 'login') => {
    const secondsOnScreen = (Date.now() - mountedAtRef.current) / 1000;
    analyticsService.trackEvent('first_screen_cta_tapped', {
      side,
      variant: 'carousel',
      seconds_on_screen: secondsOnScreen,
    });
  };

  // Role (poster vs. hunter) is no longer asked on this screen — it's picked
  // on its own screen after auth. Sign Up is role-agnostic: onboarding-context
  // already supports intent === null (see lib/context/onboarding-context.tsx
  // and app/onboarding/username.tsx's "generic, no intent picked" 4-step path).
  const handleSignUp = () => {
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_signup_tapped');
    trackCtaTapped('signup');
    router.push('/auth/sign-up-form');
  };

  const handleLogIn = () => {
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_login_tapped');
    trackCtaTapped('login');
    router.push('/auth/sign-in-form');
  };

  const handleHowItWorks = () => {
    hapticFeedback.light();
    analyticsService.trackEvent('first_screen_how_it_works_tapped', { variant: 'carousel' });
    router.push('/legal/how-it-works' as Href);
  };

  // Signed-in (or still-resolving) visitors are redirected by the effect
  // above and must never see the pre-auth CTAs even for one frame.
  if (authLoading || isLoggedIn) {
    return <View style={[styles.container, { backgroundColor: theme.background }]} />;
  }

  return (
    <WelcomeCarousel
      theme={theme}
      insets={insets}
      onSignUpPress={handleSignUp}
      onLoginPress={handleLogIn}
      onHowItWorksPress={handleHowItWorks}
      onSlideChange={(slide: WelcomeCarouselSlide, index: number) => {
        analyticsService.trackEvent('first_screen_carousel_slide_viewed', {
          slide: slide.key,
          index,
        });
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
