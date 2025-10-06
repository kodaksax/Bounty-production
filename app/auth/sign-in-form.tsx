"use client"

import { MaterialIcons } from '@expo/vector-icons';
import { Alert, AlertDescription } from "components/ui/alert";
import * as AppleAuthentication from 'expo-apple-authentication';
import { makeRedirectUri, ResponseType } from 'expo-auth-session';
import {
  useIdTokenAuthRequest as useGoogleIdTokenAuthRequest,
} from 'expo-auth-session/providers/google';
import { useRouter } from "expo-router";
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import type React from "react";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";

// Added The Next Line For Testing

export default function SignInRoute() {
  return <SignInForm />
}

export function SignInForm() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState("") // email or username
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<{ [key: string]: string }>({})
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Complete auth session for iOS standalone/browser
  WebBrowser.maybeCompleteAuthSession()

  // Configure Google auth (Expo Auth Session)
  const iosGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || 'placeholder-ios-client-id'
  const androidGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || 'placeholder-android-client-id'
  const webGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || 'placeholder-web-client-id'
  const isGoogleConfigured = Boolean(
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  )
  const expoRedirectUri = makeRedirectUri({
    // native scheme may be auto configured by expo
    // preferReturningParams: true,
  })
  const [request, response, promptAsync] = useGoogleIdTokenAuthRequest({
    responseType: ResponseType.IdToken,
    clientId: Platform.select({
      ios: iosGoogleClientId,
      android: androidGoogleClientId,
      default: webGoogleClientId,
    }),
    iosClientId: iosGoogleClientId,
    androidClientId: androidGoogleClientId,
    webClientId: webGoogleClientId,
    redirectUri: expoRedirectUri,
    // select which scopes you need; openid provides id_token
    scopes: ['openid', 'email', 'profile'],
  })

  const navigateToSignUp = () => {
    router.push("/auth/sign-up-form")
  }

  const handleSubmit = async () => {
    setErrors({})
    setAuthError(null)

    // Basic frontend validation
    if (!identifier || !password) {
      setErrors({ general: "Email and password are required." })
      return
    }

    try {
      setIsLoading(true)

      // Call backend sign-in endpoint
      const localHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
      const baseUrl = process.env.API_BASE_URL || `http://${localHost}:3001`;
      
      const response = await fetch(`${baseUrl}/app/auth/sign-in-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier.trim(), password })
      });

      const data = await response.json();

      if (!response.ok) {
        setAuthError(data.error || 'Failed to sign in');
        return;
      }

      // Store the access token if provided
      if (data.session?.access_token) {
        await SecureStore.setItemAsync('sb-access-token', data.session.access_token);
      }

      // Navigate to the app
      router.push('/tabs/bounty-app');
      
    } catch (err) {
      setAuthError("An unexpected error occurred")
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const getFieldError = (field: string) => {
    return errors[field]
  }

  // When Google auth completes, exchange idToken with your backend
  useEffect(() => {
    const handleGoogleResponse = async () => {
      if (!response) return
      if (!isGoogleConfigured) return
      if (response.type === 'success') {
        const idToken = (response.params as any)?.id_token || (response.authentication as any)?.idToken
        if (!idToken) {
          setAuthError('Google sign-in failed: missing id_token')
          return
        }
        try {
          setIsLoading(true)
          const localHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost'
          const baseUrl = process.env.API_BASE_URL || `http://${localHost}:3001`
          const res = await fetch(`${baseUrl}/auth/google/callback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          })
          const data = await res.json()
          if (!res.ok) {
            setAuthError(data?.error || 'Failed to sign in with Google')
            return
          }
          if (data.session?.access_token) {
            await SecureStore.setItemAsync('sb-access-token', data.session.access_token)
          }
          router.push('/tabs/bounty-app')
        } catch (e) {
          console.error(e)
          setAuthError('Google sign-in failed')
        } finally {
          setIsLoading(false)
        }
      } else if (response.type === 'error') {
        setAuthError(response.error?.message || 'Google sign-in canceled')
      }
    }
    handleGoogleResponse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response, isGoogleConfigured])

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 bg-emerald-700/95 px-6 pt-20 pb-8">
          <View className="items-center mb-10">
            <Text className="text-white font-extrabold text-3xl tracking-widest mt-2">BOUNTY</Text>
          </View>

          {/* Segmented Toggle */}
          <View className="flex-row mb-6 rounded-full overflow-hidden bg-black/30">
            <TouchableOpacity
              className="flex-1 py-2 items-center justify-center"
              onPress={() => router.push('/auth/sign-up-form')}
            >
              <Text className="text-white/70 font-medium text-sm">Register</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 py-2 items-center justify-center bg-emerald-500"
              onPress={() => { /* already here */ }}
              disabled
            >
              <Text className="text-white font-medium text-sm">Login</Text>
            </TouchableOpacity>
          </View>

          {authError && (
            <View className="mb-4">
              <Alert variant="destructive">
                <AlertDescription>{authError}</AlertDescription>
              </Alert>
            </View>
          )}

          <View className="gap-5">
            <View>
              <Text className="text-sm text-white/80 mb-1">Email or Username</Text>
              <TextInput
                nativeID="identifier"
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="you@example.com or username"
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!isLoading}
                className="w-full bg-white/5 rounded px-3 py-3 text-white"
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
                  onChangeText={setPassword}
                  placeholder="Password"
                  secureTextEntry={!showPassword}
                  editable={!isLoading}
                  className="w-full bg-white/5 rounded px-3 py-3 text-white"
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

            <TouchableOpacity onPress={handleSubmit} disabled={isLoading} className="w-full bg-emerald-600 rounded py-3 items-center flex-row justify-center">
              {isLoading ? (
                <>
                  <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                  <Text className="text-white">Signing in...</Text>
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
          // TODO: send credential.authorizationCode/idToken to your backend
        } catch (e: any) {
          if (e?.code !== 'ERR_REQUEST_CANCELED') {
            setAuthError('Apple sign-in failed')
          }
        }
      }}
    />
  </View>
)}

            
            <TouchableOpacity
              disabled={!request || isLoading || !isGoogleConfigured}
              onPress={() => {
                if (!isGoogleConfigured) {
                  setAuthError('Google Sign-In not configured. Add EXPO_PUBLIC_GOOGLE_*_CLIENT_ID envs to enable.')
                  return
                }
                promptAsync()
              }}
              className="w-full bg-white rounded py-3 items-center flex-row justify-center"
              style={{ marginTop: 12 }}
            >
              {isLoading ? (
                <>
                  <ActivityIndicator color="#000" style={{ marginRight: 8 }} />
                  <Text className="text-black">Connecting...</Text>
                </>
              ) : (
                <>
                  <MaterialIcons name="login" size={18} color="#000" style={{ marginRight: 8 }} />
                  <Text className="text-black font-medium">{isGoogleConfigured ? 'Continue with Google' : 'Google setup required'}</Text>
                </>
              )}
            </TouchableOpacity>
            {!isGoogleConfigured && (
              <View className="mt-2 items-center">
                <Text className="text-white/70 text-xs">
                  Set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID / ANDROID / WEB in env to enable Google login.
                </Text>
              </View>
            )}

            <View className="items-center mt-2">
              <Text className="text-sm text-white/80">Don't have an account?</Text>
              <TouchableOpacity onPress={() => router.push('/auth/sign-up-form')} className="mt-1">
                <Text className="text-emerald-200 text-sm font-medium">Register</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
