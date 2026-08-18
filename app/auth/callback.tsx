/**
 * Auth Callback Screen
 *
 * Single entry point for every auth email link: password recovery, email
 * confirmation, and magic links. Reached as
 * `bountyexpo-workspace://auth/callback` (and, once that domain serves the app
 * over HTTPS, `https://bountyfinder.app/auth/callback`).
 *
 * The link's credentials arrive in the URL **fragment**, which expo-router
 * discards on native — so this screen reads the raw URL from `expo-linking`
 * (see lib/auth/use-incoming-auth-url.ts) and parses it explicitly
 * (lib/auth/recovery-link.ts) instead of trusting `useLocalSearchParams()`.
 * Router params are still consulted as a secondary source because on web the
 * fragment survives as the reserved `'#'` param, and `app/auth/index.tsx`
 * forwards it that way when it bounces `/auth` here.
 *
 * Sequencing is deterministic, not timed: nothing is concluded until the
 * cold-start URL lookup reports `resolved`, and navigation happens only after
 * Supabase confirms a session exists.
 */

import { MaterialIcons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import type { Href } from 'expo-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { useAuthContext } from '../../hooks/use-auth-context';
import { consumeAuthLink } from '../../lib/auth/consume-auth-link';
import type { AuthLinkType } from '../../lib/auth/recovery-link';
import { parseAuthLink, redactAuthUrl } from '../../lib/auth/recovery-link';
import { useIncomingAuthUrl } from '../../lib/auth/use-incoming-auth-url';
import { ROUTES } from '../../lib/routes';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { markInitialNavigationDone } from '../initial-navigation/initialNavigation';

type CallbackStatus = 'verifying' | 'success' | 'expired' | 'invalid' | 'failed';

/** Where each link type lands once its session is established. */
const DESTINATIONS: Record<AuthLinkType, Href> = {
  recovery: ROUTES.AUTH.UPDATE_PASSWORD as Href,
  // A freshly confirmed signup still has a profile to set up.
  signup: '/onboarding' as Href,
  invite: '/onboarding' as Href,
  email: ROUTES.ROOT as Href,
  email_change: ROUTES.ROOT as Href,
  magiclink: ROUTES.ROOT as Href,
};

/**
 * How long a success confirmation stays on screen before forwarding. Purely
 * cosmetic — the session already exists by this point, so nothing depends on
 * the delay. Recovery skips it entirely: there is no reason to make someone
 * wait to type their new password.
 */
const CONFIRMATION_DWELL_MS = 1500;

export default function AuthCallbackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { beginPasswordRecovery } = useAuthContext();

  const incoming = useIncomingAuthUrl();

  const [status, setStatus] = useState<CallbackStatus>('verifying');
  const [linkType, setLinkType] = useState<AuthLinkType | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // Which link has already been put through session establishment. Keyed rather
  // than a plain boolean so that a *different* link arriving later (the user is
  // sitting on the expired-link screen and taps a freshly mailed one) is still
  // handled, while the *same* link being redelivered — React 18's double effect
  // mount, or iOS re-emitting the launch URL on resume — is not consumed twice.
  const handledKeyRef = useRef<string | null>(null);
  // Once a session exists there is nothing left to establish; a late URL must
  // not restart the flow underneath the navigation already in progress.
  const succeededRef = useRef(false);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `useLocalSearchParams()` returns a fresh object every render, so the raw
  // value cannot be an effect dependency. Serialising it gives a stable key.
  const paramSignature = JSON.stringify(params ?? {});

  useEffect(() => {
    if (succeededRef.current) return;
    // Do not conclude anything until the cold-start URL lookup has settled —
    // deciding early is exactly how this flow used to report a valid link as
    // invalid.
    if (!incoming.resolved) return;

    // `retryNonce` participates so the Try Again button can re-run the same link.
    const handledKey = `${retryNonce}|${incoming.url ?? paramSignature}`;
    if (handledKeyRef.current === handledKey) return;
    handledKeyRef.current = handledKey;

    let cancelled = false;

    void (async () => {
      const routerParams = JSON.parse(paramSignature) as Record<string, string | string[]>;
      const link = parseAuthLink(incoming.url, routerParams);

      // Shape only — never values. redactAuthUrl keeps the key names and drops
      // every credential so this line is safe in a release log.
      console.log('[auth-callback] Handling link', {
        kind: link.kind,
        type: 'type' in link ? link.type : null,
        url: redactAuthUrl(incoming.url),
      });

      const outcome = await consumeAuthLink(link);
      if (cancelled) return;

      if (outcome.status === 'established' || outcome.status === 'already_established') {
        succeededRef.current = true;
        const type = outcome.type ?? 'recovery';
        setLinkType(type);
        setStatus('success');

        // Flag recovery *before* navigating so the root gate and the
        // update-password screen both see a consistent state if anything
        // re-evaluates routing in between.
        if (type === 'recovery') {
          try {
            beginPasswordRecovery?.();
          } catch {
            // A missing provider must not block the reset itself.
          }
        }

        const destination = DESTINATIONS[type] ?? (ROUTES.ROOT as Href);
        const go = () => {
          router.replace(destination);
          try {
            markInitialNavigationDone();
          } catch {}
        };

        if (type === 'recovery') {
          go();
        } else {
          dwellTimerRef.current = setTimeout(go, CONFIRMATION_DWELL_MS);
        }
        return;
      }

      setLinkType('type' in link ? link.type : null);

      switch (outcome.status) {
        case 'expired':
          setStatus('expired');
          break;
        case 'failed':
          setStatus('failed');
          break;
        // 'invalid' and 'none' both mean "this link carries nothing we can use".
        default:
          setStatus('invalid');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming.resolved, incoming.url, paramSignature, retryNonce]);

  // A cosmetic timer must never fire into an unmounted tree.
  useEffect(
    () => () => {
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    },
    []
  );

  // Only offered for the transient 'failed' state. Re-arms the one-shot guard
  // and bumps the nonce so the effect runs again with the same link — safe
  // because a genuine network failure never consumed the token.
  const handleRetry = useCallback(() => {
    setStatus('verifying');
    setRetryNonce(n => n + 1);
  }, []);

  const handleGoToSignIn = () => {
    router.replace(ROUTES.AUTH.SIGN_IN as Href);
    try { markInitialNavigationDone(); } catch {}
  };

  const handleRequestNewResetLink = () => {
    router.replace(ROUTES.AUTH.RESET_PASSWORD as Href);
    try { markInitialNavigationDone(); } catch {}
  };

  const handleOpenEmail = async () => {
    // Try to open default email app
    const emailUrl = 'message://';
    const canOpen = await Linking.canOpenURL(emailUrl);

    if (canOpen) {
      await Linking.openURL(emailUrl);
    } else {
      // Fallback for Android
      await Linking.openURL('mailto:');
    }
  };

  // A link that carried no readable type is treated as recovery for copy
  // purposes: that is the only flow a user actively drives, so "request a new
  // reset link" is the most useful escape hatch to offer.
  const isRecovery = linkType === 'recovery' || linkType === null;

  /**
   * User-facing copy per failure state. Supabase's own `error_description` is
   * deliberately never shown — it leaks implementation detail and reads like a
   * bug report ("Email link is invalid or has expired").
   */
  const FAILURE_COPY: Record<'expired' | 'invalid' | 'failed', { title: string; body: string }> = {
    expired: {
      title: isRecovery ? 'Reset Link Expired' : 'Link Expired',
      body: isRecovery
        ? 'This reset link has expired or has already been used. Reset links last one hour and work only once.'
        : 'This link has expired or has already been used. Please request a new one.',
    },
    invalid: {
      title: isRecovery ? 'Reset Link Invalid' : 'Link Invalid',
      body: isRecovery
        ? "We couldn't read this reset link. It may have been altered or truncated by your email app."
        : "We couldn't read this link. It may have been altered or truncated by your email app.",
    },
    failed: {
      title: 'Something Went Wrong',
      body: "We couldn't verify your link just now. Check your connection and try again.",
    },
  };

  const renderContent = () => {
    switch (status) {
      case 'verifying':
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.title}>Verifying your link</Text>
            <Text style={styles.description}>
              {isRecovery
                ? 'Please wait while we verify your reset link...'
                : 'Please wait while we verify your email...'}
            </Text>
          </View>
        );

      case 'success':
        return (
          <View style={styles.centerContent}>
            <View style={styles.successIconCircle}>
              <MaterialIcons name="check-circle" size={64} color="#059669" />
            </View>
            <Text style={styles.title}>
              {linkType === 'recovery' ? 'Link Verified' : 'Email Confirmed!'}
            </Text>
            <Text style={styles.description}>
              {linkType === 'recovery'
                ? 'Taking you to set your new password...'
                : 'Your email has been verified. You can now access all features of BOUNTY.'}
            </Text>
          </View>
        );

      case 'expired':
      case 'invalid':
      case 'failed': {
        const copy = FAILURE_COPY[status];
        const isRetryable = status === 'failed';
        return (
          <View style={styles.centerContent}>
            <View style={styles.errorIconCircle}>
              <MaterialIcons name="error-outline" size={64} color="#7f1d1d" />
            </View>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.description}>{copy.body}</Text>

            {/* Help section */}
            <View style={styles.helpBox}>
              <MaterialIcons name="info-outline" size={20} color={theme.textSecondary} />
              <View style={styles.helpContent}>
                <Text style={styles.helpTitle}>
                  {isRecovery ? 'Need a new reset link?' : 'Need a new confirmation email?'}
                </Text>
                <Text style={styles.helpText}>
                  {isRecovery
                    ? "Request a new password reset link and we'll send it to your email."
                    : "Sign in to your account and we'll send you a new verification link."}
                </Text>
              </View>
            </View>

            {/* Actions */}
            <View style={styles.errorActions}>
              {isRetryable && (
                <TouchableOpacity style={styles.primaryButton} onPress={handleRetry}>
                  <Text style={styles.primaryButtonText}>Try Again</Text>
                  <MaterialIcons name="refresh" size={20} color="#ffffff" />
                </TouchableOpacity>
              )}
              {isRecovery ? (
                <>
                  <TouchableOpacity
                    style={isRetryable ? styles.secondaryButton : styles.primaryButton}
                    onPress={handleRequestNewResetLink}
                  >
                    <Text style={isRetryable ? styles.secondaryButtonText : styles.primaryButtonText}>
                      Request New Reset Link
                    </Text>
                    <MaterialIcons
                      name="arrow-forward"
                      size={20}
                      color={isRetryable ? theme.text : '#ffffff'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryButton} onPress={handleGoToSignIn}>
                    <MaterialIcons name="login" size={20} color={theme.text} />
                    <Text style={styles.secondaryButtonText}>Back to Sign In</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity style={styles.secondaryButton} onPress={handleOpenEmail}>
                    <MaterialIcons name="email" size={20} color={theme.text} />
                    <Text style={styles.secondaryButtonText}>Check Email</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.primaryButton} onPress={handleGoToSignIn}>
                    <Text style={styles.primaryButtonText}>Go to Sign In</Text>
                    <MaterialIcons name="arrow-forward" size={20} color="#ffffff" />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        );
      }

      default:
        return null;
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Branding Header */}
      <View style={styles.brandingHeader}>
        <BrandingLogo size="large" />
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderContent()}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
      paddingHorizontal: 24,
    },
    brandingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 24,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingBottom: 24,
    },
    centerContent: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    successIconCircle: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: theme.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 6,
      marginBottom: 24,
    },
    errorIconCircle: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: '#fecaca',
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 6,
      marginBottom: 24,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 16,
      textAlign: 'center',
    },
    description: {
      fontSize: 16,
      color: theme.text,
      textAlign: 'center',
      lineHeight: 24,
      marginBottom: 32,
      paddingHorizontal: 20,
    },
    helpBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 12,
      padding: 16,
      width: '100%',
      marginBottom: 24,
      borderWidth: 1,
      borderColor: theme.border,
    },
    helpContent: {
      flex: 1,
      marginLeft: 12,
    },
    helpTitle: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 4,
    },
    helpText: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 20,
    },
    errorActions: {
      width: '100%',
      gap: 12,
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#059669',
      paddingVertical: 16,
      borderRadius: 999,
      gap: 8,
    },
    primaryButtonText: {
      color: '#ffffff',
      fontSize: 18,
      fontWeight: 'bold',
    },
    secondaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      paddingVertical: 16,
      borderRadius: 999,
      gap: 8,
      borderWidth: 2,
      borderColor: theme.border,
    },
    secondaryButtonText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
