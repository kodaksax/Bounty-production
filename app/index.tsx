import type { Href } from 'expo-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import 'react-native-get-random-values'; // must run before using tweetnacl
import { ScreenLoader } from '../components/ui/screen-loader';
import { press } from '../lib/motion';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import { useAuthContext } from '../hooks/use-auth-context';
import { useAppBootstrap } from '../hooks/useAppBootstrap';
import { bountyAppTabPath, type BountyAppTab } from '../lib/navigation/bounty-app-tab';
import { holdDeepLinks, takeDeferredTabLink } from '../lib/navigation/deferred-deep-link';
import { ROUTES } from '../lib/routes';
import { getRestorableLastScreen } from '../lib/storage/last-screen';
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
    session,
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
  // Where this user lands in the app on a cold start, decided once per user:
  // a notification's tab (see below), else the tab they last left, else the
  // feed. Caching it keeps the destination stable: this effect re-runs on
  // later state changes (stale/recovery flags), and deciding again then would
  // yank the user off whatever tab they are on now.
  const landingRef = useRef<{ userId: string; dest: string } | null>(null);
  // A notification opened during launch must not be replaced by this gate's
  // own navigation: deep links wait until the gate has navigated, and a
  // link into the tab shell becomes the gate's destination
  // (lib/navigation/deferred-deep-link.ts). Released after the first
  // navigation, or on unmount.
  const releaseDeepLinksRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const release = holdDeepLinks();
    releaseDeepLinksRef.current = release;
    return () => {
      releaseDeepLinksRef.current = null;
      release();
    };
  }, []);

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
      releaseDeepLinksRef.current?.();
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

    const routeTo = (dest: string) => {
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
    };

    if (!bootstrap.onboardingComplete) {
      routeTo('/onboarding');
      return;
    }
    if (redirectTarget) {
      routeTo(redirectTarget);
      return;
    }

    // A notification that opened the app into a tab (e.g. a new application
    // -> Inbox > My Bounties) wins. Otherwise reopen the tab the user was on
    // when the app was last closed (within LAST_SCREEN_TTL_MS), otherwise the
    // feed. The read is bounded, so this only adds a few ms on the loading
    // screen.
    const feedOrResume = (screen: string | null) =>
      screen ? bountyAppTabPath(screen as BountyAppTab) : ROUTES.TABS.BOUNTY_APP;
    const userId = session?.user?.id;
    if (!userId) {
      routeTo(ROUTES.TABS.BOUNTY_APP);
      return;
    }
    if (landingRef.current?.userId === userId) {
      routeTo(landingRef.current.dest);
      return;
    }
    const land = (dest: string) => {
      landingRef.current = { userId, dest };
      routeTo(dest);
    };
    const notificationTab = takeDeferredTabLink();
    if (notificationTab) {
      land(notificationTab);
      return;
    }

    let cancelled = false;
    void getRestorableLastScreen(userId).then(screen => {
      if (cancelled) return;
      // The notification may have been read while the last tab was.
      land(takeDeferredTabLink() ?? feedOrResume(screen));
    });
    return () => {
      cancelled = true;
    };
  }, [
    bootstrap,
    isPasswordRecovery,
    accountBlockedReason,
    environmentError,
    isAuthStale,
    router,
    confirmedReturningUser,
    redirectToParam,
    session?.user?.id,
  ]);

  if (isAuthStale) {
    return <ConnectionInterrupted onRetry={() => void attemptRefresh?.()} />;
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
      <ScreenLoader label={bootstrap.status === 'authenticated' ? 'Redirecting...' : 'Loading...'} />
    );
  }

  // Unauthenticated returning user — show sign-in form.
  if (__DEV__) {
    console.log('[index] Rendering sign-in form');
  }
  return <SignInForm />;
}

/**
 * Session restore failed. Drawn in the app theme like the loader it replaces
 * — it used to be hard-coded dark, so a light-mode user saw the page go dark
 * just for this state. Its own component so only this branch reads the theme.
 */
function ConnectionInterrupted({ onRetry }: { onRetry: () => void }) {
  const { theme } = useAppThemeContext();
  return (
    <View style={[indexStyles.loadingContainer, { backgroundColor: theme.background }]}>
      <Text style={[indexStyles.offlineTitle, { color: theme.text }]}>Connection interrupted</Text>
      <Text style={[indexStyles.offlineText, { color: theme.textSecondary }]}>
        We could not restore your session. Check your connection and try again.
      </Text>
      <TouchableOpacity
        style={[indexStyles.retryButton, { backgroundColor: theme.primary, borderBottomColor: theme.primaryShade }]}
        activeOpacity={press.opacity}
        onPress={onRetry}
      >
        <Text style={indexStyles.retryButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const indexStyles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  offlineText: {
    fontSize: 16,
    lineHeight: 22,
    marginTop: 12,
    maxWidth: 300,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    borderBottomWidth: 4,
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
