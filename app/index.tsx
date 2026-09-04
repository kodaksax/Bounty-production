import type { Href } from 'expo-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import 'react-native-get-random-values'; // must run before using tweetnacl
import { useAuthContext } from '../hooks/use-auth-context';
import { useAppBootstrap } from '../hooks/useAppBootstrap';
import { ROUTES } from '../lib/routes';
import { hasDeviceSignedInBefore } from '../lib/storage/onboarding';
import { logAuthLifecycleEvent } from '../lib/utils/auth-diagnostics';
import { generateCorrelationId } from '../lib/utils/auth-errors';
import { SignInForm } from './auth/sign-in-form';
import { markInitialNavigationDone } from './initial-navigation/initialNavigation';

/**
 * Root Index - Auth Gate
 *
 * Consumes the `useAppBootstrap` hook which resolves all async state (auth,
 * profile, local AsyncStorage flag) inside its own "loading" phase.  By the
 * time bootstrap.status transitions out of "loading" the correct destination
 * is already known, so navigation is synchronous and the wrong screen is
 * never rendered — eliminating the onboarding screen flash.
 *
 * State machine handled here:
 *   loading        → show splash / loading spinner
 *   unauthenticated → show sign-in form
 *   authenticated  → immediately navigate to main app or onboarding
 *
 * Password recovery is checked before the onboarding route since it is a
 * special override that should always take precedence.
 */
/**
 * Where to send a just-authenticated user, when they arrived here because the
 * /tabs group guard (app/tabs/_layout.tsx) bounced a logged-out deep link.
 * Only accepts an in-app "/tabs/…" path — anything with a scheme, host,
 * backslash or "//" is rejected so this can't be turned into an open redirect.
 */
function safeRedirectTarget(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value) return null;
  if (!value.startsWith('/tabs/')) return null;
  if (value.includes('//') || value.includes('\\') || value.includes(':')) return null;
  return value;
}

