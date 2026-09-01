/**
 * Stripe Connect onboarding screen — embedded onboarding.
 *
 * Follows https://docs.stripe.com/connect/embedded-onboarding using Stripe's
 * official React Native bindings, so the connected account completes KYC
 * inside our own app instead of on a Stripe-hosted page:
 *
 *   1. `POST /connect/create-account-session` mints an Account Session with
 *      `components.account_onboarding` enabled (creating the Express account
 *      on first run) and returns its `client_secret` + publishable key.
 *   2. `loadConnectAndInitialize` builds a Connect instance whose
 *      `fetchClientSecret` re-mints a session on demand — Stripe calls it
 *      again whenever the session expires, which a long KYC flow (document
 *      upload, bank details) can easily outlive.
 *   3. `<ConnectAccountOnboarding />` presents Stripe's account-onboarding
 *      component as a full-screen modal, themed with our appearance
 *      variables. Stripe owns the auth WebView it needs for Express accounts.
 *
 * Completion signal: `onExit` fires when the account owner finishes or leaves
 * the flow, and Stripe's own truth is the arbiter from there — we call
 * `/connect/verify-onboarding` and derive the outcome from charges_enabled /
 * payouts_enabled / details_submitted / requirements.currently_due, then show
 * it via ConnectOnboardingResult and wait for the user to acknowledge. The
 * `account.updated` webhook remains authoritative for the profile columns
 * (the client cannot write them — the profile guard trigger rejects it).
 *
 * Browser fallback: if the embedded component can't load (`onLoadError`), the
 * error screen offers the hosted Account Link in an ASWebAuthenticationSession
 * (iOS) / Chrome Custom Tab (Android) so a hunter is never locked out of
 * getting paid.
 *
 * The screen is reached via `router.push('/wallet/connect/embedded-onboarding')`
 * from `ConnectOnboardingButton`, the withdraw flows, etc. — keeping the
 * route stable so existing callers don't change. Because it's a plain stack
 * push, `router.back()` on dismissal always returns the user to whichever
 * screen launched onboarding (Wallet, Withdraw, Settings, …) with the
 * navigation stack otherwise untouched.
 */

import { MaterialIcons } from '@expo/vector-icons';
import {
    ConnectAccountOnboarding,
    ConnectComponentsProvider,
    loadConnectAndInitialize,
    type StripeConnectInstance,
} from '@stripe/stripe-react-native';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
    ConnectOnboardingResult,
    type ConnectOnboardingOutcome,
} from '../../../components/ui/connect-onboarding-result';
import { useFadeAnimation } from '../../../hooks/use-accessible-animation';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { API_BASE_URL } from '../../../lib/config/api';
import { CONNECT_REFRESH_URL, CONNECT_RETURN_URL } from '../../../lib/config/app';
import { momentsService } from '../../../lib/moments/momentsService';
import { analyticsService } from '../../../lib/services/analytics-service';
import { authProfileService } from '../../../lib/services/auth-profile-service';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';
import { useWallet } from '../../../lib/wallet-context';

type Phase = 'starting' | 'embedded' | 'in_browser' | 'finalizing' | 'result' | 'error';

interface AccountSession {
  clientSecret: string;
  publishableKey: string;
}

interface VerifyOnboardingResponse {
  onboarded?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  requirementsCurrentlyDue?: string[];
  disabledReason?: string | null;
}

// Stripe's account state is the only signal we trust here. Unlike the hosted
// flow there is no "returned to our redirect URL" hint to lean on — `onExit`
// fires both when the account owner completes onboarding and when they back
// out of it — so the outcome is derived purely from the account itself.
function deriveOutcome(args: {
  onboarded: boolean;
  detailsSubmitted: boolean;
  currentlyDue: string[];
}): ConnectOnboardingOutcome {
  if (args.onboarded) return 'success';
  // Nothing submitted yet ⇒ they left the form before finishing it.
  if (!args.detailsSubmitted) return 'cancelled';
  if (args.currentlyDue.length > 0) return 'action_required';
  return 'pending';
}

