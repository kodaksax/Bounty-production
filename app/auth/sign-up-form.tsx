'use client';
import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { Session } from '@supabase/supabase-js';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIVACY_TEXT } from '../../assets/legal/privacy';
import { TERMS_TEXT } from '../../assets/legal/terms';
import { Button } from '../../components/ui/button';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { config } from '../../lib/config';
import { API_BASE_URL } from '../../lib/config/api';
import useScreenBackground from '../../lib/hooks/useScreenBackground';
import { ROUTES } from '../../lib/routes';
import { storage } from '../../lib/storage';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { analyticsService } from '../../lib/services/analytics-service';
import { markDeviceHasSignedIn } from '../../lib/storage/onboarding';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { generateCorrelationId, parseAuthError } from '../../lib/utils/auth-errors';
import { suggestEmailCorrection, validateEmail } from '../../lib/utils/auth-validation';
import {
    calculatePasswordStrength,
    getStrengthColor,
    getStrengthWidth,
    validateNewPassword,
    validatePasswordMatch,
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

export default function SignUpRoute() {
  return <SignUpForm />;
}

export function SignUpForm() {
  const { theme } = useAppThemeContext();
  useScreenBackground(theme.background);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [legalModal, setLegalModal] = useState<'terms' | 'privacy' | null>(null);
  // Terminal-but-recoverable state: the account WAS created, but the sign-in
  // that normally follows it could not establish a session. Re-submitting the
  // form would now fail with "email already registered", so the form is
  // replaced by a single explicit action instead of a generic error.
  const [accountCreatedNeedsSignIn, setAccountCreatedNeedsSignIn] = useState(false);

  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  // Password strength tracking — same rules/UI pattern as the reset-password
  // flow (lib/utils/password-validation.ts), so sign-up and password reset
  // never disagree about what makes a valid password.
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrengthResult | null>(null);
  useEffect(() => {
    setPasswordStrength(password ? calculatePasswordStrength(password) : null);
  }, [password]);

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

    // Validate password match
    const confirmError = validatePasswordMatch(password, confirmPassword);
    if (confirmError) errors.confirmPassword = confirmError;

    // Require age verification per App Store policy
    if (!ageVerified) {
      errors.ageVerified = 'You must confirm you are 18 or older to create an account.';
    }
    if (!termsAccepted) {
      errors.termsAccepted = 'You must accept the Terms & Privacy policy to continue.';
    }

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
        setConfirmPassword('');
        setAgeVerified(false);
        setTermsAccepted(false);

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
        void markDeviceHasSignedIn();
        analyticsService.trackEvent('auth_signup_success', { method: 'email' });

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
        // as the pre-auth welcome screen.
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
        setConfirmPassword('');
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
          <Button onPress={handleGoToSignIn} accessibilityLabel="Go to sign in">
            Sign In
          </Button>
        </View>
      </View>
    );
  }

  return (
    <>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 px-6 pt-20 pb-8" style={{ backgroundColor: theme.background }}>
            <TouchableOpacity
              onPress={() => (router.canGoBack() ? router.back() : router.replace(ROUTES.AUTH.SIGN_IN as Href))}
              className="self-start p-2 mb-4"
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <MaterialIcons name="arrow-back" size={24} color={theme.text} />
            </TouchableOpacity>
            <View className="flex-row items-center justify-center mb-10">
              <BrandingLogo size="large" />
            </View>
            <View className="gap-5">
              {authError ? (
                <View className="bg-red-500/20 border border-red-400 rounded p-3">
                  <Text style={{ color: theme.isDark ? '#fecaca' : '#991b1b', fontSize: 14 }}>{authError}</Text>
                </View>
              ) : null}

              <View>
                <Text className="text-sm mb-1" style={{ color: theme.text }}>Username</Text>
                <TextInput
                  value={username}
                  onChangeText={text => {
                    // Normalize to lowercase to match onboarding rules
                    setUsername(text.toLowerCase());
                    if (fieldErrors.username) setFieldErrors(prev => ({ ...prev, username: '' }));
                  }}
                  placeholder="Choose a username (3-24 chars)"
                  autoCapitalize="none"
                  autoComplete="username-new"
                  textContentType={Platform.OS === 'ios' ? 'username' : undefined}
                  editable={!isLoading}
                  className={`w-full rounded px-3 py-3 ${fieldErrors.username ? 'border border-red-400' : ''}`}
                  style={{ backgroundColor: theme.surfaceSecondary, color: theme.text }}
                  placeholderTextColor={theme.textDisabled}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => {
                    /* focus next field (email) */
                  }}
                />
                {fieldErrors.username ? <ValidationMessage message={fieldErrors.username} /> : null}
              </View>

              <View>
                <Text className="text-sm mb-1" style={{ color: theme.text }}>Email</Text>
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
                  className={`w-full rounded px-3 py-3 ${fieldErrors.email ? 'border border-red-400' : ''}`}
                  style={{ backgroundColor: theme.surfaceSecondary, color: theme.text }}
                  placeholderTextColor={theme.textDisabled}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
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
                    <Text className="text-yellow-300 text-xs mt-1">
                      Did you mean <Text className="underline font-medium">{emailSuggestion}</Text>?
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <View>
                <Text className="text-sm mb-1" style={{ color: theme.text }}>Password</Text>
                <View className="relative">
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
                    className={`w-full rounded px-3 py-3 pr-12 ${fieldErrors.password ? 'border border-red-400' : ''}`}
                    style={{ backgroundColor: theme.surfaceSecondary, color: theme.text }}
                    placeholderTextColor={theme.textDisabled}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <MaterialIcons
                      name={showPassword ? 'visibility-off' : 'visibility'}
                      size={20}
                      color={theme.text}
                    />
                  </TouchableOpacity>
                </View>
                {fieldErrors.password ? <ValidationMessage message={fieldErrors.password} /> : null}

                {passwordStrength && (
                  <View className="mt-3">
                    <View className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary }}>
                      <View
                        style={{
                          width: `${getStrengthWidth(passwordStrength.score)}%`,
                          height: '100%',
                          backgroundColor: getStrengthColor(passwordStrength.level),
                          borderRadius: 4,
                        }}
                      />
                    </View>
                    <Text
                      style={{ color: getStrengthColor(passwordStrength.level) }}
                      className="text-xs mt-1 capitalize"
                    >
                      {passwordStrength.level.replace('-', ' ')}
                    </Text>
                    <View className="mt-2 rounded-lg p-3" style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary }}>
                      {passwordStrength.requirements.map((req) => (
                        <View key={req.id} className="flex-row items-center mb-1">
                          <MaterialIcons
                            name={req.met ? 'check-circle' : 'radio-button-unchecked'}
                            size={14}
                            color={req.met ? theme.primary : theme.textSecondary}
                          />
                          <Text
                            className="text-xs ml-2"
                            style={{ color: req.met ? theme.primary : theme.textSecondary }}
                          >
                            {req.label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>

              <View>
                <Text className="text-sm mb-1" style={{ color: theme.text }}>Confirm Password</Text>
                <View className="relative">
                  <TextInput
                    ref={confirmPasswordRef}
                    value={confirmPassword}
                    onChangeText={text => {
                      setConfirmPassword(text);
                      if (fieldErrors.confirmPassword) {
                        setFieldErrors(prev => ({ ...prev, confirmPassword: '' }));
                      }
                    }}
                    placeholder="Confirm password"
                    secureTextEntry={!showConfirmPassword}
                    autoComplete="password-new"
                    textContentType={Platform.OS === 'ios' ? 'newPassword' : undefined}
                    passwordRules={Platform.OS === 'ios' ? IOS_NEW_PASSWORD_RULES : undefined}
                    editable={!isLoading}
                    className={`w-full rounded px-3 py-3 pr-12 ${fieldErrors.confirmPassword ? 'border border-red-400' : ''}`}
                    style={{ backgroundColor: theme.surfaceSecondary, color: theme.text }}
                    placeholderTextColor={theme.textDisabled}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    <MaterialIcons
                      name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                      size={20}
                      color={theme.text}
                    />
                  </TouchableOpacity>
                </View>
                {fieldErrors.confirmPassword ? (
                  <ValidationMessage message={fieldErrors.confirmPassword} />
                ) : null}
              </View>

              <View className="flex-row items-center mt-2">
                <TouchableOpacity
                  onPress={() => setAgeVerified(v => !v)}
                  className="mr-3"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ageVerified }}
                >
                  <MaterialIcons
                    name={ageVerified ? 'check-box' : 'check-box-outline-blank'}
                    size={22}
                    color={ageVerified ? theme.primary : theme.text}
                  />
                </TouchableOpacity>
                <Text style={{ color: theme.text }}>I confirm I am 18 years or older</Text>
              </View>
              {fieldErrors.ageVerified ? (
                <ValidationMessage message={fieldErrors.ageVerified} />
              ) : null}

              <View className="mt-3">
                <View className="flex-row items-start">
                  <TouchableOpacity
                    onPress={() => setTermsAccepted(v => !v)}
                    className="mr-3 mt-0.5"
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: termsAccepted }}
                  >
                    <MaterialIcons
                      name={termsAccepted ? 'check-box' : 'check-box-outline-blank'}
                      size={22}
                      color={termsAccepted ? theme.primary : theme.text}
                    />
                  </TouchableOpacity>
                  <View className="flex-1 flex-row flex-wrap">
                    <Text style={{ color: theme.text }}>I accept the </Text>
                    <TouchableOpacity
                      onPress={() => setLegalModal('terms')}
                      accessibilityRole="link"
                      accessibilityLabel="View Terms of Service"
                    >
                      <Text className="underline" style={{ color: theme.text }}>Terms of Service</Text>
                    </TouchableOpacity>
                    <Text style={{ color: theme.text }}> and </Text>
                    <TouchableOpacity
                      onPress={() => setLegalModal('privacy')}
                      accessibilityRole="link"
                      accessibilityLabel="View Privacy Policy"
                    >
                      <Text className="underline" style={{ color: theme.text }}>Privacy Policy</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {fieldErrors.termsAccepted ? (
                  <View className="ml-9">
                    <ValidationMessage message={fieldErrors.termsAccepted} />
                  </View>
                ) : null}
              </View>

              <Button
                onPress={handleSubmit}
                loading={isLoading}
                accessibilityLabel="Create account"
              >
                Create Account
              </Button>

              <TouchableOpacity
                onPress={() => router.replace(ROUTES.AUTH.SIGN_IN as Href)}
                accessibilityRole="button"
                accessibilityLabel="Back to sign in"
              >
                <Text className="text-center mt-6" style={{ color: theme.text }}>Back to Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
            {(legalModal === 'terms' ? TERMS_TEXT : PRIVACY_TEXT).split(/\n\n+/).map((p, i) => (
              <Text key={i} className="text-sm leading-6 mb-3" style={{ color: theme.text }}>
                {p}
              </Text>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
