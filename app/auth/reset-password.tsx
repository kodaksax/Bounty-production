"use client"
import { MaterialIcons } from '@expo/vector-icons'
import { BrandingLogo } from 'components/ui/branding-logo'
import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { useRouter } from 'expo-router'
import { requestPasswordReset } from 'lib/services/auth-service'
import React, { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native'

export default function ResetPasswordRoute() { return <ResetPasswordScreen /> }

export function ResetPasswordScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

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
      
      const result = await requestPasswordReset(email.trim().toLowerCase())
      
      if (result.success) {
        setMessage(result.message)
        setEmailSent(true)
      } else if (result.error === 'rate_limited') {
        setError(result.message)
      } else {
        // For security, show success even if email doesn't exist
        setMessage(result.message)
        setEmailSent(true)
      }
    } catch (e) {
      setError('An unexpected error occurred. Please try again.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleResend = () => {
    setEmailSent(false)
    setMessage(null)
    handleReset()
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 bg-emerald-700/95 px-6 pt-20 pb-8">
          {/* Header */}
          <View className="flex-row items-center justify-center mb-6">
            <BrandingLogo size="large" />
          </View>
          
          {/* Title and Description */}
          <View className="items-center mb-8">
            <View className="bg-white/10 rounded-full p-4 mb-4">
              <MaterialIcons name="lock-reset" size={32} color="#fff" />
            </View>
            <Text className="text-white font-bold text-xl mb-2">Reset Password</Text>
            <Text className="text-white/70 text-center text-sm px-4">
              {emailSent 
                ? "We've sent you an email with instructions to reset your password."
                : "Enter your email address and we'll send you a link to reset your password."}
            </Text>
          </View>

          {/* Error Alert */}
          {error && (
            <View className="bg-red-500/20 border border-red-400 rounded-lg p-4 mb-4 flex-row items-start">
              <MaterialIcons name="error-outline" size={20} color="#f87171" style={{ marginTop: 2 }} />
              <View className="ml-3 flex-1">
                <Text className="text-red-200 text-sm">{error}</Text>
              </View>
              <TouchableOpacity onPress={() => setError(null)}>
                <MaterialIcons name="close" size={20} color="#f87171" />
              </TouchableOpacity>
            </View>
          )}
          
          {/* Success Message */}
          {message && (
            <View className="bg-emerald-600/30 border border-emerald-400 rounded-lg p-4 mb-4 flex-row items-start">
              <MaterialIcons name="check-circle" size={20} color="#34d399" style={{ marginTop: 2 }} />
              <View className="ml-3 flex-1">
                <Text className="text-emerald-200 text-sm">{message}</Text>
              </View>
            </View>
          )}

          <View className="gap-5">
            {/* Email Input */}
            {!emailSent && (
              <View>
                <Label className="text-white/80 mb-1">Email Address</Label>
                <View className="relative">
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
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      color: '#fff',
                      paddingLeft: 44,
                    }}
                  />
                  <View className="absolute left-3 top-1/2 -translate-y-1/2">
                    <MaterialIcons name="email" size={20} color="rgba(255,255,255,0.5)" />
                  </View>
                </View>
                {fieldError && (
                  <View className="flex-row items-center mt-2">
                    <MaterialIcons name="error-outline" size={14} color="#f87171" />
                    <Text className="text-red-400 text-xs ml-1">{fieldError}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Action Buttons */}
            {emailSent ? (
              <View className="gap-3">
                {/* Open Email App */}
                <Button onPress={() => {
                  // This is a placeholder - in production, use expo-mail-composer
                }} className="w-full">
                  <View className="flex-row items-center justify-center">
                    <MaterialIcons name="email" size={20} color="#fff" style={{ marginRight: 8 }} />
                    <Text className="text-white font-medium">Open Email App</Text>
                  </View>
                </Button>

                {/* Resend Email */}
                <TouchableOpacity 
                  onPress={handleResend} 
                  disabled={loading}
                  className="py-3 items-center"
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-white/80 text-sm">
                      Didn
                      {"'"}
                      t receive the email? <Text className="text-emerald-300 underline">Resend</Text>
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Additional Help */}
                <View className="bg-white/5 rounded-lg p-4 mt-4">
                  <Text className="text-white/60 text-xs text-center mb-2">
                    Check your spam folder if you don
                    {"'"}
                    t see the email.
                  </Text>
                  <Text className="text-white/60 text-xs text-center">
                    The reset link will expire in 1 hour.
                  </Text>
                </View>
              </View>
            ) : (
              <Button disabled={loading} onPress={handleReset} className="w-full">
                <View className="flex-row items-center justify-center">
                  {loading ? (
                    <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                  ) : (
                    <MaterialIcons name="send" size={20} color="#fff" style={{ marginRight: 8 }} />
                  )}
                  <Text className="text-white font-medium">
                    {loading ? 'Sending...' : 'Send Reset Link'}
                  </Text>
                </View>
              </Button>
            )}

            {/* Back to Sign In */}
            <TouchableOpacity 
              onPress={() => router.push('/auth/sign-in-form')} 
              className="flex-row items-center justify-center py-3 mt-2"
            >
              <MaterialIcons name="arrow-back" size={18} color="rgba(255,255,255,0.8)" />
              <Text className="text-white/80 ml-2">Back to Sign In</Text>
            </TouchableOpacity>
          </View>

          {/* Security Note */}
          <View className="mt-auto pt-8">
            <View className="flex-row items-center justify-center bg-white/5 rounded-lg p-3">
              <MaterialIcons name="security" size={16} color="rgba(255,255,255,0.5)" />
              <Text className="text-white/50 text-xs ml-2">
                Your security is our priority. Reset links are single-use and expire after 1 hour.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}