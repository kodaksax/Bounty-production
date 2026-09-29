'use client';
import { FontAwesome, MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { Session } from '@supabase/supabase-js';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIVACY_TEXT } from '../../assets/legal/privacy';
import { TERMS_TEXT } from '../../assets/legal/terms';
import { LegalText } from '../../components/legal/LegalText';
import {
  ONBOARDING_TOTAL_STEPS,
  OnboardingProgressDots,
} from '../../components/onboarding/OnboardingProgressDots';
import { config } from '../../lib/config';
import { API_BASE_URL } from '../../lib/config/api';
import useScreenBackground from '../../lib/hooks/useScreenBackground';
import { ROUTES } from '../../lib/routes';
import { storage } from '../../lib/storage';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { palette } from '../../lib/themes/colors';
import type { AppTheme } from '../../lib/themes/types';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import { hasLocalOnboardingFlag, markDeviceHasSignedIn } from '../../lib/storage/onboarding';
import { isUsernameUnique, validateUsername } from '../../lib/services/userProfile';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { useSocialAuth } from '../../hooks/useSocialAuth';
import { GoogleLogo } from '../../components/ui/google-logo';
import { generateCorrelationId, parseAuthError } from '../../lib/utils/auth-errors';
import { suggestEmailCorrection, validateEmail } from '../../lib/utils/auth-validation';
import {
    calculatePasswordStrength,
    getStrengthColor,
    getStrengthWidth,
    validateNewPassword,
    type PasswordStrengthResult,
} from '../../lib/utils/password-validation';
import { markInitialNavigationDone } from '../initial-navigation/initialNavigation';

// iOS Password AutoFill rules for the sign-up password fields.
// Kept in sync with `lib/utils/password-validation.ts` (the same requirements
// used by the password reset flow) so the system-generated "Strong Password"
// satisfies our requirements — and so a password valid at sign-up is never
// later rejected when the user resets it.
const IOS_NEW_PASSWORD_RULES =
  'minlength: 8; required: lower; required: upper; required: digit; required: special;';

/**
 * Map a rejected `/auth/register` response to a low-cardinality reason so
 * `auth_signup_failed` is groupable in analytics. Mirrors the user-facing
 * branches in `handleSubmit` below — keep the two in sync.
 */
function classifyRegisterFailure(status: number, backendMessage: string): string {
  const msg = backendMessage.toLowerCase();
  if (status === 409) {
    if (msg.includes('email')) return 'email_already_registered';
    if (msg.includes('username')) return 'username_taken';
    return 'account_exists';
  }
  if (status === 401 || msg.includes('invalid jwt') || msg.includes('missing jwt')) {
    return 'configuration_error';
  }
  if (status === 404) return 'endpoint_not_found';
  if (
    status >= 500 ||
    msg.includes('internal server error') ||
    msg.includes('internal_server_error') ||
    msg === 'error' ||
    msg.includes('unexpected error')
  ) {
    return 'server_error';
  }
  return 'other';
}

/**
 * Signs the just-registered user in, retrying once on a transient failure.
 *
 * The account already exists at this point, so a single flaky request must not
 * be what decides whether the user gets into the app. Returns the session, or
 * `null` when the backend deliberately withheld one (email confirmation
 * required). Throws only when a session genuinely could not be created.
 */
// Exported for regression coverage: the "account exists, session doesn't"
// branch is the one that decides whether a brand-new user gets into the app,
// and it is not reachable through the rendered form without standing up the
// whole registration request.
export async function signInAfterRegister(
  email: string,
  password: string,
  correlationId: string
): Promise<Session | null> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      // One short backoff — long enough to ride out a momentary network blip,
      // short enough that the user is still watching the same spinner.
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (!error) {
        // No session with no error means confirmation is required — a
        // deliberate backend decision, not a failure. Do not retry it.
        return data.session ?? null;
      }

      lastError = error;
      const parsed = parseAuthError(error, correlationId);

      // "Email not confirmed" is also a definitive answer, not a transient
      // failure: surface it as the confirmation-required state.
      if (parsed.category === 'email_not_confirmed') return null;

      // Anything the error taxonomy marks non-retryable (bad credentials,
      // config error) will not improve on a second attempt.
      if (!parsed.retryable && parsed.category !== 'unknown') break;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('Sign-in after registration returned no session');
}

