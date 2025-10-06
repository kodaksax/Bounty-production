"use client"
import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

export default function SignUpRoute() {
  return <SignUpForm />
}

export function SignUpForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async () => {
    setAuthError(null)

    if (!email) return setAuthError('Email is required')
    if (!password) return setAuthError('Password is required')
    if (password.length < 6) return setAuthError('Password must be at least 6 characters')
    if (password !== confirmPassword) return setAuthError('Passwords do not match')
    if (!isSupabaseConfigured) return setAuthError('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.')

    try {
      setIsLoading(true)
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      })
      if (error) throw error

      // If email confirmations are enabled, session may be null until user verifies email
      if (data.session) {
        router.replace('/tabs/bounty-app')
      } else {
        // Show a friendly note and route to sign-in
        setAuthError('Check your email to confirm your account, then sign in.')
      }
    } catch (e: any) {
      setAuthError(e?.message || 'Sign-up failed')
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
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!isLoading}
                className="w-full bg-white/5 rounded px-3 py-3 text-white"
                placeholderTextColor="rgba(255,255,255,0.4)"
              />
            </View>

            <View>
              <Text className="text-sm text-white/80 mb-1">Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                secureTextEntry
                editable={!isLoading}
                className="w-full bg-white/5 rounded px-3 py-3 text-white"
                placeholderTextColor="rgba(255,255,255,0.4)"
              />
            </View>

            <View>
              <Text className="text-sm text-white/80 mb-1">Confirm Password</Text>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm password"
                secureTextEntry
                editable={!isLoading}
                className="w-full bg-white/5 rounded px-3 py-3 text-white"
                placeholderTextColor="rgba(255,255,255,0.4)"
              />
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
