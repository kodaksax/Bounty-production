"use client"

import { MaterialIcons } from '@expo/vector-icons'
import type React from "react"
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native"

import { useNavigation } from "@react-navigation/native"
import { Alert, AlertDescription } from "components/ui/alert"
import * as SecureStore from 'expo-secure-store'
import { supabase } from 'lib/supabase'
import { useState } from "react"

// Added The Next Line For Testing
import { Button } from 'components/ui/button'
import { navigate } from 'expo-router/build/global-state/routing'

const navigateForTesting = () => {
  navigate('../tabs/bounty-app');
}

export default function SignInRoute() {
  return <SignInForm />
}

export function SignInForm() {
  const navigation = useNavigation<any>()
  const [identifier, setIdentifier] = useState("") // email or username
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<{ [key: string]: string }>({})
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = async () => {
    setErrors({})
    setAuthError(null)

    // Basic frontend validation
    if (!identifier || !password) {
      setErrors({ general: "Credentials required." })
      return
    }

    try {
      setIsLoading(true)

      // First attempt Supabase sign-in: if identifier looks like email use email, else treat as username by fetching profile email
      let emailForLogin = identifier;
      const looksEmail = /.+@.+\..+/.test(identifier);
      if (!looksEmail) {
        // fetch username -> email mapping from backend (public endpoint could be added; for now attempt sign-in with placeholder will fail)
        // Fallback: call backend mock sign-in to resolve email
        const resolveResp = await fetch(`${process.env.API_BASE_URL || 'http://localhost:3001'}/auth/sign-in`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password })
        });
        const resolveJson = await resolveResp.json();
        if (resolveResp.ok && resolveJson.user?.email) {
          emailForLogin = resolveJson.user.email;
        }
      }

      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email: emailForLogin, password });
      if (signInErr) {
        setAuthError(signInErr.message || 'Failed to sign in');
        return;
      }
      if (signInData?.session?.access_token) {
        await SecureStore.setItemAsync('sb-access-token', signInData.session.access_token);
      }

      // Navigate after success
      // @ts-ignore
      navigation.navigate('Dashboard');
      
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
              onPress={() => navigation.navigate('SignUp')}
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
                <TouchableOpacity onPress={() => navigation.navigate('ResetPassword')}>
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

            <View className="items-center mt-2">
              <Text className="text-sm text-white/80">Don't have an account?</Text>
              <TouchableOpacity onPress={() => navigation.navigate('SignUp')} className="mt-1">
                <Text className="text-emerald-200 text-sm font-medium">Register</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Button onClick={() => navigateForTesting()}></Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