export default function Index() {
  const bootstrap = useAppBootstrap();
  const { redirect_to: redirectToParam } = useLocalSearchParams<{ redirect_to?: string }>();
  const {
    isPasswordRecovery,
    accountBlockedReason,
    environmentError,
    isAuthStale,
    attemptRefresh,
  } = useAuthContext();
  const router = useRouter();
  const authGateCorrelationRef = useRef(generateCorrelationId('root_auth_gate'));
  // The destination this gate last navigated to, NOT a one-shot boolean.
  //
  // A boolean latched on the first navigation and never cleared, so any later
  // change in the inputs (session restored after a stall, account blocked,
  // password-recovery link opened, sign-out) could not re-route: the gate
  // stayed silently pointed at a destination that was no longer correct.
  // Keying on the destination keeps the double-navigation protection (the same
  // target is never pushed twice) while still allowing a genuine change of
  // answer.
  const lastNavigatedRef = useRef<string | null>(null);
  // Tracks whether we've confirmed this is a *returning* user (device has
  // signed in before) — until this is true, an unauthenticated visitor might
  // still be a first-timer who should see onboarding instead of the log-in
  // form, so we hold on the loading spinner rather than flashing sign-in.
  const [confirmedReturningUser, setConfirmedReturningUser] = useState(false);

  // Debug logging on mount (development only)
  useEffect(() => {
    if (__DEV__) {
      console.log('[index] Component mounted');
    }
  }, []);

  // Reset navigation guard on unmount so a remount starts fresh.
  useEffect(() => {
    return () => {
      lastNavigatedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const correlationId = authGateCorrelationRef.current;
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();

    logAuthLifecycleEvent({
      correlationId,
      stage: 'root-auth-gate:evaluate',
      status: 'started',
      startedAt,
      metadata: {
        bootstrapStatus: bootstrap.status,
        isPasswordRecovery,
        confirmedReturningUser,
      },
    });

    // Single navigation primitive for this gate. Returns false when the
    // requested destination is the one already navigated to, so every branch
    // below is naturally idempotent across re-renders.
    const navigateTo = (dest: string): boolean => {
      if (lastNavigatedRef.current === dest) return false;
      lastNavigatedRef.current = dest;
      router.replace(dest as Href);
      try {
        markInitialNavigationDone();
      } catch {}
      return true;
    };

    // The environment guard (lib/config/env-guard.ts) refused to connect —
    // this bundle's Supabase URL doesn't match its build channel, so no auth
    // call can succeed regardless of whether a valid session is persisted.
    // Takes precedence over every other branch, including the loading gate
    // below: showing the sign-in form here would misleadingly suggest the
    // user was logged out when their session was never touched.
    if (environmentError) {
      if (__DEV__) {
        console.log('[index] Environment integrity check failed — routing to environment-error');
      }
      if (!navigateTo('/auth/environment-error')) return;
      logAuthLifecycleEvent({
        correlationId,
        stage: 'root-auth-gate:navigation',
        status: 'success',
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAtMs,
        outcome: 'environment_error',
      });
      return;
    }

    // Still resolving auth or onboarding state — do nothing yet.
    if (bootstrap.status === 'loading') return;

    // Session restore stalled but a persisted session may still be recoverable.
    // The retry UI below is rendered instead; navigating to sign-in here would
    // present a recoverable connectivity problem as a logout.
    if (isAuthStale) return;

    // A banned/suspended account takes precedence over all other routing
    // decisions, same as password recovery below — the provider has already
    // force-signed the user out by the time this fires (see
    // providers/auth-provider.tsx), so this only needs to redirect.
    if (accountBlockedReason) {
      const dest =
        accountBlockedReason === 'banned' ? '/auth/account-banned' : '/auth/account-suspended';
      if (__DEV__) {
        console.log('[index] Account blocked — routing to', dest);
      }
      if (!navigateTo(dest)) return;
      logAuthLifecycleEvent({
        correlationId,
        stage: 'root-auth-gate:navigation',
        status: 'success',
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAtMs,
        outcome: `account_${accountBlockedReason}`,
      });
      return;
    }

    // Password recovery takes precedence over all routing decisions.
    if (isPasswordRecovery) {
      if (__DEV__) {
        console.log('[index] Password recovery mode — routing to update-password');
      }
      if (!navigateTo(ROUTES.AUTH.UPDATE_PASSWORD)) return;
      logAuthLifecycleEvent({
        correlationId,
        stage: 'root-auth-gate:navigation',
        status: 'success',
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAtMs,
        outcome: 'password_recovery',
      });
      return;
    }

    // Unauthenticated — determine whether this is a genuine first-time
    // visitor (never signed in on this device) or a returning user who is
    // simply logged out right now.
    if (bootstrap.status === 'unauthenticated') {
      if (confirmedReturningUser) return;

      let cancelled = false;
      (async () => {
        const returning = await hasDeviceSignedInBefore();
        if (cancelled) return;

        if (!returning) {
          if (__DEV__) {
            console.log('[index] First-time device — routing to onboarding welcome');
          }
          if (!navigateTo('/onboarding/welcome')) return;
          logAuthLifecycleEvent({
            correlationId,
            stage: 'root-auth-gate:navigation',
            status: 'success',
            startedAt,
            finishedAt: new Date().toISOString(),
            elapsedMs: Date.now() - startedAtMs,
            outcome: 'first_time_onboarding_welcome',
          });
        } else {
          setConfirmedReturningUser(true);
          logAuthLifecycleEvent({
            correlationId,
            stage: 'root-auth-gate:returning-user-check',
            status: 'success',
            startedAt,
            finishedAt: new Date().toISOString(),
            elapsedMs: Date.now() - startedAtMs,
            outcome: 'show_sign_in',
          });
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    // Authenticated — onboardingComplete is already known (resolved by the
    // hook), so this navigation is synchronous with no further async work.
    // A returning user who deep-linked to a /tabs screen while logged out was
    // sent here by app/tabs/_layout.tsx with ?redirect_to=<that path>; honour
    // it now that they have a session instead of dropping them on the feed.
    // Onboarding still takes precedence — an unfinished account has no
    // meaningful tab to land on.
    const redirectTarget = safeRedirectTarget(redirectToParam);
    const dest = bootstrap.onboardingComplete
      ? (redirectTarget ?? ROUTES.TABS.BOUNTY_APP)
      : '/onboarding';

    if (__DEV__) {
      console.log('[index] Routing decision:', {
        onboardingComplete: bootstrap.onboardingComplete,
        dest,
      });
    }

    if (!navigateTo(dest)) return;
    logAuthLifecycleEvent({
      correlationId,
      stage: 'root-auth-gate:navigation',
      status: 'success',
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAtMs,
      outcome: dest,
      metadata: {
        onboardingComplete: bootstrap.onboardingComplete,
      },
    });
  }, [
    bootstrap,
    isPasswordRecovery,
    accountBlockedReason,
    environmentError,
    isAuthStale,
    router,
    confirmedReturningUser,
    redirectToParam,
  ]);

  if (isAuthStale) {
    return (
      <View style={indexStyles.loadingContainer}>
        <Text style={indexStyles.offlineTitle}>Connection interrupted</Text>
        <Text style={indexStyles.offlineText}>
          We could not restore your session. Check your connection and try again.
        </Text>
        <TouchableOpacity style={indexStyles.retryButton} onPress={() => void attemptRefresh?.()}>
          <Text style={indexStyles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Loading, authenticated (redirecting), or an unauthenticated visitor whose
  // first-time-device check hasn't resolved yet — show spinner, never the
  // wrong screen.
  // Use inline StyleSheet styles (not NativeWind className) so the screen is
  // visible even when the CSS-interop runtime fails to process global.css.
  if (
    bootstrap.status === 'loading' ||
    bootstrap.status === 'authenticated' ||
    (bootstrap.status === 'unauthenticated' && !confirmedReturningUser)
  ) {
    if (__DEV__) {
      console.log('[index] Rendering loading/redirecting state:', bootstrap.status);
    }
    return (
      <View style={indexStyles.loadingContainer}>
        <ActivityIndicator size="large" color="#059669" />
        <Text style={indexStyles.loadingText}>
          {bootstrap.status === 'authenticated' ? 'Redirecting...' : 'Loading...'}
        </Text>
      </View>
    );
  }

  // Unauthenticated returning user — show sign-in form.
  if (__DEV__) {
    console.log('[index] Rendering sign-in form');
  }
  return <SignInForm />;
}

const indexStyles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0F14', // page background
  },
  loadingText: {
    color: '#ffffff',
    marginTop: 16,
    fontSize: 16,
  },
  offlineTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  offlineText: {
    color: '#d1d5db',
    fontSize: 16,
    lineHeight: 22,
    marginTop: 12,
    maxWidth: 300,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#059669',
    borderRadius: 6,
    marginTop: 24,
    minWidth: 112,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
