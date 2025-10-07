"use client"
import { Alert, AlertDescription } from 'components/ui/alert'
import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { useRouter } from 'expo-router'
import { supabase } from 'lib/supabase'
import React, { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native'

export default function ResetPasswordRoute() { return <ResetPasswordScreen /> }

export function ResetPasswordScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const validateEmail = (email: string): boolean => {
    setFieldError(null)
    if (!email || email.trim().length === 0) {
      setFieldError('Email is required')
      return false
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setFieldError('Please enter a valid email address')
      return false
    }
    return true
  }

  const handleReset = async () => {
    setMessage(null)
    setError(null)
    setFieldError(null)
    
    if (!validateEmail(email)) return
    
    try {
      setLoading(true)
      const redirectTo = process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL || 'https://your-app.com/auth/callback'
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo })
      
      if (error) {
        if (error.message.includes('rate limit')) {
          setError('Too many requests. Please try again later.')
        } else {
          setError(error.message)
        }
        return
      }
      
      setMessage('If that email exists, a reset link was sent. Please check your inbox.')
    } catch (e) {
      setError('An unexpected error occurred. Please try again.')
      console.error(e)
    } finally {
      setLoading(false)
    }
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
              <Input 
                value={email} 
                onChangeText={(text) => {
                  setEmail(text)
                  if (fieldError) setFieldError(null)
                }} 
                placeholder="you@example.com" 
                autoCapitalize="none" 
                autoComplete="email"
                keyboardType="email-address"
                editable={!loading}
              />
              {fieldError && <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{fieldError}</Text>}
            </View>
            <Button disabled={loading} onPress={handleReset} className="w-full">
              {loading ? 'Sending...' : 'Send Reset Link'}
            </Button>
            <Button variant="link" onPress={() => router.push('/auth/sign-in-form')} className="mt-2">Back to Sign In</Button>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}