"use client"
import { MaterialIcons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as AppleAuthentication from 'expo-apple-authentication'
import { makeRedirectUri, ResponseType } from 'expo-auth-session'
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ErrorBanner } from '../../components/error-banner'
import { Checkbox } from '../../components/ui/checkbox'
import { AnimatedScreen } from '../../components/ui/animated-screen'
import { useFormSubmission } from '../../hooks/useFormSubmission'
import useScreenBackground from '../../lib/hooks/useScreenBackground'
import { identify, initMixpanel, track } from '../../lib/mixpanel'
import { ROUTES } from '../../lib/routes'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { getUserFriendlyError } from '../../lib/utils/error-messages'

WebBrowser.maybeCompleteAuthSession()

export default function SignInRoute() {
  return <SignInForm />
}

export function SignInForm() {
  // set status/safe-area color for this screen
  useScreenBackground('#097959ff') // EMERALD_800 / dark
  const router = useRouter()
  const [identifier, setIdentifier] = useState('') // email or username
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({})
  const [showPassword, setShowPassword] = useState(false)
  const [loginAttempts, setLoginAttempts] = useState(0)
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null)
  const [rememberMe, setRememberMe] = useState(false)
  const [socialAuthLoading, setSocialAuthLoading] = useState(false)
  const [socialAuthError, setSocialAuthError] = useState<any>(null)
  
  // Use form submission hook with rate limiting
  const { submit: handleSubmit, isSubmitting, error: authError, reset: resetError } = useFormSubmission(
    async () => {
      // Check for lockout
      if (lockoutUntil && Date.now() < lockoutUntil) {
        const remainingSeconds = Math.ceil((lockoutUntil - Date.now()) / 1000)
        throw new Error(`Too many failed attempts. Please wait ${remainingSeconds} seconds.`)
      }

      if (!validateForm()) {
        throw new Error('Please fix the form errors')
      }
      
      if (!isSupabaseConfigured) {
        throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.')
      }

      // If identifier may be username, your backend should resolve username -> email.
      // Here we assume email sign-in:
      const { data, error } = await supabase.auth.signInWithPassword({
        email: identifier.trim().toLowerCase(), // Normalize email
        password,
      })
      
      if (error) {
        // Track failed login attempts
        const newAttempts = loginAttempts + 1
        setLoginAttempts(newAttempts)
        
        // Lock out after 5 failed attempts for 5 minutes
        if (newAttempts >= 5) {
          const lockout = Date.now() + (5 * 60 * 1000) // 5 minutes
          setLockoutUntil(lockout)
          throw new Error('Too many failed attempts. Please try again in 5 minutes.')
        }
        
        // Handle specific error cases with user-friendly messages
        if (error.message.includes('Invalid login credentials')) {
          throw new Error('Invalid email or password. Please try again.')
        } else if (error.message.includes('Email not confirmed')) {
          throw new Error('Please confirm your email address before signing in.')
        } else {
          throw error
        }
      }
      
      // Reset login attempts on success
      setLoginAttempts(0)
      setLockoutUntil(null)
      
      // Handle remember me preference
      try {
        if (rememberMe) {
          await AsyncStorage.setItem('rememberMeEmail', identifier.trim().toLowerCase())
        } else {
          await AsyncStorage.removeItem('rememberMeEmail')
        }
      } catch (error) {
        console.error('[sign-in] Failed to save remember me preference:', error)
      }
      
      if (data.session) {
        // Ensure Mixpanel initialized and identify user (safe no-op if SDK not initialized)
        try {
          await initMixpanel();
          identify(data.session.user.id, {
            $email: data.session.user.email,
            $name: (data.session.user.user_metadata as any)?.full_name || (data.session.user.user_metadata as any)?.name,
          })
          try { track('Sign In', { user_id: data.session.user.id, email: data.session.user.email }); } catch (e) {}
        } catch (e) {
          // swallow analytics errors
        }

        // Check if user has completed onboarding (has profile in Supabase)
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', data.session.user.id)
          .single()
        
        if (!profile || !profile.username) {
          // User needs to complete onboarding
          router.replace('/onboarding/username')
        } else {
          // User has completed onboarding, go to app
          router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
        }
      } else {
        throw new Error('Authentication failed. Please try again.')
      }
    },
    {
      debounceMs: 500, // Prevent double-submissions
    }
  );

  // Google config (safe placeholders keep the app from crashing)
  const iosGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || 'placeholder-ios-client-id'
  const androidGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || 'placeholder-android-client-id'
  const webGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || 'placeholder-web-client-id'
  const isGoogleConfigured = Boolean(
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  )
  const redirectUri = useMemo(() => makeRedirectUri({}), [])

  // IMPORTANT: always pass iosClientId/androidClientId/webClientId so the hook doesn’t throw on iOS
  const [request, response, promptAsync] = useIdTokenAuthRequest({
    responseType: ResponseType.IdToken,
    clientId: Platform.select({
      ios: iosGoogleClientId,
      android: androidGoogleClientId,
      default: webGoogleClientId,
    })!,
    iosClientId: iosGoogleClientId,
    androidClientId: androidGoogleClientId,
    webClientId: webGoogleClientId,
    redirectUri,
    scopes: ['openid', 'email', 'profile'],
  })

  // Load saved email on mount
  useEffect(() => {
    const loadSavedEmail = async () => {
      try {
        const savedEmail = await AsyncStorage.getItem('rememberMeEmail')
        if (savedEmail) {
          setIdentifier(savedEmail)
          setRememberMe(true)
        }
      } catch (error) {
        console.error('[sign-in] Failed to load saved email:', error)
      }
    }
    loadSavedEmail()
  }, [])

  const getFieldError = (field: string) => fieldErrors[field]

  const validateForm = () => {
    const errors: Record<string, string> = {}
    
    if (!identifier || identifier.trim().length === 0) {
      errors.identifier = 'Email is required'
    } else {
      // Basic email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(identifier.trim())) {
        errors.identifier = 'Please enter a valid email address'
      }
    }
    
    if (!password) {
      errors.password = 'Password is required'
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters'
    }
    
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  // Handle Google auth completion -> exchange id_token with Supabase
  useEffect(() => {
    const run = async () => {
      if (!isGoogleConfigured) return
      if (response?.type !== 'success') return
      const idToken = response.params.id_token
      if (!idToken) {
        setSocialAuthError('Google did not return id_token')
        return
      }
      if (!isSupabaseConfigured) {
        setSocialAuthError('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.')
        return
      }
      try {
        setSocialAuthLoading(true)
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        })
        if (error) throw error
        if (data.session) {
          // Check if user has completed onboarding (has profile in Supabase)
          const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', data.session.user.id)
            .single()
          
          if (!profile || !profile.username) {
            // User needs to complete onboarding
            router.replace('/onboarding/username')
          } else {
            // User has completed onboarding, go to app
            router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
          }
        } else {
          setSocialAuthError('No session returned after Google sign-in.')
        }
      } catch (e: any) {
        setSocialAuthError(e?.message || 'Google sign-in failed')
        console.error('[google] Error:', e)
      } finally {
        setSocialAuthLoading(false)
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response])
  
  
  return (
    <AnimatedScreen animationType="fade" duration={400}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 bg-emerald-700/95 px-6 pt-20 pb-8">
            <View className="flex-row items-center justify-center mb-10">
              <MaterialIcons name="gps-fixed" size={40} color="#fff" />
              <Text className="text-white font-extrabold text-3xl tracking-widest ml-2">BOUNTY</Text>
            </View>
            <View className="gap-5">
              {authError && (() => {
                const friendlyError = getUserFriendlyError(authError);
                return (
                  <ErrorBanner
                    error={friendlyError}
                    onDismiss={resetError}
                    onAction={friendlyError.retryable ? () => handleSubmit() : undefined}
                  />
                );
              })()}

              <View>
              <Text className="text-sm text-white/80 mb-1">Email</Text>
              <TextInput
                nativeID="identifier"
                value={identifier}
                onChangeText={(text) => {
                  setIdentifier(text)
                  if (fieldErrors.identifier) {
                    setFieldErrors(prev => ({ ...prev, identifier: '' }))
                  }
                }}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!isSubmitting}
                className={`w-full bg-white/5 rounded px-3 py-3 text-white ${fieldErrors.identifier ? 'border border-red-400' : ''}`}
                placeholderTextColor="rgba(255,255,255,0.4)"
              />
              {getFieldError('identifier') && <Text className="text-xs text-red-400 mt-1">{getFieldError('identifier')}</Text>}
            </View>

            <View>
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-sm text-white/80">Password</Text>
                <TouchableOpacity onPress={() => router.push('/auth/reset-password')}>
                  <Text className="text-[11px] text-emerald-200">Forgot?</Text>
                </TouchableOpacity>
              </View>
              <View className="relative">
                <TextInput
                  nativeID="password"
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text)
                    if (fieldErrors.password) {
                      setFieldErrors(prev => ({ ...prev, password: '' }))
                    }
                  }}
                  placeholder="Password"
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  editable={!isSubmitting}
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
              {getFieldError('password') && <Text className="text-xs text-red-400 mt-1">{getFieldError('password')}</Text>}
            </View>

            <View className="flex-row items-center">
              <Checkbox 
                checked={rememberMe} 
                onCheckedChange={setRememberMe}
                disabled={isSubmitting}
              />
              <TouchableOpacity 
                onPress={() => !isSubmitting && setRememberMe(!rememberMe)}
                disabled={isSubmitting}
              >
                <Text className="text-white/80 text-sm ml-2">Remember me</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={handleSubmit} disabled={isSubmitting} className="w-full bg-emerald-600 rounded py-3 items-center flex-row justify-center">
              {isSubmitting ? (
                <>
                  <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                </>
              ) : (
                <Text className="text-white font-medium">Sign In</Text>
              )}
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <View style={{ marginTop: 12 }}>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={8}
                  style={{ width: '100%', height: 44 }}
                  onPress={async () => {
                    try {
                      const credential = await AppleAuthentication.signInAsync({
                        requestedScopes: [
                          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                          AppleAuthentication.AppleAuthenticationScope.EMAIL,
                        ],
                      })
                      if (!credential.identityToken) {
                        setSocialAuthError('No Apple identity token')
                        return
                      }
                      if (!isSupabaseConfigured) {
                        setSocialAuthError('Supabase is not configured.')
                        return
                      }
                      const { data, error } = await supabase.auth.signInWithIdToken({
                        provider: 'apple',
                        token: credential.identityToken,
                      })
                      if (error) throw error
                      if (data.session) {
                        // Check if user has completed onboarding
                        const { data: profile } = await supabase
                          .from('profiles')
                          .select('username')
                          .eq('id', data.session.user.id)
                          .single()
                        
                        if (!profile || !profile.username) {
                          router.replace('/onboarding/username')
                        } else {
                          router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
                        }
                      }
                    } catch (e: any) {
                      if (e?.code !== 'ERR_REQUEST_CANCELED') {
                        setSocialAuthError('Apple sign-in failed')
                        console.error(e)
                      }
                    }
                  }}
                />
              </View>
            )}

            <TouchableOpacity
              disabled={!isGoogleConfigured || isSubmitting || !request}
              onPress={() => promptAsync()}
              className={`w-full rounded py-3 items-center flex-row justify-center mt-2 ${isGoogleConfigured ? 'bg-white' : 'bg-white/40'}`}
            >
              <Text className="text-black font-medium">
                {isGoogleConfigured ? 'Continue with Google' : 'Google setup required'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.push('/auth/sign-up-form')}>
              <Text className="text-white/80 text-center mt-6">New here? Create an account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </AnimatedScreen>
  )
}
