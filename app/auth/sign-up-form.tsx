"use client"
import { MaterialIcons } from '@expo/vector-icons'
import type { Href } from 'expo-router'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { BrandingLogo } from '../../components/ui/branding-logo'
import { ValidationPatterns } from '../../hooks/use-form-validation'
import useScreenBackground from '../../lib/hooks/useScreenBackground'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { parseAuthError, generateCorrelationId } from '../../lib/utils/auth-errors'
import { validateEmail } from '../../lib/utils/auth-validation'

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
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [ageVerified, setAgeVerified] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)

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
              router.replace('/onboarding')
              return
            }
            // For other errors, throw to be caught by catch block
            throw profileError
          }
          
          // Profile exists - check if onboarding is complete
          // User needs onboarding if username is missing or onboarding_completed is false
          if (!profile.username || profile.onboarding_completed === false) {
            console.log('[sign-up] Profile incomplete or onboarding not completed, redirecting to onboarding', { 
              correlationId,
              hasUsername: !!profile.username,
              onboardingCompleted: profile.onboarding_completed
            })
            router.replace('/onboarding')
          } else {
            // User has completed onboarding (edge case) - go to app
            console.log('[sign-up] Profile complete, redirecting to app', { correlationId })
            router.replace({ pathname: '/tabs/bounty-app', params: { screen: 'bounty' } } as any)
          }
        } catch (err) {
          // On error, proceed to onboarding to be safe
          console.error('[sign-up] Profile check error, proceeding to onboarding', { correlationId, error: err })
          router.replace('/onboarding')
        }
      } else {
        // No session was created (shouldn't happen, but handle gracefully)
        console.warn('[sign-up] No session created after sign-up, showing email confirmation', { correlationId })
        router.replace('/auth/email-confirmation' as Href)
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
                }}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!isLoading}
                className={`w-full bg-white/5 rounded px-3 py-3 text-white ${fieldErrors.email ? 'border border-red-400' : ''}`}
                placeholderTextColor="rgba(255,255,255,0.4)"
              />
              {fieldErrors.email && <Text className="text-xs text-red-400 mt-1">{fieldErrors.email}</Text>}
            </View>

            <View>
              <Text className="text-sm text-white/80 mb-1">Password</Text>
              <View className="relative">
                <TextInput
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
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <MaterialIcons name={showPassword ? 'visibility-off' : 'visibility'} size={20} color="#fff" />
                </TouchableOpacity>
              </View>
              {fieldErrors.password && <Text className="text-xs text-red-400 mt-1">{fieldErrors.password}</Text>}
              <Text className="text-xs text-white/60 mt-1">Must include uppercase, lowercase, number, and special character</Text>
            </View>

            <View>
              <Text className="text-sm text-white/80 mb-1">Confirm Password</Text>
              <View className="relative">
                <TextInput
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
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  <MaterialIcons name={showConfirmPassword ? 'visibility-off' : 'visibility'} size={20} color="#fff" />
                </TouchableOpacity>
              </View>
              {fieldErrors.confirmPassword && <Text className="text-xs text-red-400 mt-1">{fieldErrors.confirmPassword}</Text>}
            </View>

            <View className="flex-row items-center mt-2">
              <TouchableOpacity
                onPress={() => setAgeVerified(v => !v)}
                className="mr-3"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: ageVerified }}
              >
                <MaterialIcons name={ageVerified ? 'check-box' : 'check-box-outline-blank'} size={22} color={ageVerified ? '#10b981' : '#fff'} />
              </TouchableOpacity>
              <Text className="text-white/90">I confirm I am 18 years or older</Text>
            </View>
            {fieldErrors.ageVerified && <Text className="text-xs text-red-400 mt-1">{fieldErrors.ageVerified}</Text>}

            <View className="mt-3">
              <View className="flex-row items-start">
                <TouchableOpacity
                  onPress={() => setTermsAccepted(v => !v)}
                  className="mr-3 mt-0.5"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: termsAccepted }}
                >
                  <MaterialIcons name={termsAccepted ? 'check-box' : 'check-box-outline-blank'} size={22} color={termsAccepted ? '#10b981' : '#fff'} />
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
              {fieldErrors.termsAccepted && <Text className="text-xs text-red-400 mt-1 ml-9">{fieldErrors.termsAccepted}</Text>}
            </View>

            <TouchableOpacity onPress={handleSubmit} disabled={isLoading} className="w-full bg-emerald-600 rounded py-3 items-center flex-row justify-center">
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
