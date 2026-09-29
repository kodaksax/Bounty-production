/**
 * Onboarding Payouts
 * The last step that asks for anything, immediately after role selection
 * (app/onboarding/role-select.tsx) and before the founder note
 * (app/onboarding/founder-note.tsx), which closes the flow. Both intents land here —
 * "Make today pay." and "I'd rather earn" alike — because a poster's refunds
 * and a hunter's earnings both leave the wallet through the same Stripe
 * Connect account.
 *
 * This file owns state + navigation only; the UI lives in
 * components/onboarding/PayoutSetupScreen.tsx and the actual Connect flow
 * lives in app/wallet/connect/embedded-onboarding.tsx. There is one CTA, not
 * a create/link pair: the connect function creates a new Express account
 * whenever the profile has none, so a "Link Existing Account" button pushing
 * the same route would still have created one. Linking a pre-existing Stripe
 * account needs its own OAuth flow; until that exists, don't offer it.
 *
 * `returnTo` is what makes Connect onboarding reusable here: the onboarding
 * screen normally pops back to whatever pushed it (Wallet, Withdraw, …), which
 * inside a signup funnel would dump the user back on this step forever. With
 * `returnTo` it replaces itself with the next funnel step instead, so finishing
 * — or backing out of — Stripe continues the flow either way.
 *
 * Theme-aware like every other step: the theme handed to PayoutSetupScreen
 * comes from useAppThemeContext(), not a pinned darkTheme.
 */

import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PayoutSetupScreen } from '../../components/onboarding/PayoutSetupScreen';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import {
    DEFAULT_PAYOUT_COUNTRY,
    type PayoutCountry,
} from '../../lib/strings/payoutSetup';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

const NEXT_STEP: Href = '/onboarding/founder-note';

export default function PayoutsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const { data: onboardingData } = useOnboarding();
  const [country, setCountry] = useState<PayoutCountry>(DEFAULT_PAYOUT_COUNTRY);
  // Set once a CTA has navigated, so a second tap during the push transition
  // can't stack two copies of the Connect screen.
  const [busy, setBusy] = useState(false);

  // The Connect screen normally leaves via replace(returnTo), but if it is
  // ever popped back to this step instead, the CTA must not stay locked.
  useFocusEffect(
    useCallback(() => {
      setBusy(false);
    }, [])
  );

  const startConnect = useCallback(() => {
    if (busy) return;
    setBusy(true);
    hapticFeedback.light();
    analyticsService.trackEvent('payout_setup_started', {
      surface: 'onboarding',
      role: onboardingData.intent ?? 'unknown',
      country: country.code,
    });
    router.push({
      pathname: '/wallet/connect/embedded-onboarding',
      params: {
        country: country.code,
        source: 'onboarding',
        returnTo: NEXT_STEP as string,
      },
    } as Href);
  }, [busy, country.code, onboardingData.intent, router]);

  const handleSkip = useCallback(() => {
    hapticFeedback.light();
    analyticsService.trackEvent('payout_setup_skipped', {
      surface: 'onboarding',
      role: onboardingData.intent ?? 'unknown',
    });
    router.push(NEXT_STEP);
  }, [onboardingData.intent, router]);

  const handleBack = useCallback(() => {
    hapticFeedback.light();
    router.back();
  }, [router]);

  return (
    <PayoutSetupScreen
      theme={theme}
      insets={insets}
      country={country}
      onChangeCountry={setCountry}
      onCreateAccount={startConnect}
      onSkip={handleSkip}
      onBack={router.canGoBack() ? handleBack : undefined}
      busy={busy}
    />
  );
}
