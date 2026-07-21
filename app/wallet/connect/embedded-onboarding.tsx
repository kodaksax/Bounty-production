/**
 * Stripe Connect onboarding screen (mobile-native in-app flow).
 *
 * Apple's ASWebAuthenticationSession (iOS) and Android's Chrome Custom Tabs
 * are the platform-sanctioned way to present a third-party onboarding /
 * authentication flow without taking the user out of the app:
 *
 *   - They render over the app and dismiss back to it automatically when
 *     the hosted flow redirects to a registered deep link / universal link.
 *   - They share the system's browser engine (WKWebView on iOS, Chrome on
 *     Android), so every page feature Stripe relies on works — including
 *     `window.open`, cross-origin `postMessage`, storage for `m.stripe.network`,
 *     Stripe Identity document capture, Apple/Google autofill, and SMS
 *     one-time-code autofill. These are the exact invariants that break
 *     inside a nested `react-native-webview`.
 *   - Both Apple and Google explicitly treat these as "in-app" presentations
 *     for App Store / Play review purposes.
 *
 * We combine that with Stripe's hosted Express Account Link (the
 * `POST /connect/create-account-link` edge route we already ship), whose
 * `return_url` is our universal link `https://bountyfinder.app/wallet/connect/return`.
 * Stripe redirects to it on completion, the OS auto-dismisses the session,
 * and we refresh onboarding state via `/connect/verify-onboarding` — the
 * `account.updated` webhook remains authoritative.
 *
 * Once status is reconciled, we show an explicit outcome screen (success /
 * pending / action-required / cancelled / couldn't-verify) via
 * ConnectOnboardingResult and wait for the user to acknowledge it before
 * dismissing — rather than silently popping the stack the instant the
 * "Finalizing…" spinner finishes, which gave no feedback either way.
 *
 * The screen is reached via `router.push('/wallet/connect/embedded-onboarding')`
 * from `ConnectOnboardingButton`, the withdraw flows, etc. — keeping the
 * route stable so existing callers don't change. Because it's a plain stack
 * push, `router.back()` on dismissal always returns the user to whichever
 * screen launched onboarding (Wallet, Withdraw, Settings, …) with the
 * navigation stack otherwise untouched.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ConnectOnboardingResult,
  type ConnectOnboardingOutcome,
} from '../../../components/ui/connect-onboarding-result';
import { useFadeAnimation } from '../../../hooks/use-accessible-animation';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { API_BASE_URL } from '../../../lib/config/api';
import { CONNECT_REFRESH_URL, CONNECT_RETURN_URL } from '../../../lib/config/app';
import { analyticsService } from '../../../lib/services/analytics-service';
import { authProfileService } from '../../../lib/services/auth-profile-service';
import { supabase } from '../../../lib/supabase';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';
import { useWallet } from '../../../lib/wallet-context';

type Phase = 'starting' | 'in_browser' | 'finalizing' | 'result' | 'error';
type BrowserResultType = 'success' | 'cancel' | 'dismiss' | 'opened' | 'locked' | null;

interface VerifyOnboardingResponse {
  onboarded?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  requirementsCurrentlyDue?: string[];
  disabledReason?: string | null;
}

// Stripe's own truth (charges_enabled && payouts_enabled) always wins, even
// over a "cancelled" browser result — covers the case where the account was
// already fully onboarded (e.g. a webhook landed between sessions) and the
// user just closed a redundant onboarding screen.
function deriveOutcome(args: {
  browserResultType: BrowserResultType;
  onboarded: boolean;
  detailsSubmitted: boolean;
  currentlyDue: string[];
}): ConnectOnboardingOutcome {
  if (args.onboarded) return 'success';
  if (args.browserResultType !== 'success') return 'cancelled';
  if (args.currentlyDue.length > 0) return 'action_required';
  if (args.detailsSubmitted) return 'pending';
  return 'action_required';
}

const VERIFY_TIMEOUT_MS = 15000;

export default function ConnectOnboardingScreen() {
  const router = useRouter();
  const { session, isLoading: authLoading } = useAuthContext();
  const { theme } = useAppThemeContext();
  const { refreshFromApi } = useWallet();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { fadeOut, style: fadeStyle } = useFadeAnimation(1);

  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ConnectOnboardingOutcome | null>(null);
  const [requirementsCurrentlyDue, setRequirementsCurrentlyDue] = useState<string[]>([]);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);

  // Guard against React strict-mode / re-focus double-invocations.
  const launchedRef = useRef(false);
  // Prevents overlapping verify-onboarding calls (e.g. a manual Retry
  // pressed while the auto-triggered check is still in flight).
  const verifyingRef = useRef(false);
  // Remembers the last browser session result so a manual "Retry" (which
  // doesn't reopen the browser) still derives the outcome consistently.
  const lastBrowserResultRef = useRef<BrowserResultType>(null);

  // Best-effort refresh of everything the completion state can affect —
  // wallet balance/transactions and the cached auth profile — run in
  // parallel with the verify-onboarding call so it doesn't add latency to
  // the "Finalizing…" screen.
  const refreshAncillaryState = useCallback(
    async (token: string) => {
      await Promise.allSettled([refreshFromApi(token), authProfileService.refreshProfile()]);
    },
    [refreshFromApi]
  );

  const verifyOnboardingStatus = useCallback(
    async (browserResultType: BrowserResultType) => {
      if (verifyingRef.current) return;
      verifyingRef.current = true;
      lastBrowserResultRef.current = browserResultType;

      const token = session?.access_token;
      if (!token) {
        verifyingRef.current = false;
        setOutcome('verify_error');
        setPhase('result');
        return;
      }

      setPhase('finalizing');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

      try {
        const [verifyResult] = await Promise.allSettled([
          fetch(`${API_BASE_URL}/connect/verify-onboarding`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
          }),
          refreshAncillaryState(token),
        ]);

        if (verifyResult.status !== 'fulfilled' || !verifyResult.value.ok) {
          throw new Error('verify-onboarding request failed');
        }

        const body = (await verifyResult.value.json()) as VerifyOnboardingResponse;

        if (body?.onboarded) {
          try {
            await analyticsService.trackEvent('identity_verified', {
              source: 'stripe_connect_onboarding',
              chargesEnabled: !!body.chargesEnabled,
              payoutsEnabled: !!body.payoutsEnabled,
            });
          } catch {
            /* analytics is best-effort */
          }
        }

        const currentlyDue = body.requirementsCurrentlyDue ?? [];
        setRequirementsCurrentlyDue(currentlyDue);
        setDisabledReason(body.disabledReason ?? null);
        setOutcome(
          deriveOutcome({
            browserResultType,
            onboarded: !!body.onboarded,
            detailsSubmitted: !!body.detailsSubmitted,
            currentlyDue,
          })
        );
      } catch (err) {
        console.warn('[connect-onboarding] verify-onboarding failed', err);
        setOutcome('verify_error');
      } finally {
        clearTimeout(timeoutId);
        verifyingRef.current = false;
        setPhase('result');
      }
    },
    [session?.access_token, refreshAncillaryState]
  );

  const launchOnboarding = useCallback(async () => {
    const token = session?.access_token;
    if (!token) {
      setError('You must be signed in to set up payouts.');
      setPhase('error');
      return;
    }

    try {
      setError(null);
      setPhase('starting');

      // 1. Ask our edge function for a fresh, short-lived Stripe Account Link.
      const linkRes = await fetch(`${API_BASE_URL}/connect/create-account-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: 'account_onboarding',
          returnUrl: CONNECT_RETURN_URL,
          refreshUrl: CONNECT_REFRESH_URL,
        }),
      });

      if (!linkRes.ok) {
        let message = `Couldn't start Stripe onboarding (${linkRes.status}).`;
        try {
          const body = (await linkRes.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* non-JSON error body — keep the default message */
        }
        throw new Error(message);
      }

      const { url } = (await linkRes.json()) as { url?: string };
      if (!url || typeof url !== 'string') {
        throw new Error("Stripe didn't return an onboarding URL. Please try again.");
      }

      // 2. Present the hosted onboarding in an ASWebAuthenticationSession /
      //    Chrome Custom Tab. The OS dismisses automatically when Stripe
      //    redirects to our universal link.
      setPhase('in_browser');
      const result = await WebBrowser.openAuthSessionAsync(url, CONNECT_RETURN_URL, {
        // Sharing cookies gives users a smoother flow if they've already
        // authenticated with Stripe or their bank in Safari/Chrome.
        preferEphemeralSession: false,
      });

      // Track the funnel step regardless of final verification outcome —
      // reaching the return URL means the user submitted identity/KYC info.
      const userId = session?.user?.id;
      if (userId && result.type === 'success') {
        try {
          await analyticsService.trackEvent('identity_submitted', {
            source: 'stripe_connect_onboarding',
          });
        } catch {
          /* analytics is best-effort */
        }
        try {
          await supabase.from('profiles').update({ stripe_connect_onboarding_complete: true }).eq('id', userId);
        } catch (err) {
          console.warn('[connect-onboarding] optimistic update failed', err);
        }
      }

      // 3. Regardless of whether the user completed or cancelled, reconcile
      //    state with Stripe. The webhook is authoritative but this gives
      //    the UI an immediate, correct answer.
      await verifyOnboardingStatus(result.type);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong starting Stripe onboarding. Please try again.';
      console.warn('[connect-onboarding] launch failed', err);
      setError(message);
      setPhase('error');
    }
  }, [session?.access_token, session?.user?.id, verifyOnboardingStatus]);

  useEffect(() => {
    if (authLoading) return;
    if (launchedRef.current) return;
    launchedRef.current = true;
    launchOnboarding();
  }, [authLoading, launchOnboarding]);

  const handleRetry = useCallback(() => {
    launchOnboarding();
  }, [launchOnboarding]);

  const handleRetryVerify = useCallback(() => {
    verifyOnboardingStatus(lastBrowserResultRef.current);
  }, [verifyOnboardingStatus]);

  // Single dismissal path for every "leave this screen" action (X button,
  // Done, Go to Wallet, Maybe Later, the pre-launch error's Back to wallet).
  // Fades the content out first so the pop doesn't feel abrupt, then pops
  // the stack — which naturally returns to whatever screen launched
  // onboarding, with no route reset needed.
  const dismiss = useCallback(async () => {
    // fadeOut already collapses to an instant, 0-duration transition when
    // the user has Reduce Motion enabled (see useAccessibleAnimation).
    await fadeOut(180);
    router.back();
  }, [fadeOut, router]);

  if (authLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!session?.access_token) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Please sign in</Text>
          <Text style={styles.muted}>You must be signed in to set up payouts.</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={dismiss}>
            <Text style={styles.secondaryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const title =
    phase === 'error'
      ? 'Onboarding unavailable'
      : phase === 'finalizing'
        ? 'Finalizing…'
        : phase === 'in_browser'
          ? 'Complete onboarding'
          : 'Set up payouts';

  const message =
    phase === 'error'
      ? (error ?? 'Something went wrong starting Stripe onboarding. Please try again.')
      : phase === 'finalizing'
        ? "We're refreshing your account status. This takes a moment."
        : phase === 'in_browser'
          ? "Complete the Stripe onboarding in the secure browser window. You'll return here automatically when you're done."
          : "Opening Stripe's secure onboarding…";

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <Animated.View style={[styles.flexFill, fadeStyle]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.closeBtn}
          >
            <MaterialIcons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Set up payouts</Text>
          <View style={{ width: 24 }} />
        </View>

        {phase === 'result' && outcome ? (
          <ConnectOnboardingResult
            outcome={outcome}
            currentlyDue={requirementsCurrentlyDue}
            disabledReason={disabledReason}
            onDone={dismiss}
            onGoToWallet={dismiss}
            onContinueVerification={handleRetry}
            onContinueSetup={handleRetry}
            onMaybeLater={dismiss}
            onRetryVerify={handleRetryVerify}
          />
        ) : (
          <View style={styles.body}>
            {phase === 'error' ? (
              <View style={styles.iconBadgeError}>
                <MaterialIcons name="error-outline" size={40} color="#ef4444" />
              </View>
            ) : (
              <ActivityIndicator size="large" color={theme.primary} />
            )}
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>

            {phase === 'error' ? (
              <>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>
                  <MaterialIcons name="refresh" size={20} color="#ffffff" />
                  <Text style={styles.primaryBtnText}>Try again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={dismiss}>
                  <Text style={styles.secondaryBtnText}>Back to wallet</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    flexFill: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
      backgroundColor: t.surface,
    },
    headerTitle: { color: t.text, fontSize: 17, fontWeight: '600' },
    closeBtn: { padding: 4 },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    title: {
      marginTop: 20,
      fontSize: 20,
      fontWeight: '700',
      color: t.text,
      textAlign: 'center',
    },
    message: {
      marginTop: 8,
      fontSize: 14,
      lineHeight: 20,
      color: t.textSecondary,
      textAlign: 'center',
      maxWidth: 320,
    },
    iconBadgeError: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: 'rgba(239,68,68,0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtn: {
      marginTop: 24,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.primary,
      paddingVertical: 12,
      paddingHorizontal: 28,
      borderRadius: 999,
    },
    primaryBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
    secondaryBtn: {
      marginTop: 12,
      paddingVertical: 10,
      paddingHorizontal: 20,
    },
    secondaryBtnText: { color: t.textSecondary, fontSize: 14, fontWeight: '500' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    errorTitle: { color: t.text, fontSize: 18, fontWeight: '600' },
    muted: { color: t.textSecondary, marginTop: 8, fontSize: 14, textAlign: 'center' },
  });
}
