"use client"
import { MaterialIcons } from '@expo/vector-icons'
import { ValidationMessage } from 'app/components/ValidationMessage'
import type { Href } from 'expo-router'
import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { BrandingLogo } from '../../components/ui/branding-logo'
import { ValidationPatterns } from '../../hooks/use-form-validation'
import useScreenBackground from '../../lib/hooks/useScreenBackground'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { generateCorrelationId, parseAuthError } from '../../lib/utils/auth-errors'
import { validateEmail, suggestEmailCorrection } from '../../lib/utils/auth-validation'
import { markInitialNavigationDone } from '../initial-navigation/initialNavigation'
import { colors } from '../../lib/theme';

export default function SignUpRoute() {
  return <SignUpForm />
}

export function SignUpForm() {
  // set status/safe-area color for this screen
  useScreenBackground('#097959ff') // EMERALD_800 / dark
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [ageVerified, setAgeVerified] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)

  const passwordRef = useRef<TextInput>(null)
  const confirmPasswordRef = useRef<TextInput>(null)

  const validateForm = () => {
    const errors: Record<string, string> = {}

    // Validate email
    const emailError = validateEmail(email)
    if (emailError) errors.email = emailError

    // Validate password - must meet strong password requirements
    if (!password) {
      errors.password = 'Password is required'
    } else if (!ValidationPatterns.strongPassword.test(password)) {
      errors.password = 'Password must be at least 8 characters with uppercase, lowercase, number, and special character (@$!%*?&)'
    }

    // Validate password match
    if (password && confirmPassword && password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match'
    } else if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password'
    }

    // Require age verification per App Store policy
    if (!ageVerified) {
      errors.ageVerified = 'You must confirm you are 18 or older to create an account.'
    }
    if (!termsAccepted) {
      errors.termsAccepted = 'You must accept the Terms & Privacy policy to continue.'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async () => {
    setAuthError(null)
    setFieldErrors({})

    if (!validateForm()) return
    if (!isSupabaseConfigured) {
      setAuthError('Authentication service is not configured. Please contact support.')
      return
    }

    // Generate correlation ID for tracking this auth attempt
    const correlationId = generateCorrelationId('signup');

    try {
      setIsLoading(true)
      console.log('[sign-up] Starting sign-up process', { correlationId })

      // SIMPLIFIED: Let Supabase handle its own timeout logic
      // See SIGN_IN_SIMPLIFICATION_SUMMARY.md for rationale
      // Pass age verification into user_metadata so backend can persist it
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(), // Normalize email
        password,
        options: {
          data: { age_verified: ageVerified }
        }
      })

      if (error) {
        console.error('[sign-up] Error:', error, { correlationId })

        // Parse error using centralized handler
        const authError = parseAuthError(error, correlationId);
        setAuthError(authError.userMessage)
        return
      }

      console.log('[sign-up] Sign-up successful', { correlationId, hasSession: !!data.session })

      // Clear form data for security (especially password)
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setAgeVerified(false)
      setTermsAccepted(false)

      // Keep user signed in after account creation (auto sign-in)
      // The user will be redirected to onboarding or app based on their profile status
      // Email verification gates will prevent posting/applying until verified
      if (data.session) {
        console.log('[sign-up] User automatically signed in, checking profile', { correlationId })

        try {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('username, onboarding_completed')
            .eq('id', data.session.user.id)
            .single()

          // Handle profile errors
          if (profileError) {
            if (profileError.code === 'PGRST116') {
              // Profile doesn't exist yet (expected for new users) - proceed to onboarding
              console.log('[sign-up] No profile found, redirecting to onboarding', { correlationId })
              router.replace('/onboarding' as Href)
              try { markInitialNavigationDone(); } catch { }
              return
            }
            // For other errors, throw to be caught by catch block
            throw profileError
          }

          // Profile exists - check if onboarding is complete
          // User needs onboarding if username is missing or onboarding_completed is not true
          // Note: onboarding_completed could be false or null for new users
          if (!profile.username || profile.onboarding_completed !== true) {
            console.log('[sign-up] Profile incomplete or onboarding not completed, redirecting to onboarding', {
              correlationId,
              hasUsername: !!profile.username,
              onboardingCompleted: profile.onboarding_completed
            })
            router.replace('/onboarding' as Href)
            try { markInitialNavigationDone(); } catch { }
          } else {
            // User has completed onboarding (edge case) - go to app
            console.log('[sign-up] Profile complete, redirecting to app', { correlationId })
            router.replace('/tabs/bounty-app' as Href)
            try { markInitialNavigationDone(); } catch { }
          }
        } catch (err) {
          // On error, proceed to onboarding to be safe
          console.error('[sign-up] Profile check error, proceeding to onboarding', { correlationId, error: err })
          router.replace('/onboarding' as Href)
          try { markInitialNavigationDone(); } catch { }
        }
      } else {
        // No session was created (shouldn't happen, but handle gracefully)
        console.warn('[sign-up] No session created after sign-up, showing email confirmation', { correlationId })
        router.replace('/auth/email-confirmation' as Href)
        try { markInitialNavigationDone(); } catch { }
      }
    } catch (e: any) {
      console.error('[sign-up] Unexpected error:', e, { correlationId })

      // Parse error using centralized handler
      const authError = parseAuthError(e, correlationId);
      setAuthError(authError.userMessage)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 bg-emerald-700/95 px-6 pt-20 pb-8">
          <View className="flex-row items-center justify-center mb-10">
            <BrandingLogo size="large" />
          </View>
          <View className="gap-5">
            {authError ? (
              <View className="bg-red-500/20 border border-red-400 rounded p-3">
                <Text className="text-red-200 text-sm">{authError}</Text>
              </View>
            ) : null}

            <View>
              <Text className="text-sm text-white/80 mb-1">Email</Text>
              <TextInput
                value={email}
                onChangeText={(text) => {
                  setEmail(text)
                  if (fieldErrors.email) {
                    setFieldErrors(prev => ({ ...prev, email: '' }))
                  }
                  setEmailSuggestion(suggestEmailCorrection(text))
                }}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!isLoading}
                className={`w-full bg-white/5 rounded px-3 py-3 text-white ${fieldErrors.email ? 'border border-red-400' : ''}`}
                placeholderTextColor="rgba(255,255,255,0.4)"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              {fieldErrors.email ? <ValidationMessage message={fieldErrors.email} /> : null}
              {emailSuggestion ? (
                <TouchableOpacity
                  onPress={() => {
                    setEmail(emailSuggestion)
                    setEmailSuggestion(null)
                    setFieldErrors(prev => ({ ...prev, email: '' }))
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
              <Text className="text-sm text-white/80 mb-1">Password</Text>
              <View className="relative">
                <TextInput
                  ref={passwordRef}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text)
                    if (fieldErrors.password) {
                      setFieldErrors(prev => ({ ...prev, password: '' }))
                    }
                  }}
                  placeholder="At least 8 characters"
                  secureTextEntry={!showPassword}
                  autoComplete="password-new"
                  editable={!isLoading}
                  className={`w-full bg-white/5 rounded px-3 py-3 text-white pr-12 ${fieldErrors.password ? 'border border-red-400' : ''}`}
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <MaterialIcons name={showPassword ? 'visibility-off' : 'visibility'} size={20} color="#fff" />
                </TouchableOpacity>
              </View>
              {fieldErrors.password ? <ValidationMessage message={fieldErrors.password} /> : null}
              <Text className="text-xs text-white/60 mt-1">Must include uppercase, lowercase, number, and special character</Text>
            </View>

            <View>
              <Text className="text-sm text-white/80 mb-1">Confirm Password</Text>
              <View className="relative">
                <TextInput
                  ref={confirmPasswordRef}
                  value={confirmPassword}
                  onChangeText={(text) => {
                    setConfirmPassword(text)
                    if (fieldErrors.confirmPassword) {
                      setFieldErrors(prev => ({ ...prev, confirmPassword: '' }))
                    }
                  }}
                  placeholder="Confirm password"
                  secureTextEntry={!showConfirmPassword}
                  autoComplete="password-new"
                  editable={!isLoading}
                  className={`w-full bg-white/5 rounded px-3 py-3 text-white pr-12 ${fieldErrors.confirmPassword ? 'border border-red-400' : ''}`}
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  <MaterialIcons name={showConfirmPassword ? 'visibility-off' : 'visibility'} size={20} color="#fff" />
                </TouchableOpacity>
              </View>
              {fieldErrors.confirmPassword ? <ValidationMessage message={fieldErrors.confirmPassword} /> : null}
            </View>

            <View className="flex-row items-center mt-2">
              <TouchableOpacity
                onPress={() => setAgeVerified(v => !v)}
                className="mr-3"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: ageVerified }}
              >
                <MaterialIcons name={ageVerified ? 'check-box' : 'check-box-outline-blank'} size={22} color={ageVerified ? colors.primary[500] : '#fff'} />
              </TouchableOpacity>
              <Text className="text-white/90">I confirm I am 18 years or older</Text>
            </View>
            {fieldErrors.ageVerified ? <ValidationMessage message={fieldErrors.ageVerified} /> : null}

            <View className="mt-3">
              <View className="flex-row items-start">
                <TouchableOpacity
                  onPress={() => setTermsAccepted(v => !v)}
                  className="mr-3 mt-0.5"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: termsAccepted }}
                >
                  <MaterialIcons name={termsAccepted ? 'check-box' : 'check-box-outline-blank'} size={22} color={termsAccepted ? colors.primary[500] : '#fff'} />
                </TouchableOpacity>
                <View className="flex-1 flex-row flex-wrap">
                  <Text className="text-white/90">I accept the </Text>
                  <TouchableOpacity onPress={() => router.push('/legal/terms')}>
                    <Text className="text-white underline">Terms of Service</Text>
                  </TouchableOpacity>
                  <Text className="text-white/90"> and </Text>
                  <TouchableOpacity onPress={() => router.push('/legal/privacy')}>
                    <Text className="text-white underline">Privacy Policy</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {fieldErrors.termsAccepted ? (
                <View className="ml-9">
                  <ValidationMessage message={fieldErrors.termsAccepted} />
                </View>
              ) : null}
            </View>

            <TouchableOpacity onPress={handleSubmit} disabled={isLoading} className="w-full bg-background-secondary rounded py-3 items-center flex-row justify-center">
              {isLoading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">Create Account</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.back()}>
              <Text className="text-white/80 text-center mt-6">Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
