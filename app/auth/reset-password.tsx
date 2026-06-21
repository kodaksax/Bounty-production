"use client"
import { MaterialIcons } from '@expo/vector-icons'
import { BrandingLogo } from 'components/ui/branding-logo'
import { Label } from 'components/ui/label'
import { useRouter } from 'expo-router'
import { requestPasswordReset } from 'lib/services/auth-service'
import { useAppThemeContext } from 'lib/themes/AppThemeContext'
import { isValidEmail } from 'lib/utils/password-validation'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

/** Seconds to wait between reset requests */
const RESEND_COOLDOWN_SECONDS = 60
/** Maximum reset attempts before temporary lockout */
const MAX_RESET_ATTEMPTS = 5
/** Lockout duration in seconds after exceeding max attempts */
const LOCKOUT_DURATION_SECONDS = 300 // 5 minutes

export default function ResetPasswordRoute() { return <ResetPasswordScreen /> }

export function ResetPasswordScreen() {
  const router = useRouter()
  const { theme } = useAppThemeContext()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  // Cooldown timer state
  const [resendCooldown, setResendCooldown] = useState(0)

  // Attempt tracking state
  const [resetAttempts, setResetAttempts] = useState(0)
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null)

  // Cooldown countdown effect
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setTimeout(() => {
      setResendCooldown(prev => prev - 1)
    }, 1000)
    return () => clearTimeout(timer)
  }, [resendCooldown])

  const isLockedOut = useCallback((): boolean => {
    if (!lockoutUntil) return false
    if (Date.now() < lockoutUntil) return true
    // Lockout expired — reset
    setLockoutUntil(null)
    setResetAttempts(0)
    return false
  }, [lockoutUntil])

  const lockoutMessage = useCallback((): string => {
    const remainingSec = Math.ceil(((lockoutUntil ?? 0) - Date.now()) / 1000)
    const remainingMin = Math.ceil(remainingSec / 60)
    return `Too many attempts. Please try again in ${remainingMin} minute${remainingMin !== 1 ? 's' : ''}.`
  }, [lockoutUntil])

  const validateEmail = (value: string): boolean => {
    setFieldError(null)
    if (!value || value.trim().length === 0) {
      setFieldError('Email is required')
      return false
    }
    if (!isValidEmail(value)) {
      setFieldError('Please enter a valid email address')
      return false
    }
    return true
  }

  const handleReset = async () => {
    setMessage(null)
    setError(null)
    setFieldError(null)

    // Check lockout
    if (isLockedOut()) {
      setError(lockoutMessage())
      return
    }

    // Check cooldown
    if (resendCooldown > 0) {
      setError(`Please wait ${resendCooldown} seconds before requesting another reset link.`)
      return
    }

    if (!validateEmail(email)) return

    // Track attempt
    const newAttempts = resetAttempts + 1
    setResetAttempts(newAttempts)

    if (newAttempts >= MAX_RESET_ATTEMPTS) {
      const lockout = Date.now() + LOCKOUT_DURATION_SECONDS * 1000
      setLockoutUntil(lockout)
      setError(`Too many attempts. Please try again in ${Math.ceil(LOCKOUT_DURATION_SECONDS / 60)} minutes.`)
      console.warn('[reset-password] Lockout triggered', { attempts: newAttempts })
      return
    }

    try {
      setLoading(true)

      const result = await requestPasswordReset(email.trim().toLowerCase())

      if (result.success) {
        setMessage(result.message)
        setEmailSent(true)
        setResendCooldown(RESEND_COOLDOWN_SECONDS)
      } else if (result.error === 'rate_limited') {
        setError(result.message)
      } else {
        // Actual failure (e.g. unexpected error) — show the error message
        setError(result.message)
      }
    } catch (e) {
      setError('An unexpected error occurred. Please try again.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleResend = () => {
    if (resendCooldown > 0 || isLockedOut()) return
    setEmailSent(false)
    setMessage(null)
    handleReset()
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 px-6 pt-20 pb-8" style={{ backgroundColor: theme.background }}>
          {/* Header */}
          <View className="flex-row items-center justify-center mb-6">
            <BrandingLogo size="large" />
          </View>

          {/* Title and Description */}
          <View className="items-center mb-8">
            <View className="rounded-full p-4 mb-4" style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary }}>
              <MaterialIcons name="lock-reset" size={32} color={theme.text} />
            </View>
            <Text className="font-bold text-xl mb-2" style={{ color: theme.text }}>Reset Password</Text>
            <Text className="text-center text-sm px-4" style={{ color: theme.text }}>
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
                <Text style={{ color: theme.isDark ? '#fecaca' : '#991b1b', fontSize: 14 }}>{error}</Text>
              </View>
              <TouchableOpacity onPress={() => setError(null)}>
                <MaterialIcons name="close" size={20} color="#f87171" />
              </TouchableOpacity>
            </View>
          )}

          {/* Success Message */}
          {message && (
            <View className="rounded-lg p-4 mb-4 flex-row items-start" style={{ backgroundColor: theme.surfaceSecondary, borderWidth: 1, borderColor: theme.border }}>
              <MaterialIcons name="check-circle" size={20} color="#059669" style={{ marginTop: 2 }} />
              <View className="ml-3 flex-1">
                <Text style={{ color: theme.text, fontSize: 14 }}>{message}</Text>
              </View>
            </View>
          )}

          <View className="gap-5">
            {/* Email Input */}
            {!emailSent && (
              <View>
                <Label className="mb-1" style={{ color: theme.text }}>Email Address</Label>
                <View className="relative">
                  <TextInput
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
                    placeholderTextColor={theme.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'}
                    textContentType={Platform.OS === 'ios' ? 'emailAddress' : undefined}
                    style={{
                      color: theme.text,
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary,
                      borderRadius: 8,
                      paddingLeft: 48,
                      paddingRight: 16,
                      paddingVertical: 12,
                      fontSize: 16,
                      borderWidth: fieldError ? 1 : 0,
                      borderColor: fieldError ? '#f87171' : 'transparent',
                    }}
                  />
                  <View className="absolute left-3 top-1/2 -translate-y-1/2">
                    <MaterialIcons name="email" size={20} color={theme.textSecondary} />
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
                <TouchableOpacity
                  onPress={() => {
                    // This is a placeholder - in production, use expo-mail-composer
                  }}
                  className="w-full bg-[#059669] rounded-lg py-3 items-center"
                >
                  <Text className="text-white font-medium">Open Email App</Text>
                </TouchableOpacity>

                {/* Resend Email */}
                <TouchableOpacity
                  onPress={handleResend}
                  disabled={loading || resendCooldown > 0 || isLockedOut()}
                  className="py-3 items-center"
                >
                  {loading ? (
                    <ActivityIndicator color={theme.primary} />
                  ) : resendCooldown > 0 ? (
                    <Text className="text-sm" style={{ color: theme.textSecondary }}>
                      Resend available in {resendCooldown}s
                    </Text>
                  ) : (
                    <Text className="text-sm" style={{ color: theme.text }}>
                      Didn
                      {"'"}
                      t receive the email? <Text className="text-[#6ee7b7] underline">Resend</Text>
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Additional Help */}
                <View className="rounded-lg p-4 mt-4" style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary }}>
                  <Text className="text-xs text-center mb-2" style={{ color: theme.textSecondary }}>
                    Check your spam folder if you don
                    {"'"}
                    t see the email.
                  </Text>
                  <Text className="text-xs text-center" style={{ color: theme.textSecondary }}>
                    The reset link will expire in 1 hour.
                  </Text>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                disabled={loading || resendCooldown > 0 || isLockedOut()}
                onPress={handleReset}
                className={`w-full rounded-lg py-3 items-center ${
                  loading || resendCooldown > 0 || isLockedOut()
                    ? 'bg-[#059669]/50'
                    : 'bg-[#059669]'
                }`}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-medium">Send Reset Link</Text>
                )}
              </TouchableOpacity>
            )}

            {/* Back to Sign In */}
            <TouchableOpacity
              onPress={() => router.push('/auth/sign-in-form')}
              className="flex-row items-center justify-center py-3 mt-2"
            >
              <MaterialIcons name="arrow-back" size={18} color={theme.text} />
              <Text className="ml-2" style={{ color: theme.text }}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>

          {/* Security Note */}
          <View className="mt-auto pt-8">
            <View className="flex-row items-center justify-center rounded-lg p-3" style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.surfaceSecondary }}>
              <MaterialIcons name="security" size={16} color={theme.textSecondary} />
              <Text className="text-xs ml-2" style={{ color: theme.textSecondary }}>
                Your security is our priority. Reset links are single-use and expire after 1 hour.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