// After a real Apple/Google sign-in, decide whether this is an existing,
// fully-onboarded account (go straight to the app) or a new/incomplete one
// (continue onboarding at style, the first post-auth step). Mirrors
// app/onboarding/username.tsx's routeAfterSocialSignIn — kept as a separate
// copy rather than a shared import because the two screens' surrounding
// state (loading flags, analytics context) differ enough that a shared
// helper would need its own prop-drilling just to stay thin.
async function routeAfterAuth(userId: string, router: ReturnType<typeof useRouter>) {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('username, onboarding_completed')
      .eq('id', userId)
      .single();

    if (error) {
      analyticsService.trackEvent('onboarding_auth_completed', { method: 'social', outcome: 'new_account' });
      router.replace('/onboarding/style' as Href);
      return;
    }

    const onboarded =
      profile?.username &&
      (profile.onboarding_completed === true || (await hasLocalOnboardingFlag(userId)));

    if (onboarded) {
      analyticsService.trackEvent('onboarding_auth_completed', { method: 'social', outcome: 'existing_onboarded' });
      router.replace('/tabs/bounty-app' as Href);
    } else {
      analyticsService.trackEvent('onboarding_auth_completed', { method: 'social', outcome: 'existing_incomplete' });
      router.replace('/onboarding/style' as Href);
    }
  } catch {
    router.replace('/onboarding/style' as Href);
  }
}

// Sign-up is the auth step of the onboarding flow — the same step
// app/onboarding/username.tsx renders at activeIndex 0, so it shows the same
// total. See ONBOARDING_TOTAL_STEPS for what the steps are.
const SIGNUP_TOTAL_STEPS = ONBOARDING_TOTAL_STEPS;

export default function SignUpRoute() {
  return <SignUpForm />;
}

type UsernameAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function SignUpForm() {
  // Follows the app's light/dark preference. This screen used to pin
  // darkTheme to match the pre-auth funnel; the theme now flows into
  // makeLayout, which is why it's a parameter there rather than a module
  // const — the StyleSheet has to be rebuilt when the theme changes, not
  // only when the viewport does.
  const { theme } = useAppThemeContext();
  useScreenBackground(theme.background);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { styles, icons } = useMemo(
    () => makeLayout(theme, width, height, insets.top, insets.bottom),
    [theme, width, height, insets.top, insets.bottom]
  );
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [usernameAvailability, setUsernameAvailability] = useState<UsernameAvailability>('idle');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const {
    isAppleAvailable,
    isGoogleConfigured,
    googleRequest,
    promptGoogleSignIn,
    googleSessionReady,
    signInWithApple,
    loading: socialLoading,
    error: socialError,
    clearError: clearSocialError,
  } = useSocialAuth();
  const [legalModal, setLegalModal] = useState<'terms' | 'privacy' | null>(null);
  // Terminal-but-recoverable state: the account WAS created, but the sign-in
  // that normally follows it could not establish a session. Re-submitting the
  // form would now fail with "email already registered", so the form is
  // replaced by a single explicit action instead of a generic error.
  const [accountCreatedNeedsSignIn, setAccountCreatedNeedsSignIn] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  // The error banner renders at the TOP of a form whose submit button is at the
  // BOTTOM. Without this, a failed "Create Account" shows a spinner, returns to
  // its resting label and looks like a dead button -- the reason it failed is
  // one full screen above the finger that pressed it.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (authError || Object.keys(fieldErrors).length > 0) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [authError, fieldErrors]);

  // Password strength tracking — same rules/UI pattern as the reset-password
  // flow (lib/utils/password-validation.ts), so sign-up and password reset
  // never disagree about what makes a valid password.
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrengthResult | null>(null);
  useEffect(() => {
    setPasswordStrength(password ? calculatePasswordStrength(password) : null);
  }, [password]);

  // Live username availability — debounced so every keystroke doesn't hit
  // Supabase. isUsernameUnique already falls back to a local check when the
  // query fails, but the final DB UNIQUE constraint at submit time is what
  // actually decides this, never this indicator alone.
  useEffect(() => {
    if (!username) {
      setUsernameAvailability('idle');
      return;
    }
    const format = validateUsername(username);
    if (!format.valid) {
      setUsernameAvailability('invalid');
      return;
    }

    setUsernameAvailability('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const unique = await isUsernameUnique(username);
        if (!cancelled) setUsernameAvailability(unique ? 'available' : 'taken');
      } catch {
        if (!cancelled) setUsernameAvailability('idle');
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  useEffect(() => {
    if (socialError) {
      Alert.alert('Sign-in failed', socialError, [{ text: 'OK', onPress: clearSocialError }]);
    }
  }, [socialError, clearSocialError]);

  // Google's OAuth redirect resolves asynchronously — once a session exists,
  // route the same way a fresh email registration would.
  useEffect(() => {
    if (!googleSessionReady) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) {
        router.replace('/onboarding/style' as Href);
        return;
      }
      await routeAfterAuth(userId, router);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleSessionReady]);

  const handleAppleContinue = async () => {
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_auth_started', { method: 'apple' });
    const success = await signInWithApple();
    if (!success) return;

    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) {
      router.replace('/onboarding/style' as Href);
      return;
    }
    await routeAfterAuth(userId, router);
  };

  const handleGooglePress = () => {
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_auth_started', { method: 'google' });
    void promptGoogleSignIn();
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    // Validate email
    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;

    // Validate username (require lowercase letters, numbers and underscores)
    if (!username) {
      errors.username = 'Username is required';
    } else if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      errors.username =
        'Username must be 3-24 characters: lowercase letters, numbers, and underscores only';
    }

    // Validate password using the same rules as password reset, so a
    // password that's valid here is never later rejected on reset.
    const passwordError = validateNewPassword(password);
    if (passwordError) errors.password = passwordError;

    // The 18+ attestation and Terms/Privacy acceptance are no longer separate
    // checkboxes: pressing "Create Account" IS the acceptance, and the consent
    // line above the button states both. Keep that copy in sync with this.

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    setAuthError(null);
    setFieldErrors({});

    if (!validateForm()) return;
    if (!isSupabaseConfigured) {
      setAuthError('Authentication service is not configured. Please contact support.');
      return;
    }

    // Generate correlation ID for tracking this auth attempt
    const correlationId = generateCorrelationId('signup');
    analyticsService.trackEvent('auth_signup_started', { method: 'email' });

    try {
      setIsLoading(true);
      console.log('[sign-up] Starting sign-up process (via backend)', { correlationId });

      // Register via backend to ensure duplicate-email checks use admin API
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedUsername = username.trim().toLowerCase();
      // Supabase edge functions require the anon key for unauthenticated calls
      if (!config.supabase.anonKey) {
        console.error('[sign-up] Supabase anon key is missing while Supabase is configured', {
          correlationId,
        });
        setAuthError('Authentication service is misconfigured. Please contact support.');
        return;
      }
      const anonKey = config.supabase.anonKey;
      const registerEndpoint = `${API_BASE_URL}/auth/register`;
      console.log('[sign-up] POST', registerEndpoint, { correlationId });
      const registerRes = await fetch(registerEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
        },
        body: JSON.stringify({ email: normalizedEmail, password, username: normalizedUsername }),
      });

      if (!registerRes.ok) {
        // Attempt to parse structured error body for clearer messaging
        const text = await registerRes.text().catch(() => '');
        let parsed: any = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {}
        const backendMessage =
          parsed?.error ||
          parsed?.message ||
          text ||
          registerRes.statusText ||
          'Failed to create account';

        // Always log the full response details for debugging — visible in Expo metro logs
        console.error('[sign-up] Registration request failed', {
          correlationId,
          status: registerRes.status,
          statusText: registerRes.statusText,
          url: registerEndpoint,
          rawBody: text,
          parsedError: backendMessage,
        });

        // A rejected registration used to leave no analytics trace: every
        // branch below only calls setAuthError and returns, and the outer
        // catch never runs for a resolved HTTP response. Capture the failure
        // once here so it covers every rejection branch, carrying the HTTP
        // status and a groupable reason.
        analyticsService.trackEvent('auth_signup_failed', {
          method: 'email',
          status: registerRes.status,
          reason: classifyRegisterFailure(registerRes.status, String(backendMessage)),
        });

        if (registerRes.status === 409) {
          const errLower = String(backendMessage).toLowerCase();
          if (errLower.includes('email')) {
            setAuthError(
              'This email is already registered. Please sign in instead or use password reset.'
            );
            return;
          }
          if (errLower.includes('username')) {
            setAuthError('This username is already taken. Please choose another.');
            return;
          }
          setAuthError('Account already exists. Please sign in or choose different credentials.');
          return;
        }

        // Supabase Edge Runtime returns "Invalid JWT" (401) when the anon key
        // doesn't match the project — surface a friendlier message.
        if (
          registerRes.status === 401 ||
          String(backendMessage).toLowerCase().includes('invalid jwt') ||
          String(backendMessage).toLowerCase().includes('missing jwt')
        ) {
          console.error('[sign-up] Auth service configuration error (JWT rejected)', {
            correlationId,
          });
          setAuthError(
            'Unable to reach the sign-up service. Please try again later or contact support.'
          );
          return;
        }

        // Supabase Edge Runtime returns 404 when the Function is not deployed or the URL is wrong
        if (registerRes.status === 404) {
          console.error(
            '[sign-up] Registration endpoint not found — check API_BASE_URL and edge function deployment',
            {
              correlationId,
              url: registerEndpoint,
            }
          );
          setAuthError('Sign-up service is temporarily unavailable. Please try again later.');
          return;
        }

        // 5xx or explicit "internal server error" messages from the edge runtime
        // should not be shown verbatim — surface a friendly, actionable message.
        // Avoid masking messages that merely start with "internal"
        // (e.g. "internal validation failed").
        const msgLower = String(backendMessage).toLowerCase();
        const isInternalServerError =
          msgLower === 'internal server error' ||
          msgLower.includes('internal server error') ||
          msgLower === 'internal_server_error' ||
          msgLower.includes('internal_server_error');
        if (
          registerRes.status >= 500 ||
          isInternalServerError ||
          msgLower === 'error' ||
          msgLower.includes('unexpected error')
        ) {
          setAuthError('Something went wrong on our end. Please try again in a moment.');
          return;
        }

        setAuthError(backendMessage);
        return;
      }

      // Registration succeeded. Now sign in the user to create a session.
      //
      // A newly registered user must NEVER be asked to authenticate a second
      // time, so this is the one place allowed to fail "half way": the account
      // exists but no session does. That state is handled explicitly below
      // (accountCreatedNeedsSignIn) instead of being reported as a generic
      // error that leaves the user on a form which will now answer
      // "email already registered" — a dead end.
      try {
        const session = await signInAfterRegister(normalizedEmail, password, correlationId);

        // Track the signup funnel event as soon as registration + sign-in
        // succeed. We track regardless of whether a session was returned
        // (email-confirmation flow still counts as a signup conversion).
        try {
          await analyticsService.trackEvent('signup_completed', {
            method: 'email',
            has_session: !!session,
            lifecycle_stage: 'signed_up',
          });
        } catch {
          /* analytics is best-effort */
        }

        // Clear the credential fields for security. `email` is deliberately
        // kept: if the session could not be established it is prefilled on the
        // sign-in screen, and it is never a secret.
        setPassword('');

        if (!session) {
          // The backend creates users with `email_confirm: true`
          // (supabase/functions/auth/index.ts), so this is not the normal
          // path — it means confirmation is enabled at the project level.
          // Show the explicit verification state rather than routing into the
          // authenticated app with no session.
          analyticsService.trackEvent('auth_signup_requires_confirmation', { method: 'email' });
          router.replace('/auth/email-confirmation' as Href);
          try {
            markInitialNavigationDone();
          } catch {}
          return;
        }

        // Session established — this device has now completed a sign-up, so a
        // later logout shows the log-in form instead of first-run onboarding.
        //
        // No separate `auth_signup_success` event here: it fired every time
        // alongside `signup_completed` for this exact branch (confirmed ~1:1
        // live in PostHog — 37 vs 34 events/45d), and `signup_completed`
        // already carries `has_session: true` for precisely this outcome. The
        // other auth_signup_* diagnostic events stay, since they cover
        // branches `signup_completed` never fires for at all.
        void markDeviceHasSignedIn();

        // Decide the destination from what we actually know right now. The
        // account was created seconds ago, so onboarding is incomplete unless
        // the profile explicitly says otherwise; every uncertain outcome
        // (query error, missing row) resolves to "continue onboarding", never
        // to a screen that asks the user to sign in again.
        let onboardingComplete = false;
        try {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('username, onboarding_completed')
            .eq('id', session.user.id)
            .single();

          if (profileError && profileError.code !== 'PGRST116') {
            console.error('[sign-up] Profile check error after register', {
              correlationId,
              error: profileError,
            });
          }
          onboardingComplete = !!profile?.username && profile?.onboarding_completed === true;
        } catch (err) {
          console.error('[sign-up] Profile check threw after register', {
            correlationId,
            error: err,
          });
        }

        // Route straight to the first post-auth onboarding step rather than to
        // the /onboarding gate. The gate has to re-derive state that is
        // already known here, and any gap in that derivation used to surface
        // as the pre-auth welcome screen. The card-style pick is the first
        // thing a new account sees — see app/onboarding/style.tsx, which
        // continues on to role-select.
        router.replace((onboardingComplete ? '/tabs/bounty-app' : '/onboarding/style') as Href);
        try {
          markInitialNavigationDone();
        } catch {}
      } catch (err: any) {
        // Registration definitely succeeded (we are past the !ok branch), so
        // never tell the user their sign-up failed. Offer the one action that
        // completes the job.
        console.error('[sign-up] Could not establish a session after register', err, {
          correlationId,
        });
        analyticsService.trackEvent('auth_signup_session_failed', {
          method: 'email',
          reason: parseAuthError(err, correlationId).category,
        });
        setPassword('');
        // Prefill the sign-in screen so the recovery costs one tap, not a
        // retype (app/auth/sign-in-form.tsx reads this key on mount).
        try {
          await storage.setItem('lastUsedEmail', normalizedEmail);
        } catch {
          /* prefill is a convenience — never block recovery on it */
        }
        setAccountCreatedNeedsSignIn(true);
        setAuthError(null);
        return;
      }
    } catch (e: any) {
      console.error('[sign-up] Unexpected error:', e, { correlationId });

      // Parse error using centralized handler
      const authError = parseAuthError(e, correlationId);
      analyticsService.trackEvent('auth_signup_failed', {
        method: 'email',
        reason: authError.category,
      });
      setAuthError(authError.userMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Hands the user off to sign-in with their email already filled in, so the
  // "account created but no session" recovery costs one tap and no retyping.
  const handleGoToSignIn = () => {
    router.replace(ROUTES.AUTH.SIGN_IN as Href);
  };

  // Account created, but no session. Re-submitting the form is guaranteed to
  // fail from here ("Email already registered"), so replace it with the one
  // action that finishes the job. Nothing about the account is lost — the user
  // just needs to sign in once.
  if (accountCreatedNeedsSignIn) {
    return (
      <View
        className="flex-1 items-center justify-center px-8"
        style={{ backgroundColor: theme.background }}
      >
        <MaterialIcons name="check-circle" size={56} color={theme.primary} />
        <Text
          className="text-xl font-bold mt-4 text-center"
          style={{ color: theme.text }}
        >
          Your account is ready
        </Text>
        <Text
          className="text-sm mt-3 text-center"
          style={{ color: theme.textSecondary, lineHeight: 20 }}
        >
          We created your account but couldn&apos;t sign you in automatically — this is
          usually a brief connection problem. Sign in once and you&apos;re in.
        </Text>
        <View className="w-full mt-8">
          <TouchableOpacity
            onPress={handleGoToSignIn}
            className="items-center justify-center rounded-full"
            style={{ backgroundColor: theme.primary, height: 56 }}
            accessibilityRole="button"
            accessibilityLabel="Go to sign in"
          >
            <Text style={{ color: theme.background, fontSize: 18, fontWeight: '700' }}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <>
      {/* Deliberately NOT a KeyboardAvoidingView: that resized this container,
          which dragged the docked button up so it rode on top of the keyboard.
          The screen keeps its full height and the keyboard simply covers the
          button; dismissing the keyboard reveals it again. The scroll view
          takes the keyboard as an inset instead, so the focused field stays
          visible without anything outside the scroll area moving. */}
      <View style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace(ROUTES.AUTH.SIGN_IN as Href))}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="arrow-back" size={icons.back} color={theme.text} />
          </TouchableOpacity>

          <OnboardingProgressDots
            total={SIGNUP_TOTAL_STEPS}
            activeIndex={0}
            style={styles.dots}
            activeColor={theme.primary}
            inactiveColor={theme.border}
          />

          <Text style={styles.heading}>Create your account.</Text>

          {authError ? (
            <View
              style={styles.errorBanner}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.errorBannerText}>{authError}</Text>
            </View>
          ) : null}

          {Platform.OS === 'ios' && (
            <TouchableOpacity
              onPress={handleAppleContinue}
              disabled={socialLoading || !isAppleAvailable}
              style={styles.appleButton}
              accessibilityRole="button"
              accessibilityLabel="Continue with Apple"
              accessibilityState={{ disabled: socialLoading || !isAppleAvailable, busy: socialLoading }}
            >
              {socialLoading ? (
                // Black on the white Apple button, per Apple's guidelines — not a
                // theme colour, and correct in both modes.
                <ActivityIndicator color={palette.black} style={styles.buttonIcon} />
              ) : (
                <FontAwesome
                  name="apple"
                  size={icons.field}
                  color={palette.black}
                  style={styles.buttonIcon}
                />
              )}
              <Text style={styles.appleButtonText}>Continue with Apple</Text>
            </TouchableOpacity>
          )}

          {/* Always rendered: Google is part of this screen's design, so a build
              missing EXPO_PUBLIC_GOOGLE_*_CLIENT_ID shows it visibly disabled
              rather than silently dropping a sign-in method. The disabled state
              is on the element itself, so assistive tech doesn't read an inert
              button as actionable. */}
          <TouchableOpacity
            onPress={handleGooglePress}
            disabled={!isGoogleConfigured || !googleRequest || socialLoading}
            style={[styles.googleButton, !isGoogleConfigured && styles.buttonUnavailable]}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            accessibilityState={{
              disabled: !isGoogleConfigured || !googleRequest || socialLoading,
              busy: socialLoading,
            }}
          >
            {socialLoading ? (
              <ActivityIndicator color={theme.text} style={styles.buttonIcon} />
            ) : (
              <View style={styles.buttonIcon}>
                <GoogleLogo size={icons.field} />
              </View>
            )}
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={styles.fieldLabel}>Email</Text>
          <View style={[styles.field, !!fieldErrors.email && styles.fieldInvalid]}>
            <MaterialIcons name="mail-outline" size={icons.field} color={theme.textSecondary} />
            <TextInput
              value={email}
              onChangeText={text => {
                setEmail(text);
                if (fieldErrors.email) {
                  setFieldErrors(prev => ({ ...prev, email: '' }));
                }
                setEmailSuggestion(suggestEmailCorrection(text));
              }}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType={Platform.OS === 'ios' ? 'emailAddress' : undefined}
              editable={!isLoading}
              style={styles.fieldInput}
              placeholderTextColor={theme.textDisabled}
              returnKeyType="next"
              blurOnSubmit={false}
            />
          </View>
          {fieldErrors.email ? <ValidationMessage message={fieldErrors.email} /> : null}
          {emailSuggestion ? (
            <TouchableOpacity
              onPress={() => {
                setEmail(emailSuggestion);
                setEmailSuggestion(null);
                setFieldErrors(prev => ({ ...prev, email: '' }));
              }}
              accessibilityRole="button"
              accessibilityLabel={`Use suggested email: ${emailSuggestion}`}
            >
              <Text style={styles.helperWarning}>
                Did you mean <Text style={styles.helperWarningStrong}>{emailSuggestion}</Text>?
              </Text>
            </TouchableOpacity>
          ) : null}

          <Text style={styles.fieldLabel}>Username</Text>
          <View
            style={[
              styles.field,
              usernameAvailability === 'available' && styles.fieldValid,
              (!!fieldErrors.username || usernameAvailability === 'taken') && styles.fieldInvalid,
            ]}
          >
            <Text style={styles.fieldPrefix}>@</Text>
            <TextInput
              value={username}
              onChangeText={text => {
                // Normalize to lowercase to match onboarding rules
                setUsername(text.toLowerCase());
                if (fieldErrors.username) setFieldErrors(prev => ({ ...prev, username: '' }));
              }}
              placeholder="username"
              autoCapitalize="none"
              autoComplete="username-new"
              textContentType={Platform.OS === 'ios' ? 'username' : undefined}
              editable={!isLoading}
              style={styles.fieldInput}
              placeholderTextColor={theme.textDisabled}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            {usernameAvailability === 'checking' && (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            )}
            {usernameAvailability === 'available' && (
              <MaterialIcons name="check-circle" size={icons.status} color={theme.primary} />
            )}
          </View>
          {/* Height is reserved whether or not a hint is showing, so the
              availability result doesn't shove the rest of the form downward. */}
          <View style={styles.helperSlot}>
            {fieldErrors.username ? (
              <ValidationMessage message={fieldErrors.username} />
            ) : usernameAvailability === 'available' ? (
              <Text style={styles.helperSuccess}>@{username} is available</Text>
            ) : usernameAvailability === 'taken' ? (
              <Text style={styles.helperError}>@{username} is already taken</Text>
            ) : null}
          </View>

          <Text style={styles.fieldLabel}>Password</Text>
          <View style={[styles.field, !!fieldErrors.password && styles.fieldInvalid]}>
            <MaterialIcons name="lock-outline" size={icons.field} color={theme.textSecondary} />
            <TextInput
              ref={passwordRef}
              value={password}
              onChangeText={text => {
                setPassword(text);
                if (fieldErrors.password) {
                  setFieldErrors(prev => ({ ...prev, password: '' }));
                }
              }}
              placeholder="At least 8 characters"
              secureTextEntry={!showPassword}
              autoComplete="password-new"
              textContentType={Platform.OS === 'ios' ? 'newPassword' : undefined}
              passwordRules={Platform.OS === 'ios' ? IOS_NEW_PASSWORD_RULES : undefined}
              editable={!isLoading}
              style={styles.fieldInput}
              placeholderTextColor={theme.textDisabled}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(s => !s)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <MaterialIcons
                name={showPassword ? 'visibility-off' : 'visibility'}
                size={icons.field}
                color={theme.textSecondary}
              />
            </TouchableOpacity>
          </View>
          {fieldErrors.password ? <ValidationMessage message={fieldErrors.password} /> : null}
          {/* Same reservation as the username hint: the meter fades in on the
              first keystroke and must not change the form's height when it does. */}
          <View style={styles.strengthRow}>
            {passwordStrength ? (
              <>
                <View style={styles.strengthTrack}>
                <View
                  style={[
                    styles.strengthFill,
                    {
                      width: `${getStrengthWidth(passwordStrength.score)}%`,
                      backgroundColor: getStrengthColor(passwordStrength.level),
                    },
                    ]}
                  />
                </View>
                <Text
                  style={[styles.strengthLabel, { color: getStrengthColor(passwordStrength.level) }]}
                >
                  {passwordStrength.level.replace('-', ' ')}
                </Text>
              </>
            ) : null}
          </View>

          {/* Sits at the bottom of the form on a tall device and tightens up on
              a short one, which keeps the blurb below visible without scrolling. */}
          <View style={styles.spacer} />

          {/* Pressing "Create Account" IS the acceptance — this line carries the
              18+ attestation and the Terms/Privacy consent that used to be two
              separate checkboxes. Keep it in sync with validateForm. */}
          <Text style={styles.legalText}>
            By continuing you confirm you&apos;re 18 or older and agree to our{' '}
            <Text
              style={styles.legalLink}
              onPress={() => setLegalModal('terms')}
              accessibilityRole="link"
            >
              Terms
            </Text>
            {' and '}
            <Text
              style={styles.legalLink}
              onPress={() => setLegalModal('privacy')}
              accessibilityRole="link"
            >
              Privacy Policy
            </Text>
            .
          </Text>

          <Text style={styles.reassuranceText}>
            Takes about a minute. We save as you go, and you can change anything later.
          </Text>
        </ScrollView>

        {/* Only the action is docked. Anything that grows inside the form (the
            strength meter, a username hint, a field error) used to push this
            button below the fold; keeping it outside the ScrollView makes that
            structurally impossible. */}
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={isLoading}
            style={styles.submitButton}
            accessibilityRole="button"
            accessibilityLabel="Create account"
            accessibilityState={{ disabled: isLoading, busy: isLoading }}
          >
            {isLoading && <ActivityIndicator color={theme.background} style={styles.buttonIcon} />}
            <Text style={styles.submitButtonText}>Create Account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.replace(ROUTES.AUTH.SIGN_IN as Href)}
            accessibilityRole="button"
            accessibilityLabel="Already have an account? Sign in"
          >
            <Text style={styles.signInLink}>Already have an account? Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Modal
        visible={legalModal !== null}
        animationType="slide"
        onRequestClose={() => setLegalModal(null)}
        statusBarTranslucent
      >
        {/*
          SafeAreaView from react-native-safe-area-context does NOT receive top
          insets when rendered inside a React Native Modal, so we omit the 'top'
          edge here and apply the top inset manually on the header View below
          (using insets.top captured in the parent context where the provider works).
        */}
        <SafeAreaView className="flex-1" style={{ backgroundColor: theme.surface }} edges={['left', 'right', 'bottom']}>
          <View
            className="flex-row justify-between items-center px-4 pb-4"
            style={{ paddingTop: Math.max(insets.top, Platform.OS === 'ios' ? 44 : 16) }}
          >
            <View className="flex-row items-center flex-1 mr-2">
              <MaterialIcons
                name={legalModal === 'terms' ? 'gavel' : 'privacy-tip'}
                size={24}
                color={theme.text}
              />
              <Text
                className="text-lg font-bold tracking-wider ml-2 flex-1"
                style={{ color: theme.text }}
                numberOfLines={1}
              >
                {legalModal === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setLegalModal(null)}
              className="p-2"
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <MaterialIcons name="close" size={24} color={theme.text} />
            </TouchableOpacity>
          </View>
          <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
            <LegalText text={legalModal === 'terms' ? TERMS_TEXT : PRIVACY_TEXT} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

