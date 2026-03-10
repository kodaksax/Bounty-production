"use client"
import { MaterialIcons } from '@expo/vector-icons'
import { ValidationMessage } from 'app/components/ValidationMessage'
import * as AppleAuthentication from 'expo-apple-authentication'
import { ResponseType, makeRedirectUri } from 'expo-auth-session'
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ErrorBanner } from '../../components/error-banner'
import { AnimatedScreen } from '../../components/ui/animated-screen'
import { CaptchaChallenge } from '../../components/ui/captcha-challenge'
import { Checkbox } from '../../components/ui/checkbox'
import { useFormSubmission } from '../../hooks/useFormSubmission'
import { setRememberMePreference } from '../../lib/auth-session-storage'
import useScreenBackground from '../../lib/hooks/useScreenBackground'
import { identify, initMixpanel, track } from '../../lib/mixpanel'
import { ROUTES } from '../../lib/routes'
import { storage } from '../../lib/storage'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { generateCorrelationId, getAuthErrorMessage, parseAuthError } from '../../lib/utils/auth-errors'
import { validateEmail, suggestEmailCorrection } from '../../lib/utils/auth-validation'
import { CAPTCHA_THRESHOLD } from '../../lib/utils/captcha'
import { getUserFriendlyError } from '../../lib/utils/error-messages'
import { markInitialNavigationDone } from '../initial-navigation/initialNavigation'

WebBrowser.maybeCompleteAuthSession()

export default function SignInRoute() {
  return <SignInForm />
}

