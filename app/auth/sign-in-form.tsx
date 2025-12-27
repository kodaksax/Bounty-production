"use client"
import { MaterialIcons } from '@expo/vector-icons'
import NetInfo from '@react-native-community/netinfo'
import * as AppleAuthentication from 'expo-apple-authentication'
import { makeRedirectUri, ResponseType } from 'expo-auth-session'
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ErrorBanner } from '../../components/error-banner'
import { AnimatedScreen } from '../../components/ui/animated-screen'
import { Checkbox } from '../../components/ui/checkbox'
import { useFormSubmission } from '../../hooks/useFormSubmission'
import useScreenBackground from '../../lib/hooks/useScreenBackground'
import { identify, initMixpanel, track } from '../../lib/mixpanel'
import { ROUTES } from '../../lib/routes'
import { storage } from '../../lib/storage'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { AUTH_RETRY_CONFIG, getAuthErrorMessage } from '../../lib/utils/auth-errors'
import { getUserFriendlyError } from '../../lib/utils/error-messages'
import { withTimeout } from '../../lib/utils/withTimeout'

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
      console.log('[sign-in] Starting sign-in process')
      
      // Check Supabase configuration first
      if (!isSupabaseConfigured) {
        console.error('[sign-in] Supabase is not configured!')
        throw new Error('Authentication service is not configured. Please contact support.')
      }
      
      // Log Supabase configuration status for debugging (development only to avoid leaking env details)
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[sign-in] Supabase configured:', {
          hasUrl: Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL),
          hasKey: Boolean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
          urlPrefix: process.env.EXPO_PUBLIC_SUPABASE_URL?.substring(0, 15) + '...',
        })
      }
      
      // Check for lockout
      if (lockoutUntil && Date.now() < lockoutUntil) {
        const remainingSeconds = Math.ceil((lockoutUntil - Date.now()) / 1000)
        throw new Error(`Too many failed attempts. Please wait ${remainingSeconds} seconds.`)
      }

      if (!validateForm()) {
        throw new Error('Please fix the form errors')
      }

      try {
        // If identifier may be username, your backend should resolve username -> email.
        // Here we assume email sign-in
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log('[sign-in] Attempting to sign in with email:', identifier.trim().toLowerCase())
        } else {
          console.log('[sign-in] Attempting to sign in (email redacted for production)')
        }

        // SIMPLIFIED AUTH FLOW: Let Supabase handle its own timeouts and network logic
        // The previous complex retry/timeout logic was causing valid requests to fail
        console.log(`[sign-in] Calling supabase.auth.signInWithPassword...`)
        
        const { data, error } = await supabase.auth.signInWithPassword({
          email: identifier.trim().toLowerCase(),
          password,
        })
        
        console.log(`[sign-in] Auth response received:`, {
          hasData: Boolean(data),
          hasError: Boolean(error),
          errorMessage: error?.message,
        })

        if (error) {
          console.error('[sign-in] Authentication error:', error)
          
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

        console.log('[sign-in] Authentication successful')

        // Handle remember me preference
        try {
          if (rememberMe) {
            await storage.setItem('rememberMeEmail', identifier.trim().toLowerCase())
          } else {
            await storage.removeItem('rememberMeEmail')
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
            try { track('Sign In', { user_id: data.session.user.id, email: data.session.user.email }); } catch (e) { }
          } catch (e) {
            // swallow analytics errors
          }

          // OPTIMIZED: Quick profile check with fast timeout and immediate navigation
          // The AuthProvider will handle full profile sync in the background
          console.log('[sign-in] Performing quick profile check for:', data.session.user.id)
          
          try {
            // Use a very short timeout for the profile check - just to determine onboarding status
            const { data: profile, error: profileError } = await withTimeout(
              supabase
                .from('profiles')
                .select('username')
                .eq('id', data.session.user.id)
                .single(),
              AUTH_RETRY_CONFIG.PROFILE_TIMEOUT // 3 second timeout - fast decision
            )

            if (profileError) {
              // If profile doesn't exist (PGRST116), user needs onboarding
              if (profileError.code === 'PGRST116') {
                console.log('[sign-in] No profile found, redirecting to onboarding')
                router.replace('/onboarding/username')
                return
              }
              // For other errors, proceed to app - AuthProvider will handle sync
              console.log('[sign-in] Profile check error, proceeding to app:', profileError.message)
              router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
              return
            }

            if (!profile || !profile.username) {
              // User needs to complete onboarding
              console.log('[sign-in] Profile incomplete, redirecting to onboarding')
              router.replace('/onboarding/username')
            } else {
              // User has completed onboarding, go to app
              console.log('[sign-in] Profile complete, redirecting to app')
              router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
            }
          } catch (profileCheckError: any) {
            // On timeout or error, proceed to app and let AuthProvider handle it
            // This prevents blocking the user from signing in due to profile check issues
            console.log('[sign-in] Profile check timeout/error, proceeding to app. AuthProvider will sync.')
            router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
          }
        } else {
          throw new Error('Authentication failed. Please try again.')
        }
      } catch (err: any) {
        console.error('[sign-in] Sign-in error:', err)
        
        // Use shared error message utility for consistent messaging
        throw new Error(getAuthErrorMessage(err))
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
        const savedEmail = await storage.getItem('rememberMeEmail')
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
        console.log('[google] Starting Google sign-in with id_token')
        
        // Simplified: Let Supabase handle its own timeout
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        })
        
        if (error) throw error
        if (data.session) {
          console.log('[google] Sign-in successful, checking profile')
          
          // Quick profile check with fast timeout
          try {
            const { data: profile } = await withTimeout(
              supabase
                .from('profiles')
                .select('username')
                .eq('id', data.session.user.id)
                .single(),
              AUTH_RETRY_CONFIG.PROFILE_TIMEOUT // 3 second timeout - fast decision
            )

            if (!profile || !profile.username) {
              // User needs to complete onboarding
              router.replace('/onboarding/username')
            } else {
              // User has completed onboarding, go to app
              router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
            }
          } catch (profileError: any) {
            console.log('[google] Profile check failed, proceeding to app. AuthProvider will sync.')
            // On error/timeout, proceed to app - AuthProvider will handle profile sync
            router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
          }
        } else {
          setSocialAuthError('No session returned after Google sign-in.')
        }
      } catch (e: any) {
        const errorMsg = getAuthErrorMessage(e)
        setSocialAuthError(errorMsg)
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
              <Image
                source={require('../../assets/images/bounty-logo.png')}
                style={{ width: 220, height: 60 }}
                resizeMode="contain"
              />
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
                        console.log('[apple] Starting Apple sign-in')
                        const credential = await AppleAuthentication.signInAsync({
                          requestedScopes: [
                            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                            AppleAuthentication.AppleAuthenticationScope.EMAIL,
                          ],
                        })
                        if (!credential.identityToken) {
                          setSocialAuthError('No Apple identity token received')
                          return
                        }
                        if (!isSupabaseConfigured) {
                          setSocialAuthError('Authentication service is not configured.')
                          return
                        }
                        
                        console.log('[apple] Exchanging token with Supabase')
                        const { data, error } = await supabase.auth.signInWithIdToken({
                          provider: 'apple',
                          token: credential.identityToken,
                        })
                        
                        if (error) throw error
                        if (data.session) {
                          console.log('[apple] Sign-in successful, checking profile')
                          
                          // Quick profile check with fast timeout
                          try {
                            const { data: profile } = await withTimeout(
                              supabase
                                .from('profiles')
                                .select('username')
                                .eq('id', data.session.user.id)
                                .single(),
                              AUTH_RETRY_CONFIG.PROFILE_TIMEOUT // 3 second timeout - fast decision
                            )

                            if (!profile || !profile.username) {
                              router.replace('/onboarding/username')
                            } else {
                              router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
                            }
                          } catch (profileError: any) {
                            console.log('[apple] Profile check failed, proceeding to app. AuthProvider will sync.')
                            // On error/timeout, proceed to app - AuthProvider will handle profile sync
                            router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
                          }
                        }
                      } catch (e: any) {
                        if (e?.code !== 'ERR_REQUEST_CANCELED') {
                          const errorMsg = getAuthErrorMessage(e)
                          setSocialAuthError(errorMsg)
                          console.error('[apple] Error:', e)
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
