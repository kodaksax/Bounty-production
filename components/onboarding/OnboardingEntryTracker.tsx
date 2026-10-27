/**
 * Emits onboarding_started / onboarding_resumed once per mount of the
 * onboarding route group — see lib/analytics/onboarding-entry.ts for the
 * contract. Rendered by app/onboarding/_layout.tsx, inside OnboardingProvider,
 * because the layout is the one boundary every entry path crosses: the root
 * gate's first-time route to welcome, sign-up's route to style, and the
 * /onboarding gate's resume routes.
 */

import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useAuthContext } from '../../hooks/use-auth-context';
import { onboardingStepFromPath, trackOnboardingEntry } from '../../lib/analytics/onboarding-entry';
import { useOnboarding } from '../../lib/context/onboarding-context';

export function OnboardingEntryTracker() {
  const pathname = usePathname();
  const { session, isLoading: authLoading } = useAuthContext();
  const { data: onboardingData, loading: onboardingLoading } = useOnboarding();
  const trackedRef = useRef(false);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    // Wait for auth and the draft so `authenticated` and `intent` describe the
    // user, not a loading state.
    if (trackedRef.current || authLoading || onboardingLoading) return;
    const step = onboardingStepFromPath(pathname);
    if (!step) return;
    // Welcome is the pre-auth entry. A signed-in user who lands there is sent
    // straight back to the gate (welcome.tsx), so count them where they arrive.
    if (step === 'welcome' && userId) return;
    trackedRef.current = true;
    void trackOnboardingEntry({ step, userId, intent: onboardingData.intent ?? null });
  }, [pathname, authLoading, onboardingLoading, userId, onboardingData.intent]);

  return null;
}