export function SignInForm() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('') // email or username
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({})
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [loginAttempts, setLoginAttempts] = useState(0)
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null)
  const [captchaVerified, setCaptchaVerified] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)

  const passwordRef = useRef<TextInput>(null)

  const isLockoutActive = lockoutUntil !== null && Date.now() < lockoutUntil
  const captchaRequired = loginAttempts >= CAPTCHA_THRESHOLD && !isLockoutActive
  const [socialAuthLoading, setSocialAuthLoading] = useState(false)
  const [socialAuthError, setSocialAuthError] = useState<string | null>(null)

  const { submit: handleSubmit, isSubmitting, error: authError, reset: resetError } = useFormSubmission(
    async () => {
      const correlationId = generateCorrelationId('signin');
      console.log('[sign-in] Starting sign-in process', { correlationId })

      if (!isSupabaseConfigured) {
        console.error('[sign-in] Supabase is not configured!', { correlationId })
        throw new Error('Authentication service is not configured. Please contact support.')
      }

      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[sign-in] Supabase configured:', {
          correlationId,
          hasUrl: Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL),
          hasKey: Boolean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
          urlPrefix: process.env.EXPO_PUBLIC_SUPABASE_URL?.substring(0, 15) + '...',
        })
      }

      if (isLockoutActive) {
        const remainingSeconds = Math.ceil((lockoutUntil! - Date.now()) / 1000)
        throw new Error(`Too many failed attempts. Please wait ${remainingSeconds} seconds.`)
      }

      if (captchaRequired && !captchaVerified) {
        throw new Error('Please complete the security check before signing in.')
      }

      if (!validateForm()) {
        throw new Error('Please fix the form errors')
      }

      try {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log('[sign-in] Attempting to sign in with email:', identifier.trim().toLowerCase(), { correlationId })
        } else {
          console.log('[sign-in] Attempting to sign in (email redacted for production)', { correlationId })
        }

        try {
          console.log('[sign-in] Setting remember me preference:', rememberMe, { correlationId })
          await setRememberMePreference(rememberMe)
        } catch (prefError) {
          console.warn('[sign-in] Failed to save remember me preference:', prefError, { correlationId })
        }

        console.log(`[sign-in] Calling supabase.auth.signInWithPassword...`, { correlationId })

        const { data, error } = await supabase.auth.signInWithPassword({
          email: identifier.trim().toLowerCase(),
          password,
        })

        console.log(`[sign-in] Auth response received:`, {
          correlationId,
          hasData: Boolean(data),
          hasError: Boolean(error),
          errorMessage: error?.message,
        })

        if (error) {
          console.error('[sign-in] Authentication error:', error, { correlationId })

          const authError = parseAuthError(error, correlationId);

          const newAttempts = loginAttempts + 1
          setLoginAttempts(newAttempts)

          if (newAttempts >= 5) {
            const lockout = Date.now() + (5 * 60 * 1000)
            setLockoutUntil(lockout)
            setCaptchaVerified(false)
            throw new Error('Too many failed attempts. Please try again in 5 minutes.')
          }

          throw new Error(authError.userMessage)
        }

        setLoginAttempts(0)
        setLockoutUntil(null)
        setCaptchaVerified(false)

        console.log('[sign-in] Authentication successful', { correlationId })

        try {
          if (rememberMe) {
            await storage.setItem('rememberMeEmail', identifier.trim().toLowerCase())
          } else {
            await storage.removeItem('rememberMeEmail')
          }
        } catch (error) {
          console.error('[sign-in] Failed to save remember me preference:', error, { correlationId })
        }

        if (data.session) {
          try {
            await initMixpanel();
            identify(data.session.user.id, {
              $email: data.session.user.email,
              $name: (data.session.user.user_metadata as any)?.full_name || (data.session.user.user_metadata as any)?.name,
            })
            try { track('Sign In', { user_id: data.session.user.id, email: data.session.user.email, correlation_id: correlationId }); } catch { }
          } catch {
            // swallow analytics errors
          }

          try {
            const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
            if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') {
              console.log('[sign-in] MFA challenge required, redirecting to MFA screen', { correlationId })
              router.replace(ROUTES.AUTH.MFA_CHALLENGE as unknown as any)
              try { markInitialNavigationDone(); } catch { }
              return
            }
          } catch {
            console.error('[sign-in] Could not determine MFA level, blocking sign-in', { correlationId })
            throw new Error('Unable to verify multi-factor authentication status. Please try again.')
          }

          console.log('[sign-in] Performing quick profile check for:', data.session.user.id, { correlationId })

          try {
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('username, onboarding_completed')
              .eq('id', data.session.user.id)
              .single()

            if (profileError) {
              if (profileError.code === 'PGRST116') {
                console.log('[sign-in] No profile found, redirecting to onboarding', { correlationId })
                router.replace('/onboarding')
                try { markInitialNavigationDone(); } catch { }
                return
              }
              console.log('[sign-in] Profile check error, proceeding to app:', profileError.message, { correlationId })
              router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
              return
            }

            if (!profile || !profile.username || profile.onboarding_completed !== true) {
              console.log('[sign-in] Profile incomplete or onboarding not completed, redirecting to onboarding', {
                correlationId,
                hasUsername: !!profile?.username,
                onboardingCompleted: profile?.onboarding_completed
              })
              router.replace('/onboarding')
              try { markInitialNavigationDone(); } catch { }
            } else {
              console.log('[sign-in] Profile complete, redirecting to app', { correlationId })
              router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
              try { markInitialNavigationDone(); } catch { }
            }
          } catch {
            console.log('[sign-in] Profile check error, proceeding to app. AuthProvider will sync.', { correlationId })
            router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
          }
        } else {
          throw new Error('Authentication failed. Please try again.')
        }
      } catch (err: any) {
        console.error('[sign-in] Sign-in error:', err, { correlationId })
        const authError = parseAuthError(err, correlationId);
        throw new Error(authError.userMessage)
      }
    },
    {
      debounceMs: 500,
    }
  );

  const iosGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || 'placeholder-ios-client-id'
  const androidGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || 'placeholder-android-client-id'
  const webGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || 'placeholder-web-client-id'
  const isGoogleConfigured = Boolean(
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  )

  const redirectUri = useMemo(() => {
    const uri = makeRedirectUri({
      scheme: 'bountyexpo-workspace',
      path: 'auth/callback'
    });
    console.log('[Google Auth] Redirect URI:', uri);

    if (uri.startsWith('exp://') && !uri.includes('localhost') && !uri.includes('127.0.0.1')) {
      console.warn(
        '[Google Auth] Using dynamic exp:// URI. This will fail unless you add ' +
        'the exact URI to Google Cloud Console. Current URI:', uri
      );
      console.warn('[Google Auth] To fix: Add this exact URI to your Google OAuth client redirect URIs');
    }

    return uri;
  }, [])

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

    const emailError = validateEmail(identifier)
    if (emailError) {
      errors.identifier = emailError
    }

    if (!password) {
      errors.password = 'Password is required'
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

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

        console.log('[google] Setting remember me preference: true (social auth)')
        await setRememberMePreference(true)

        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        })

        if (error) throw error
        if (data.session) {
          console.log('[google] Sign-in successful, checking profile')

          try {
            const { data: profile } = await supabase
              .from('profiles')
              .select('username, onboarding_completed')
              .eq('id', data.session.user.id)
              .single()

            if (!profile || !profile.username || profile.onboarding_completed !== true) {
              console.log('[google] Profile incomplete or onboarding not completed, redirecting to onboarding', {
                hasUsername: !!profile?.username,
                onboardingCompleted: profile?.onboarding_completed
              })
              router.replace('/onboarding')
              try { markInitialNavigationDone(); } catch { }
            } else {
              router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
              try { markInitialNavigationDone(); } catch { }
            }
          } catch {
            console.log('[google] Profile check failed, proceeding to app. AuthProvider will sync.')
            router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
            try { markInitialNavigationDone(); } catch { }
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#F8F9FB' }}>

        {/* GREEN HEADER — sits outside ScrollView so it's pinned flush at the absolute top */}
        <View style={{ height: 140, backgroundColor: '#059669', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 20 }}>
          <Image
            source={require('../../assets/images/bounty-logo.png')}
            style={{ width: 220, height: 30 , paddingBottom: 100 }}
            resizeMode="contain"
          />
        </View>

        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 px-6 pt-8 pb-8">
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

              {socialAuthError && (
                <ErrorBanner
                  error={getUserFriendlyError(socialAuthError)}
                  onDismiss={() => setSocialAuthError(null)}
                />
              )}

              <View>
                <Text className="text-sm gray mb-1 font-bold">Emal</Text>
                <TextInput
                  nativeID="identifier"
                  value={identifier}
                  onChangeText={(text) => {
                    setIdentifier(text)
                    if (fieldErrors.identifier) {
                      setFieldErrors(prev => ({ ...prev, identifier: '' }))
                    }
                    setEmailSuggestion(suggestEmailCorrection(text))
                  }}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  editable={!isSubmitting}
                  className={`w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 ${fieldErrors.identifier ? 'border-red-400' : ''}`}
                  placeholderTextColor="#9CA3AF"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
                {getFieldError('identifier') ? <ValidationMessage message={getFieldError('identifier')} /> : null}
                {emailSuggestion ? (
                  <TouchableOpacity
                    onPress={() => {
                      setIdentifier(emailSuggestion)
                      setEmailSuggestion(null)
                      setFieldErrors(prev => ({ ...prev, identifier: '' }))
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
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-sm text-white/80">Password</Text>
                  <TouchableOpacity onPress={() => router.push('/auth/reset-password')}>
                    <Text className="text-[11px] text-emerald-200">Forgot?</Text>
                  </TouchableOpacity>
                </View>
                <View className="relative">
                  <TextInput
                    ref={passwordRef}
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
                    className={`w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 ${fieldErrors.password ? 'border-red-400' : ''}`}
                    placeholderTextColor="#9CA3AF"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <MaterialIcons name={showPassword ? 'visibility-off' : 'visibility'} size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
                {getFieldError('password') ? <ValidationMessage message={getFieldError('password')} /> : null}
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

              {captchaRequired && (
                <View className="mt-4">
                  <Text className="text-xs text-white/80 mb-2">
                    Please complete the security check below to continue signing in.
                  </Text>
                  <CaptchaChallenge
                    onVerified={() => setCaptchaVerified(true)}
                    onReset={() => setCaptchaVerified(false)}
                  />
                </View>
              )}

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
                      setSocialAuthLoading(true)
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

                        console.log('[apple] Setting remember me preference: true (social auth)')
                        await setRememberMePreference(true)

                        console.log('[apple] Exchanging token with Supabase')
                        const { data, error } = await supabase.auth.signInWithIdToken({
                          provider: 'apple',
                          token: credential.identityToken,
                        })

                        if (error) throw error
                        if (data.session) {
                          console.log('[apple] Sign-in successful, checking profile')

                          try {
                            const { data: profile } = await supabase
                              .from('profiles')
                              .select('username, onboarding_completed')
                              .eq('id', data.session.user.id)
                              .single()

                            if (!profile || !profile.username || profile.onboarding_completed !== true) {
                              console.log('[apple] Profile incomplete or onboarding not completed, redirecting to onboarding', {
                                hasUsername: !!profile?.username,
                                onboardingCompleted: profile?.onboarding_completed
                              })
                              router.replace('/onboarding')
                              try { markInitialNavigationDone(); } catch { }
                            } else {
                              router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
                              try { markInitialNavigationDone(); } catch { }
                            }
                          } catch {
                            console.log('[apple] Profile check failed, proceeding to app. AuthProvider will sync.')
                            router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
                            try { markInitialNavigationDone(); } catch { }
                          }
                        }
                      } catch (e: any) {
                        if (e?.code !== 'ERR_REQUEST_CANCELED') {
                          const errorMsg = getAuthErrorMessage(e)
                          setSocialAuthError(errorMsg)
                          console.error('[apple] Error:', e)
                        }
                      } finally {
                        setSocialAuthLoading(false)
                      }
                    }}
                  />
                  {socialAuthLoading && (
                    <View style={{ position: 'absolute', right: 16, top: 6 }}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  )}
                </View>
              )}

              <TouchableOpacity
                disabled={!isGoogleConfigured || isSubmitting || !request || socialAuthLoading}
                onPress={() => promptAsync()}
                className={`w-full rounded py-3 items-center flex-row justify-center mt-2 ${isGoogleConfigured ? 'bg-white' : 'bg-white/40'}`}
              >
                {socialAuthLoading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text className="text-black font-medium">
                    {isGoogleConfigured ? 'Continue with Google' : 'Google setup required'}
                  </Text>
                )}
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