/** Mints a fresh Account Session scoped to the account-onboarding component. */
async function createAccountSession(token: string): Promise<AccountSession> {
  const response = await fetch(`${API_BASE_URL}/connect/create-account-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ components: { account_onboarding: true } }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    clientSecret?: string;
    publishableKey?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || `Couldn't start Stripe onboarding (${response.status}).`);
  }
  if (!data.clientSecret || !data.publishableKey) {
    throw new Error('Stripe returned an incomplete onboarding session. Please try again.');
  }

  return { clientSecret: data.clientSecret, publishableKey: data.publishableKey };
}

/** Maps the app theme onto Connect's appearance variables. */
function connectAppearance(t: AppTheme) {
  return {
    overlays: 'dialog' as const,
    variables: {
      colorPrimary: t.primary,
      colorBackground: t.background,
      colorText: t.text,
      colorSecondaryText: t.textSecondary,
      colorBorder: t.border,
      colorDanger: t.error,
      buttonPrimaryColorBackground: t.primary,
      buttonPrimaryColorBorder: t.primary,
      buttonPrimaryColorText: '#ffffff',
      buttonSecondaryColorBackground: t.surfaceSecondary,
      buttonSecondaryColorBorder: t.border,
      buttonSecondaryColorText: t.text,
      actionPrimaryColorText: t.primary,
      actionSecondaryColorText: t.textSecondary,
      offsetBackgroundColor: t.surface,
      formBackgroundColor: t.surfaceSecondary,
      formHighlightColorBorder: t.primary,
      formAccentColor: t.primary,
      borderRadius: '12px',
      buttonBorderRadius: '10px',
      formBorderRadius: '10px',
      spacingUnit: '9px',
      fontSizeBase: '15px',
    },
  };
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
  const [connectInstance, setConnectInstance] = useState<StripeConnectInstance | null>(null);

  // Prevents overlapping verify-onboarding calls (e.g. a manual Retry
  // pressed while the auto-triggered check is still in flight).
  const verifyingRef = useRef(false);
  // The session we minted to read the publishable key, handed to Stripe on
  // its first fetchClientSecret call instead of paying for a second one.
  const primedSecretRef = useRef<string | null>(null);
  // Kept current so the long-lived fetchClientSecret closure always signs its
  // request with a live token, even after a silent refresh.
  const tokenRef = useRef<string | undefined>(session?.access_token);
  useEffect(() => {
    tokenRef.current = session?.access_token;
  }, [session?.access_token]);

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

  const verifyOnboardingStatus = useCallback(async () => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;

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

      // `details_submitted` is the embedded equivalent of the hosted flow's
      // "reached the return URL" signal: the account owner pushed their
      // identity/KYC information through to Stripe.
      if (body?.detailsSubmitted) {
        try {
          await analyticsService.trackEvent('identity_submitted', {
            source: 'stripe_connect_onboarding',
          });
        } catch {
          /* analytics is best-effort */
        }
      }

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
      if (!body.onboarded && session?.user?.id) {
        await momentsService.enqueue(session.user.id, 'stripe_connect_onboarding');
      }
      setOutcome(
        deriveOutcome({
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
  }, [session?.access_token, session?.user?.id, refreshAncillaryState]);

  const appearance = useMemo(() => connectAppearance(theme), [theme]);

  /**
   * Mints the first Account Session (which also tells us the publishable key
   * for the backend's Stripe mode) and builds the Connect instance.
   */
  const startEmbeddedOnboarding = useCallback(async () => {
    const token = session?.access_token;
    if (!token) {
      setError('You must be signed in to set up payouts.');
      setPhase('error');
      return;
    }

    try {
      setError(null);
      const primed = await createAccountSession(token);
      primedSecretRef.current = primed.clientSecret;

      const instance = loadConnectAndInitialize({
        publishableKey: primed.publishableKey,
        // Stripe calls this again whenever the Account Session expires.
        fetchClientSecret: async () => {
          const primedSecret = primedSecretRef.current;
          if (primedSecret) {
            primedSecretRef.current = null;
            return primedSecret;
          }
          const next = await createAccountSession(tokenRef.current ?? token);
          return next.clientSecret;
        },
        appearance,
        locale: 'en-US',
      });

      setConnectInstance(instance);
      setPhase('embedded');
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong starting Stripe onboarding. Please try again.';
      console.warn('[connect-onboarding] failed to start embedded onboarding', err);
      setError(message);
      setPhase('error');
    }
  }, [appearance, session?.access_token]);

  useEffect(() => {
    if (authLoading) return;
    if (phase !== 'starting' || connectInstance) return;
    void startEmbeddedOnboarding();
  }, [authLoading, connectInstance, phase, startEmbeddedOnboarding]);

  // Stripe's `onExit` — the account owner finished onboarding or closed the
  // component. Either way, reconcile against the account itself.
  const handleEmbeddedExit = useCallback(() => {
    void verifyOnboardingStatus();
  }, [verifyOnboardingStatus]);

  const handleLoadError = useCallback((payload: { error?: { message?: string } }) => {
    const message =
      payload?.error?.message ?? 'Stripe onboarding could not load. Please try again.';
    console.warn('[connect-onboarding] embedded component load error', message);
    setError(message);
    setPhase('error');
  }, []);

  /** Restart embedded onboarding with a fresh Account Session. */
  const handleRetry = useCallback(() => {
    setError(null);
    setOutcome(null);
    primedSecretRef.current = null;
    setConnectInstance(null);
    setPhase('starting');
  }, []);

  const handleRetryVerify = useCallback(() => {
    void verifyOnboardingStatus();
  }, [verifyOnboardingStatus]);

  /**
   * Escape hatch when the embedded component can't run on this device:
   * Stripe's hosted Account Link presented in an ASWebAuthenticationSession /
   * Chrome Custom Tab, which redirects back to our universal link.
   */
  const launchHostedFallback = useCallback(async () => {
    const token = session?.access_token;
    if (!token) {
      setError('You must be signed in to set up payouts.');
      setPhase('error');
      return;
    }

    try {
      setError(null);
      setPhase('in_browser');

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

      await WebBrowser.openAuthSessionAsync(url, CONNECT_RETURN_URL, {
        // Sharing cookies gives users a smoother flow if they've already
        // authenticated with Stripe or their bank in Safari/Chrome.
        preferEphemeralSession: false,
      });

      await verifyOnboardingStatus();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong starting Stripe onboarding. Please try again.';
      console.warn('[connect-onboarding] hosted fallback failed', err);
      setError(message);
      setPhase('error');
    }
  }, [session?.access_token, verifyOnboardingStatus]);

  // Single dismissal path for every "leave this screen" action (X button,
  // Done, Go to Wallet, Maybe Later, the error screen's Back to wallet).
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
          : 'Preparing your secure Stripe session…';

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
                <TouchableOpacity style={styles.secondaryBtn} onPress={launchHostedFallback}>
                  <Text style={styles.secondaryBtnText}>Continue in browser instead</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={dismiss}>
                  <Text style={styles.secondaryBtnText}>Back to wallet</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        )}
      </Animated.View>

      {/* Stripe presents account onboarding as its own full-screen modal over
          this screen, so it renders outside the fading content above. */}
      {phase === 'embedded' && connectInstance ? (
        <ConnectComponentsProvider connectInstance={connectInstance}>
          <ConnectAccountOnboarding
            title="Set up payouts"
            onExit={handleEmbeddedExit}
            onLoadError={handleLoadError}
          />
        </ConnectComponentsProvider>
      ) : null}
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