// Layout reference: an iPhone 14 viewport (390 x 844) minus its safe-area
// insets (47 top, 34 bottom). Every value below was budgeted against that
// usable height so the "Create Account" button lands above the fold, and is
// then scaled to the real device rather than shipped as fixed pixels.
const BASE_WIDTH = 390;
const BASE_USABLE_HEIGHT = 763;

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

function makeLayout(
  theme: AppTheme,
  width: number,
  height: number,
  insetTop: number,
  insetBottom: number
) {
  // Icons, radii and horizontal padding track the width. Vertical rhythm and
  // control heights track the usable height instead, so a short device tightens
  // the gaps rather than pushing content off-screen. Both are clamped so a
  // tablet doesn't render a comically oversized phone form.
  const hScale = clamp(width / BASE_WIDTH, 0.85, 1.3);
  const vScale = clamp(
    (height - insetTop - insetBottom) / BASE_USABLE_HEIGHT,
    0.8,
    1.15
  );
  // Type follows whichever axis is tighter: a short screen has to shrink its
  // text as well as its gaps, or four lines of legal copy eat the room the
  // consent blurb needs to stay on screen.
  const tScale = Math.min(hScale, vScale);
  const f = (n: number) => Math.round(n * hScale);
  const v = (n: number) => Math.round(n * vScale);
  const t = (n: number) => Math.round(n * tScale);

  return {
    icons: { back: f(24), field: f(20), status: f(22) },
    styles: StyleSheet.create({
      flex: {
        flex: 1,
        backgroundColor: theme.background,
      },
      scroll: {
        flex: 1,
        backgroundColor: theme.background,
      },
      scrollContent: {
        flexGrow: 1,
        paddingHorizontal: f(24),
        paddingTop: insetTop + v(4),
        // The pinned footer below carries the bottom inset.
        paddingBottom: v(2),
      },
      backButton: {
        alignSelf: 'flex-start',
        padding: f(6),
        marginLeft: -f(6),
      },
      dots: {
        paddingTop: v(4),
      },
      heading: {
        fontSize: t(30),
        lineHeight: t(36),
        fontWeight: '800',
        letterSpacing: -0.5 * tScale,
        color: theme.text,
        marginTop: v(14),
        marginBottom: v(16),
      },
      errorBanner: {
        borderRadius: f(14),
        padding: f(14),
        marginBottom: v(16),
        // Error tint derived from the token rather than a fixed rgba() red, so
        // the wash tracks the theme: 15% fill, 60% border.
        backgroundColor: `${theme.error}26`,
        borderWidth: 1,
        borderColor: `${theme.error}99`,
      },
      errorBannerText: {
        color: theme.error,
        fontSize: t(14),
        lineHeight: t(20),
      },
      // Apple's Sign in with Apple button is brand-mandated: white fill,
      // black mark and label, not theme colours. The border is ours — without
      // it a white pill on the light theme's white background has no edge.
      appleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: v(52),
        borderRadius: 999,
        backgroundColor: palette.white,
        borderWidth: 1,
        borderColor: theme.border,
      },
      appleButtonText: {
        color: palette.black,
        fontSize: t(16),
        fontWeight: '700',
      },
      googleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: v(52),
        borderRadius: 999,
        marginTop: v(10),
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.border,
      },
      googleButtonText: {
        color: theme.text,
        fontSize: t(16),
        fontWeight: '700',
      },
      buttonIcon: {
        marginRight: f(10),
      },
      buttonUnavailable: {
        opacity: 0.45,
      },
      dividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: v(16),
      },
      dividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: theme.border,
      },
      dividerText: {
        marginHorizontal: f(14),
        fontSize: t(13),
        color: theme.textSecondary,
      },
      fieldLabel: {
        fontSize: t(14),
        fontWeight: '600',
        color: theme.textSecondary,
        marginTop: v(14),
        marginBottom: v(6),
      },
      field: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: f(12),
        height: v(52),
        paddingHorizontal: f(16),
        borderRadius: f(14),
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
      },
      fieldValid: {
        borderColor: theme.primary,
      },
      fieldInvalid: {
        borderColor: theme.error,
      },
      fieldInput: {
        flex: 1,
        fontSize: t(16),
        color: theme.text,
        // Android gives TextInput its own vertical padding, which would make
        // the row taller than the fixed-height field it sits in.
        padding: 0,
      },
      fieldPrefix: {
        fontSize: t(16),
        color: theme.textSecondary,
      },
      helperSuccess: {
        fontSize: t(12.5),
        color: theme.primaryLight,
      },
      helperError: {
        fontSize: t(12.5),
        color: theme.error,
      },
      helperWarning: {
        fontSize: t(12.5),
        color: theme.warning,
        marginTop: v(6),
      },
      helperWarningStrong: {
        fontWeight: '600',
        textDecorationLine: 'underline',
      },
      // One hint line, always occupying the same room whether filled or empty.
      helperSlot: {
        minHeight: t(13) + v(6),
        justifyContent: 'center',
      },
      strengthRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: f(10),
        marginTop: v(6),
        minHeight: t(14),
      },
      strengthTrack: {
        flex: 1,
        height: v(6),
        borderRadius: 999,
        overflow: 'hidden',
        backgroundColor: theme.overlay,
      },
      strengthFill: {
        height: '100%',
        borderRadius: 999,
      },
      strengthLabel: {
        fontSize: t(12),
        fontWeight: '600',
        textTransform: 'capitalize',
        minWidth: f(76),
        textAlign: 'right',
      },
      // Absorbs leftover height so the blurb below it sits at the foot of the
      // form on a tall device, and collapses to nothing on a short one.
      spacer: {
        flex: 1,
      },
      // Pinned below the scroll area, so nothing the form does can move it.
      footer: {
        paddingHorizontal: f(24),
        paddingTop: v(8),
        paddingBottom: insetBottom + v(6),
        backgroundColor: theme.background,
      },
      legalText: {
        fontSize: t(13),
        lineHeight: t(18),
        color: theme.textSecondary,
        marginTop: v(12),
      },
      legalLink: {
        color: theme.text,
        textDecorationLine: 'underline',
      },
      reassuranceText: {
        fontSize: t(13),
        lineHeight: t(18),
        color: theme.textSecondary,
        marginTop: v(6),
      },
      submitButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: v(54),
        borderRadius: 999,
        backgroundColor: theme.primary,
        shadowColor: theme.primary,
        shadowOpacity: 0.45,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
      },
      submitButtonText: {
        color: theme.background,
        fontSize: t(17),
        fontWeight: '700',
      },
      signInLink: {
        textAlign: 'center',
        fontSize: t(13),
        fontWeight: '600',
        color: theme.textSecondary,
        marginTop: v(12),
      },
    }),
  };
}
