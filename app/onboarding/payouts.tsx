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
 * lives in app/wallet/connect/embedded-onboarding.tsx. Both CTAs push that
 * same screen: Stripe's hosted onboarding already offers "sign in to an
 * existing account" inside the flow, so "Link Existing Account" is the same
 * route with a different entry intent (carried for analytics, and so the
 * screen can label itself correctly later) rather than a second, parallel
 * implementation we'd have to keep in sync.
 *
 * `returnTo` is what makes Connect onboarding reusable here: the onboarding
 * screen normally pops back to whatever pushed it (Wallet, Withdraw, …), which
 * inside a signup funnel would dump the user back on this step forever. With
 * `returnTo` it replaces itself with the next funnel step instead, so finishing
 * — or backing out of — Stripe continues the flow either way.
 *
 * Forced dark, like welcome/role-select: same "getting started" funnel.
 */

import { type Href, useRouter } from 'expo-router';
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
import { darkTheme } from '../../lib/themes/darkTheme';

const NEXT_STEP: Href = '/onboarding/founder-note';

export default function PayoutsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: onboardingData } = useOnboarding();
  const [country, setCountry] = useState<PayoutCountry>(DEFAULT_PAYOUT_COUNTRY);
  // Set once a CTA has navigated, so a second tap during the push transition
  // can't stack two copies of the Connect screen.
  const [busy, setBusy] = useState(false);

  const startConnect = useCallback(
    (mode: 'create' | 'link') => {
      if (busy) return;
      setBusy(true);
      hapticFeedback.light();
      analyticsService.trackEvent('payout_setup_started', {
        surface: 'onboarding',
        role: onboardingData.intent ?? 'unknown',
        mode,
        country: country.code,
      });
      router.push({
        pathname: '/wallet/connect/embedded-onboarding',
        params: {
          country: country.code,
          mode,
          source: 'onboarding',
          returnTo: NEXT_STEP as string,
        },
      } as Href);
    },
    [busy, country.code, onboardingData.intent, router]
  );

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
      theme={darkTheme}
      insets={insets}
      country={country}
      onChangeCountry={setCountry}
      onCreateAccount={() => startConnect('create')}
      onLinkExisting={() => startConnect('link')}
      onSkip={handleSkip}
      onBack={router.canGoBack() ? handleBack : undefined}
      busy={busy}
    />
  );
}
