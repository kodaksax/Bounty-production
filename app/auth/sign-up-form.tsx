"use client"
import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ValidationPatterns } from '../../hooks/use-form-validation'
import useScreenBackground from '../../lib/hooks/useScreenBackground'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
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
    if (!isSupabaseConfigured) return setAuthError('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.')

    try {
      setIsLoading(true)
      // Pass age verification into user_metadata so backend can persist it
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(), // Normalize email
        password,
        options: {
          data: { age_verified: ageVerified }
        }
      })
      if (error) {
        // Handle specific error cases
        if (error.message.includes('already registered')) {
          setAuthError('This email is already registered. Please sign in instead.')
        } else if (error.message.includes('rate limit')) {
          setAuthError('Too many attempts. Please try again later.')
        } else {
          setAuthError(error.message)
        }
        return
      }

      // If email confirmations are enabled, session may be null until user verifies email
      if (data.session) {
        // New users always need to complete onboarding
        router.replace('/onboarding/username')
      } else {
        // Show a friendly note and route to sign-in
        setAuthError('Check your email to confirm your account, then sign in.')
      }
    } catch (e: any) {
      setAuthError(e?.message || 'An unexpected error occurred. Please try again.')
      console.error('[sign-up] Error:', e)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 bg-emerald-700/95 px-6 pt-20 pb-8">
          <View className="flex-row items-center justify-center mb-10">
            <MaterialIcons name="gps-fixed" size={40} color="#fff" />
            <Text className="text-white font-extrabold text-3xl tracking-widest ml-2">BOUNTY</Text>
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

            <View className="flex-row items-center mt-3">
              <TouchableOpacity
                onPress={() => setTermsAccepted(v => !v)}
                className="mr-3"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: termsAccepted }}
              >
                <MaterialIcons name={termsAccepted ? 'check-box' : 'check-box-outline-blank'} size={22} color={termsAccepted ? '#10b981' : '#fff'} />
              </TouchableOpacity>
              <Text className="text-white/90">I accept the </Text>
              <TouchableOpacity onPress={() => router.push('/legal/terms')}>
                <Text className="text-white underline">Terms & Privacy</Text>
              </TouchableOpacity>
            </View>
            {fieldErrors.termsAccepted && <Text className="text-xs text-red-400 mt-1">{fieldErrors.termsAccepted}</Text>}

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
