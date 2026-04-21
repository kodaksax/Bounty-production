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
 * The screen is reached via `router.push('/wallet/connect/embedded-onboarding')`
 * from `ConnectOnboardingButton`, the withdraw flows, etc. — keeping the
 * route stable so existing callers don't change.
 */

import { MaterialIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthContext } from '../../../hooks/use-auth-context';
import { API_BASE_URL } from '../../../lib/config/api';
import { CONNECT_REFRESH_URL, CONNECT_RETURN_URL } from '../../../lib/config/app';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../lib/theme';

type Phase = 'starting' | 'in_browser' | 'finalizing' | 'error';

export default function ConnectOnboardingScreen() {
  const router = useRouter();
  const { session, isLoading: authLoading } = useAuthContext();

  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  // Guard against React strict-mode / re-focus double-invocations.
  const launchedRef = useRef(false);

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

      // 3. Regardless of whether the user completed or cancelled, reconcile
      //    state with Stripe. The webhook is authoritative but this gives
      //    the UI an immediate, correct answer.
      setPhase('finalizing');

      // Optimistic local flag — the webhook will overwrite it with Stripe's
      // authoritative capability state shortly after.
      const userId = session?.user?.id;
      if (userId && result.type === 'success') {
        try {
          await supabase.from('profiles').update({ onboarding_complete: true }).eq('id', userId);
        } catch (err) {
          console.warn('[connect-onboarding] optimistic update failed', err);
        }
      }

      try {
        await fetch(`${API_BASE_URL}/connect/verify-onboarding`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (err) {
        console.warn('[connect-onboarding] verify-onboarding refresh failed', err);
      }

      router.replace('/tabs/wallet-screen');
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Something went wrong starting Stripe onboarding. Please try again.";
      console.warn('[connect-onboarding] launch failed', err);
      setError(message);
      setPhase('error');
    }
  }, [router, session?.access_token, session?.user?.id]);

  useEffect(() => {
    if (authLoading) return;
    if (launchedRef.current) return;
    launchedRef.current = true;
    launchOnboarding();
  }, [authLoading, launchOnboarding]);

  const handleRetry = useCallback(() => {
    launchedRef.current = true;
    launchOnboarding();
  }, [launchOnboarding]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  if (authLoading) return null;

  if (!session?.access_token) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Please sign in</Text>
          <Text style={styles.muted}>You must be signed in to set up payouts.</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleClose}>
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
      ? error ?? "Something went wrong starting Stripe onboarding. Please try again."
      : phase === 'finalizing'
      ? "We're refreshing your account status. This takes a moment."
      : phase === 'in_browser'
      ? "Complete the Stripe onboarding in the secure browser window. You'll return here automatically when you're done."
      : "Opening Stripe's secure onboarding…";

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.closeBtn}
        >
          <MaterialIcons name="close" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Set up payouts</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        {phase === 'error' ? (
          <View style={styles.iconBadgeError}>
            <MaterialIcons name="error-outline" size={40} color="#7f1d1d" />
          </View>
        ) : (
          <ActivityIndicator size="large" color={colors.primary[500]} />
        )}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>

        {phase === 'error' ? (
          <>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>
              <MaterialIcons name="refresh" size={20} color="#052e1b" />
              <Text style={styles.primaryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleClose}>
              <Text style={styles.secondaryBtnText}>Back to wallet</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.muted,
    backgroundColor: colors.background.secondary,
  },
  headerTitle: { color: colors.text.primary, fontSize: 17, fontWeight: '600' },
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
    color: colors.text.primary,
    textAlign: 'center',
  },
  message: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text.secondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  iconBadgeError: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#a7f3d0',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 999,
  },
  primaryBtnText: { color: '#052e1b', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  secondaryBtnText: { color: colors.text.secondary, fontSize: 14, fontWeight: '500' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { color: colors.text.primary, fontSize: 18, fontWeight: '600' },
  muted: { color: colors.text.secondary, marginTop: 8, fontSize: 14, textAlign: 'center' },
});
