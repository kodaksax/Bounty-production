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
import { Checkbox } from '../../components/ui/checkbox'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { ROUTES } from '../../lib/routes'

WebBrowser.maybeCompleteAuthSession()

export default function SignInRoute() {
  return <SignInForm />
}

export function SignInForm() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('') // email or username
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({})
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loginAttempts, setLoginAttempts] = useState(0)
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null)
  const [rememberMe, setRememberMe] = useState(false)

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
    }
    
    if (!password) {
      errors.password = 'Password is required'
    }
    
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async () => {
    setFieldErrors({})
    setAuthError(null)

    // Check for lockout
    if (lockoutUntil && Date.now() < lockoutUntil) {
      const remainingSeconds = Math.ceil((lockoutUntil - Date.now()) / 1000)
      setAuthError(`Too many failed attempts. Please wait ${remainingSeconds} seconds.`)
      return
    }

    if (!validateForm()) return
    
    if (!isSupabaseConfigured) {
      setAuthError('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.')
      return
    }

    try {
      setIsLoading(true)
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
          setAuthError('Too many failed attempts. Please try again in 5 minutes.')
          return
        }
        
        // Handle specific error cases
        if (error.message.includes('Invalid login credentials')) {
          setAuthError('Invalid email or password. Please try again.')
        } else if (error.message.includes('Email not confirmed')) {
          setAuthError('Please confirm your email address before signing in.')
        } else {
          setAuthError(error.message)
        }
        return
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
        setAuthError('Authentication failed. Please try again.')
      }
    } catch (err: any) {
      setAuthError(err?.message || 'An unexpected error occurred. Please try again.')
      console.error('[sign-in] Error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Handle Google auth completion -> exchange id_token with Supabase
  useEffect(() => {
    const run = async () => {
      if (!isGoogleConfigured) return
      if (response?.type !== 'success') return
      const idToken = response.params.id_token
      if (!idToken) {
        setAuthError('Google did not return id_token')
        return
      }
      if (!isSupabaseConfigured) {
        setAuthError('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.')
        return
      }
      try {
        setIsLoading(true)
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
          setAuthError('No session returned after Google sign-in.')
        }
      } catch (e: any) {
        setAuthError(e?.message || 'Google sign-in failed')
        console.error('[google] Error:', e)
      } finally {
        setIsLoading(false)
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response])
  
  
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
                editable={!isLoading}
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
              {getFieldError('password') && <Text className="text-xs text-red-400 mt-1">{getFieldError('password')}</Text>}
            </View>

            <View className="flex-row items-center">
              <Checkbox 
                checked={rememberMe} 
                onCheckedChange={setRememberMe}
                disabled={isLoading}
              />
              <TouchableOpacity 
                onPress={() => !isLoading && setRememberMe(!rememberMe)}
                disabled={isLoading}
              >
                <Text className="text-white/80 text-sm ml-2">Remember me</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={handleSubmit} disabled={isLoading} className="w-full bg-emerald-600 rounded py-3 items-center flex-row justify-center">
              {isLoading ? (
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
                        setAuthError('No Apple identity token')
                        return
                      }
                      if (!isSupabaseConfigured) {
                        setAuthError('Supabase is not configured.')
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
                        setAuthError('Apple sign-in failed')
                        console.error(e)
                      }
                    }
                  }}
                />
              </View>
            )}

            <TouchableOpacity
              disabled={!isGoogleConfigured || isLoading || !request}
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
  )
}
