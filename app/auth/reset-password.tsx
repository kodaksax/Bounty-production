"use client"
import { useNavigation } from '@react-navigation/native'
import { Alert, AlertDescription } from 'components/ui/alert'
import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { supabase } from 'lib/supabase'
import React, { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native'

export default function ResetPasswordRoute() { return <ResetPasswordScreen /> }

export function ResetPasswordScreen() {
  const navigation = useNavigation<any>()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleReset = async () => {
    setMessage(null); setError(null)
    if (!email) { setError('Email required'); return }
    try {
      setLoading(true)
      const redirectTo = process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL || 'https://your-app.com/auth/callback'
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (error) { setError(error.message); return }
      setMessage('If that email exists, a reset link was sent.')
    } catch (e) {
      setError('Unexpected error')
      console.error(e)
    } finally { setLoading(false) }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 bg-emerald-700/95 px-6 pt-20 pb-8">
          <Text className="text-white font-extrabold text-3xl tracking-widest mb-8 text-center">BOUNTY</Text>
          <Text className="text-white/80 text-base mb-6 text-center">Password Reset</Text>
          {error && (
            <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>
          )}
          {message && (
            <Alert className="mb-4"><AlertDescription>{message}</AlertDescription></Alert>
          )}
          <View className="gap-5">
            <View>
              <Label>Email</Label>
              <Input value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" />
            </View>
            <Button disabled={loading} onPress={handleReset} className="w-full">
              {loading ? 'Sending...' : 'Send Reset Link'}
            </Button>
            <Button variant="link" onPress={() => navigation.goBack()} className="mt-2">Back</Button>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}