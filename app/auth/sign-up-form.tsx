'use client';
import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
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
import { ValidationPatterns } from '../../hooks/use-form-validation';
import { config } from '../../lib/config';
import { API_BASE_URL } from '../../lib/config/api';
import useScreenBackground from '../../lib/hooks/useScreenBackground';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { analyticsService } from '../../lib/services/analytics-service';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { generateCorrelationId, parseAuthError } from '../../lib/utils/auth-errors';
import { suggestEmailCorrection, validateEmail } from '../../lib/utils/auth-validation';
import { markInitialNavigationDone } from '../initial-navigation/initialNavigation';

// iOS Password AutoFill rules for the sign-up password fields.
// Kept in sync with the client-side validation in `validateForm` so the
// system-generated "Strong Password" satisfies our requirements.
const IOS_NEW_PASSWORD_RULES = 'minlength: 8; required: lower; required: upper; required: digit;';

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

  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

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

    // Validate password - at least 8 chars with uppercase, lowercase, and a number.
    // Requirements intentionally match iOS's auto-generated "Strong Password" format
    // (letters + digits + hyphens) so Apple's password autofill works on sign-up.
    if (!password) {
      errors.password = 'Password is required';
    } else if (!ValidationPatterns.password.test(password)) {
      errors.password =
        'Password must be at least 8 characters with uppercase, lowercase, and a number';
    }

    // Validate password match
    if (password && confirmPassword && password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    } else if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    }

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
      try {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (signInError) {
          console.error('[sign-up] Sign-in after register failed', signInError, { correlationId });
          const authErr = parseAuthError(signInError, correlationId);
          setAuthError(authErr.userMessage);
          return;
        }

        const session = signInData.session;

        // Track the signup funnel event as soon as registration + sign-in
        // succeed. We track regardless of whether a session was returned
        // (email-confirmation flow still counts as a signup conversion).
        try {
          await analyticsService.trackEvent('user_signed_up', {
            method: 'email',
            hasSession: !!session,
          });
        } catch {
          /* analytics is best-effort */
        }

        // Clear form data for security
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setAgeVerified(false);
        setTermsAccepted(false);

        if (session) {
          // Proceed to profile check / onboarding as before
          try {
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('username, onboarding_completed')
              .eq('id', session.user.id)
              .single();

            if (profileError) {
              if (profileError.code === 'PGRST116') {
                router.replace('/onboarding' as Href);
                try {
                  markInitialNavigationDone();
                } catch {}
                return;
              }
              throw profileError;
            }

            if (!profile.username || profile.onboarding_completed !== true) {
              router.replace('/onboarding' as Href);
              try {
                markInitialNavigationDone();
              } catch {}
            } else {
              router.replace('/tabs/bounty-app' as Href);
              try {
                markInitialNavigationDone();
              } catch {}
            }
          } catch (err) {
            console.error('[sign-up] Profile check error after register', {
              correlationId,
              error: err,
            });
            router.replace('/onboarding' as Href);
            try {
              markInitialNavigationDone();
            } catch {}
          }
        } else {
          router.replace('/auth/email-confirmation' as Href);
          try {
            markInitialNavigationDone();
          } catch {}
        }
      } catch (err: any) {
        const authErr = parseAuthError(err, correlationId);
        setAuthError(authErr.userMessage);
        return;
      }
    } catch (e: any) {
      console.error('[sign-up] Unexpected error:', e, { correlationId });

      // Parse error using centralized handler
      const authError = parseAuthError(e, correlationId);
      setAuthError(authError.userMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 px-6 pt-20 pb-8" style={{ backgroundColor: theme.background }}>
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
                <Text className="text-xs mt-1" style={{ color: theme.textSecondary }}>
                  Must include uppercase, lowercase, and a number
                </Text>
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
                onPress={() => router.back()}
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
